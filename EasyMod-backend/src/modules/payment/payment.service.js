const { Order, PaymentConfig } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { UserShop } = require('../entities');
const crypto = require('crypto');

const GATEWAY_ALIAS_TO_CANONICAL = {
    bkash: 'self-mfs'
};

const VALID_MFS_TYPES = ['bkash', 'nagad', 'rocket'];
const VALID_MFS_MODES = ['self', 'business'];
const SENSITIVE_PAYMENT_KEY = /(?:credential|secret|token|password|api[_-]?key|private[_-]?key)/i;

const normalizeGateway = (gateway) => {
    if (typeof gateway !== 'string') return gateway;
    const normalized = gateway.toLowerCase();
    return GATEWAY_ALIAS_TO_CANONICAL[normalized] || normalized;
};

const normalizeMfsMode = (mode) => {
    if (mode === 'merchant') return 'business';
    if (mode === 'personal') return 'self';
    return mode;
};

const isNonEmptyCredentials = (credentials) => (
    credentials !== null &&
    typeof credentials === 'object' &&
    !Array.isArray(credentials) &&
    Object.keys(credentials).length > 0
);

const sanitizePaymentConfigOptions = (value) => {
    if (Array.isArray(value)) return value.map(sanitizePaymentConfigOptions);
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
        Object.entries(value)
            .filter(([key]) => !SENSITIVE_PAYMENT_KEY.test(key))
            .map(([key, nested]) => [key, sanitizePaymentConfigOptions(nested)])
    );
};

const normalizeCredentialsForGateway = (gateway, credentials = {}) => {
    if (credentials === null || credentials === undefined) return null;
    if (typeof credentials !== 'object' || Array.isArray(credentials)) return credentials;

    const normalizedGateway = normalizeGateway(gateway);
    const source = { ...credentials };
    if (normalizedGateway === 'self-mfs') {
        const mfsType = typeof source.mfs_type === 'string'
            ? source.mfs_type.toLowerCase()
            : source.mfs_type;
        const mode = normalizeMfsMode(source.mfs_mode || source.accountType);

        return {
            ...source,
            ...(mfsType ? { mfs_type: mfsType } : {}),
            ...(mode ? { mfs_mode: mode } : {}),
            ...(gateway?.toLowerCase?.() === 'bkash' ? {
                mfs_type: 'bkash',
                mfs_number: source.mfs_number || source.phone || source.merchant_id || source.merchantId || '',
                mfs_mode: mode || 'self'
            } : {})
        };
    }
    return source;
};

const validateSelfMfsCredentials = (credentials) => {
    if (!isNonEmptyCredentials(credentials)) {
        throw new AppError('Self MFS credentials are required', 400);
    }

    const mfsType = typeof credentials.mfs_type === 'string'
        ? credentials.mfs_type.toLowerCase()
        : credentials.mfs_type;
    if (!VALID_MFS_TYPES.includes(mfsType)) {
        throw new AppError(`mfs_type must be one of: ${VALID_MFS_TYPES.join(', ')}`, 400);
    }

    const mfsMode = normalizeMfsMode(credentials.mfs_mode);
    if (!VALID_MFS_MODES.includes(mfsMode)) {
        throw new AppError(`mfs_mode must be one of: ${VALID_MFS_MODES.join(', ')}`, 400);
    }

    const { validatePhone } = require('../../utils/validators/phone.validator');
    if (!validatePhone(credentials.mfs_number)) {
        throw new AppError('mfs_number must be a valid Bangladesh mobile number', 400);
    }

    return {
        ...credentials,
        mfs_type: mfsType,
        mfs_mode: mfsMode,
        mfs_number: credentials.mfs_number
    };
};

const buildCredentialSummary = (config) => {
    const credentials = config?.credentials;
    const hasCredentials = isNonEmptyCredentials(credentials);
    const mfsMode = hasCredentials
        ? normalizeMfsMode(credentials.mfs_mode || credentials.accountType)
        : null;
    return {
        has_credentials: hasCredentials,
        mfs_type: hasCredentials && typeof credentials.mfs_type === 'string'
            ? credentials.mfs_type
            : null,
        mfs_mode: mfsMode || null,
        mfs_number: hasCredentials
            ? credentials.mfs_number || credentials.phone || null
            : null
    };
};

/**
 * Verify user has access to shop
 */
const verifyShopAccess = async (userId, shopId) => {
    const userShop = await UserShop.findOne({
        where: {
            user_id: userId,
            shop_id: shopId,
            is_active: true
        }
    });

    if (!userShop) {
        throw new AppError('You do not have access to this shop', 403);
    }
    return userShop;
};

/**
 * Confirm COD payment for an order
 */
const confirmCodPayment = async (orderId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId }
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    if (order.order_status !== 'confirmed') {
        throw new AppError('Order must be confirmed before payment can be processed', 400);
    }

    if (order.payment_status !== 'pending') {
        throw new AppError(`Payment status is already ${order.payment_status}`, 400);
    }

    // Bug #12: COD "confirm" means delivery collected — status → 'paid'.
    // 'unpaid' was wrong and inconsistent with gateway payments; removing it.
    await order.update({ payment_status: 'paid', paid_at: new Date() });

    return order;
};

module.exports = {
    confirmCodPayment,
    getPaymentConfigs,
    savePaymentConfig,
    testPaymentConnection,
    deletePaymentConfig,
    _private: {
        normalizeGateway,
        normalizeCredentialsForGateway,
        validateSelfMfsCredentials,
        buildCredentialSummary,
        isNonEmptyCredentials,
        sanitizePaymentConfigOptions
    }
};

/**
 * Get all payment configurations for a shop
 */
async function getPaymentConfigs(shopId, userId) {
    await verifyShopAccess(userId, shopId);

    const configs = await PaymentConfig.findAll({
        where: { shop_id: shopId }
    });

    // Mask sensitive data before returning
    return configs.map(config => ({
        id: config.id,
        gateway: config.gateway,
        is_enabled: config.is_enabled,
        config: sanitizePaymentConfigOptions(config.config),
        ...(config.gateway === 'self-mfs'
            ? { credential_summary: buildCredentialSummary(config) }
            : {}),
        created_at: config.created_at,
        updated_at: config.updated_at
    }));
}

/**
 * Save or update payment configuration
 */
async function savePaymentConfig(shopId, userId, gateway, isEnabled, credentials, config) {
    await verifyShopAccess(userId, shopId);
    const originalGateway = gateway;
    gateway = normalizeGateway(gateway);

    // Validate gateway
    const validGateways = ['cod', 'self-mfs'];
    if (!validGateways.includes(gateway)) {
        throw new AppError('Invalid payment gateway', 400);
    }

    const normalizedCredentials = normalizeCredentialsForGateway(originalGateway, credentials);
    const hasIncomingCredentials = isNonEmptyCredentials(normalizedCredentials);
    if (gateway === 'self-mfs' && credentials !== undefined && credentials !== null && !hasIncomingCredentials) {
        // Empty objects are treated as omitted, while malformed non-object
        // values are rejected rather than silently ignored.
        if (typeof credentials !== 'object' || Array.isArray(credentials)) {
            validateSelfMfsCredentials(normalizedCredentials);
        }
    }
    const validatedIncomingCredentials = gateway === 'self-mfs' && hasIncomingCredentials
        ? validateSelfMfsCredentials(normalizedCredentials)
        : null;

    // Idempotency key logic
    const idempotencyKey = config?.idempotency_key || null;
    if (idempotencyKey) {
        const existing = await PaymentConfig.findOne({ where: { shop_id: shopId, gateway, idempotency_key: idempotencyKey } });
        if (existing) return existing;
    }


    // Retry-safe processing
    let paymentConfig;
    try {
        paymentConfig = await PaymentConfig.findOne({ where: { shop_id: shopId, gateway } });
        if (paymentConfig) {
            const storedCredentials = gateway === 'self-mfs' ? paymentConfig.credentials : null;
            const effectiveCredentials = validatedIncomingCredentials || storedCredentials;
            const nextEnabled = isEnabled !== undefined ? isEnabled : paymentConfig.is_enabled;

            if (gateway === 'self-mfs' && nextEnabled) {
                validateSelfMfsCredentials(effectiveCredentials);
            }

            if (isEnabled !== undefined) {
                paymentConfig.is_enabled = isEnabled;
            }
            if (validatedIncomingCredentials) {
                paymentConfig.credentials = validatedIncomingCredentials;
            }
            if (config) {
                paymentConfig.config = config;
            }
            await paymentConfig.save();
        } else {
            const nextEnabled = isEnabled !== undefined ? isEnabled : false;
            if (gateway === 'self-mfs' && nextEnabled) {
                validateSelfMfsCredentials(validatedIncomingCredentials);
            }
            paymentConfig = await PaymentConfig.create({
                shop_id: shopId,
                gateway,
                is_enabled: nextEnabled,
                credentials: gateway === 'self-mfs' ? validatedIncomingCredentials : null,
                config: config || {},
                idempotency_key: idempotencyKey
            });
        }
    } catch (err) {
        if (err instanceof AppError) {
            throw err;
        }
        // Robust error handling
        throw new AppError('Payment config update failed: ' + err.message, 500);
    }
    // Sync self-mfs credentials into shop.settings.bd so the chatbot can read them
    const credentialsForSync = validatedIncomingCredentials || (gateway === 'self-mfs' ? paymentConfig.credentials : null);
    if (gateway === 'self-mfs' && credentialsForSync?.mfs_number) {
        try {
            const { updateBdSettings } = require('../shop/shop-bd-settings');
            await updateBdSettings(shopId, {
                mfs_type: credentialsForSync.mfs_type,
                mfs_number: credentialsForSync.mfs_number,
                mfs_mode: credentialsForSync.mfs_mode || 'self'
            });
        } catch (_) { /* non-fatal — chatbot will degrade to manual payment */ }
    }

    return paymentConfig;
}

/**
 * Test payment gateway connection
 */
async function testPaymentConnection(shopId, userId, gateway, credentials) {
    await verifyShopAccess(userId, shopId);
    const originalGateway = gateway;
    gateway = normalizeGateway(gateway);

    if (gateway === 'cod') {
        return {
            success: true,
            message: 'COD does not require credentials'
        };
    } else if (gateway === 'self-mfs') {
        const normalizedCredentials = normalizeCredentialsForGateway(originalGateway, credentials);
        const validatedCredentials = validateSelfMfsCredentials(normalizedCredentials);
        return {
            success: true,
            message: `${validatedCredentials.mfs_type} number verified`
        };
    }

    throw new AppError('Invalid payment gateway', 400);
}

/**
 * Delete payment configuration (disconnect)
 */
async function deletePaymentConfig(shopId, userId, gateway) {
    await verifyShopAccess(userId, shopId);
    gateway = normalizeGateway(gateway);

    const paymentConfig = await PaymentConfig.findOne({
        where: { shop_id: shopId, gateway }
    });

    if (!paymentConfig) {
        throw new AppError('Payment configuration not found', 404);
    }

    await paymentConfig.destroy();

    return {
        success: true,
        message: `${gateway} configuration deleted successfully`
    };
}

