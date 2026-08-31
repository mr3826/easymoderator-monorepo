const { Subscription, Invoice, UsageEvent, AuditLog } = require('../entities');
const crypto = require('crypto');
const { v5: uuidv5, validate: uuidValidate } = require('uuid');

const recordFunnelEventSafe = (event, values) => {
    try {
        return require('../analytics/funnel-events.service')
            .recordFunnelEvent({ event, ...values })
            .catch(() => {});
    } catch (_) {
        return Promise.resolve();
    }
};
const { AppError } = require('../../utils/AppError');
const { UserShop } = require('../entities');
const { Op, Transaction } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');
const { createLogger } = require('../../utils/structured-logger');
const cacheService = require('../../utils/cache.service');
const {
    PlanCode,
    PRICING_TIERS,
    getTierByCode,
    isUnlimitedLimit,
    isLimitExceeded,
    RECURRING_INVOICE_TYPES,
    recurringInvoiceTypeFor
} = require('./subscription.plans');
const {
    effectiveConversationLimit,
    isConversationQuotaExhausted
} = require('./subscription.access');

/**
 * Fixed namespace for hashing non-UUID idempotency keys into usage_events.
 * Never change it: the hash IS the dedup key, so a new namespace would let
 * every in-flight request meter a second time.
 */
const USAGE_REQUEST_NAMESPACE = '7b3f2c1e-9a4d-4f8b-8c2a-1d6e5f0a9b34';

/**
 * usage_events.request_id is a UUID column (widened from TEXT by
 * 20260611_003_schema_drift_sweep), but callers pass whatever identifies their
 * request: the Meta webhook path sends `conv:<uuid>`, and the HTTP path
 * forwards a client-supplied `x-request-id` header verbatim
 * (request-context.middleware.js). Postgres rejects both with "invalid input
 * syntax for type uuid" — and every caller wraps trackUsage in a catch so
 * ingestion is never blocked, so the rejection surfaced only as a log line
 * while the meter silently stayed at zero.
 *
 * Hash anything that is not already a UUID into a stable one. Same input still
 * means same key, so idempotency is unchanged. Every read and write of
 * usage_events.request_id must go through here, or a lookup will miss the row
 * its own write created.
 */
const usageRequestKey = (requestId) => (
    uuidValidate(String(requestId))
        ? String(requestId)
        : uuidv5(String(requestId), USAGE_REQUEST_NAMESPACE)
);

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

const cancelOpenRecurringInvoices = async (subscriptionId, transaction = null) => {
    if (typeof Invoice?.update !== 'function') return;
    const options = {
        where: {
            subscription_id: subscriptionId,
            invoice_type: { [Op.in]: RECURRING_INVOICE_TYPES },
            status: { [Op.in]: ['pending', 'overdue'] },
        },
    };
    if (transaction) options.transaction = transaction;
    await Invoice.update(
        { status: 'cancelled', notes: 'Cancelled because the subscription plan changed' },
        options,
    );
};

/**
 * Get subscription details for a shop
 */
const getSubscription = async (shopId, userId) => {
    await verifyShopAccess(userId, shopId);

    let subscription = await Subscription.findOne({
        where: { shop_id: shopId }
    });

    // If no subscription exists, create the free-forever Shuru entitlement.
    if (!subscription) {
        subscription = await createDefaultSubscription(shopId);
    }

    const conversationLimit = effectiveConversationLimit(subscription);

    // Calculate usage percentages and statuses
    const usage = {
        conversations: {
            used: subscription.conversations_used,
            limit: conversationLimit,
            included_limit: subscription.conversations_limit,
            topup_balance: Math.max(0, Number(subscription.topup_balance) || 0),
            percentage: getUsagePercentage(subscription.conversations_used, conversationLimit),
            status: getUsageStatus(subscription.conversations_used, conversationLimit)
        },
        orders: {
            used: subscription.orders_used,
            limit: subscription.orders_limit,
            percentage: getUsagePercentage(subscription.orders_used, subscription.orders_limit),
            status: getUsageStatus(subscription.orders_used, subscription.orders_limit)
        },
        products: {
            used: subscription.products_used,
            limit: subscription.products_limit,
            percentage: getUsagePercentage(subscription.products_used, subscription.products_limit),
            status: getUsageStatus(subscription.products_used, subscription.products_limit)
        }
    };

    let partnerEligibility = {
        delivered_orders_30d: 0,
        minimum_delivered_orders: 300,
        eligible: false,
        available: true
    };
    try {
        const { countRecentDeliveredOrders } = require('./partner.service');
        const deliveredOrders = await countRecentDeliveredOrders(shopId);
        partnerEligibility = {
            delivered_orders_30d: deliveredOrders,
            minimum_delivered_orders: 300,
            eligible: deliveredOrders >= 300,
            available: true
        };
    } catch (error) {
        partnerEligibility = {
            ...partnerEligibility,
            available: false
        };
    }

    return {
        subscription,
        usage,
        effective_conversation_limit: conversationLimit,
        conversation_quota_exhausted: isConversationQuotaExhausted(subscription),
        period: {
            start: subscription.current_period_start,
            end: subscription.current_period_end
        },
        partner_eligibility: partnerEligibility,
        extra_usage: {
            conversations: 0,
            charge: 0
        }
    };
};

/**
 * Get usage status
 */
const getUsageStatus = (used, limit) => {
    if (isUnlimitedLimit(limit)) return 'safe';
    const percentage = (used / limit) * 100;
    if (used >= limit) return 'exceeded';
    if (percentage >= 70) return 'warning';
    return 'safe';
};

const getUsagePercentage = (used, limit) => {
    if (isUnlimitedLimit(limit) || limit === 0) return 0;
    return Math.min(100, Math.max(0, (used / limit) * 100));
};

/**
 * Create the default subscription for a new shop: free-forever SHURU.
 * Shuru uses a synthetic monthly period anchored at signup; the daily reset job
 * advances that period from its recorded boundary rather than relying on a
 * calendar-month or trial countdown.
 */
const createDefaultSubscription = async (shopId, { transaction = null, emitEvent = true } = {}) => {
    const now = new Date();
    const nextPeriod = new Date(now);
    nextPeriod.setMonth(nextPeriod.getMonth() + 1);
    const shuruTier = PRICING_TIERS[PlanCode.SHURU];

    const values = {
        shop_id: shopId,
        plan_code: shuruTier.code,
        plan_name: shuruTier.name,
        plan_price: shuruTier.priceBdtMonthly,
        billing_cycle: 'monthly',
        billing_model: shuruTier.billingModel,
        per_order_charge_bdt: shuruTier.perOrderChargeBdt,
        status: 'active',
        trial_ends_at: null,
        conversations_limit: shuruTier.conversationsLimit,
        orders_limit: shuruTier.ordersLimit,
        products_limit: shuruTier.productsLimit,
        current_period_start: now,
        current_period_end: nextPeriod,
        next_billing_date: nextPeriod,
        features: shuruTier.features
    };
    const subscription = transaction
        ? await Subscription.create(values, { transaction })
        : await Subscription.create(values);
    if (emitEvent) {
        recordFunnelEventSafe('plan_assigned_shuru', {
            shopId,
            metadata: { plan_code: PlanCode.SHURU },
            onceKey: `plan_assigned_shuru:${shopId}`,
        });
    }
    return subscription;
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

    const requestedCode = String(planData?.plan_code || '').toUpperCase();
    if (![PlanCode.SHURU, PlanCode.GROWTH].includes(requestedCode)) {
        throw new AppError('Only Shuru and Growth can be selected from the merchant billing page', 403);
    }

    const selectedTier = PRICING_TIERS[requestedCode];
    const billingCycle = planData.billing_cycle || 'monthly';
    if (!['monthly', 'yearly'].includes(billingCycle)) {
        throw new AppError('Invalid billing cycle', 400);
    }
    // Annual Growth remains readable and renewable for existing customers, but
    // new plan selections are monthly-only because annual is retired from the
    // marketing/signup flow.
    if (billingCycle === 'yearly'
        && !(subscription.plan_code === PlanCode.GROWTH && subscription.billing_cycle === 'yearly')) {
        throw new AppError('Annual billing is available only to existing annual Growth subscribers', 400);
    }

    const currentPlanCode = String(subscription.plan_code || '').toUpperCase();
    if (requestedCode === PlanCode.GROWTH) {
        const isSameActivePlan = currentPlanCode === PlanCode.GROWTH
            && subscription.status === 'active'
            && billingCycle === subscription.billing_cycle;
        if (isSameActivePlan) return subscription;

        throw new AppError(
            'Growth activation requires a successful bKash payment',
            402,
            'PAYMENT_REQUIRED',
        );
    }

    const now = new Date();
    const nextPeriod = new Date(now);

    if (billingCycle === 'yearly') {
        nextPeriod.setFullYear(nextPeriod.getFullYear() + 1);
    } else {
        nextPeriod.setMonth(nextPeriod.getMonth() + 1);
    }

    const calculatedPlanPrice = billingCycle === 'yearly'
        ? selectedTier.priceBdtYearly
        : selectedTier.priceBdtMonthly;

    const oldPrice = parseFloat(subscription.plan_price || 0);
    const oldPlanCode = subscription.plan_code;
    const newPrice = calculatedPlanPrice;
    const newPlanName = selectedTier.name;

    // Proration: on upgrade mid-cycle, charge the difference for remaining days.
    // Downgrade takes effect at the next billing date — no immediate charge.
    const isUpgrade = newPrice > oldPrice;
    const periodStart = subscription.current_period_start
        ? new Date(subscription.current_period_start)
        : now;
    const periodEnd = subscription.current_period_end
        ? new Date(subscription.current_period_end)
        : nextPeriod;

    const msPerDay = 1000 * 60 * 60 * 24;
    const daysRemaining = Math.max(0, Math.ceil((periodEnd - now) / msPerDay));
    const totalDays = Math.max(1, Math.ceil((periodEnd - periodStart) / msPerDay));

    const transaction = await sequelize.transaction();
    try {
        // An open renewal belongs to the old plan snapshot. Cancel it in the
        // same transaction as the plan change so dunning cannot suspend the new plan.
        await cancelOpenRecurringInvoices(subscription.id, transaction);

        if (isUpgrade && daysRemaining > 0 && oldPrice > 0) {
            const fraction = daysRemaining / totalDays;
            const proratedCharge = Math.round((newPrice - oldPrice) * fraction * 100) / 100;

            if (proratedCharge >= 1) {
                const yearMonth = now.toISOString().substring(0, 7).replace('-', '');
                const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
                const invoiceNumber = `INV-${yearMonth}-${suffix}`;
                const dueDate = new Date(now.getTime() + 7 * msPerDay);

                await Invoice.create({
                    subscription_id: subscription.id,
                    shop_id: shopId,
                    invoice_number: invoiceNumber,
                    billing_period: now.toLocaleString('default', { month: 'long', year: 'numeric' }),
                    billing_period_start: now,
                    billing_period_end: periodEnd,
                    invoice_type: `Proration (upgrade to ${newPlanName})`,
                    amount: proratedCharge,
                    base_amount: proratedCharge,
                    extra_usage_amount: 0,
                    addon_amount: 0,
                    status: 'pending',
                    due_date: dueDate,
                    notes: `Prorated charge for ${daysRemaining} remaining days (${Math.round(fraction * 100)}% of billing period)`
                }, { transaction });
            }
        }

        await subscription.update({
            plan_code: selectedTier.code,
            plan_name: newPlanName,
            plan_price: calculatedPlanPrice,
            billing_cycle: billingCycle,
            billing_model: selectedTier.billingModel,
            per_order_charge_bdt: selectedTier.perOrderChargeBdt,
            conversations_limit: selectedTier.conversationsLimit,
            orders_limit: selectedTier.ordersLimit,
            products_limit: selectedTier.productsLimit,
            features: selectedTier.features,
            status: 'active',
            trial_ends_at: null,
            usage_reset_at: null,
            current_period_start: now,
            current_period_end: nextPeriod,
            next_billing_date: nextPeriod
        }, { transaction });
        await transaction.commit();
    } catch (error) {
        await Promise.resolve(transaction.rollback()).catch(() => {});
        throw error;
    }

    // Invalidate cached subscription/limits so the next request reflects the new plan
    await cacheService.clearForShop(shopId);

    recordFunnelEventSafe(selectedTier.code === PlanCode.SHURU ? 'plan_assigned_shuru' : 'plan_upgraded', {
        shopId,
        metadata: {
            from_plan: oldPlanCode,
            to_plan: selectedTier.code,
            billing_cycle: billingCycle,
        },
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
 * - Conversation allowance is decided at conversation-metering time
 * - Persist every increment into audit_logs
 * 
 * @param {string} shopId - Shop UUID
 * @param {string} usageType - 'conversations' | 'orders' | 'products'
 * @param {number} amount - Amount to increment (default: 1)
 * @param {string} requestId - Idempotency key (required for transaction safety)
 * @param {object} metadata - Additional context (resource_id, etc)
 * @returns {Promise<object>} { subscription, usageEvent, isRetry, transactionId, within_allowance }
 * @throws {AppError} If subscription not found, an invalid amount is supplied, or transaction fails
 */
const trackUsage = async (shopId, usageType, amount = 1, requestId = null, metadata = {}) => {
    if (!requestId) {
        throw new AppError('requestId is required for idempotent usage tracking', 400);
    }

    if (!['conversations', 'orders', 'products'].includes(usageType)) {
        throw new AppError(`Invalid usage type: ${usageType}`, 400);
    }
    if (!Number.isInteger(amount) || amount <= 0) {
        throw new AppError('amount must be a positive integer', 400);
    }

    const idempotencyKey = usageRequestKey(requestId);

    const logger = createLogger(requestId, shopId);
    let transaction = null;

    try {
        // Step 1: Check for duplicate request (idempotency)
        let existingEvent = await UsageEvent.findOne({
            where: {
                shop_id: shopId,
                resource_type: usageType,
                request_id: idempotencyKey
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
                    within_allowance: usageType === 'conversations'
                        ? existingEvent.resource_metadata?.within_allowance === true
                        : true,
                    message: 'Usage already tracked for this request (idempotent)'
                };
            }
        }

        // Step 2: Create transaction
        transaction = await sequelize.transaction({
            // The literal 'READ_COMMITTED' is not SQL — Sequelize interpolates
            // the value straight into SET TRANSACTION ISOLATION LEVEL, so the
            // underscore form made Postgres reject every usage transaction.
            isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED
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
        let currentUsage = Number(subscription[field]) || 0;
        let newUsage = currentUsage + amount;
        const limit = subscription[limitField];

        let periodResetUpdates = {};
        const currentPeriodEnd = subscription.current_period_end
            ? new Date(subscription.current_period_end)
            : null;
        const now = new Date();
        if (currentPeriodEnd && !Number.isNaN(currentPeriodEnd.getTime()) && currentPeriodEnd <= now) {
            let nextPeriodStart = currentPeriodEnd;
            let nextPeriodEnd = new Date(nextPeriodStart);
            const yearly = subscription.billing_cycle === 'yearly';
            do {
                if (yearly) nextPeriodEnd.setFullYear(nextPeriodEnd.getFullYear() + 1);
                else nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1);
                if (nextPeriodEnd <= now) nextPeriodStart = nextPeriodEnd;
            } while (nextPeriodEnd <= now);

            currentUsage = 0;
            newUsage = amount;
            periodResetUpdates = {
                conversations_used: 0,
                orders_used: 0,
                products_used: 0,
                current_period_start: nextPeriodStart,
                current_period_end: nextPeriodEnd,
                next_billing_date: nextPeriodEnd,
                // Keep the prior period start as the renewal handoff marker. The
                // invoice job uses a marker strictly before the new period start
                // to bill the period that this inline reset just closed.
                usage_reset_at: subscription.current_period_start || currentPeriodEnd,
            };
        }

        if (usageType !== 'conversations' && isLimitExceeded(newUsage, limit)) {
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

        // A conversation consumes the included plan allowance first, then any
        // purchased/bonus top-up balance. The event is still recorded when the
        // allowance is exhausted so the worker can pause only that AI turn.
        let topupBalance = Math.max(0, Number(subscription.topup_balance) || 0);
        let withinAllowance = true;
        let crossedThresholds = [];
        let allowanceForEvent = null;
        if (usageType === 'conversations' && !isUnlimitedLimit(limit)) {
            const allowanceBefore = Number(limit) + topupBalance;
            allowanceForEvent = allowanceBefore;
            const includedRemaining = Math.max(0, Number(limit) - currentUsage);
            const beyondPlan = Math.max(0, amount - includedRemaining);
            const availableTopup = topupBalance;
            const fromTopup = Math.min(availableTopup, beyondPlan);
            topupBalance -= fromTopup;
            withinAllowance = beyondPlan <= availableTopup;
            const previousPercentage = allowanceBefore > 0 ? (currentUsage / allowanceBefore) * 100 : 100;
            const nextPercentage = allowanceBefore > 0 ? (newUsage / allowanceBefore) * 100 : 100;
            crossedThresholds = [70, 90, 100].filter((threshold) => (
                previousPercentage < threshold && nextPercentage >= threshold
            ));
        }

        const usageMetadata = {
            ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
            within_allowance: withinAllowance
        };

        // Step 5: Create UsageEvent record (marks transaction as pending)
        const usageEvent = await UsageEvent.create({
            shop_id: shopId,
            resource_type: usageType,
            request_id: idempotencyKey,
            delta: amount,
            transaction_id: transaction.id,
            status: 'pending',
            resource_id: usageMetadata.resourceId || null,
            resource_metadata: usageMetadata
        }, { transaction });

        // Step 6: Increment subscription counter (ATOMIC inside transaction)
        const subscriptionUpdates = { ...periodResetUpdates, [field]: newUsage };
        if (usageType === 'conversations') subscriptionUpdates.topup_balance = topupBalance;
        await subscription.update(subscriptionUpdates, { transaction });

        // Step 7: Create audit log entry (ensures auditability)
        //
        // `metadata` and `idempotency_key`, not `details` and `request_id`:
        // audit_logs has no column by either of those names, and Sequelize
        // drops unknown attributes on create() without erroring. Every usage
        // audit row written so far therefore recorded the ids and the action
        // and silently lost BOTH the payload and the key that correlates the
        // row back to its request — the one field an idempotent billing audit
        // trail exists to carry.
        await AuditLog.create({
            shop_id: shopId,
            resource_type: 'subscription_usage',
            resource_id: subscription.id,
            action: 'usage_tracked',
            metadata: {
                usageType,
                amount,
                newTotal: newUsage,
                limit,
                withinAllowance,
                requestId,
                usageEventId: usageEvent.id
            },
            user_id: null, // System action
            idempotency_key: requestId
        }, { transaction });

        // Step 8: Mark UsageEvent as committed (MUST be inside transaction)
        await usageEvent.update({
            status: 'committed',
            committed_at: new Date()
        }, { transaction });

        // Step 9: Commit transaction
        await transaction.commit();

        for (const threshold of crossedThresholds) {
            recordFunnelEventSafe(`usage_threshold_${threshold}`, {
                shopId,
                metadata: {
                    usage_type: usageType,
                    used: newUsage,
                    allowance: allowanceForEvent,
                },
                onceKey: `usage_threshold:${shopId}:${subscription.current_period_start}:${threshold}`,
            });
        }

        logger.info('Usage tracked successfully (transaction committed)', {
            usageType,
            delta: amount,
            newTotal: newUsage,
            limit,
            withinAllowance,
            status: getUsageStatus(newUsage, limit)
        });

        return {
            subscription,
            usageEvent,
            isRetry: false,
            transactionId: transaction.id,
            within_allowance: withinAllowance,
            message: 'Usage tracked successfully'
        };

    } catch (error) {
        // Step 9b: Lost an idempotency race.
        //
        // The Step 1 check is check-then-act: concurrent callers with the same
        // requestId all see no existing event, all proceed, and the unique
        // index on usage_events.request_id lets exactly one insert win. The
        // losers were being reported as 500 "Usage tracking failed: Validation
        // error" — the opposite of idempotent, and only reachable under real
        // concurrency, which is why a mocked suite never saw it.
        //
        // The index is the arbiter. Roll our own work back, then return the
        // winner's committed event as the retry it is. Handled before the
        // rollback branch below because that branch marks pending rows for this
        // request_id as rolled_back, which here would be the WINNER's row.
        if (error?.name === 'SequelizeUniqueConstraintError') {
            if (transaction) {
                try {
                    await transaction.rollback();
                } catch (rollbackError) {
                    logger.error('Failed to roll back after idempotency race', rollbackError, { usageType });
                }
                transaction = null;
            }

            const winner = await UsageEvent.findOne({
                where: { shop_id: shopId, resource_type: usageType, request_id: idempotencyKey }
            });

            if (winner) {
                logger.info('Concurrent duplicate resolved by unique index (idempotent retry)', {
                    usageType,
                    winnerStatus: winner.status
                });
                const currentSubscription = await Subscription.findOne({ where: { shop_id: shopId } });
                return {
                    subscription: currentSubscription,
                    usageEvent: winner,
                    isRetry: true,
                    transactionId: winner.transaction_id,
                    within_allowance: usageType === 'conversations'
                        ? winner.resource_metadata?.within_allowance === true
                        : true,
                    message: 'Usage already tracked for this request (idempotent)'
                };
            }
            // No winner found: fall through and report the original error
            // rather than inventing a success.
        }

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
                            request_id: idempotencyKey,
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
        });

    // Invalidate cached limits so the reset is immediately visible
    await cacheService.clearForShop(subscription.shop_id);

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
            request_id: usageRequestKey(requestId)
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

/**
 * Check if shop can create one more order (usage limit).
 * Call BEFORE creating order to avoid creating orders that would exceed limit.
 * @throws {AppError} USAGE_LIMIT_EXCEEDED if orders_used + 1 > orders_limit
 */
const checkOrderLimit = async (shopId) => {
    const subscription = await Subscription.findOne({ where: { shop_id: shopId } });
    if (!subscription) return;
    const newUsage = (subscription.orders_used || 0) + 1;
    const limit = subscription.orders_limit;
    if (isLimitExceeded(newUsage, limit)) {
        const error = new AppError(`Usage limit exceeded for orders: ${newUsage} > ${limit}`, 402);
        error.code = 'USAGE_LIMIT_EXCEEDED';
        throw error;
    }
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

/**
 * Grant bonus conversations to a shop (e.g. referral reward, promo credit).
 * Atomic increment on topup_balance; safe under concurrency and consumed after
 * the included plan allowance.
 * No-op if the shop has no subscription row yet (lazy-created on first use).
 *
 * @param {string} shopId - Shop UUID
 * @param {number} amount - Conversations to add (must be > 0)
 * @param {string} [reason] - Audit reason for structured logging
 * @returns {Promise<{ granted: boolean, amount: number }>}
 */
const grantBonusConversations = async (shopId, amount, reason = 'bonus') => {
    if (!shopId || !Number.isInteger(amount) || amount <= 0) {
        return { granted: false, amount: 0 };
    }

    const [affected] = await Subscription.increment(
        { topup_balance: amount },
        { where: { shop_id: shopId } }
    );

    // Sequelize returns affectedCount differently per dialect; treat falsy as no-op
    const granted = Array.isArray(affected) ? affected[1] > 0 : true;

    const logger = createLogger('subscription-bonus', shopId);
    logger.info('Bonus conversations granted', { amount, reason });

    return { granted, amount };
};

// Pricing is all-in / VAT-inclusive (founder decision): a ৳999 plan is billed at
// exactly ৳999. Kept in sync with invoice-generator.js so the on-demand renewal
// invoice matches the monthly cron's amount. Bump centrally if NBR VAT is required.
const BD_VAT_RATE = 0;

/**
 * Activate (or reactivate) a subscription once a recurring invoice is paid.
 *
 * Flips a non-active subscription (suspended / past_due / trial_expired / inactive)
 * back to `active` so the AI assistant resumes (see subscription.access.isAiActive)
 * and anchors a fresh access window from the payment date. That window is what
 * schedules the next charge: the invoice-generator bills a subscription only once
 * `next_billing_date` has passed, so paying a yearly invoice defers the next
 * renewal by a year rather than by a calendar month.
 * Safe to call on an already-active subscription — it simply refreshes the window.
 *
 * @param {Object} subscription - Subscription Sequelize instance
 * @returns {Promise<Object>} the updated subscription
 */
const activateFromPaidInvoice = async (subscription, {
    targetPlanCode = null,
    targetBillingCycle = null,
    preservePeriod = false,
    billingPeriodEnd = null,
    transaction = null,
} = {}) => {
    const currentPlanCode = String(subscription.plan_code || '').toUpperCase();
    const resolvedPlanCode = String(targetPlanCode || currentPlanCode).toUpperCase();
    const targetTier = getTierByCode(resolvedPlanCode);
    const billingCycle = targetBillingCycle || subscription.billing_cycle || 'monthly';
    const now = new Date();
    let periodStart = now;
    let periodEnd = new Date(now);
    if (preservePeriod && subscription.current_period_start && subscription.current_period_end) {
        periodStart = new Date(subscription.current_period_start);
        periodEnd = new Date(subscription.current_period_end);
    } else if (preservePeriod && billingPeriodEnd) {
        periodStart = new Date(billingPeriodEnd);
        periodEnd = new Date(periodStart);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
    } else if (billingCycle === 'yearly') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const updates = {
        status: 'active',
        usage_reset_at: preservePeriod ? subscription.usage_reset_at || null : null,
        trial_ends_at: null,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        next_billing_date: periodEnd
    };
    if (targetTier) {
        Object.assign(updates, {
            plan_code: targetTier.code,
            plan_name: targetTier.name,
            plan_price: billingCycle === 'yearly' ? targetTier.priceBdtYearly : targetTier.priceBdtMonthly,
            billing_cycle: billingCycle,
            billing_model: targetTier.billingModel,
            per_order_charge_bdt: targetTier.perOrderChargeBdt,
            conversations_limit: targetTier.conversationsLimit,
            orders_limit: targetTier.ordersLimit,
            products_limit: targetTier.productsLimit,
            features: targetTier.features,
        });
    }

    if (transaction) await subscription.update(updates, { transaction });
    else await subscription.update(updates);

    if (!transaction) await cacheService.clearForShop(subscription.shop_id);

    const logger = createLogger('subscription-activate', subscription.shop_id);
    logger.info('Subscription activated after invoice payment', {
        subscriptionId: subscription.id,
        nextBillingDate: periodEnd
    });

    return subscription;
};

/**
 * Ensure the shop has an open (payable) monthly subscription invoice it can settle
 * to (re)activate the AI. Returns an existing open `monthly_subscription` invoice if
 * one is outstanding (never stacks duplicates), otherwise creates a fresh one priced
 * at the canonical plan fee with the current all-in VAT policy (identical to
 * the monthly invoice-generator).
 *
 * This is the activation path for a lapsed / suspended owner: the invoice-generator
 * only bills `status='active'` subscriptions, so a shop can otherwise lack an invoice
 * to pay. The "Pay / Renew with bKash" action calls this.
 *
 * @param {string} shopId
 * @param {string} userId
 * @returns {Promise<Object>} the open or newly-created Invoice instance
 */
const ensureRenewalInvoice = async (shopId, userId, targetPlanCode = null) => {
    await verifyShopAccess(userId, shopId);

    let subscription = await Subscription.findOne({ where: { shop_id: shopId } });
    if (!subscription) {
        subscription = await createDefaultSubscription(shopId);
    }

    const currentPlanCode = String(subscription.plan_code || '').toUpperCase();
    const requestedPlanCode = String(targetPlanCode || currentPlanCode).toUpperCase();

    // Per-order Partner shops are billed from delivered orders, not a flat renewal.
    if (requestedPlanCode === PlanCode.PARTNER || subscription.billing_model === 'per_order') {
        throw new AppError('Partner (per-order) plans are billed per delivered order, not by renewal', 400);
    }

    if (requestedPlanCode !== PlanCode.GROWTH) {
        throw new AppError('This plan has no payable subscription fee', 400);
    }

    const targetTier = PRICING_TIERS[PlanCode.GROWTH];
    const targetBillingCycle = currentPlanCode === PlanCode.GROWTH
        ? (subscription.billing_cycle === 'yearly' ? 'yearly' : 'monthly')
        : 'monthly';
    const targetInvoiceType = recurringInvoiceTypeFor(targetBillingCycle);

    // Reuse any already-open recurring invoice so the owner pays it instead of
    // stacking a new one. Matching the whole recurring set, not just the monthly
    // type — a yearly subscriber with an open annual renewal must be handed that
    // invoice rather than issued a second one alongside it.
    let existing = null;
    if (typeof Invoice.findAll === 'function') {
        const openInvoices = await Invoice.findAll({
            where: {
                subscription_id: subscription.id,
                invoice_type: { [Op.in]: RECURRING_INVOICE_TYPES },
                status: { [Op.in]: ['pending', 'overdue'] }
            },
            order: [['created_at', 'DESC']]
        });
        existing = openInvoices.find((invoice) => {
            if (invoice.invoice_type !== targetInvoiceType) return false;
            let metadata = invoice.metadata || {};
            if (typeof metadata === 'string') {
                try { metadata = JSON.parse(metadata); } catch (_) { metadata = {}; }
            }
            return String(metadata.target_plan_code || currentPlanCode).toUpperCase() === requestedPlanCode;
        }) || null;
    } else if (typeof Invoice.findOne === 'function') {
        existing = await Invoice.findOne({
            where: {
                subscription_id: subscription.id,
                invoice_type: targetInvoiceType,
                status: { [Op.in]: ['pending', 'overdue'] }
            },
            order: [['created_at', 'DESC']]
        });
        if (existing) {
            let metadata = existing.metadata || {};
            if (typeof metadata === 'string') {
                try { metadata = JSON.parse(metadata); } catch (_) { metadata = {}; }
            }
            if (existing.invoice_type !== targetInvoiceType
                || String(metadata.target_plan_code || currentPlanCode).toUpperCase() !== requestedPlanCode) {
                existing = null;
            }
        }
    }
    if (existing) return existing;

    const baseAmount = targetBillingCycle === 'yearly'
        ? targetTier.priceBdtYearly
        : targetTier.priceBdtMonthly;
    if (!(baseAmount > 0)) {
        throw new AppError('This plan has no payable subscription fee', 400);
    }

    const now = new Date();
    const billingPeriodStart = subscription.current_period_start
        ? new Date(subscription.current_period_start)
        : now;
    const periodEnd = new Date(now);
    if (targetBillingCycle === 'yearly') {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const tax = Math.round(baseAmount * BD_VAT_RATE);
    const totalAmount = baseAmount + tax;

    const yearMonth = now.toISOString().substring(0, 7).replace('-', '');
    const invoiceNumber = `INV-${yearMonth}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const values = {
        subscription_id: subscription.id,
        shop_id: shopId,
        invoice_number: invoiceNumber,
        invoice_type: targetInvoiceType,
        amount: totalAmount,
        base_amount: baseAmount,
        extra_usage_amount: 0,
        addon_amount: 0,
        billing_period: billingPeriodStart.toLocaleString('default', { month: 'long', year: 'numeric' }),
        billing_period_start: billingPeriodStart,
        billing_period_end: periodEnd,
        status: 'pending',
        metadata: {
            plan_code: currentPlanCode,
            target_plan_code: requestedPlanCode,
            target_billing_cycle: targetBillingCycle,
        },
        // 3-day due threshold — matches the recurring invoice-generator + reconciler.
        due_date: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
        notes: 'Subscription activation / renewal'
    };

    try {
        return await Invoice.create(values);
    } catch (error) {
        if (error?.name === 'SequelizeUniqueConstraintError' && typeof Invoice.findOne === 'function') {
            const existing = await Invoice.findOne({
                where: {
                    subscription_id: subscription.id,
                    invoice_type: targetInvoiceType,
                    billing_period_start: billingPeriodStart,
                },
            });
            if (existing) return existing;
        }
        throw error;
    }
};

module.exports = {
    getSubscription,
    updatePlan,
    trackUsage,
    checkOrderLimit,
    getInvoices,
    getInvoiceById,
    resetUsageCounters,
    createDefaultSubscription,
    getUsageEvents,
    verifyNoDoubleCount,
    checkRateLimit,
    incrementRateLimit,
    grantBonusConversations,
    activateFromPaidInvoice,
    ensureRenewalInvoice,
    cancelOpenRecurringInvoices
};
