'use strict';

/**
 * Centralised notification service for EasyModerator.
 *
 * Handles conversation-limit threshold notifications (70%, 90%, 100%)
 * via web push (VAPID) and in-app notification records.
 */

const { Op } = require('sequelize');
const { PushSubscription, UserShop } = require('../entities');
const pushNotificationService = require('../notification/push-notification.service');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('NotificationService');

/**
 * Notification type definitions.
 */
const NOTIFICATION_TYPES = Object.freeze({
    CONV_LIMIT_70: {
        title: '⚠️ কথোপকথন সীমা ৭০% পৌঁছেছে',
        body: (data) => `আপনার ${data.pct || 70}% কথোপকথন সীমা ব্যবহার হয়েছে। টপ-আপ করুন বা প্ল্যান আপগ্রেড করুন।`,
        bodyEn: (data) => `You've used ${data.pct || 70}% of your conversation limit. Consider topping up or upgrading.`,
        urgency: 'normal'
    },
    CONV_LIMIT_90: {
        title: '🔴 কথোপকথন সীমা ৯০% পৌঁছেছে',
        body: (data) => `সতর্কতা! ${data.pct || 90}% কথোপকথন সীমা শেষ হয়ে যাচ্ছে।`,
        bodyEn: (data) => `Warning! ${data.pct || 90}% of your conversation limit used.`,
        urgency: 'high'
    },
    CONV_LIMIT_EXCEEDED: {
        title: '🚫 কথোপকথন সীমা শেষ — AI বিরতি নিয়েছে',
        body: () => 'আপনার কথোপকথন সীমা শেষ। AI অটো-রিপ্লাই বিরতি নিয়েছে — টপ-আপ করুন বা Growth-এ আপগ্রেড করুন।',
        bodyEn: () => 'Your conversation allowance is exhausted. AI auto-replies are paused; top up or upgrade to Growth.',
        urgency: 'high'
    },
});

/**
 * Send a conversation-limit notification to all owners of a shop.
 * @param {string} shopId
 * @param {string} type - One of NOTIFICATION_TYPES keys
 * @param {object} data - Context data (used, limit, pct, etc.)
 */
const sendConvLimitNotification = async (shopId, type, data = {}) => {
    const typeDef = NOTIFICATION_TYPES[type];
    if (!typeDef) {
        logger.warn('Unknown notification type', { type });
        return;
    }

    try {
        // Find shop owners
        const ownerUserShops = await UserShop.findAll({
            where: { shop_id: shopId, role: 'owner', is_active: true }
        });

        if (!ownerUserShops.length) return;

        const ownerIds = ownerUserShops.map(us => us.user_id);

        // Find web push subscriptions for these users
        const pushSubs = await PushSubscription.findAll({
            where: { user_id: { [Op.in]: ownerIds }, type: 'web' }
        });

        const payload = {
            title: typeDef.title,
            body: typeDef.bodyEn(data),
            urgency: typeDef.urgency,
            data: { type, shopId, ...data }
        };

        // Send push to each subscription
        const results = await Promise.allSettled(
            pushSubs.map(ps =>
                pushNotificationService.sendWebPush(ps.subscription_json, payload)
                    .then(result => {
                        if (result.expired) {
                            // Clean up expired subscriptions
                            return ps.destroy().catch(() => {});
                        }
                        return result;
                    })
            )
        );

        const sent = results.filter(r => r.status === 'fulfilled' && r.value?.sent).length;
        logger.info('Conversation limit notification sent', { type, shopId, pushCount: sent });

    } catch (err) {
        logger.error('Failed to send conv limit notification', { type, shopId, err: err.message });
    }
};

module.exports = { sendConvLimitNotification, NOTIFICATION_TYPES };
