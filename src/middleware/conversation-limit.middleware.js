'use strict';

/**
 * Conversation Limit Middleware
 *
 * Enforces subscription-based conversation limits across all channels.
 * Logic:
 *   effective_limit = conversations_limit + topup_balance + threshold_conversations
 *   usage% = conversations_used / effective_limit
 *
 * Threshold events:
 *   ≥ 75%  → emit CONV_LIMIT_75  (push + in-app notification, once per period)
 *   ≥ 90%  → emit CONV_LIMIT_90
 *   = 100% → grant +50 threshold buffer, emit CONV_LIMIT_EXCEEDED
 *   100% + threshold exhausted → block conversation, return 429
 *
 * Attach to AI-chatbot / conversation-initiation routes.
 * The middleware sets req.convLimitContext for downstream handlers.
 */

const { Subscription } = require('../modules/entities');
const { isUnlimitedLimit, THRESHOLD_BUFFER } = require('../modules/subscription/subscription.plans');
const notificationService = require('../modules/notification/conversation-limit-notifier.service');
const { createLogger } = require('../utils/structured-logger');

const NOTIF_CACHE = new Map(); // shopId → { period, notified75, notified90 } (in-memory guard)

const getNotifState = (shopId, period) => {
    const key = `${shopId}:${period}`;
    if (!NOTIF_CACHE.has(key)) {
        NOTIF_CACHE.set(key, { notified75: false, notified90: false, notifiedExceeded: false });
    }
    return NOTIF_CACHE.get(key);
};

const convLimitMiddleware = async (req, res, next) => {
    const shopId = req.user?.shopId;
    if (!shopId) return next();

    const logger = createLogger(req.id, shopId);

    try {
        const sub = await Subscription.findOne({ where: { shop_id: shopId } });
        if (!sub) return next(); // No subscription → allow (will be created on first usage)

        const planLimit = sub.conversations_limit;

        // PARTNER plan or explicitly unlimited → skip counting
        if (isUnlimitedLimit(planLimit)) {
            req.convLimitContext = { unlimited: true };
            return next();
        }

        const used = sub.conversations_used || 0;
        const topup = sub.topup_balance || 0;
        const threshold = sub.threshold_conversations || 0;
        const effectiveLimit = planLimit + topup + threshold;
        const usagePct = effectiveLimit > 0 ? (used / effectiveLimit) * 100 : 100;

        const billingPeriod = sub.current_period_start
            ? new Date(sub.current_period_start).toISOString().substring(0, 7)
            : 'unknown';

        const notifState = getNotifState(shopId, billingPeriod);

        // ── 100% exceeded with no threshold remaining ──────────────────────────
        if (used >= effectiveLimit && threshold === 0) {
            if (!notifState.notifiedExceeded) {
                notifState.notifiedExceeded = true;
                // Grant +50 threshold buffer
                await sub.update({ threshold_conversations: THRESHOLD_BUFFER });
                await notificationService.sendConvLimitNotification(shopId, 'CONV_LIMIT_EXCEEDED', {
                    used, limit: planLimit, topup, threshold: THRESHOLD_BUFFER
                });
                logger.warn('Conversation limit hit — granting threshold buffer', { used, planLimit });
            }
            // Re-fetch updated sub to allow this request through (threshold now active)
            req.convLimitContext = { used, effectiveLimit: effectiveLimit + THRESHOLD_BUFFER, usagePct, threshold: THRESHOLD_BUFFER };
            return next();
        }

        // ── Hard block: threshold also exhausted ─────────────────────────────
        if (used >= effectiveLimit && threshold > 0 && used >= planLimit + topup + threshold) {
            logger.warn('Conversation threshold exhausted — blocking conversation', { used, effectiveLimit });
            return res.status(429).json({
                success: false,
                code: 'CONV_LIMIT_THRESHOLD_EXHAUSTED',
                message: 'Conversation limit reached. Please top up or upgrade your plan.',
                data: { used, limit: planLimit, topup_balance: topup }
            });
        }

        // ── Threshold notification events ─────────────────────────────────────
        if (usagePct >= 90 && !notifState.notified90) {
            notifState.notified90 = true;
            setImmediate(() =>
                notificationService.sendConvLimitNotification(shopId, 'CONV_LIMIT_90', { used, limit: planLimit, pct: Math.round(usagePct) })
                    .catch(() => {})
            );
        } else if (usagePct >= 75 && !notifState.notified75) {
            notifState.notified75 = true;
            setImmediate(() =>
                notificationService.sendConvLimitNotification(shopId, 'CONV_LIMIT_75', { used, limit: planLimit, pct: Math.round(usagePct) })
                    .catch(() => {})
            );
        }

        req.convLimitContext = { used, effectiveLimit, usagePct, threshold, topup };
        return next();

    } catch (err) {
        // Fail open — never block conversations due to middleware errors
        logger.error('convLimitMiddleware error (failing open)', { err: err.message });
        return next();
    }
};

/**
 * Record a conversation against the shop's subscription usage.
 * Call this AFTER a conversation has been successfully initiated.
 */
const recordConversation = async (shopId, conversationId, channel) => {
    if (!shopId || !conversationId) return;

    try {
        const { sequelize } = require('../utils/database/database-setup');
        const billingPeriod = new Date().toISOString().substring(0, 7);

        // Upsert into conversation_usage (unique per conv + period)
        await sequelize.query(
            `INSERT INTO conversation_usage (id, shop_id, conversation_id, channel, billing_period, counted_at)
             VALUES (gen_random_uuid(), :shopId, :conversationId, :channel, :billingPeriod, NOW())
             ON CONFLICT (shop_id, conversation_id, billing_period) DO NOTHING`,
            { replacements: { shopId, conversationId, channel: channel || 'unknown', billingPeriod } }
        );

        // Increment conversations_used counter atomically
        await sequelize.query(
            `UPDATE subscriptions SET conversations_used = conversations_used + 1, updated_at = NOW()
             WHERE shop_id = :shopId`,
            { replacements: { shopId } }
        );
    } catch (err) {
        // Non-fatal — log and continue
        const logger = createLogger(null, shopId);
        logger.error('recordConversation failed', { err: err.message });
    }
};

module.exports = { convLimitMiddleware, recordConversation };
