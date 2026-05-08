/**
 * Comment-to-DM Webhook Routes
 * 
 * Meta Graph API webhook receiver for Facebook page comments.
 * Converts incoming comments to DM conversations.
 * 
 * This is a PUBLIC endpoint (no authentication required).
 * Signature verification is performed using X-Hub-Signature-256 header.
 * 
 * @file integration/comment-to-dm-webhook.routes.js
 */

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const config = require('../../config/config');
const MetaIntegration = require('./meta-integration.entity');
const commentToDmService = require('./comment-to-dm.service');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('CommentToDMWebhook');

const router = express.Router();

// H8: Redis-backed rate limiter shared across all workers; falls back to MemoryStore
const buildWebhookStore = () => {
  try {
    const { rateLimitRedis } = require('../../config/redis');
    if (rateLimitRedis && typeof rateLimitRedis.call === 'function') {
      return new RedisStore({
        prefix: 'rl:webhook:comment-to-dm:',
        sendCommand: (...args) => rateLimitRedis.call(...args)
      });
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

/**
 * Verify Meta webhook signature
 * @param {Buffer} rawBody - Raw request body buffer
 * @param {string} signature - X-Hub-Signature-256 header value
 * @param {string} secret - App secret for HMAC verification
 * @returns {boolean} True if signature is valid
 */
const isValidSignature = (rawBody, signature, secret) => {
  if (!signature || !secret) return false;
  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
};

/**
 * GET /webhooks/meta/comment-to-dm
 * Webhook verification endpoint (called by Meta during setup)
 * 
 * @query {string} hub.mode - 'subscribe'
 * @query {string} hub.challenge - Challenge token to echo back
 * @query {string} hub.verify_token - Verification token set by shop
 * @returns {string} Challenge token if valid, 403 if invalid
 */
router.get('/', async (req, res) => {
  const {
    'hub.mode': mode,
    'hub.challenge': challenge,
    'hub.verify_token': verifyToken
  } = req.query;

  logger.info('Webhook verification request', { mode });

  if (mode !== 'subscribe' || !verifyToken) {
    logger.warn('Invalid webhook verification request', { mode });
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
      logger.info('Webhook verification successful');
      return res.status(200).send(challenge);
    }
    logger.warn('Webhook verification failed - invalid token');
    return res.sendStatus(403);
  } catch (err) {
    logger.error('Webhook verify token lookup error', { error: err.message });
    return res.sendStatus(500);
  }
});

/**
 * POST /webhooks/meta/comment-to-dm
 * Webhook receiver - processes incoming Meta comment events
 * 
 * This endpoint receives comment events from Meta Graph API.
 * Signature is verified using X-Hub-Signature-256 header.
 * 
 * @header {string} X-Hub-Signature-256 - HMAC-SHA256(app_secret, raw_body)
 * @body {Object} Webhook payload with comment events
 * @returns {Object} { success: true }
 */
router.post('/', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const signature = req.headers['x-hub-signature-256'];
    const shopIdHeader = req.headers['x-shop-id']; // Optional: shop routing

    // Safe JSON parse — malformed body must not cause 500 (which triggers Meta retry storm)
    let payload;
    try {
      const rawBody = req.body instanceof Buffer
        ? req.body.toString('utf8')
        : String(req.body || '');
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch (parseErr) {
      logger.error('Webhook payload JSON parse error', { error: parseErr.message });
      return res.sendStatus(200); // Ack to prevent retry storm
    }

    logger.info('Webhook payload received', {
      object: payload.object,
      entries: payload.entry?.length || 0,
      shopId: shopIdHeader,
      hasSignature: !!signature
    });

    // CRITICAL SECURITY: Signature verification is MANDATORY
    // Check for signature header presence first
    if (!signature) {
      logger.error('Missing X-Hub-Signature-256 header', {
        asset: payload.entry?.[0]?.id
      });
      return res.status(403).json({
        success: false,
        error: 'Missing X-Hub-Signature-256 header'
      });
    }

    // Determine app_secret: per-tenant first, then global fallback
    const globalSecret = config.metaWebhookAppSecret;
    let appSecret = globalSecret;

    if (!appSecret && payload.entry && payload.entry.length > 0) {
      // Multi-app setup: look up per-tenant secret from the first entry's asset ID
      try {
        const firstAssetId = payload.entry[0].id;
        const integration = await MetaIntegration.findOne({
          where: { meta_asset_id: firstAssetId, status: 'CONNECTED' }
        });
        appSecret = integration?.app_secret || null;
      } catch (lookupErr) {
        logger.error('Per-tenant secret lookup error', { error: lookupErr.message });
      }
    }

    // CRITICAL SECURITY: If no app_secret can be determined, reject immediately
    if (!appSecret) {
      logger.error('No app_secret configured for signature verification', {
        env: config.env,
        asset: payload.entry?.[0]?.id,
        hasGlobalSecret: !!globalSecret
      });
      return res.status(403).json({
        success: false,
        error: 'Signature verification failed: no app secret'
      });
    }

    // CRITICAL SECURITY: Verify signature using constant-time comparison
    const rawBodyBuf = req.body instanceof Buffer
      ? req.body
      : Buffer.from(String(req.body || ''));
    const isValid = isValidSignature(rawBodyBuf, signature, appSecret);
    
    if (!isValid) {
      logger.error('Invalid Meta webhook signature', {
        asset: payload.entry?.[0]?.id,
        signaturePrefix: signature?.substring(0, 20)
      });
      return res.status(403).json({
        success: false,
        error: 'Invalid X-Hub-Signature-256'
      });
    }

    // Ensure we have a shopId for routing (from header or try to infer from integration)
    let shopId = shopIdHeader;

    if (!shopId && payload.entry && payload.entry.length > 0) {
      try {
        const firstAssetId = payload.entry[0].id;
        const integration = await MetaIntegration.findOne({
          where: { meta_asset_id: firstAssetId },
          attributes: ['shop_id']
        });
        shopId = integration?.shop_id;
      } catch (err) {
        logger.warn('Could not determine shopId from integration', {
          error: err.message
        });
      }
    }

    if (!shopId) {
      logger.warn('Webhook handler missing shopId', {
        hasHeader: !!shopIdHeader,
        entries: payload.entry?.length || 0
      });
      return res.status(400).json({
        success: false,
        error: 'x-shop-id header or integration lookup required'
      });
    }

    // Process the webhook (signature now verified)
    const result = await commentToDmService.processCommentWebhook(payload, shopId);

    logger.info('Webhook processed successfully', {
      shopId,
      success: result.success,
      conversionsCount: result.count || 0
    });

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Webhook processing error', {
      error: error.message,
      stack: error.stack
    });
    // Always return 200 to prevent Meta retry storms
    res.sendStatus(200);
  }
});

module.exports = router;
