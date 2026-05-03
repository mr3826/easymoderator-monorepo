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

// BullMQ message queue — lazy-loaded so the webhook handler still works if
// Redis/BullMQ is unavailable (n8n workflow acts as fallback in that case).
let _messageQueue = null;
function getMessageQueue() {
    if (!_messageQueue) {
        try {
            _messageQueue = require('../../jobs/message-queue').messageQueue;
        } catch (err) {
            console.warn('[webhook] BullMQ message queue unavailable:', err.message);
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
    if (!queue) return; // BullMQ not available — n8n workflow handles AI processing

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
        console.error('[webhook] Failed to dispatch BullMQ job:', err.message, { shop_id, externalId });
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
    // Per-tenant: find the integration whose verify token matches
    const integration = await MetaIntegration.findOne({
      where: { webhook_verify_token: verifyToken, status: 'CONNECTED' }
    });

    // Fallback to global env var for backward-compat during migration period
    const globalToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    const isValid = integration || (globalToken && verifyToken === globalToken);

    if (isValid) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch (err) {
    console.error('Webhook verify token lookup error:', err.message);
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
      console.error('[webhook] Payload JSON parse error:', parseErr.message);
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
        console.error(`[webhook] Invalid signature for asset ${firstAssetId} — check META_WEBHOOK_APP_SECRET matches your Meta App Secret exactly`);
        return res.sendStatus(403);
      }
    } else {
      // Secret not configured — warn but continue so messages aren't silently dropped
      // during initial setup. Set META_WEBHOOK_APP_SECRET to your Meta App Secret to enable verification.
      console.warn(`[webhook] META_WEBHOOK_APP_SECRET not set — skipping signature check for asset ${firstAssetId}`);
    }

    console.log(`[webhook] Received ${payload.object} event for asset ${firstAssetId}`);

    // Route by object type — each handler catches its own errors; we always return 200
    if (payload.object === 'page') {
      await handlePageWebhook(payload);
    } else if (payload.object === 'instagram') {
      await handleInstagramWebhook(payload);
    } else if (payload.object === 'whatsapp_business_account') {
      await handleWhatsAppWebhook(payload);
    } else {
      console.warn(`[webhook] Unhandled object type: ${payload.object}`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('[webhook] Unhandled processing error:', error);
    res.sendStatus(200); // Still 200 — avoid Meta retry storms on unexpected errors
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
      console.error('Data deletion callback: META_WEBHOOK_APP_SECRET not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const payload = parseSignedRequest(signedRequest, appSecret);
    if (!payload) {
      return res.status(403).json({ error: 'Invalid signed_request signature' });
    }

    const facebookUserId = payload.user_id;
    const confirmationCode = `DEL-${facebookUserId}-${Date.now()}`;

    // Schedule deletion: anonymize/delete all customer records linked to this Facebook user ID
    setImmediate(async () => {
      try {
        // Delete customer records where channel_user_id matches the Facebook user ID
        // and channel_type is 'messenger' or 'instagram'
        const deletedCount = await Customer.destroy({
          where: {
            channel_user_id: facebookUserId,
            channel_type: ['messenger', 'instagram']
          }
        });
        console.log(`Data deletion callback: deleted ${deletedCount} customer record(s) for Facebook user ${facebookUserId} (code: ${confirmationCode})`);
      } catch (deleteErr) {
        console.error(`Data deletion callback: failed to delete records for Facebook user ${facebookUserId}:`, deleteErr.message);
      }
    });

    // Meta requires this exact response shape
    const baseUrl = process.env.FRONTEND_URL || process.env.BASE_URL || 'https://app.easymod.tech';
    return res.status(200).json({
      url: `${baseUrl}/privacy-policy`,
      confirmation_code: confirmationCode
    });
  } catch (error) {
    console.error('Data deletion callback error:', error);
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
      console.error('Deauthorize callback: META_WEBHOOK_APP_SECRET not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const payload = parseSignedRequest(signedRequest, appSecret);
    if (!payload) {
      return res.status(403).json({ error: 'Invalid signed_request signature' });
    }

    const facebookUserId = payload.user_id;

    // Best-effort: mark customers with this Facebook user ID as deauthorized.
    // Full data deletion happens via the /data-deletion callback (user-controlled)
    // or a scheduled purge after the retention window.
    setImmediate(async () => {
      try {
        await Customer.update(
          { metadata: require('sequelize').literal(`jsonb_set(COALESCE(metadata, '{}'), '{deauthorized}', 'true')`) },
          {
            where: {
              channel_user_id: facebookUserId,
              channel_type: ['messenger', 'instagram']
            }
          }
        );
        console.log(`Deauthorize callback: marked customer ${facebookUserId} as deauthorized`);
      } catch (err) {
        console.error(`Deauthorize callback: failed to update customer ${facebookUserId}:`, err.message);
      }
    });

    // Meta expects a 200; no specific body format required for deauthorize.
    return res.sendStatus(200);
  } catch (error) {
    console.error('Deauthorize callback error:', error);
    return res.sendStatus(500);
  }
});

// n8n reply callback — stores bot response and sends to customer via Meta
router.post('/reply', express.json(), async (req, res) => {
  try {
    if (config.internalWebhookSecret) {
      const provided = req.headers['x-internal-webhook-secret'];
      if (provided !== config.internalWebhookSecret) {
        return res.status(403).json({ error: 'Invalid webhook secret' });
      }
    }

    const { conversation_id, message, platform, recipient_id, idempotency_key } = req.body;

    if (!conversation_id || !message) {
      return res.status(400).json({ error: 'conversation_id and message are required' });
    }

    // H6: Derive shop_id from conversation — never trust caller-supplied shop_id
    const conversation = await Conversation.findOne({ where: { id: conversation_id } });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const shop_id = conversation.shop_id;

    // Idempotency: if caller supplied a key, check for an existing reply before creating
    if (idempotency_key) {
      const existing = await Message.findOne({
        where: { conversation_id, sender: 'ai', external_id: idempotency_key }
      });
      if (existing) {
        return res.status(200).json({ success: true, message_id: existing.id, conversation_id, duplicate: true });
      }
    }

    // Enforce Meta's 24-hour messaging window for Facebook/Instagram (check BEFORE storing)
    if (recipient_id && platform && ['messenger', 'facebook', 'instagram'].includes(platform)) {
      const lastCustomerMsg = await Message.findOne({
        where: { conversation_id, sender: 'customer' },
        order: [['created_at', 'DESC']]
      });
      if (lastCustomerMsg) {
        const hoursElapsed = (Date.now() - new Date(lastCustomerMsg.created_at)) / (1000 * 60 * 60);
        if (hoursElapsed > 24) {
          return res.status(422).json({ error: 'Outside 24-hour messaging window. Cannot send message after 24 hours of last customer message.' });
        }
      }
    }

    // Store the bot reply as a message record
    const botMessage = await Message.create({
      conversation_id,
      content: message,
      sender: 'ai',
      external_id: idempotency_key || null
    });

    // Send reply to customer via Meta Graph API
    if (recipient_id && platform) {
      try {
        // Map 'messenger' (conversation channel_type) to 'facebook' (MetaIntegration platform)
        const platformKey = (platform === 'facebook' || platform === 'messenger') ? 'facebook' : platform;
        const integration = await MetaIntegration.findOne({
          where: { shop_id, platform: platformKey, status: 'CONNECTED' }
        });

        if (integration && integration.access_token) {
          // Block delivery if token is known to be expired — caller gets actionable error
          if (integration.token_expires_at && new Date(integration.token_expires_at) < new Date()) {
            console.error(`[reply] Token expired for shop ${shop_id} platform ${platform} at ${integration.token_expires_at}`);
            return res.status(503).json({
              error: 'Meta access token expired. Please reconnect the channel.',
              code: 'TOKEN_EXPIRED',
              platform
            });
          }
          const metaService = require('./meta.service');
          await sendMetaReply(platform, metaService.decryptToken(integration.access_token), recipient_id, message);
          console.log(`Sent ${platform} reply to ${recipient_id} for shop ${shop_id}`);
        } else {
          console.warn(`No active ${platform} integration for shop ${shop_id}`);
        }
      } catch (sendError) {
        console.error('Failed to send Meta reply:', sendError.message);
        // Message is still stored even if delivery fails
      }
    }

    res.status(200).json({
      success: true,
      message_id: botMessage.id,
      conversation_id
    });
  } catch (error) {
    console.error('Reply callback error:', error);
    res.status(500).json({ error: 'Failed to process reply' });
  }
});

// Send reply to customer via Meta Graph API
async function sendMetaReply(platform, accessToken, recipientId, messageText) {
  if (platform === 'whatsapp') {
    // WhatsApp Cloud API
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!phoneNumberId) {
      console.warn('WHATSAPP_PHONE_NUMBER_ID not configured');
      return;
    }
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipientId,
        type: 'text',
        text: { body: messageText }
      })
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`WhatsApp send error ${res.status}: ${body}`);
    }
  } else {
    // Facebook Messenger / Instagram — Send API
    const res = await fetch('https://graph.facebook.com/v21.0/me/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text: messageText },
        access_token: accessToken
      })
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Messenger/Instagram send error ${res.status}: ${body}`);
    }
  }
}

// Handle Facebook Messenger webhooks
async function handlePageWebhook(payload) {
  for (const entry of payload.entry) {
    const pageId = entry.id;
    console.log(`[webhook] Processing Facebook page ${pageId}, ${entry.messaging?.length || 0} messaging events`);

    let integration = await MetaIntegration.findOne({
      where: { meta_asset_id: pageId, platform: 'facebook', status: 'CONNECTED' }
    });

    if (!integration) {
      // Log all existing CONNECTED facebook integrations so we can debug page ID mismatches
      const existing = await MetaIntegration.findAll({
        where: { platform: 'facebook', status: 'CONNECTED' },
        attributes: ['meta_asset_id', 'shop_id', 'display_name']
      });
      console.warn(
        `[webhook] No CONNECTED facebook integration for page_id=${pageId}.`,
        `Existing CONNECTED facebook integrations: ${JSON.stringify(existing.map(i => ({ meta_asset_id: i.meta_asset_id, shop_id: i.shop_id, name: i.display_name })))}`
      );
      continue;
    }

    for (const messaging of (entry.messaging || [])) {
      // Skip echo events (page's own outbound messages reflected back by Meta)
      if (messaging.message?.is_echo) {
        console.debug(`[webhook] Skipped echo event from ${messaging.sender.id}`);
        continue;
      }
      const messageText = messaging.message?.text || null;
      const attachments = messaging.message?.attachments || [];

      // Skip non-message events (read receipts, delivery confirmations, etc.)
      if (!messageText && attachments.length === 0) {
        console.debug(`[webhook] Skipped non-message event (no text/attachments) from ${messaging.sender.id}`, { keys: Object.keys(messaging) });
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
        console.log(`[webhook] Processing message from ${messaging.sender.id} to shop ${integration.shop_id}`);
        const storeResult = await storeIncomingMessage(normalizedEvent);
        if (!storeResult.duplicate) {
          sseManager.emit(integration.shop_id, 'new_message', {
            conversation_id: storeResult.conversation_id,
            message: storeResult.message
          });
        }
        dispatchMessageJob(storeResult, normalizedEvent); // non-blocking
      } catch (err) {
        // Log but never re-throw — returning 500 to Meta triggers a retry storm.
        // Each failed message is independently logged so one failure doesn't drop the rest.
        console.error(`[webhook] Failed to store message from ${messaging.sender.id} (page ${pageId}):`, err.message, err.stack);
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
      console.warn(`[webhook] No connected Instagram integration for account ${igAccountId} — message dropped`);
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
          sseManager.emit(integration.shop_id, 'new_message', {
            conversation_id: storeResult.conversation_id,
            message: storeResult.message
          });
        }
        dispatchMessageJob(storeResult, normalizedEvent); // non-blocking
      } catch (err) {
        console.error(`[webhook] Failed to store Instagram message from ${message.sender.id} (account ${igAccountId}):`, err.message, err.stack);
      }
    }
  }
}

// Handle WhatsApp webhooks
async function handleWhatsAppWebhook(payload) {
  for (const entry of payload.entry) {
    const whatsappAccountId = entry.id;

    const integration = await MetaIntegration.findOne({
      where: { meta_asset_id: whatsappAccountId, platform: 'whatsapp', status: 'CONNECTED' }
    });

    if (!integration) continue;

    for (const change of entry.changes) {
      if (change.field === 'messages' && change.value.messages) {
        for (const message of change.value.messages) {
          const messageText = message.text?.body || null;
          const attachments = message.type !== 'text' ? [message] : [];
          if (!messageText && attachments.length === 0) continue;

          const normalizedEvent = {
            platform: 'whatsapp',
            shop_id: integration.shop_id,
            sender: message.from,
            message: messageText || '',
            attachments,
            timestamp: new Date(parseInt(message.timestamp) * 1000),
            raw_event: message
          };

          try {
            const storeResult = await storeIncomingMessage(normalizedEvent);
            if (!storeResult.duplicate) {
              sseManager.emit(integration.shop_id, 'new_message', {
                conversation_id: storeResult.conversation_id,
                message: storeResult.message
              });
            }
            dispatchMessageJob(storeResult, normalizedEvent); // non-blocking
          } catch (err) {
            console.error(`[webhook] Failed to store WhatsApp message from ${message.from} (account ${whatsappAccountId}):`, err.message, err.stack);
          }
        }
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
        console.log(`Duplicate webhook event skipped (external_id=${externalId})`);
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
      let conversation = await Conversation.findOne({
        where: {
          shop_id,
          customer_id: customer.id,
          channel: channelType,
          updated_at: { [Op.gte]: oneDayAgo }
        },
        order: [['updated_at', 'DESC']],
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

      // 3. Store the message and touch conversation.updated_at so the 24h window is rolling
      const msgRecord = await Message.create({
        conversation_id: conversation.id,
        content: message,
        sender: 'customer',
        external_id: externalId
      }, { transaction: t });

      // Touch updated_at so the 24h window resets with every new customer message
      await conversation.update({ updated_at: new Date() }, { transaction: t });

      console.log(`Stored ${platform} message: customer=${customer.id}, conv=${conversation.id}, msg=${msgRecord.id}`);

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
    console.error('Failed to store incoming message:', error.message, { platform: event?.platform, shop_id: event?.shop_id, sender: event?.sender, stack: error.stack });
    throw error;
  }
}

// Debug endpoint to verify webhook subscriptions
router.get('/debug/subscriptions/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    const integration = await MetaIntegration.findOne({
      where: { meta_asset_id: pageId }
    });

    if (!integration) {
      return res.status(404).json({
        error: 'No integration found',
        meta_asset_id: pageId
      });
    }

    const metaService = require('./meta.service');
    const accessToken = metaService.decryptToken(integration.access_token);

    // Check subscribed apps
    const response = await require('axios').get(
      `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps`,
      { params: { access_token: accessToken, fields: 'id,name' } }
    );

    res.json({
      integration: {
        shop_id: integration.shop_id,
        platform: integration.platform,
        status: integration.status,
        meta_asset_id: integration.meta_asset_id
      },
      subscription_response: response.data
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      hint: 'Check that the page access token is still valid'
    });
  }
});

// Export storeIncomingMessage so the channel test endpoint can use it directly
module.exports = router;
module.exports.storeIncomingMessage = storeIncomingMessage;
