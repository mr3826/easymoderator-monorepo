'use strict';

/**
 * Conversation Usage Notifier — daily cron job
 *
 * Scans all active subscriptions and sends notifications to shops
 * approaching their conversation limits (75%, 90%, exceeded).
 * Also deducts threshold_debt from the new period on renewal.
 *
 * Schedule: daily at 08:00 Bangladesh time (02:00 UTC)
 */

const { Subscription } = require('../modules/entities');
const { isUnlimitedLimit, THRESHOLD_BUFFER } = require('../modules/subscription/subscription.plans');
const notificationService = require('../modules/notification/conversation-limit-notifier.service');
const { createLogger } = require('../utils/structured-logger');
const { Op } = require('sequelize');

const logger = createLogger('conv-usage-notifier');

const run = async () => {
    logger.info('Starting conversation usage notifier job');

    try {
        // Trialing shops use real quota too — include them so the daily backstop
        // nudges (75/90/100) reach trial users, not just paid `active` ones.
        const activeSubscriptions = await Subscription.findAll({
            where: { status: { [Op.in]: ['active', 'trialing'] } }
        });

        let notified = 0;

        for (const sub of activeSubscriptions) {
            if (isUnlimitedLimit(sub.conversations_limit)) continue;

            const used = sub.conversations_used || 0;
            const planLimit = sub.conversations_limit;
            const topup = sub.topup_balance || 0;
            const threshold = sub.threshold_conversations || 0;
            const effectiveLimit = planLimit + topup + threshold;
            if (effectiveLimit <= 0) continue;

            const pct = Math.round((used / effectiveLimit) * 100);

            try {
                if (used >= effectiveLimit && threshold === 0) {
                    // Grant threshold buffer if not already granted
                    await sub.update({ threshold_conversations: THRESHOLD_BUFFER });
                    await notificationService.sendConvLimitNotification(sub.shop_id, 'CONV_LIMIT_EXCEEDED', {
                        used, limit: planLimit, threshold: THRESHOLD_BUFFER
                    });
                    notified++;
                } else if (pct >= 90) {
                    await notificationService.sendConvLimitNotification(sub.shop_id, 'CONV_LIMIT_90', {
                        used, limit: planLimit, pct
                    });
                    notified++;
                } else if (pct >= 75) {
                    await notificationService.sendConvLimitNotification(sub.shop_id, 'CONV_LIMIT_75', {
                        used, limit: planLimit, pct
                    });
                    notified++;
                }
            } catch (subErr) {
                logger.error('Failed to notify shop', { shopId: sub.shop_id, err: subErr.message });
            }
        }

        logger.info('Conversation usage notifier complete', { total: activeSubscriptions.length, notified });
    } catch (err) {
        logger.error('Conversation usage notifier job failed', { err: err.message });
    }
};

module.exports = { run };
