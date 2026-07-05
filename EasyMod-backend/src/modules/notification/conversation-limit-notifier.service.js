'use strict';

/**
 * Centralised notification service for EasyModerator.
 *
 * Handles conversation-limit threshold notifications (75%, 90%, exceeded)
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
    CONV_LIMIT_75: {
        title: '⚠️ কথোপকথন সীমা ৭৫% পৌঁছেছে',
        body: (data) => `আপনার ${data.pct || 75}% কথোপকথন সীমা ব্যবহার হয়েছে। টপ-আপ করুন বা প্ল্যান আপগ্রেড করুন।`,
        bodyEn: (data) => `You've used ${data.pct || 75}% of your conversation limit. Consider topping up or upgrading.`,
        urgency: 'normal'
    },
    CONV_LIMIT_90: {
        title: '🔴 কথোপকথন সীমা ৯০% পৌঁছেছে',
        body: (data) => `সতর্কতা! ${data.pct || 90}% কথোপকথন সীমা শেষ হয়ে যাচ্ছে।`,
        bodyEn: (data) => `Warning! ${data.pct || 90}% of your conversation limit used.`,
        urgency: 'high'
    },
    CONV_LIMIT_EXCEEDED: {
        title: '🚀 কথোপকথন সীমা শেষ — ৫০টি ফ্রি বাফার চালু',
        body: () => '+৫০টি ফ্রি কথোপকথন যোগ করা হলো। শেষ হওয়ার আগে টপ-আপ করুন বা আপগ্রেড করুন যাতে AI চালু থাকে।',
        bodyEn: () => '+50 free conversations added. Top up or upgrade before they run out to keep your AI replying.',
        urgency: 'high'
    },
    CONV_THRESHOLD_ACTIVE: {
        title: '⚡ ফ্রি বাফার ব্যবহার হচ্ছে',
        body: () => 'আপনার ফ্রি বাফার শেষ হয়ে আসছে। AI চালু রাখতে টপ-আপ করুন বা প্ল্যান আপগ্রেড করুন।',
        bodyEn: () => 'Your free buffer is running low. Top up or upgrade to keep your AI replying.',
        urgency: 'high'
    },
    TRIAL_ENDING: {
        title: '⏳ আপনার ফ্রি ট্রায়াল শেষ হতে চলেছে',
        body: (data) => `আপনার ১৪-দিনের ফ্রি ট্রায়ালে আর ${data.daysLeft || 1} দিন বাকি। ৳৯৯৯-এ আপগ্রেড করে AI চালু রাখুন।`,
        bodyEn: (data) => `Only ${data.daysLeft || 1} day(s) left in your free trial. Upgrade for ৳999 to keep your AI running.`,
        urgency: 'normal'
    },
    TRIAL_EXPIRED: {
        title: '🔔 ট্রায়াল শেষ — AI বিরতি নিয়েছে',
        body: () => 'আপনার ফ্রি ট্রায়াল শেষ। AI অটো-রিপ্লাই বন্ধ — তবে আপনি নিজে রিপ্লাই দিতে পারবেন। ৳৯৯৯-এ আপগ্রেড করুন।',
        bodyEn: () => 'Your free trial has ended. AI auto-reply is paused (you can still reply manually). Upgrade for ৳999 to resume.',
        urgency: 'high'
    }
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
