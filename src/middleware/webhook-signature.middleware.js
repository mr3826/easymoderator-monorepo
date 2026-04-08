/**
 * Webhook Signature Verification Middleware
 * SECURITY CRITICAL: Verifies HMAC-SHA256 signatures
 * FIXES: BLOCKING #1 (timing attack) & BLOCKING #2 (database enumeration)
 */
const crypto = require('crypto');
const { AppError } = require('../utils/AppError');
const { createLogger } = require('../utils/structured-logger');
const logger = createLogger('WebhookSignatureMiddleware');
const timingSafeCompare = (a, b) => {
  try {
    return crypto.timingSafeEqual(a, b);
  } catch (error) {
    logger.warn('Timing safe compare failed', { error: error.message });
    return false;
  }
};
const extractSignatureHex = (receivedSignature) => {
  if (!receivedSignature) return '';
  const hex = receivedSignature.includes('=') ? receivedSignature.split('=')[1] || '' : receivedSignature;
  return hex || '';
};
const verifyHmacSignature = (rawBody, receivedSignature, secret) => {
  if (!receivedSignature || !secret) return false;
  const receivedHex = extractSignatureHex(receivedSignature);
  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const receivedBuf = Buffer.from(receivedHex, 'hex');
  const isValid = timingSafeCompare(expectedBuf, receivedBuf);
  if (!isValid) logger.warn('Webhook signature mismatch');
  return isValid;
};
const getWebhookSecret = async (req, webhookType = 'default', integrationId = null) => {
  if (integrationId) {
    try {
      const Integration = require('../modules/integration/meta-integration.entity');
      const integration = await Integration.findByPk(integrationId);
      if (integration && integration.status === 'CONNECTED') {
        const secretField = webhookType === 'meta' ? 'app_secret' : 'webhook_secret';
        if (integration[secretField]) {
          logger.debug('Using secret by integration_id');
          return integration[secretField];
        }
      }
    } catch (err) {
      logger.error('Secret lookup failed', { integrationId, error: err.message });
    }
  }
  if (req.headers['x-webhook-secret']) return req.headers['x-webhook-secret'];
  const envKey = `${webhookType.toUpperCase()}_WEBHOOK_SECRET`;
  return process.env[envKey] || null;
};
const verifyWebhookSignature = (webhookType = 'incoming', options = {}) => {
  const { requireSignature = true, secretLookup = null } = options;
  return async (req, res, next) => {
    try {
      const signature = req.headers['x-hub-signature-256'] || req.headers['x-signature-256'] || req.headers['x-webhook-signature'];
      if (requireSignature && !signature) {
        throw new AppError('Missing webhook signature header', 403);
      }
      if (!signature) return next();
      const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(String(req.body || ''));
      const integrationId = req.params.integrationId || req.params.shopId;
      let secret = secretLookup ? await secretLookup(req) : await getWebhookSecret(req, webhookType, integrationId);
      if (!secret) throw new AppError('Webhook configuration incomplete', 503);
      const isValid = verifyHmacSignature(rawBody, signature, secret);
      if (!isValid) throw new AppError('Invalid webhook signature', 403);
      logger.info('Webhook signature verified');
      try {
        if (req.body instanceof Buffer) req.body = JSON.parse(req.body.toString('utf-8'));
      } catch (e) {
        logger.warn('Failed to parse webhook body');
      }
      next();
    } catch (error) {
      next(error);
    }
  }
};
module.exports = { verifyWebhookSignature, verifyHmacSignature, getWebhookSecret, timingSafeCompare, extractSignatureHex };