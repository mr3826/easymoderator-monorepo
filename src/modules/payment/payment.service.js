const { Order, PaymentConfig } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { UserShop } = require('../entities');
const crypto = require('crypto');

const GATEWAY_ALIAS_TO_CANONICAL = {
    bkash: 'self-mfs'
};

const normalizeGateway = (gateway) => GATEWAY_ALIAS_TO_CANONICAL[gateway] || gateway;

const normalizeCredentialsForGateway = (gateway, credentials = {}) => {
    if (gateway === 'bkash') {
        return {
            mfs_type: gateway,
            mfs_number: credentials.mfs_number || credentials.phone || credentials.merchant_id || credentials.merchantId || '',
            mfs_mode: credentials.mfs_mode || credentials.accountType || 'self'
        };
    }
    return credentials;
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
    deletePaymentConfig
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
        config: config.config,
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
    credentials = normalizeCredentialsForGateway(originalGateway, credentials);

    // Validate gateway
    const validGateways = ['cod', 'self-mfs'];
    if (!validGateways.includes(gateway)) {
        throw new AppError('Invalid payment gateway', 400);
    }

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
            if (isEnabled !== undefined) {
                if (isEnabled && gateway !== 'cod') {
                    if (!paymentConfig.credentials || Object.keys(paymentConfig.credentials).length === 0) {
                        throw new AppError('Cannot enable payment method without credentials. Please save credentials first.', 400);
                    }
                }
                paymentConfig.is_enabled = isEnabled;
            }
            if (credentials) {
                paymentConfig.credentials = credentials;
            }
            if (config) {
                paymentConfig.config = config;
            }
            await paymentConfig.save();
        } else {
            if (gateway !== 'cod' && (!credentials || Object.keys(credentials).length === 0)) {
                throw new AppError('Credentials are required to create payment configuration', 400);
            }
            paymentConfig = await PaymentConfig.create({
                shop_id: shopId,
                gateway,
                is_enabled: isEnabled !== undefined ? isEnabled : false,
                credentials,
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
    // Safe state transitions
    if (paymentConfig.is_enabled && (!paymentConfig.credentials || Object.keys(paymentConfig.credentials).length === 0)) {
        paymentConfig.is_enabled = false;
        await paymentConfig.save();
    }

    // Sync self-mfs credentials into shop.settings.bd so the chatbot can read them
    if (gateway === 'self-mfs' && credentials && credentials.mfs_number) {
        try {
            const { updateBdSettings } = require('../shop/shop-bd-settings');
            await updateBdSettings(shopId, {
                mfs_type: credentials.mfs_type,
                mfs_number: credentials.mfs_number,
                mfs_mode: credentials.mfs_mode || 'self'
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
    credentials = normalizeCredentialsForGateway(originalGateway, credentials);

    if (gateway === 'cod') {
        return {
            success: true,
            message: 'COD does not require credentials'
        };
    } else if (gateway === 'self-mfs') {
        if (!credentials || !credentials.mfs_number) {
            throw new AppError('Self MFS requires mfs_number (01XXXXXXXXX)', 400);
        }
        const { validatePhone } = require('../../utils/validators/phone.validator');
        if (!validatePhone(credentials.mfs_number)) {
            throw new AppError('mfs_number must be a valid Bangladesh mobile number', 400);
        }
        return {
            success: true,
            message: `${credentials.mfs_type || 'MFS'} number verified`
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

