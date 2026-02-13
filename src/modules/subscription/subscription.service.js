const { Subscription, Invoice, UsageEvent, AuditLog } = require('src/modules/entities');
const { AppError } = require('src/utils/AppError');
const { UserShop } = require('src/modules/entities');
const { Op } = require('sequelize');
const { sequelize } = require('src/utils/database/database-setup');
const { createLogger } = require('src/utils/structured-logger');
const cacheService = require('src/utils/cache.service');

/**
 * Verify user has access to shop
 */
const verifyShopAccess = async (userId, shopId) => {
    const userShop = await UserShop.findOne({
        where: {
            user_id: userId,
            shop_id: shopId,
            is_active: true
        }
    });

    if (!userShop) {
        throw new AppError('You do not have access to this shop', 403);
    }
    return userShop;
};

/**
 * Get subscription details for a shop
 */
const getSubscription = async (shopId, userId) => {
    await verifyShopAccess(userId, shopId);

    let subscription = await Subscription.findOne({
        where: { shop_id: shopId }
    });

    // If no subscription exists, create a default free plan
    if (!subscription) {
        subscription = await createDefaultSubscription(shopId);
    }

    // Calculate usage percentages and statuses
    const usage = {
        conversations: {
            used: subscription.conversations_used,
            limit: subscription.conversations_limit,
            percentage: (subscription.conversations_used / subscription.conversations_limit) * 100,
            status: getUsageStatus(subscription.conversations_used, subscription.conversations_limit)
        },
        orders: {
            used: subscription.orders_used,
            limit: subscription.orders_limit,
            percentage: (subscription.orders_used / subscription.orders_limit) * 100,
            status: getUsageStatus(subscription.orders_used, subscription.orders_limit)
        },
        products: {
            used: subscription.products_used,
            limit: subscription.products_limit,
            percentage: (subscription.products_used / subscription.products_limit) * 100,
            status: getUsageStatus(subscription.products_used, subscription.products_limit)
        }
    };

    return {
        subscription,
        usage,
        extra_usage: {
            conversations: subscription.extra_conversations,
            charge: parseFloat(subscription.extra_charge)
        }
    };
};

/**
 * Get usage status
 */
const getUsageStatus = (used, limit) => {
    const percentage = (used / limit) * 100;
    if (used > limit) return 'exceeded';
    if (percentage >= 80) return 'warning';
    return 'safe';
};

/**
 * Create default free subscription for new shop
 */
const createDefaultSubscription = async (shopId) => {
    const now = new Date();
    const nextMonth = new Date(now);
    nextMonth.setMonth(nextMonth.getMonth() + 1);

    return await Subscription.create({
        shop_id: shopId,
        plan_name: 'Free',
        plan_price: 0,
        billing_cycle: 'monthly',
        status: 'active',
        conversations_limit: 100,
        orders_limit: 50,
        products_limit: 100,
        current_period_start: now,
        current_period_end: nextMonth,
        next_billing_date: nextMonth,
        features: {
            image_understanding: false,
            advanced_ai: false,
            priority_support: false,
            custom_branding: false,
            rate_limit_per_minute: 10
        }
    });
};

/**
 * Update plan
 */
const updatePlan = async (shopId, userId, planData) => {
    await verifyShopAccess(userId, shopId);

    let subscription = await Subscription.findOne({
        where: { shop_id: shopId }
    });

    if (!subscription) {
        subscription = await createDefaultSubscription(shopId);
    }

    const now = new Date();
    const nextPeriod = new Date(now);
    
    if (planData.billing_cycle === 'yearly') {
        nextPeriod.setFullYear(nextPeriod.getFullYear() + 1);
    } else {
        nextPeriod.setMonth(nextPeriod.getMonth() + 1);
    }

    await subscription.update({
        plan_name: planData.plan_name,
        plan_price: planData.plan_price,
        billing_cycle: planData.billing_cycle,
        conversations_limit: planData.conversations_limit,
        orders_limit: planData.orders_limit,
        products_limit: planData.products_limit,
        features: planData.features || subscription.features,
        current_period_start: now,
        current_period_end: nextPeriod,
        next_billing_date: nextPeriod
    });

    return subscription;
};

/**
 * REFACTORED: Track usage with atomic transactions and idempotency
 * 
 * Ensures:
 * - Usage increments ONLY inside committed transactions
 * - If transaction fails → usage MUST NOT increment
 * - Prevent double counting using idempotency keys (shop_id, resource_type, request_id)
 * - Hard errors if limits exceeded
 * - Persist every increment into audit_logs
 * 
 * @param {string} shopId - Shop UUID
 * @param {string} usageType - 'conversations' | 'orders' | 'products'
 * @param {number} amount - Amount to increment (default: 1)
 * @param {string} requestId - Idempotency key (required for transaction safety)
 * @param {object} metadata - Additional context (resource_id, etc)
 * @returns {Promise<object>} { subscription, usageEvent, isRetry, transactionId }
 * @throws {AppError} If subscription not found, limits exceeded, or transaction fails
 */
const trackUsage = async (shopId, usageType, amount = 1, requestId = null, metadata = {}) => {
    if (!requestId) {
        throw new AppError('requestId is required for idempotent usage tracking', 400);
    }

    if (!['conversations', 'orders', 'products'].includes(usageType)) {
        throw new AppError(`Invalid usage type: ${usageType}`, 400);
    }

    const logger = createLogger(requestId, shopId);
    let transaction = null;

    try {
        // Step 1: Check for duplicate request (idempotency)
        let existingEvent = await UsageEvent.findOne({
            where: {
                shop_id: shopId,
                resource_type: usageType,
                request_id: requestId
            }
        });

        if (existingEvent) {
            // Retry detected - return previous result
            logger.info('Duplicate usage tracking request detected (idempotent retry)', {
                usageType,
                previousStatus: existingEvent.status
            });

            // If previous attempt was rolled back, retry the transaction
            if (existingEvent.status === 'rolled_back') {
                logger.warn('Previous attempt was rolled back, retrying transaction', {
                    usageType
                });
            } else if (existingEvent.status === 'committed') {
                // Successful previous attempt - return without double counting
                const subscription = await Subscription.findOne({ where: { shop_id: shopId } });
                return {
                    subscription,
                    usageEvent: existingEvent,
                    isRetry: true,
                    transactionId: existingEvent.transaction_id,
                    message: 'Usage already tracked for this request (idempotent)'
                };
            }
        }

        // Step 2: Create transaction
        transaction = await sequelize.transaction({
            isolationLevel: 'READ_COMMITTED'
        });

        // Step 3: Lock subscription row for update (prevents concurrent increments)
        const subscription = await Subscription.findOne({
            where: { shop_id: shopId },
            transaction,
            lock: transaction.LOCK.UPDATE // Pessimistic locking
        });

        if (!subscription) {
            throw new AppError('Subscription not found', 404);
        }

        // Step 4: Validate limits before transaction
        const field = `${usageType}_used`;
        const limitField = `${usageType}_limit`;
        const newUsage = subscription[field] + amount;
        const limit = subscription[limitField];

        if (usageType !== 'conversations' && newUsage > limit) {
            // Hard error if limit exceeded for non-conversation usage
            const error = new AppError(
                `Usage limit exceeded for ${usageType}: ${newUsage} > ${limit}`,
                402
            );
            error.code = 'USAGE_LIMIT_EXCEEDED';
            error.limit = limit;
            error.current = newUsage;
            throw error;
        }

        // Step 5: Create UsageEvent record (marks transaction as pending)
        const usageEvent = await UsageEvent.create({
            shop_id: shopId,
            resource_type: usageType,
            request_id: requestId,
            delta: amount,
            transaction_id: transaction.id,
            status: 'pending',
            resource_id: metadata.resourceId || null,
            resource_metadata: metadata || null
        }, { transaction });

        // Step 6: Increment subscription counter (ATOMIC inside transaction)
        let extraCharge = parseFloat(subscription.extra_charge || 0);
        let extraConversations = subscription.extra_conversations || 0;

        // Calculate extra usage charge if exceeded limit
        if (usageType === 'conversations' && newUsage > limit) {
            const extraAmount = newUsage - limit;
            const perConversationCharge = 2.5;
            extraCharge = extraAmount * perConversationCharge;
            extraConversations = extraAmount;
        }

        await subscription.update({
            [field]: newUsage,
            extra_conversations: extraConversations,
            extra_charge: extraCharge
        }, { transaction });

        // Step 7: Create audit log entry (ensures auditability)
        await AuditLog.create({
            shop_id: shopId,
            resource_type: 'subscription_usage',
            resource_id: subscription.id,
            action: 'usage_tracked',
            details: {
                usageType,
                amount,
                newTotal: newUsage,
                limit,
                requestId,
                usageEventId: usageEvent.id
            },
            user_id: null, // System action
            request_id: requestId
        }, { transaction });

        // Step 8: Mark UsageEvent as committed (MUST be inside transaction)
        await usageEvent.update({
            status: 'committed',
            committed_at: new Date()
        }, { transaction });

        // Step 9: Commit transaction
        await transaction.commit();

        logger.info('Usage tracked successfully (transaction committed)', {
            usageType,
            delta: amount,
            newTotal: newUsage,
            limit,
            status: getUsageStatus(newUsage, limit)
        });

        return {
            subscription,
            usageEvent,
            isRetry: false,
            transactionId: transaction.id,
            message: 'Usage tracked successfully'
        };

    } catch (error) {
        // Step 10: Rollback on error
        if (transaction) {
            try {
                await transaction.rollback();
                logger.warn('Transaction rolled back due to error', {
                    usageType,
                    errorMessage: error.message,
                    errorCode: error.code
                });

                // Mark UsageEvent as rolled_back (if it was created)
                await UsageEvent.update(
                    { status: 'rolled_back', error_message: error.message },
                    {
                        where: {
                            shop_id: shopId,
                            resource_type: usageType,
                            request_id: requestId,
                            status: 'pending'
                        }
                    }
                );
            } catch (rollbackError) {
                logger.error('Failed to rollback transaction', rollbackError, {
                    usageType,
                    originalError: error.message
                });
            }
        }

        // Rethrow original error
        if (error instanceof AppError) {
            throw error;
        }

        const appError = new AppError(
            `Usage tracking failed: ${error.message}`,
            500
        );
        appError.code = 'USAGE_TRACKING_FAILED';
        appError.originalError = error;
        throw appError;
    }
};

/**
 * Request conversation pack
 */
const requestConversationPack = async (shopId, userId, packAmount, packPrice) => {
    await verifyShopAccess(userId, shopId);

    const subscription = await Subscription.findOne({
        where: { shop_id: shopId }
    });

    if (!subscription) {
        throw new AppError('Subscription not found', 404);
    }

    // Create an invoice for the pack
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
    const now = new Date();
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + 7); // 7 days to pay

    const invoice = await Invoice.create({
        subscription_id: subscription.id,
        shop_id: shopId,
        invoice_number: invoiceNumber,
        billing_period: now.toLocaleString('default', { month: 'long', year: 'numeric' }),
        invoice_type: `Conversation Pack (${packAmount} conversations)`,
        amount: packPrice,
        base_amount: packPrice,
        extra_usage_amount: 0,
        addon_amount: 0,
        status: 'pending',
        due_date: dueDate,
        notes: `Add-on: ${packAmount} AI conversations`
    });

    return {
        invoice,
        message: `Invoice ${invoiceNumber} created for ${packAmount} conversations. Conversations will be added after payment.`
    };
};

/**
 * Get invoices for a shop
 */
const getInvoices = async (shopId, userId) => {
    await verifyShopAccess(userId, shopId);

    const invoices = await Invoice.findAll({
        where: { shop_id: shopId },
        order: [['created_at', 'DESC']],
        limit: 50
    });

    return invoices;
};

/**
 * Get invoice by ID
 */
const getInvoiceById = async (invoiceId, shopId, userId) => {
    await verifyShopAccess(userId, shopId);

    const invoice = await Invoice.findOne({
        where: { 
            id: invoiceId,
            shop_id: shopId 
        }
    });

    if (!invoice) {
        throw new AppError('Invoice not found', 404);
    }

    return invoice;
};

/**
 * Reset usage counters (called monthly/yearly via cron)
 */
const resetUsageCounters = async (subscriptionId) => {
    const subscription = await Subscription.findByPk(subscriptionId);
    
    if (!subscription) {
        throw new AppError('Subscription not found', 404);
    }

    await subscription.update({
        conversations_used: 0,
        orders_used: 0,
        products_used: 0,
        extra_conversations: 0,
        extra_charge: 0
    });

    return subscription;
};

/**
 * Get usage events for audit trail
 */
const getUsageEvents = async (shopId, filters = {}) => {
    const where = { shop_id: shopId };

    if (filters.resourceType) {
        where.resource_type = filters.resourceType;
    }

    if (filters.status) {
        where.status = filters.status;
    }

    if (filters.startDate || filters.endDate) {
        where.created_at = {};
        if (filters.startDate) {
            where.created_at[Op.gte] = new Date(filters.startDate);
        }
        if (filters.endDate) {
            where.created_at[Op.lte] = new Date(filters.endDate);
        }
    }

    const events = await UsageEvent.findAll({
        where,
        order: [['created_at', 'DESC']],
        limit: filters.limit || 100
    });

    return events;
};

/**
 * Verify no double counting (for testing/debugging)
 */
const verifyNoDoubleCount = async (shopId, resourceType, requestId) => {
    const events = await UsageEvent.findAll({
        where: {
            shop_id: shopId,
            resource_type: resourceType,
            request_id: requestId
        }
    });

    if (events.length > 1) {
        throw new AppError(
            `Double counting detected: ${events.length} events for same request_id`,
            500
        );
    }

    return events.length === 1 && events[0].status === 'committed';
};

const getRateLimitKey = (shopId, customerId) => {
    const bucket = Math.floor(Date.now() / 60000);
    return `rate:${shopId}:${customerId}:${bucket}`;
};

const getRateLimitReset = () => {
    const now = new Date();
    now.setSeconds(0, 0);
    now.setMinutes(now.getMinutes() + 1);
    return now.toISOString();
};

const checkRateLimit = async (shopId, userId, customerId) => {
    await verifyShopAccess(userId, shopId);

    const subscription = await Subscription.findOne({ where: { shop_id: shopId } });
    const limit = subscription?.features?.rate_limit_per_minute || 10;

    const key = getRateLimitKey(shopId, customerId);
    const current = (await cacheService.get(key)) || 0;

    return {
        allowed: current < limit,
        limit,
        current,
        window: 'per_minute',
        reset_at: getRateLimitReset()
    };
};

const incrementRateLimit = async (shopId, userId, customerId) => {
    await verifyShopAccess(userId, shopId);

    const subscription = await Subscription.findOne({ where: { shop_id: shopId } });
    const limit = subscription?.features?.rate_limit_per_minute || 10;

    const key = getRateLimitKey(shopId, customerId);
    const currentCount = await cacheService.increment(key, 1);
    await cacheService.expire(key, 120);

    return {
        current_count: currentCount,
        limit
    };
};

module.exports = {
    getSubscription,
    updatePlan,
    trackUsage,
    requestConversationPack,
    getInvoices,
    getInvoiceById,
    resetUsageCounters,
    createDefaultSubscription,
    getUsageEvents,
    verifyNoDoubleCount,
    checkRateLimit,
    incrementRateLimit
};
