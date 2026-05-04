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
 * Validate Nagad webhook signature
 */
const validateNagadSignature = async (req, res, next) => {
    try {
        const signature = req.headers['x-nagad-signature'];
        
        if (!signature) {
            throw new AppError('Missing Nagad webhook signature', 401);
        }

        // For Nagad, we'll need to extract shop_id from the webhook payload
        const { paymentReferenceId } = req.body;
        
        if (!paymentReferenceId) {
            throw new AppError('Missing payment reference ID', 400);
        }

        // Find payment transaction to get shop_id
        const { PaymentTransaction } = require('../entities');
        const paymentTransaction = await PaymentTransaction.findOne({
            where: { transaction_id: paymentReferenceId }
        });

        if (!paymentTransaction) {
            throw new AppError('Payment transaction not found', 404);
        }

        // Get Nagad configuration
        const paymentConfig = await PaymentConfig.findOne({
            where: { 
                shop_id: paymentTransaction.shop_id, 
                gateway: 'nagad',
                is_enabled: true 
            }
        });

        if (!paymentConfig?.credentials?.app_secret) {
            throw new AppError('Nagad configuration not found', 404);
        }

        // Validate signature (implementation depends on Nagad's signature method)
        const expectedSignature = crypto
            .createHmac('sha256', paymentConfig.credentials.app_secret)
            .update(JSON.stringify(req.body))
            .digest('hex');

        if (signature !== expectedSignature) {
            throw new AppError('Invalid Nagad webhook signature', 401);
        }

        logger.info('Nagad webhook signature validated', {
            paymentReferenceId,
            shopId: paymentTransaction.shop_id
        });

        next();

    } catch (error) {
        logger.error('Nagad webhook validation failed', { error: error.message });
        res.status(401).json({ error: 'Invalid webhook signature' });
    }
};

/**
 * Generic webhook signature validator
 * Routes specific validators based on gateway
 */
const validateWebhookSignature = (gateway) => {
    const validators = {
        'bkash': validateBkashSignature,
        'nagad': validateNagadSignature
    };

    const validator = validators[gateway];
    if (!validator) {
        return (req, res, next) => next(); // No validation for unknown gateways
    }

    return validator;
};

module.exports = {
    validateWebhookSignature,
    validateBkashSignature,
    validateNagadSignature
};
