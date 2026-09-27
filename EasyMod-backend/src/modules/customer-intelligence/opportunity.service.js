'use strict';

/**
 * Sales Opportunities — detection, conversion, expiry and merchant actions.
 *
 * Concurrency model (ADR-0006):
 *   - detection for one shop runs inside a transaction holding
 *     pg_try_advisory_xact_lock('opportunity-detector:<shop>'); a second
 *     detector for the same shop skips instead of racing;
 *   - the partial unique index idx_customer_opportunities_live is the backstop
 *     (at most one OPEN|ACTIONED row per customer);
 *   - every status change is a conditional UPDATE on the expected from-states,
 *     so a merchant action and a detector/conversion never overwrite each other.
 */

const { Op } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const metrics = require('../pilot-features/pilot-metrics');
const signalsLib = require('./opportunity-signals');
const { loadOrdersForCustomers, findCustomersByPhone } = require('./customer-orders');
const { contactability } = require('./contactability');

const logger = createLogger('SalesOpportunities');

const LIVE_STATUSES = Object.freeze(['OPEN', 'ACTIONED']);
const TERMINAL_STATUSES = Object.freeze(['CONVERTED', 'DISMISSED', 'EXPIRED']);
const DISMISS_REASONS = Object.freeze(['NOT_INTERESTED', 'ALREADY_HANDLED', 'NOT_A_REAL_REQUEST', 'OTHER']);

const CONFIG = Object.freeze({
    LOOKBACK_MS: 72 * 60 * 60 * 1000,
    QUIET_MS: 30 * 60 * 1000,
    OPEN_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,
    ACTIONED_EXPIRY_MS: 14 * 24 * 60 * 60 * 1000,
    MAX_CONVERSATIONS: 200,
    MAX_MESSAGES: 5000,
    MAX_LIVE_FOR_CONVERSION: 500,
});

const entities = () => require('../entities');
const OrderSessionModel = () => require('../order/order-session.entity');
const isPostgres = () => sequelize?.getDialect?.() === 'postgres';
const plain = (row) => (row && typeof row.get === 'function' ? row.get({ plain: true }) : row);
const ms = (value) => (value ? new Date(value).getTime() : 0);
const maxDate = (...values) => {
    const best = Math.max(...values.map(ms).filter(Number.isFinite));
    return best > 0 ? new Date(best) : null;
};

async function acquireShopLock(shopId, transaction) {
    if (!isPostgres()) return true;
    const [rows] = await sequelize.query(
        'SELECT pg_try_advisory_xact_lock(hashtextextended(:lockKey, 0)) AS locked',
        { replacements: { lockKey: `opportunity-detector:${shopId}` }, transaction },
    );
    return rows?.[0]?.locked === true;
}

/**
 * Detect, merge, convert and expire opportunities for one shop.
 * Idempotent: re-running with no new customer messages changes nothing.
 */
async function detectForShop(shopId, { now = new Date() } = {}) {
    const result = {
        shopId, candidates: 0, created: 0, updated: 0, converted: 0, expired: 0, lockSkipped: false,
    };
    const runStartedAt = new Date(now.getTime());

    await sequelize.transaction(async (transaction) => {
        if (!(await acquireShopLock(shopId, transaction))) {
            result.lockSkipped = true;
            metrics.increment('opportunity.detector_lock_skipped');
            return;
        }
        const { Conversation, Message, Customer, CustomerOpportunity } = entities();
        const lookbackStart = new Date(now.getTime() - CONFIG.LOOKBACK_MS);

        const conversations = await Conversation.findAll({
            where: {
                shop_id: shopId,
                customer_id: { [Op.ne]: null },
                updated_at: { [Op.gte]: lookbackStart },
            },
            attributes: ['id', 'customer_id', 'updated_at'],
            order: [['updated_at', 'DESC']],
            limit: CONFIG.MAX_CONVERSATIONS,
            transaction,
        });
        const customerIds = [...new Set(conversations.map((c) => c.customer_id))];
        result.candidates = customerIds.length;

        if (customerIds.length) {
            const customers = await Customer.findAll({
                where: { shop_id: shopId, id: { [Op.in]: customerIds } },
                attributes: ['id', 'phone', 'channel_type', 'messaging_consent'],
                transaction,
            });
            const opportunities = await CustomerOpportunity.findAll({
                where: { shop_id: shopId, customer_id: { [Op.in]: customerIds } },
                order: [['last_signal_at', 'DESC']],
                transaction,
            });
            const ordersByCustomer = await loadOrdersForCustomers(shopId, customers, {
                since: lookbackStart,
                transaction,
            });
            const conversationIds = conversations.map((c) => c.id);
            const messages = await Message.findAll({
                where: {
                    conversation_id: { [Op.in]: conversationIds },
                    sender: 'customer',
                    created_at: { [Op.gte]: lookbackStart },
                },
                attributes: ['id', 'conversation_id', 'content', 'metadata', 'created_at'],
                order: [['created_at', 'DESC']],
                limit: CONFIG.MAX_MESSAGES,
                transaction,
            });
            const sessions = await OrderSessionModel().findAll({
                where: {
                    shop_id: shopId,
                    customer_id: { [Op.in]: customerIds },
                    created_order_id: null,
                    status: { [Op.in]: ['ACTIVE', 'ABANDONED'] },
                    last_activity_at: { [Op.gte]: lookbackStart },
                },
                transaction,
            });

            const conversationsByCustomer = new Map();
            for (const conversation of conversations) {
                if (!conversationsByCustomer.has(conversation.customer_id)) {
                    conversationsByCustomer.set(conversation.customer_id, []);
                }
                conversationsByCustomer.get(conversation.customer_id).push(conversation.id);
            }
            const customerByConversation = new Map(conversations.map((c) => [c.id, c.customer_id]));
            const messagesByCustomer = new Map();
            for (const message of [...messages].reverse()) {
                const customerId = customerByConversation.get(message.conversation_id);
                if (!messagesByCustomer.has(customerId)) messagesByCustomer.set(customerId, []);
                messagesByCustomer.get(customerId).push(plain(message));
            }
            const sessionsByCustomer = new Map();
            for (const session of sessions) {
                if (!sessionsByCustomer.has(session.customer_id)) sessionsByCustomer.set(session.customer_id, []);
                sessionsByCustomer.get(session.customer_id).push(plain(session));
            }
            const liveByCustomer = new Map();
            const lastSignalByCustomer = new Map();
            for (const opportunity of opportunities) {
                if (LIVE_STATUSES.includes(opportunity.status) && !liveByCustomer.has(opportunity.customer_id)) {
                    liveByCustomer.set(opportunity.customer_id, opportunity);
                }
                const prior = lastSignalByCustomer.get(opportunity.customer_id);
                if (!prior || ms(opportunity.last_signal_at) > ms(prior)) {
                    lastSignalByCustomer.set(opportunity.customer_id, opportunity.last_signal_at);
                }
            }

            for (const customer of customers) {
                const outcome = await evaluateCustomer({
                    shopId,
                    customer,
                    now,
                    runStartedAt,
                    transaction,
                    messages: messagesByCustomer.get(customer.id) || [],
                    sessions: sessionsByCustomer.get(customer.id) || [],
                    orders: ordersByCustomer.get(customer.id) || [],
                    live: liveByCustomer.get(customer.id) || null,
                    lastSignalAt: lastSignalByCustomer.get(customer.id) || null,
                    latestConversationId: (conversationsByCustomer.get(customer.id) || [])[0] || null,
                    lookbackStart,
                });
                if (outcome === 'created') result.created += 1;
                if (outcome === 'updated') result.updated += 1;
            }
        }

        result.converted = await convertLiveOpportunities(shopId, { now, transaction });
        result.expired = await expireStale(shopId, { now, transaction });
    });

    metrics.increment('opportunity.detector_run');
    logger.info('opportunity.detector_shop_complete', result);
    return result;
}

async function evaluateCustomer({
    shopId, customer, now, runStartedAt, transaction, messages, sessions, orders,
    live, lastSignalAt, latestConversationId, lookbackStart,
}) {
    const { CustomerOpportunity } = entities();
    if (contactability(customer, now).reason === 'OPTED_OUT') return 'skipped';

    // A conversation that is still going is not an abandoned one.
    const lastCustomerActivity = maxDate(
        ...messages.map((m) => m.created_at),
        ...sessions.map((s) => s.last_activity_at),
    );
    if (!lastCustomerActivity || now.getTime() - lastCustomerActivity.getTime() < CONFIG.QUIET_MS) {
        return 'skipped';
    }

    const lastOrderAt = maxDate(...orders.map((o) => o.created_at));
    const cursor = maxDate(lookbackStart, lastOrderAt, live ? live.last_signal_at : lastSignalAt);
    const { signals, declined } = signalsLib.collectSignals({ messages, sessions, cursor });
    if (declined || !signals.length) return 'skipped';

    if (live) {
        const merged = signalsLib.mergeSignals(live.signals || [], signals);
        const assessment = signalsLib.assess(merged);
        const lastAt = maxDate(live.last_signal_at, ...signals.map((s) => s.at));
        const [updated] = await CustomerOpportunity.update({
            signals: merged,
            reasons: assessment.reasons,
            strength: assessment.strength || live.strength,
            product_refs: signalsLib.productRefsFrom(merged),
            last_signal_at: lastAt,
            conversation_id: latestConversationId || live.conversation_id,
        }, {
            where: { id: live.id, shop_id: shopId, status: { [Op.in]: LIVE_STATUSES } },
            transaction,
        });
        if (updated) {
            metrics.increment('opportunity.updated');
            return 'updated';
        }
        return 'skipped';
    }

    const assessment = signalsLib.assess(signals);
    if (!assessment.qualifies) return 'skipped';

    // A merchant may have resolved an opportunity for this customer while this
    // run was reading; do not resurrect it — the next run recomputes the cursor.
    const resolvedDuringRun = await CustomerOpportunity.count({
        where: {
            shop_id: shopId,
            customer_id: customer.id,
            status: { [Op.in]: TERMINAL_STATUSES },
            resolved_at: { [Op.gte]: runStartedAt },
        },
        transaction,
    });
    if (resolvedDuringRun) return 'skipped';

    const sessionSignal = signals.find((s) => s.source === 'ORDER_SESSION');
    try {
        await sequelize.transaction({ transaction }, async (savepoint) => {
            await CustomerOpportunity.create({
                shop_id: shopId,
                customer_id: customer.id,
                conversation_id: latestConversationId,
                order_session_id: sessionSignal?.order_session_id || null,
                status: 'OPEN',
                strength: assessment.strength,
                reasons: assessment.reasons,
                signals: signalsLib.mergeSignals([], signals),
                product_refs: signalsLib.productRefsFrom(signals),
                first_signal_at: signals[0].at,
                last_signal_at: signals[signals.length - 1].at,
                detected_at: now,
                detector_version: signalsLib.DETECTOR_VERSION,
            }, { transaction: savepoint });
        });
    } catch (error) {
        if (error?.name === 'SequelizeUniqueConstraintError') return 'skipped';
        throw error;
    }
    metrics.increment('opportunity.created');
    logger.info('opportunity.created', {
        shopId, customerId: customer.id, strength: assessment.strength, reasons: assessment.reasons,
    });
    return 'created';
}

/**
 * Convert live opportunities whose customer has since placed an order (linked
 * by customer_id, or an unlinked order with the same normalized phone).
 */
async function convertLiveOpportunities(shopId, { now = new Date(), transaction = null } = {}) {
    const { CustomerOpportunity, Customer } = entities();
    const live = await CustomerOpportunity.findAll({
        where: { shop_id: shopId, status: { [Op.in]: LIVE_STATUSES } },
        attributes: ['id', 'customer_id', 'first_signal_at'],
        order: [['first_signal_at', 'ASC']],
        limit: CONFIG.MAX_LIVE_FOR_CONVERSION,
        ...(transaction ? { transaction } : {}),
    });
    if (!live.length) return 0;
    const customers = await Customer.findAll({
        where: { shop_id: shopId, id: { [Op.in]: live.map((o) => o.customer_id) } },
        attributes: ['id', 'phone'],
        ...(transaction ? { transaction } : {}),
    });
    const earliest = new Date(Math.min(...live.map((o) => ms(o.first_signal_at))));
    const ordersByCustomer = await loadOrdersForCustomers(shopId, customers, { since: earliest, transaction });

    let converted = 0;
    for (const opportunity of live) {
        const candidates = (ordersByCustomer.get(opportunity.customer_id) || [])
            .filter((order) => ms(order.created_at) >= ms(opportunity.first_signal_at))
            .sort((a, b) => ms(a.created_at) - ms(b.created_at));
        if (!candidates.length) continue;
        if (await markConverted(shopId, opportunity.id, candidates[0].id, { now, transaction })) converted += 1;
    }
    return converted;
}

async function markConverted(shopId, opportunityId, orderId, { now = new Date(), transaction = null } = {}) {
    const { CustomerOpportunity } = entities();
    const [updated] = await CustomerOpportunity.update({
        status: 'CONVERTED',
        converted_order_id: orderId,
        resolved_at: now,
        resolution_reason: 'ORDER_CREATED',
    }, {
        where: { id: opportunityId, shop_id: shopId, status: { [Op.in]: LIVE_STATUSES } },
        ...(transaction ? { transaction } : {}),
    });
    if (updated) {
        metrics.increment('opportunity.converted');
        logger.info('opportunity.converted', { shopId, opportunityId, orderId });
    }
    return updated > 0;
}

/**
 * Post-commit hook from order creation: convert immediately instead of waiting
 * for the next sweep. Best effort — failures are counted and the sweep
 * converts later. Never throws into the order path.
 */
async function convertForOrder(order) {
    try {
        if (!order?.id || !order?.shop_id) return 0;
        const { isCustomerIntelligenceEnabled } = require('../pilot-features/pilot-features.service');
        if (!(await isCustomerIntelligenceEnabled(order.shop_id))) return 0;
        const { CustomerOpportunity } = entities();
        const customerIds = order.customer_id
            ? [order.customer_id]
            : (await findCustomersByPhone(order.shop_id, order.customer_phone)).map((c) => c.id);
        if (!customerIds.length) return 0;
        const createdAt = order.created_at || order.createdAt || new Date();
        const live = await CustomerOpportunity.findAll({
            where: {
                shop_id: order.shop_id,
                customer_id: { [Op.in]: customerIds },
                status: { [Op.in]: LIVE_STATUSES },
                first_signal_at: { [Op.lte]: createdAt },
            },
            attributes: ['id'],
        });
        let converted = 0;
        for (const opportunity of live) {
            if (await markConverted(order.shop_id, opportunity.id, order.id)) converted += 1;
        }
        return converted;
    } catch (error) {
        metrics.increment('opportunity.conversion_hook_failed');
        logger.warn('opportunity.conversion_hook_failed', { orderId: order?.id, error: error.message });
        return 0;
    }
}

async function expireStale(shopId, { now = new Date(), transaction = null } = {}) {
    const { CustomerOpportunity } = entities();
    const options = transaction ? { transaction } : {};
    const [openExpired] = await CustomerOpportunity.update({
        status: 'EXPIRED', resolved_at: now, resolution_reason: 'NO_ACTIVITY',
    }, {
        where: {
            shop_id: shopId,
            status: 'OPEN',
            last_signal_at: { [Op.lt]: new Date(now.getTime() - CONFIG.OPEN_EXPIRY_MS) },
        },
        ...options,
    });
    const [actionedExpired] = await CustomerOpportunity.update({
        status: 'EXPIRED', resolved_at: now, resolution_reason: 'NO_ORDER_AFTER_FOLLOW_UP',
    }, {
        where: {
            shop_id: shopId,
            status: 'ACTIONED',
            actioned_at: { [Op.lt]: new Date(now.getTime() - CONFIG.ACTIONED_EXPIRY_MS) },
        },
        ...options,
    });
    const expired = (openExpired || 0) + (actionedExpired || 0);
    if (expired) metrics.increment('opportunity.expired', expired);
    return expired;
}

// ── Merchant actions ─────────────────────────────────────────────────────────

async function transitionForMerchant(shopId, opportunityId, fromStatuses, values) {
    const { CustomerOpportunity } = entities();
    const [updated] = await CustomerOpportunity.update(values, {
        where: { id: opportunityId, shop_id: shopId, status: { [Op.in]: fromStatuses } },
    });
    const current = await CustomerOpportunity.findOne({ where: { id: opportunityId, shop_id: shopId } });
    if (!current) throw new AppError('Opportunity not found', 404, 'NOT_FOUND');
    if (!updated) {
        throw new AppError(
            `Opportunity is already ${current.status.toLowerCase()}`,
            409,
            'OPPORTUNITY_STATE_CONFLICT',
        );
    }
    return current;
}

async function markContacted(shopId, opportunityId, userId) {
    const opportunity = await transitionForMerchant(shopId, opportunityId, ['OPEN'], {
        status: 'ACTIONED', actioned_at: new Date(), actioned_by: userId,
    });
    metrics.increment('opportunity.actioned');
    return opportunity;
}

async function dismiss(shopId, opportunityId, userId, reason) {
    if (!DISMISS_REASONS.includes(reason)) {
        throw new AppError('Invalid dismiss reason', 400, 'VALIDATION_ERROR');
    }
    const opportunity = await transitionForMerchant(shopId, opportunityId, LIVE_STATUSES, {
        status: 'DISMISSED', resolved_at: new Date(), resolved_by: userId, resolution_reason: reason,
    });
    metrics.increment('opportunity.dismissed');
    return opportunity;
}

// ── Read models ──────────────────────────────────────────────────────────────

function serializeOpportunity(row, now = new Date()) {
    const data = plain(row);
    const customer = data.customer || null;
    return {
        id: data.id,
        status: data.status,
        strength: data.strength,
        reasons: data.reasons || [],
        signals: (data.signals || []).map((s) => ({
            code: s.code,
            source: s.source,
            intent_id: s.intent_id || null,
            attribute: s.attribute || null,
            checkout_step: s.checkout_step || null,
            message_id: s.message_id || null,
            at: s.at,
        })),
        product_refs: data.product_refs || [],
        customer_id: data.customer_id,
        conversation_id: data.conversation_id,
        first_signal_at: data.first_signal_at,
        last_signal_at: data.last_signal_at,
        detected_at: data.detected_at,
        actioned_at: data.actioned_at,
        converted_order_id: data.converted_order_id,
        resolved_at: data.resolved_at,
        resolution_reason: data.resolution_reason,
        detector_version: data.detector_version,
        recommended_action: recommendedAction(data, customer, now),
        customer: customer ? {
            id: customer.id,
            name: customer.name,
            channel_type: customer.channel_type,
        } : null,
    };
}

/** What the merchant should do next — always a manual, policy-gated step. */
function recommendedAction(opportunity, customer, now) {
    if (!LIVE_STATUSES.includes(opportunity.status)) return null;
    const contact = customer ? contactability(customer, now) : null;
    if (contact?.window_open) {
        return { code: 'REPLY_IN_INBOX', window_closes_at: contact.window_closes_at };
    }
    if (contact?.reason === 'OPTED_OUT') return { code: 'DO_NOT_CONTACT' };
    if (contact?.platform) return { code: 'WAIT_FOR_CUSTOMER_MESSAGE', reason: contact.reason };
    return { code: 'CONTACT_BY_PHONE' };
}

async function listOpportunities(shopId, { status = 'LIVE', page = 1, pageSize = 20 } = {}, now = new Date()) {
    const { CustomerOpportunity, Customer } = entities();
    const statuses = status === 'LIVE' ? LIVE_STATUSES : [status];
    const { count, rows } = await CustomerOpportunity.findAndCountAll({
        where: { shop_id: shopId, status: { [Op.in]: statuses } },
        include: [{
            model: Customer,
            as: 'customer',
            attributes: ['id', 'name', 'channel_type', 'messaging_consent'],
            where: { shop_id: shopId },
            required: true,
        }],
        order: [['strength', 'ASC'], ['last_signal_at', 'DESC']],
        limit: pageSize,
        offset: (page - 1) * pageSize,
        distinct: true,
    });
    return { data: rows.map((row) => serializeOpportunity(row, now)), total: count, page, pageSize };
}

const median = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * Pilot measurement: how many opportunities were found and what happened to
 * them. Conversion rate is over resolved opportunities only, so still-open
 * ones do not dilute it. No revenue is claimed here.
 */
async function summary(shopId, { days = 30 } = {}) {
    const { CustomerOpportunity } = entities();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await CustomerOpportunity.findAll({
        where: { shop_id: shopId, detected_at: { [Op.gte]: since } },
        attributes: ['status', 'strength', 'detected_at', 'actioned_at', 'resolved_at'],
        limit: 20000,
    });
    const byStatus = { OPEN: 0, ACTIONED: 0, CONVERTED: 0, DISMISSED: 0, EXPIRED: 0 };
    const byStrength = { HIGH: 0, MEDIUM: 0 };
    const minutesToAction = [];
    const minutesToOrder = [];
    for (const row of rows) {
        byStatus[row.status] = (byStatus[row.status] || 0) + 1;
        byStrength[row.strength] = (byStrength[row.strength] || 0) + 1;
        if (row.actioned_at) minutesToAction.push(Math.round((ms(row.actioned_at) - ms(row.detected_at)) / 60000));
        if (row.status === 'CONVERTED' && row.resolved_at) {
            minutesToOrder.push(Math.round((ms(row.resolved_at) - ms(row.detected_at)) / 60000));
        }
    }
    const resolved = byStatus.CONVERTED + byStatus.DISMISSED + byStatus.EXPIRED;
    return {
        window_days: days,
        detected: rows.length,
        by_status: byStatus,
        by_strength: byStrength,
        conversion_rate: resolved ? Math.round((byStatus.CONVERTED / resolved) * 1000) / 1000 : null,
        median_minutes_to_action: median(minutesToAction.filter((m) => m >= 0)),
        median_minutes_to_order: median(minutesToOrder.filter((m) => m >= 0)),
    };
}

module.exports = {
    CONFIG,
    LIVE_STATUSES,
    summary,
    TERMINAL_STATUSES,
    DISMISS_REASONS,
    detectForShop,
    evaluateCustomer,
    convertLiveOpportunities,
    convertForOrder,
    markConverted,
    expireStale,
    markContacted,
    dismiss,
    listOpportunities,
    serializeOpportunity,
    recommendedAction,
};
