'use strict';

const { OwnerNotification } = require('../entities');
const cacheService = require('../../utils/cache.service');
const { createLogger } = require('../../utils/structured-logger');
const { sendPushToShop } = require('./push-notification.service');
const telegramNotificationService = require('./telegram-notification.service');
const { toPushPayload, formatTelegramAlert } = require('./telegram-alert.formatter');

const logger = createLogger('MerchantNotificationService');
const DEDUPE_TTL_SECONDS = 5 * 60;
const RATE_WINDOW_SECONDS = 60;
const RATE_WINDOW_MAX = 30;

async function claimDedupe(shopId, eventType, dedupeKey, ttlSeconds = DEDUPE_TTL_SECONDS) {
    if (!dedupeKey) return true;
    const key = `notification:dedupe:${eventType}:${dedupeKey}`;
    const existing = await cacheService.getForShop(shopId, key);
    if (existing) return false;
    await cacheService.setForShop(shopId, key, true, ttlSeconds);
    return true;
}

async function withinRateLimit(shopId, eventType) {
    const key = `notification:rate:${eventType}`;
    const current = await cacheService.getForShop(shopId, key);
    const now = Date.now();

    if (!current || now - current.windowStart >= RATE_WINDOW_SECONDS * 1000) {
        await cacheService.setForShop(shopId, key, { windowStart: now, count: 1 }, RATE_WINDOW_SECONDS);
        return true;
    }

    if (current.count >= RATE_WINDOW_MAX) return false;

    await cacheService.setForShop(
        shopId,
        key,
        { windowStart: current.windowStart, count: current.count + 1 },
        RATE_WINDOW_SECONDS
    );
    return true;
}

async function createInAppNotification(shopId, eventType, payload) {
    const alert = formatTelegramAlert(eventType, payload);
    return OwnerNotification.create({
        shop_id: shopId,
        type: eventType,
        customer_message: alert.body,
        customer_data: {
            ...payload,
            title: alert.title,
            deepLink: alert.deepLink
        },
        status: 'pending',
        created_at: new Date()
    });
}

async function enqueueNotification(jobData) {
    const queueManager = require('../../jobs/queue-manager');
    const queue = queueManager.queues?.notifications;
    if (!queue) return null;

    if (typeof queue.add === 'function') {
        const jobId = jobData.dedupeKey
            ? `${jobData.shopId}:${jobData.eventType}:${jobData.dedupeKey}`
            : undefined;
        const job = await queue.add('merchant-notification', jobData, jobId ? { jobId } : undefined);
        return job?.id || null;
    }
    return null;
}

async function notifyShop(shopId, eventType, payload = {}, options = {}) {
    const dedupeKey = options.dedupeKey || payload.id || payload.orderId || payload.conversationId || null;
    const dedupeClaimed = await claimDedupe(shopId, eventType, dedupeKey, options.dedupeTtlSeconds);
    if (!dedupeClaimed) {
        return { queued: false, skipped: true, reason: 'duplicate' };
    }

    const rateAllowed = await withinRateLimit(shopId, eventType);
    if (!rateAllowed) {
        logger.warn('Notification rate limit reached', { shopId, eventType });
        return { queued: false, skipped: true, reason: 'rate_limited' };
    }

    const inApp = await createInAppNotification(shopId, eventType, payload);
    const jobId = await enqueueNotification({
        shopId,
        eventType,
        payload,
        dedupeKey,
        inAppNotificationId: inApp.id
    });

    return { queued: Boolean(jobId), jobId, inAppNotificationId: inApp.id };
}

async function dispatchQueuedNotification(jobData = {}) {
    if (!jobData.eventType) {
        return sendPushToShop(jobData.shopId, jobData.payload);
    }

    const pushPayload = toPushPayload(jobData.eventType, jobData.payload || {});
    const [pushResult, telegramResult] = await Promise.allSettled([
        sendPushToShop(jobData.shopId, pushPayload),
        telegramNotificationService.sendEvent(jobData.shopId, jobData.eventType, jobData.payload || {})
    ]);

    return {
        push: pushResult.status === 'fulfilled' ? pushResult.value : { sent: false, error: pushResult.reason?.message },
        telegram: telegramResult.status === 'fulfilled' ? telegramResult.value : { sent: false, error: telegramResult.reason?.message }
    };
}

module.exports = {
    notifyShop,
    dispatchQueuedNotification,
    createInAppNotification,
    claimDedupe,
    withinRateLimit
};
