const paymentService = require('./payment.service');
const { AppError } = require('../../utils/AppError');

const SAFE_PAYMENT_CONFIG_FIELDS = [
    'id', 'shop_id', 'gateway', 'is_enabled', 'config',
    'created_at', 'updated_at'
];
const SENSITIVE_PAYMENT_KEY = /(?:credential|secret|token|password|api[_-]?key|private[_-]?key)/i;

const sanitizePaymentConfigOptions = (value) => {
    if (Array.isArray(value)) return value.map(sanitizePaymentConfigOptions);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !SENSITIVE_PAYMENT_KEY.test(key))
            .map(([key, nested]) => [key, sanitizePaymentConfigOptions(nested)])
    );
};

// PaymentConfig decrypts credentials through its Sequelize getter. Serialize
// an explicit allowlist and an approved summary instead of relying on a model's
// toJSON implementation to remain secret-free.
const sanitizePaymentConfig = (config) => {
    if (!config) return config;
    const plain = typeof config.toJSON === 'function' ? config.toJSON() : { ...config };
    const safe = {};
    for (const field of SAFE_PAYMENT_CONFIG_FIELDS) {
        if (plain[field] !== undefined) {
            safe[field] = field === 'config'
                ? sanitizePaymentConfigOptions(plain[field])
                : plain[field];
        }
    }

    const credentials = plain.credentials;
    const summary = plain.credential_summary || (
        plain.gateway === 'self-mfs' && credentials && typeof credentials === 'object'
            ? {
                has_credentials: Object.keys(credentials).length > 0,
                mfs_type: credentials.mfs_type ?? null,
                mfs_mode: credentials.mfs_mode ?? credentials.accountType ?? null,
                mfs_number: credentials.mfs_number ?? credentials.phone ?? null,
            }
            : null
    );
    if (summary && typeof summary === 'object') {
        safe.credential_summary = {
            has_credentials: summary.has_credentials === true,
            mfs_type: summary.mfs_type ?? null,
            mfs_mode: summary.mfs_mode ?? null,
            mfs_number: summary.mfs_number ?? null,
        };
    }
    return safe;
};

/**
 * Confirm COD payment
 */
const confirmCodPayment = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { orderId } = req.body;
        const order = await paymentService.confirmCodPayment(
            orderId,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            success: true,
            data: order
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    confirmCodPayment,
    getPaymentConfigs,
    savePaymentConfig,
    testPaymentConnection,
    deletePaymentConfig
};

/**
 * Get payment configurations
 */
async function getPaymentConfigs(req, res, next) {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const configs = await paymentService.getPaymentConfigs(shopId, req.user.userId);

        res.status(200).json({
            success: true,
            data: configs
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Save payment configuration
 */
async function savePaymentConfig(req, res, next) {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { gateway, is_enabled, credentials, config } = req.body;

        const savedConfig = await paymentService.savePaymentConfig(
            shopId,
            req.user.userId,
            gateway,
            is_enabled,
            credentials,
            config
        );

        res.status(200).json({
            success: true,
            message: 'Payment configuration saved successfully',
            data: sanitizePaymentConfig(savedConfig)
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Test payment gateway connection
 */
async function testPaymentConnection(req, res, next) {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { gateway, credentials } = req.body;

        const result = await paymentService.testPaymentConnection(
            shopId,
            req.user.userId,
            gateway,
            credentials
        );

        res.status(200).json({
            success: true,
            message: result.message,
            data: result
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Delete payment configuration
 */
async function deletePaymentConfig(req, res, next) {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { gateway } = req.params;

        const result = await paymentService.deletePaymentConfig(
            shopId,
            req.user.userId,
            gateway
        );

        res.status(200).json({
            success: true,
            message: result.message
        });
    } catch (error) {
        next(error);
    }
}

