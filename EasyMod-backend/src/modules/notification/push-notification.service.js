/**
 * Push Notification Service
 * Handles web push (VAPID) and mobile push (FCM via firebase-admin)
 *
 * Required env vars:
 *   VAPID_PUBLIC_KEY   — generate with: npx web-push generate-vapid-keys
 *   VAPID_PRIVATE_KEY
 *   VAPID_SUBJECT      — e.g. "mailto:admin@easymod.ai"
 *   FIREBASE_SERVICE_ACCOUNT_JSON — JSON string of Firebase service account
 */

const webpush = require('web-push');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('PushNotification');

// ── Web Push (VAPID) ──────────────────────────────────────────────────────────

let webPushReady = false;

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@easymod.ai',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  webPushReady = true;
} else {
  logger.warn('VAPID keys not configured — web push disabled');
}

/**
 * Send a web push notification to a single browser subscription
 * @param {Object} subscription - PushSubscription JSON object (endpoint, keys)
 * @param {{ title: string, body: string, data?: Object, icon?: string }} payload
 */
async function sendWebPush(subscription, payload) {
  if (!webPushReady) {
    logger.warn('Web push not configured — skipping');
    return { sent: false, reason: 'not_configured' };
  }
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || '/icon-512.png',
        data: payload.data || {}
      })
    );
    return { sent: true };
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired or invalid — caller should delete it
      return { sent: false, expired: true };
    }
    logger.error('Web push send failed', { error: err.message });
    return { sent: false, error: err.message };
  }
}

// ── FCM (Firebase Admin) ──────────────────────────────────────────────────────

let fcmApp = null;

(function initFirebase() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON not set — FCM mobile push disabled');
    return;
  }
  try {
    const admin = require('firebase-admin');
    // Avoid duplicate app initialization
    if (admin.apps.length === 0) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    fcmApp = admin;
    logger.info('Firebase Admin initialized');
  } catch (err) {
    logger.error('Firebase Admin init failed', { error: err.message });
  }
})();

/**
 * Send FCM push to a single device token
 * @param {string} deviceToken - FCM registration token
 * @param {{ title: string, body: string, data?: Object }} payload
 */
async function sendFCM(deviceToken, payload) {
  if (!fcmApp) {
    logger.warn('FCM not configured — skipping');
    return { sent: false, reason: 'not_configured' };
  }
  try {
    const messageId = await fcmApp.messaging().send({
      token: deviceToken,
      notification: { title: payload.title, body: payload.body },
      data: Object.fromEntries(
        Object.entries(payload.data || {}).map(([k, v]) => [k, String(v)])
      ),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } }
    });
    return { sent: true, messageId };
  } catch (err) {
    if (err.code === 'messaging/registration-token-not-registered') {
      return { sent: false, expired: true };
    }
    logger.error('FCM send failed', { error: err.message });
    return { sent: false, error: err.message };
  }
}

// ── Aggregate: send to all subscriptions for a shop ──────────────────────────

/**
 * Send push to all web+FCM subscriptions registered for a shop
 * @param {string} shopId
 * @param {{ title: string, body: string, data?: Object }} payload
 * @returns {{ web: number, fcm: number, expired: number }}
 */
async function sendPushToShop(shopId, payload) {
  const { PushSubscription } = require('../entities');

  const subs = await PushSubscription.findAll({ where: { shop_id: shopId } });
  if (subs.length === 0) return { web: 0, fcm: 0, expired: 0 };

  const expiredIds = [];
  let webSent = 0;
  let fcmSent = 0;

  await Promise.allSettled(
    subs.map(async (sub) => {
      let result;
      if (sub.type === 'web' && sub.subscription_json) {
        result = await sendWebPush(sub.subscription_json, payload);
      } else if (sub.type === 'fcm' && sub.device_token) {
        result = await sendFCM(sub.device_token, payload);
      }
      if (result?.expired) expiredIds.push(sub.id);
      else if (result?.sent) sub.type === 'web' ? webSent++ : fcmSent++;
    })
  );

  // Clean up expired subscriptions
  if (expiredIds.length > 0) {
    await PushSubscription.destroy({ where: { id: expiredIds } });
    logger.info(`Removed ${expiredIds.length} expired push subscriptions`, { shopId });
  }

  return { web: webSent, fcm: fcmSent, expired: expiredIds.length };
}

module.exports = { sendWebPush, sendFCM, sendPushToShop, webPushReady, fcmReady: () => !!fcmApp };
