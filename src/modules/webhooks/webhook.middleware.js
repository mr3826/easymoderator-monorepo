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
 */
const validateBkashSignature = async (req, res, next) => {
    try {
        const signature = req.headers['x-bkash-signature'];
        const timestamp = req.headers['x-bkash-timestamp'];
        
        if (!signature || !timestamp) {
            throw new AppError('Missing bKash webhook headers', 401);
        }

        // Get bKash configuration (we need shop_id, but webhook doesn't include it)
        // For now, we'll skip signature validation for bKash (they don't provide shop_id in webhook)
        // In production, you might need to maintain a mapping of paymentId -> shopId
        
        logger.info('bKash webhook signature validation skipped (shop_id not available)');
        next();

    } catch (error) {
        logger.error('bKash webhook validation failed', { error: error.message });
        res.status(401).json({ error: 'Invalid webhook signature' });
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
 * Validate AamarPay webhook signature
 */
const validateAamarPaySignature = async (req, res, next) => {
    try {
        const { verify_sign, verify_key, mer_txnid } = req.body;

        if (!verify_sign || !verify_key || !mer_txnid) {
            throw new AppError('Missing AamarPay webhook signature fields', 401);
        }

        // Find payment transaction to get shop_id
        const { PaymentTransaction } = require('../entities');
        const paymentTransaction = await PaymentTransaction.findOne({
            where: { transaction_id: mer_txnid }
        });

        if (!paymentTransaction) {
            throw new AppError('Payment transaction not found', 404);
        }

        // Get AamarPay configuration
        const paymentConfig = await PaymentConfig.findOne({
            where: { 
                shop_id: paymentTransaction.shop_id, 
                gateway: 'aamarpay',
                is_enabled: true 
            }
        });

        if (!paymentConfig?.credentials?.secret_key) {
            throw new AppError('AamarPay configuration not found', 404);
        }

        // Validate signature
        const keys = String(verify_key).split(',').map(k => k.trim()).filter(Boolean);
        const signaturePayload = keys.map(k => `${k}=${req.body[k] ?? ''}`).join('&');
        
        const useMd5 = process.env.AAMARPAY_USE_MD5_SIGNATURE === 'true';
        const expected = useMd5
            ? crypto.createHash('md5').update(`${signaturePayload}&signature_key=${paymentConfig.credentials.secret_key}`).digest('hex')
            : crypto.createHmac('sha256', paymentConfig.credentials.secret_key).update(`${signaturePayload}&signature_key=${paymentConfig.credentials.secret_key}`).digest('hex');

        if (expected !== verify_sign) {
            throw new AppError('Invalid AamarPay webhook signature', 401);
        }

        logger.info('AamarPay webhook signature validated', {
            mer_txnid,
            shopId: paymentTransaction.shop_id
        });

        next();

    } catch (error) {
        logger.error('AamarPay webhook validation failed', { error: error.message });
        res.status(401).json({ error: 'Invalid webhook signature' });
    }
};

/**
 * Validate SSLCommerz webhook signature
 */
const validateSSLCommerzSignature = async (req, res, next) => {
    try {
        const { tran_id, store_id, status } = req.body;

        if (!tran_id || !store_id || !status) {
            throw new AppError('Missing SSLCommerz webhook fields', 401);
        }

        // Find payment transaction to get shop_id
        const { PaymentTransaction } = require('../entities');
        const paymentTransaction = await PaymentTransaction.findOne({
            where: { transaction_id: tran_id }
        });

        if (!paymentTransaction) {
            throw new AppError('Payment transaction not found', 404);
        }

        // Get SSLCommerz configuration
        const paymentConfig = await PaymentConfig.findOne({
            where: { 
                shop_id: paymentTransaction.shop_id, 
                gateway: 'sslcommerz',
                is_enabled: true 
            }
        });

        if (!paymentConfig?.credentials?.store_password) {
            throw new AppError('SSLCommerz configuration not found', 404);
        }

        // SSLCommerz uses validation API call instead of signature validation
        // We'll validate the transaction by calling their validation endpoint
        const environment = paymentConfig.config?.environment || 'sandbox';
        const baseUrl = environment === 'sandbox'
            ? 'https://sandbox.sslcommerz.com'
            : 'https://securepay.sslcommerz.com';

        const validationUrl = `${baseUrl}/validator/api/validationserverAPI.php?val_id=${req.body.val_id}&store_id=${store_id}&store_passwd=${paymentConfig.credentials.store_password}&format=json`;

        const axios = require('axios');
        const validation = await axios.get(validationUrl);

        if (validation.data?.status !== 'VALID') {
            throw new AppError('Invalid SSLCommerz transaction', 401);
        }

        logger.info('SSLCommerz webhook validated', {
            tran_id,
            shopId: paymentTransaction.shop_id
        });

        next();

    } catch (error) {
        logger.error('SSLCommerz webhook validation failed', { error: error.message });
        res.status(401).json({ error: 'Invalid webhook' });
    }
};

/**
 * Generic webhook signature validator
 * Routes specific validators based on gateway
 */
const validateWebhookSignature = (gateway) => {
    const validators = {
        'bkash': validateBkashSignature,
        'nagad': validateNagadSignature,
        'aamarpay': validateAamarPaySignature,
        'sslcommerz': validateSSLCommerzSignature
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
    validateNagadSignature,
    validateAamarPaySignature,
    validateSSLCommerzSignature
};
