const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const config = require('../../config/config');
const MetaIntegration = require('./meta-integration.entity');
const { Customer } = require('../entities');
const { Conversation, Message } = require('../conversation/conversation.entity');
const { sequelize } = require('../../utils/database/database-setup');
const sseManager = require('../../utils/sse-manager');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('MetaWebhook');

// ─── B4/B9: GDPR idempotency guard ──────────────────────────────────────────
// Prevents double-deletion when Meta retries GDPR callbacks.
// Uses Redis (setex) when available; falls back to an in-memory Set with TTL.
let _gdprRedis = null;
function getGdprRedis() {
    if (_gdprRedis) return _gdprRedis;
    try {
        const { cacheRedis } = require('../../config/redis');
        if (cacheRedis && !cacheRedis._isMemoryFallback) {
            _gdprRedis = cacheRedis;
        }
    } catch (_) { /* Redis unavailable */ }
    return _gdprRedis;
}

// In-memory fallback: Map of key → expiry timestamp
const _gdprMemorySet = new Map();
function _memorySetHas(key) {
    const expiry = _gdprMemorySet.get(key);
    if (!expiry) return false;
    if (Date.now() > expiry) { _gdprMemorySet.delete(key); return false; }
    return true;
}
function _memorySetAdd(key, ttlSeconds) {
    _gdprMemorySet.set(key, Date.now() + ttlSeconds * 1000);
}

/**
 * Mark a GDPR job as processed (idempotency key with 24-hour TTL).
 * Returns true if this key was already processed (skip), false if this is the first run.
 */
async function checkAndMarkGdprProcessed(type, userId) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const key = `gdpr:processed:${type}:${userId}:${today}`;
    const TTL = 86400; // 24 hours

    const redis = getGdprRedis();
    if (redis) {
        try {
            // SET NX returns 'OK' on first write, null if key already existed
            const result = await redis.set(key, '1', 'EX', TTL, 'NX');
            return result === null; // null → already existed → skip
        } catch (err) {
            logger.warn('GDPR idempotency Redis check failed, proceeding', { error: err.message });
            return false; // Fail open — better to run twice than skip
        }
    }

    // In-memory fallback
    if (_memorySetHas(key)) return true;
    _memorySetAdd(key, TTL);
    return false;
}
// ─────────────────────────────────────────────────────────────────────────────

// BullMQ message queue — lazy-loaded so the webhook handler still works even if
// Redis/BullMQ is temporarily unavailable at startup.
let _messageQueue = null;
function getMessageQueue() {
    if (!_messageQueue) {
        try {
            _messageQueue = require('../../jobs/message-queue').messageQueue;
        } catch (err) {
            logger.warn('BullMQ message queue unavailable', { error: err.message });
        }
    }
    return _messageQueue;
}

/**
 * Dispatch a BullMQ job for AI processing after a message has been stored to DB.
 * Uses jobId = shopId:externalId for BullMQ-level deduplication (layer 1 of 3).
 * Non-blocking: errors are logged but never propagate back to the webhook handler.
 */
async function dispatchMessageJob(storeResult, event) {
    const queue = getMessageQueue();
    if (!queue) {
        logger.error('BullMQ unavailable — message stored in DB but AI pipeline skipped', {
            shopId: event.shop_id,
            platform: event.platform,
            externalId: event.raw_event?.message?.mid || event.raw_event?.id || null
        });
        return;
    }

    const { shop_id, sender, platform, message, attachments = [], raw_event } = event;
    const { conversation_id, message_id, customer_id } = storeResult;
    const externalId = raw_event?.message?.mid || raw_event?.id || null;

    const jobId = externalId ? `${shop_id}:${externalId}` : undefined;

    try {
        await queue.add(
            `msg:${shop_id}`,
            {
                shopId: shop_id,
                conversationId: conversation_id,
                messageId: message_id,
                externalId,
                message: message || '',
                platform,
                recipientId: sender,
                senderInfo: { customer_id },
                attachments,
            },
            {
                jobId,
                group: { id: shop_id }, // BullMQ v5 fair queueing per shop
            }
        );
    } catch (err) {
        logger.error('Failed to dispatch BullMQ job', { error: err.message, shop_id, externalId });
    }
}

const router = express.Router();

// H8: Redis-backed rate limiter shared across all workers; falls back to MemoryStore
const buildWebhookStore = () => {
  try {
    const { rateLimitRedis } = require('../../config/redis');
    if (rateLimitRedis && typeof rateLimitRedis.call === 'function') {
      return new RedisStore({ prefix: 'rl:webhook:', sendCommand: (...args) => rateLimitRedis.call(...args) });
    }
  } catch (_) { /* fall through */ }
  return undefined;
};

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildWebhookStore()
});

router.use(webhookLimiter);

const isValidSignature = (rawBody, signature, secret) => {
  if (!signature || !secret) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
};

// Webhook verification (GET request from Meta)
router.get('/', async (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': verifyToken } = req.query;

  if (mode !== 'subscribe' || !verifyToken) {
    return res.sendStatus(403);
  }

  try {
    // Per-tenant: find the integration whose verify token matches.
    // No global fallback — every shop must use its own token to prevent cross-shop forgery.
    const integration = await MetaIntegration.findOne({
      where: { webhook_verify_token: verifyToken, status: 'CONNECTED' }
    });

    if (integration) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch (err) {
    logger.error('Webhook verify token lookup error', { error: err.message });
    return res.sendStatus(500);
  }
});

// Webhook receiver (POST request from Meta)
router.post('/', express.raw({ type: '*/*' }), async (req, res) => {
  // Always ack 200 at the end — never let processing errors cause retries
  try {
    const signature = req.headers['x-hub-signature-256'];

    // Safe JSON parse
    let payload;
    try {
      const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch (parseErr) {
      logger.error('Payload JSON parse error', { error: parseErr.message });
      return res.sendStatus(200);
    }

    const firstAssetId = payload.entry?.[0]?.id;

    // Signature verification — use global secret (META_WEBHOOK_APP_SECRET == Meta App Secret)
    const appSecret = config.metaWebhookAppSecret;
    if (appSecret) {
      const rawBodyBuf = req.body instanceof Buffer ? req.body : Buffer.from(String(req.body || ''));
      const isValid = isValidSignature(rawBodyBuf, signature, appSecret);
      if (!isValid) {
        // Log with asset ID so we can correlate with the right page in Cloud Run logs
        logger.error(`Invalid signature for asset ${firstAssetId} — check META_WEBHOOK_APP_SECRET matches your Meta App Secret exactly`);
        return res.sendStatus(403);
      }
    } else {
      logger.error('META_WEBHOOK_APP_SECRET not configured — rejecting webhook to prevent unauthenticated payload injection');
      return res.sendStatus(403);
    }

    logger.info(`Received ${payload.object} event for asset ${firstAssetId}`);

    // Route by object type — each handler catches its own errors; we always return 200
    if (payload.object === 'page') {
      await handlePageWebhook(payload);
    } else if (payload.object === 'instagram') {
      await handleInstagramWebhook(payload);
    } else {
      logger.warn(`Unhandled object type: ${payload.object}`);
    }

    res.sendStatus(200);
  } catch (error) {
    // B3: Distinguish unexpected errors from benign ones.
    // Returning 500 here would cause Meta to retry the entire batch — so we still
    // return 200 for Meta's webhook endpoint, but we now log the FULL stack trace
    // so the error is visible in production observability tooling.
    const isExpected =
      error.name === 'SequelizeUniqueConstraintError' || // duplicate message race
      error.message?.includes('duplicate') ||
      error.message?.includes('unknown sender');

    if (isExpected) {
      logger.warn('Expected webhook processing error (duplicate/unknown)', { error: error.message });
    } else {
      // Unexpected error — log full stack for post-mortem
      logger.error('UNEXPECTED webhook processing error', { error: error.message, stack: error.stack, name: error.name });
    }

    // Still ACK 200 to Meta to avoid exponential retry storms. Each per-message error
    // is independently caught inside handlePageWebhook/handleInstagramWebhook.
    res.sendStatus(200);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Meta Data Deletion Callback (required by Meta Platform Terms for Facebook Login apps)
// Meta sends a signed_request when a user removes the app from Facebook settings.
// Spec: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse and verify Meta's signed_request parameter.
 * Returns the decoded payload or null if the signature is invalid.
 */
function parseSignedRequest(signedRequest, appSecret) {
  try {
    const [encodedSig, encodedPayload] = signedRequest.split('.');
    if (!encodedSig || !encodedPayload) return null;

    const sig = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const expectedSig = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();

    if (!crypto.timingSafeEqual(sig, expectedSig)) return null;

    const payloadJson = Buffer.from(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(payloadJson);
  } catch {
    return null;
  }
}

/**
 * GET /webhooks/meta/data-deletion
 * Human-readable deletion instructions page (also serves as the Data Deletion Instructions URL
 * in the Meta app dashboard if you prefer a URL over a callback).
 */
router.get('/data-deletion', (req, res) => {
  res.json({
    message: 'Easy Moderator Data Deletion Instructions',
    instructions: [
      '1. Remove Easy Moderator from your Facebook App Settings (Settings > Apps and Websites).',
      '2. Meta will automatically send a deletion request to our callback and we will delete your data within 30 days.',
      '3. Alternatively, email privacy@easymod.tech with subject "Facebook Data Deletion Request" and we will process it manually.',
      '4. You will receive a confirmation code by email once deletion is complete.'
    ],
    contact: 'privacy@easymod.tech'
  });
});

/**
 * POST /webhooks/meta/data-deletion
 * Meta Data Deletion Request Callback.
 * Meta sends a signed_request (form-encoded) when a user revokes app permissions.
 * We must respond within a few seconds with a confirmation_code and status_url.
 */
router.post('/data-deletion', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { signed_request: signedRequest } = req.body;
    if (!signedRequest) {
      return res.status(400).json({ error: 'Missing signed_request' });
    }

    const appSecret = config.metaWebhookAppSecret || process.env.META_WEBHOOK_APP_SECRET;
    if (!appSecret) {
      logger.error('Data deletion callback: META_WEBHOOK_APP_SECRET not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const payload = parseSignedRequest(signedRequest, appSecret);
    if (!payload) {
      return res.status(403).json({ error: 'Invalid signed_request signature' });
    }

    const facebookUserId = payload.user_id;
    const confirmationCode = `DEL-${facebookUserId}-${Date.now()}`;

    // B9: Idempotency — if Meta retries, skip duplicate deletion
    const alreadyProcessed = await checkAndMarkGdprProcessed('deletion', facebookUserId);
    if (alreadyProcessed) {
      logger.info(`Data deletion callback: already processed for Facebook user ${facebookUserId} today — skipping`, { confirmationCode });
      const baseUrl = process.env.FRONTEND_URL || process.env.BASE_URL || 'https://www.easymod.tech';
      return res.status(200).json({ url: `${baseUrl}/privacy-policy`, confirmation_code: confirmationCode });
    }

    // B2: Run deletion synchronously (before 200) with a 25-second timeout guard.
    // This guarantees deletion happens even if the process restarts after the response.
    const DELETION_TIMEOUT_MS = 25000;
    const deletionPromise = Customer.destroy({
      where: {
        channel_user_id: facebookUserId,
        channel_type: ['messenger', 'instagram']
      }
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Deletion timed out after 25s')), DELETION_TIMEOUT_MS)
    );

    try {
      const deletedCount = await Promise.race([deletionPromise, timeoutPromise]);
      logger.info(`Data deletion callback: deleted ${deletedCount} customer record(s) for Facebook user ${facebookUserId}`, { confirmationCode });
    } catch (deleteErr) {
      // Log at ERROR level so it surfaces in alerting — data may not have been deleted
      logger.error(`Data deletion callback: INCOMPLETE — failed to delete records for Facebook user ${facebookUserId}`, {
        error: deleteErr.message,
        stack: deleteErr.stack,
        confirmationCode
      });
      // Still return 200 so Meta doesn't retry indefinitely — but the error is now loud
    }

    // Meta requires this exact response shape
    const baseUrl = process.env.FRONTEND_URL || process.env.BASE_URL || 'https://www.easymod.tech';
    return res.status(200).json({
      url: `${baseUrl}/privacy-policy`,
      confirmation_code: confirmationCode
    });
  } catch (error) {
    logger.error('Data deletion callback error', { error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Meta Deauthorize Callback (required by Meta Platform Terms)
// Called when a user removes your app in Facebook Settings > Apps and Websites.
// Must be registered at: App Dashboard → Settings → Advanced → Deauthorize Callback URL
// Path to register: <your-domain>/webhooks/meta/deauthorize
// Spec: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/deauthorize-callback-url
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /webhooks/meta/deauthorize
 * Meta sends a signed_request (form-encoded) when a user deauthorizes the app.
 * We mark the customer as deauthorized and revoke their conversation data.
 */
router.post('/deauthorize', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { signed_request: signedRequest } = req.body;
    if (!signedRequest) {
      return res.status(400).json({ error: 'Missing signed_request' });
    }

    const appSecret = config.metaWebhookAppSecret || process.env.META_WEBHOOK_APP_SECRET;
    if (!appSecret) {
      logger.error('Deauthorize callback: META_WEBHOOK_APP_SECRET not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const payload = parseSignedRequest(signedRequest, appSecret);
    if (!payload) {
      return res.status(403).json({ error: 'Invalid signed_request signature' });
    }

    const facebookUserId = payload.user_id;

    // B9: Idempotency — skip if already processed today
    const alreadyProcessed = await checkAndMarkGdprProcessed('deauthorize', facebookUserId);
    if (alreadyProcessed) {
      logger.info(`Deauthorize callback: already processed for Facebook user ${facebookUserId} today — skipping`);
      return res.sendStatus(200);
    }

    // B2: Mark deauthorized synchronously before responding, with 25-second timeout guard.
    const DEAUTH_TIMEOUT_MS = 25000;
    const updatePromise = Customer.update(
      { metadata: require('sequelize').literal(`jsonb_set(COALESCE(metadata, '{}'), '{deauthorized}', 'true')`) },
      {
        where: {
          channel_user_id: facebookUserId,
          channel_type: ['messenger', 'instagram']
        }
      }
    );
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Deauthorize update timed out after 25s')), DEAUTH_TIMEOUT_MS)
    );

    try {
      await Promise.race([updatePromise, timeoutPromise]);
      logger.info(`Deauthorize callback: marked customer ${facebookUserId} as deauthorized`);
    } catch (err) {
      logger.error(`Deauthorize callback: INCOMPLETE — failed to update customer ${facebookUserId}`, {
        error: err.message,
        stack: err.stack
      });
      // Still return 200 — log is loud enough to trigger alerts
    }

    // Meta expects a 200; no specific body format required for deauthorize.
    return res.sendStatus(200);
  } catch (error) {
    logger.error('Deauthorize callback error', { error: error.message });
    return res.sendStatus(500);
  }
});

// Handle Facebook Messenger webhooks
async function handlePageWebhook(payload) {
  for (const entry of payload.entry) {
    const pageId = entry.id;
    logger.info(`Processing Facebook page ${pageId}`, { eventCount: entry.messaging?.length || 0 });

    let integration = await MetaIntegration.findOne({
      where: { meta_asset_id: pageId, platform: 'facebook', status: 'CONNECTED' }
    });

    if (!integration) {
      logger.error(`No CONNECTED facebook integration for page_id=${pageId} — incoming messages are being dropped`);

      // Find the shop that previously owned this page (any status) and alert them via SSE
      // so the agent dashboard shows a warning instead of silently losing messages.
      const previousIntegration = await MetaIntegration.findOne({
        where: { meta_asset_id: pageId, platform: 'facebook' },
        attributes: ['shop_id', 'display_name', 'status']
      });
      if (previousIntegration) {
        sseManager.emit(previousIntegration.shop_id, 'channel_error', {
          type: 'page_disconnected',
          page_id: pageId,
          display_name: previousIntegration.display_name || pageId,
          status: previousIntegration.status,
          message: `Facebook page messages are not being delivered — the channel is ${previousIntegration.status}. Reconnect it in Settings → Channels.`
        });
      }
      continue;
    }

    for (const messaging of (entry.messaging || [])) {
      // Skip echo events (page's own outbound messages reflected back by Meta)
      if (messaging.message?.is_echo) {
        logger.debug(`Skipped echo event from ${messaging.sender.id}`);
        continue;
      }
      const messageText = messaging.message?.text || null;
      const attachments = messaging.message?.attachments || [];

      // Skip non-message events (read receipts, delivery confirmations, etc.)
      if (!messageText && attachments.length === 0) {
        logger.debug(`Skipped non-message event from ${messaging.sender.id}`, { keys: Object.keys(messaging) });
        continue;
      }

      const normalizedEvent = {
        platform: 'facebook',
        shop_id: integration.shop_id,
        sender: messaging.sender.id,
        message: messageText || '',
        attachments,
        timestamp: new Date(messaging.timestamp),
        raw_event: messaging
      };

      try {
        logger.info(`Processing message from ${messaging.sender.id} to shop ${integration.shop_id}`);
        const storeResult = await storeIncomingMessage(normalizedEvent);
        if (!storeResult.duplicate) {
          const msgJson = storeResult.message.toJSON ? storeResult.message.toJSON() : storeResult.message;
          sseManager.emit(integration.shop_id, 'new_message', {
            conversation_id: storeResult.conversation_id,
            message: { ...msgJson, message_type: msgJson.metadata?.message_type || 'text', sender: 'customer' }
          });
        }
        dispatchMessageJob(storeResult, normalizedEvent); // non-blocking
      } catch (err) {
        // Log but never re-throw — returning 500 to Meta triggers a retry storm.
        // Each failed message is independently logged so one failure doesn't drop the rest.
        logger.error(`Failed to store message from ${messaging.sender.id} (page ${pageId})`, { error: err.message, stack: err.stack });
      }
    }
  }
}

// Handle Instagram webhooks
async function handleInstagramWebhook(payload) {
  for (const entry of payload.entry) {
    const igAccountId = entry.id;

    const integration = await MetaIntegration.findOne({
      where: { meta_asset_id: igAccountId, platform: 'instagram', status: 'CONNECTED' }
    });

    if (!integration) {
      logger.error(`No CONNECTED instagram integration for account ${igAccountId} — incoming messages are being dropped`);

      const previousIntegration = await MetaIntegration.findOne({
        where: { meta_asset_id: igAccountId, platform: 'instagram' },
        attributes: ['shop_id', 'display_name', 'status']
      });
      if (previousIntegration) {
        sseManager.emit(previousIntegration.shop_id, 'channel_error', {
          type: 'page_disconnected',
          page_id: igAccountId,
          display_name: previousIntegration.display_name || igAccountId,
          status: previousIntegration.status,
          message: `Instagram DM messages are not being delivered — the channel is ${previousIntegration.status}. Reconnect it in Settings → Channels.`
        });
      }
      continue;
    }

    for (const message of (entry.messaging || [])) {
      if (message.message?.is_echo) continue;
      const messageText = message.message?.text || null;
      const attachments = message.message?.attachments || [];
      if (!messageText && attachments.length === 0) continue;

      const normalizedEvent = {
        platform: 'instagram',
        shop_id: integration.shop_id,
        sender: message.sender.id,
        message: messageText || '',
        attachments,
        timestamp: new Date(message.timestamp),
        raw_event: message
      };

      try {
        const storeResult = await storeIncomingMessage(normalizedEvent);
        if (!storeResult.duplicate) {
          const msgJson = storeResult.message.toJSON ? storeResult.message.toJSON() : storeResult.message;
          sseManager.emit(integration.shop_id, 'new_message', {
            conversation_id: storeResult.conversation_id,
            message: { ...msgJson, message_type: msgJson.metadata?.message_type || 'text', sender: 'customer' }
          });
        }
        dispatchMessageJob(storeResult, normalizedEvent); // non-blocking
      } catch (err) {
        logger.error(`Failed to store Instagram message from ${message.sender.id} (account ${igAccountId})`, { error: err.message, stack: err.stack });
      }
    }
  }
}

/**
 * Store incoming customer message in database.
 * Find-or-create customer → find-or-create conversation → create message.
 * Returns { customer_id, conversation_id, message_id } for workflow context.
 */
async function storeIncomingMessage(event) {
  try {
    const { platform, shop_id, sender, message } = event;
    const { Op } = require('sequelize');

    // Map platform name to channel_type ENUM value
    const channelType = platform === 'facebook' ? 'messenger' : platform;

    // Idempotency check BEFORE opening transaction to avoid lock contention
    const externalId = event.raw_event?.message?.mid || event.raw_event?.id || null;
    if (externalId) {
      const existing = await Message.findOne({ where: { external_id: externalId } });
      if (existing) {
        logger.debug(`Duplicate webhook event skipped (external_id=${externalId})`);
        return {
          customer_id: existing.customer_id,
          customer_name: null,
          conversation_id: existing.conversation_id,
          message_id: existing.id,
          message: existing,
          shop_id: event.shop_id,
          duplicate: true
        };
      }
    }

    // Wrap all 3 writes in a transaction — prevents orphaned customer/conversation on partial failure
    return await sequelize.transaction(async (t) => {
      // 1. Find or create customer by platform sender ID
      const [customer] = await Customer.findOrCreate({
        where: { shop_id, channel_type: channelType, channel_user_id: sender },
        defaults: {
          shop_id,
          name: `${platform} user`,
          channel_type: channelType,
          channel_user_id: sender,
          metadata: { source: 'webhook', platform }
        },
        transaction: t
      });

      // 2. Find active conversation within the rolling 24h window or create a new one.
      // The window is based on the LAST MESSAGE time (conversation.updated_at is touched
      // whenever a new message is stored), not conversation creation time.
      // This matches Meta's policy: "reply within 24h of the customer's last message."
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // LOCK.UPDATE serializes concurrent webhooks for the same customer — prevents duplicate conversations
      let conversation = await Conversation.findOne({
        where: {
          shop_id,
          customer_id: customer.id,
          channel: channelType,
          updated_at: { [Op.gte]: oneDayAgo }
        },
        order: [['updated_at', 'DESC']],
        lock: t.LOCK.UPDATE,
        transaction: t
      });

      if (!conversation) {
        conversation = await Conversation.create({
          shop_id,
          customer_id: customer.id,
          channel: channelType,
          role: 'user',
          message: message,
          metadata: { source: 'webhook', platform }
        }, { transaction: t });
      }

      // 3. Store the message with attachment metadata so the frontend can render images/files
      const attachments = event.attachments || [];
      let msgMeta = {};
      if (attachments.length > 0) {
        const first = attachments[0];
        if (first.type === 'image') {
          msgMeta = { message_type: 'image', image_url: first.payload?.url || null };
        } else {
          msgMeta = { message_type: 'file', file_url: first.payload?.url || null, file_name: first.payload?.name || null };
        }
      }
      const msgContent = message || (attachments.length > 0 ? '[Attachment]' : '');
      const msgRecord = await Message.create({
        conversation_id: conversation.id,
        content: msgContent,
        sender: 'customer',
        external_id: externalId,
        metadata: msgMeta
      }, { transaction: t });

      // Touch updated_at so the 24h window resets with every new customer message
      await conversation.update({ updated_at: new Date() }, { transaction: t });

      logger.info(`Stored ${platform} message`, { customerId: customer.id, convId: conversation.id, msgId: msgRecord.id });

      return {
        customer_id: customer.id,
        customer_name: customer.name,
        conversation_id: conversation.id,
        message_id: msgRecord.id,
        message: msgRecord,
        shop_id
      };
    });
  } catch (error) {
    logger.error('Failed to store incoming message', { error: error.message, platform: event?.platform, shop_id: event?.shop_id, sender: event?.sender, stack: error.stack });
    throw error;
  }
}

// Export storeIncomingMessage so the channel test endpoint can use it directly
module.exports = router;
module.exports.storeIncomingMessage = storeIncomingMessage;
