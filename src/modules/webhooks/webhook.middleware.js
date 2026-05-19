/**
 * Webhook Middleware
 * Validates webhook signatures and authenticates requests
 */

const crypto = require('crypto');
const { PaymentConfig } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger();

/**
 * Validate bKash webhook signature
 * B1/B17: Implements HMAC-SHA256 verification using BKASH_WEBHOOK_SECRET env var.
 * The raw request body must be captured upstream and stored as req.rawBody (Buffer).
 */
const validateBkashSignature = async (req, res, next) => {
    try {
        const secret = process.env.BKASH_WEBHOOK_SECRET;
        if (!secret) {
            logger.error('bKash webhook: BKASH_WEBHOOK_SECRET is not configured');
            return res.status(503).json({ error: 'Webhook secret not configured' });
        }

        const signature = req.headers['x-bkash-signature'];
        if (!signature) {
            logger.warn('bKash webhook: missing x-bkash-signature header');
            return res.status(401).json({ error: 'Invalid webhook signature' });
        }

        // Use raw body buffer if captured by express.raw middleware, otherwise fall back
        const bodyBuffer = req.rawBody instanceof Buffer
            ? req.rawBody
            : Buffer.from(JSON.stringify(req.body));

        const expectedHex = crypto
            .createHmac('sha256', secret)
            .update(bodyBuffer)
            .digest('hex');

        const expectedBuf = Buffer.from(expectedHex);
        const receivedBuf = Buffer.from(signature);

        // Constant-time comparison to prevent timing attacks
        const signaturesMatch =
            expectedBuf.length === receivedBuf.length &&
            crypto.timingSafeEqual(expectedBuf, receivedBuf);

        if (!signaturesMatch) {
            logger.warn('bKash webhook: signature mismatch');
            return res.status(401).json({ error: 'Invalid webhook signature' });
        }

        logger.info('bKash webhook signature validated successfully');
        next();

    } catch (error) {
        logger.error('bKash webhook validation failed', { error: error.message });
        return res.status(401).json({ error: 'Invalid webhook signature' });
    }
};

/**
 * Generic webhook signature validator
 * Routes specific validators based on gateway
 */
const validateWebhookSignature = (gateway) => {
    const validators = {
        'bkash': validateBkashSignature
    };

    const validator = validators[gateway];
    if (!validator) {
        return (req, res, next) => {
            logger.error(`Webhook rejected: no validator registered for gateway "${gateway}"`);
            return res.status(401).json({ error: 'Unknown payment gateway' });
        };
    }

    return validator;
};

module.exports = {
    validateWebhookSignature,
    validateBkashSignature
};
