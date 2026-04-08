const { Order, PaymentConfig, Invoice, Shop } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { UserShop } = require('../entities');
const axios = require('axios');
const crypto = require('crypto');
const config = require('../../config/config');

const GATEWAY_ALIAS_TO_CANONICAL = {
    bkash: 'self-mfs',
    nagad: 'self-mfs',
    rocket: 'self-mfs'
};

const normalizeGateway = (gateway) => GATEWAY_ALIAS_TO_CANONICAL[gateway] || gateway;

const normalizeCredentialsForGateway = (gateway, credentials = {}) => {
    if (gateway === 'bkash' || gateway === 'nagad' || gateway === 'rocket') {
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
    deletePaymentConfig,
    initiateAamarPayPayment,
    initiateSSLCommerzPayment,
    initiateSubscriptionInvoicePayment,
    verifyAamarPayCallback,
    verifySSLCommerzCallback,
    verifyRocketCallback,
    verifyRocketWebhook
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
    const validGateways = ['cod', 'aamarpay', 'sslcommerz', 'self-mfs'];
    if (!validGateways.includes(gateway)) {
        throw new AppError('Invalid payment gateway', 400);
    }

    // Idempotency key logic
    const idempotencyKey = config?.idempotency_key || null;
    if (idempotencyKey) {
        const existing = await PaymentConfig.findOne({ where: { shop_id: shopId, gateway, idempotency_key: idempotencyKey } });
        if (existing) return existing;
    }

    // Validate credentials based on gateway
    if (isEnabled && credentials) {
        if (gateway === 'aamarpay') {
            if (!credentials.store_id || !credentials.secret_key) {
                throw new AppError('AamarPay requires store_id and secret_key', 400);
            }
        } else if (gateway === 'sslcommerz') {
            if (!credentials.store_id || !credentials.store_password) {
                throw new AppError('SSLCommerz requires store_id and store_password', 400);
            }
        }
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

    if (gateway === 'aamarpay') {
        if (!credentials.store_id || !credentials.secret_key) {
            throw new AppError('AamarPay requires store_id and secret_key', 400);
        }

        try {
            // Test AamarPay credentials by making a minimal API call
            const baseUrl = 'https://sandbox.aamarpay.com';

            // AamarPay doesn't have a dedicated test endpoint, so we'll validate the format
            // In production, you might want to make an actual small transaction test
            if (credentials.store_id.length < 3 || credentials.secret_key.length < 10) {
                throw new Error('Invalid credential format');
            }

            return {
                success: true,
                message: 'AamarPay credentials validated successfully'
            };
        } catch (error) {
            throw new AppError('Failed to validate AamarPay credentials: ' + error.message, 400);
        }
    } else if (gateway === 'sslcommerz') {
        if (!credentials.store_id || !credentials.store_password) {
            throw new AppError('SSLCommerz requires store_id and store_password', 400);
        }

        try {
            // Validate credential format
            if (credentials.store_id.length < 3 || credentials.store_password.length < 3) {
                throw new Error('Invalid credential format');
            }

            return {
                success: true,
                message: 'SSLCommerz credentials validated successfully'
            };
        } catch (error) {
            throw new AppError('Failed to validate SSLCommerz credentials: ' + error.message, 400);
        }
    } else if (gateway === 'cod') {
        return {
            success: true,
            message: 'COD does not require credentials'
        };
    } else if (gateway === 'self-mfs') {
        if (!credentials || !credentials.mfs_number) {
            throw new AppError('Self MFS requires mfs_number (01XXXXXXXXX)', 400);
        }
        const BD_PHONE_RE = /^(?:\+?88)?01[3-9]\d{8}$/;
        if (!BD_PHONE_RE.test(credentials.mfs_number)) {
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

/**
 * Initiate AamarPay payment
 */
async function initiateAamarPayPayment(orderId, shopId, userId) {
    await verifyShopAccess(userId, shopId);

    // Get order
    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId }
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    if (order.payment_status !== 'pending') {
        throw new AppError('Payment already processed or cancelled', 400);
    }

    // Get AamarPay configuration
    const config = await PaymentConfig.findOne({
        where: { shop_id: shopId, gateway: 'aamarpay', is_enabled: true }
    });

    if (!config || !config.credentials) {
        throw new AppError('AamarPay is not configured for this shop', 400);
    }

    const { store_id, secret_key } = config.credentials;
    const baseUrl = process.env.AAMARPAY_SANDBOX === 'true'
        ? 'https://sandbox.aamarpay.com'
        : 'https://secure.aamarpay.com';

    // Prepare payment data
    const paymentData = {
        store_id,
        signature_key: secret_key,
        tran_id: `${order.order_number}-${Date.now()}`,
        success_url: `${process.env.BASE_URL}/api/payment/aamarpay/success`,
        fail_url: `${process.env.BASE_URL}/api/payment/aamarpay/fail`,
        cancel_url: `${process.env.BASE_URL}/api/payment/aamarpay/cancel`,
        amount: parseFloat(order.total),
        currency: 'BDT',
        desc: `Payment for Order #${order.order_number}`,
        cus_name: order.customer_name || 'Customer',
        cus_email: 'customer@example.com',
        cus_add1: order.delivery_address || 'N/A',
        cus_phone: order.customer_phone || '01700000000',
        type: 'json'
    };

    try {
        const response = await axios.post(`${baseUrl}/api/v1/initiate-payment`, paymentData, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.payment_url) {
            // Update order with transaction ID
            await order.update({
                payment_status: 'processing'
            });

            return {
                success: true,
                payment_url: response.data.payment_url,
                transaction_id: paymentData.tran_id
            };
        }

        throw new AppError('Failed to initiate AamarPay payment', 500);
    } catch (error) {
        console.error('AamarPay initiation error:', error.response?.data || error.message);
        throw new AppError('Failed to initiate payment with AamarPay', 500);
    }
}

/**
 * Initiate SSLCommerz payment
 */
async function initiateSSLCommerzPayment(orderId, shopId, userId) {
    await verifyShopAccess(userId, shopId);

    // Get order
    const order = await Order.findOne({
        where: { id: orderId, shop_id: shopId }
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    if (order.payment_status !== 'pending') {
        throw new AppError('Payment already processed or cancelled', 400);
    }

    // Get SSLCommerz configuration
    const config = await PaymentConfig.findOne({
        where: { shop_id: shopId, gateway: 'sslcommerz', is_enabled: true }
    });

    if (!config || !config.credentials) {
        throw new AppError('SSLCommerz is not configured for this shop', 400);
    }

    const { store_id, store_password } = config.credentials;
    const environment = config.config?.environment || 'sandbox';
    const baseUrl = environment === 'sandbox'
        ? 'https://sandbox.sslcommerz.com'
        : 'https://securepay.sslcommerz.com';

    // Prepare payment data
    const paymentData = {
        store_id,
        store_passwd: store_password,
        total_amount: parseFloat(order.total),
        currency: 'BDT',
        tran_id: `${order.order_number}-${Date.now()}`,
        success_url: `${process.env.BASE_URL}/api/payment/sslcommerz/success`,
        fail_url: `${process.env.BASE_URL}/api/payment/sslcommerz/fail`,
        cancel_url: `${process.env.BASE_URL}/api/payment/sslcommerz/cancel`,
        ipn_url: `${process.env.BASE_URL}/api/payment/sslcommerz/ipn`,
        product_name: `Order #${order.order_number}`,
        product_category: 'General',
        product_profile: 'general',
        cus_name: order.customer_name || 'Customer',
        cus_email: 'customer@example.com',
        cus_add1: order.delivery_address || 'N/A',
        cus_phone: order.customer_phone || '01700000000',
        cus_city: 'Dhaka',
        cus_country: 'Bangladesh',
        shipping_method: 'NO',
        num_of_item: 1,
        product_amount: parseFloat(order.total),
        vat: 0,
        discount_amount: 0,
        convenience_fee: 0
    };

    try {
        const response = await axios.post(`${baseUrl}/gwprocess/v4/api.php`,
            new URLSearchParams(paymentData).toString(),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            }
        );

        if (response.data && response.data.status === 'SUCCESS' && response.data.GatewayPageURL) {
            // Update order with transaction ID
            await order.update({
                payment_status: 'processing'
            });

            return {
                success: true,
                payment_url: response.data.GatewayPageURL,
                transaction_id: paymentData.tran_id
            };
        }

        throw new AppError(response.data?.failedreason || 'Failed to initiate SSLCommerz payment', 500);
    } catch (error) {
        console.error('SSLCommerz initiation error:', error.response?.data || error.message);
        throw new AppError('Failed to initiate payment with SSLCommerz', 500);
    }
}

/**
 * Initiate payment for a subscription invoice (conversation pack, etc.)
 * Works with AamarPay and SSLCommerz.
 * tran_id format: INV-YYYYMM-XXXXXX-<timestamp> so callbacks can identify it.
 */
async function initiateSubscriptionInvoicePayment(invoiceId, shopId, userId, gateway) {
    await verifyShopAccess(userId, shopId);

    const invoice = await Invoice.findOne({ where: { id: invoiceId, shop_id: shopId } });
    if (!invoice) throw new AppError('Invoice not found', 404);
    if (invoice.status !== 'pending') throw new AppError('Invoice is not awaiting payment', 400);

    const shop = await Shop.findOne({ where: { id: shopId }, attributes: ['name', 'email'] });
    const tran_id = `${invoice.invoice_number}-${Date.now()}`;
    const amount = parseFloat(invoice.amount);

    if (gateway === 'aamarpay') {
        const payConfig = await PaymentConfig.findOne({
            where: { shop_id: shopId, gateway: 'aamarpay', is_enabled: true }
        });
        if (!payConfig?.credentials) throw new AppError('AamarPay is not configured for this shop', 400);

        const { store_id, secret_key } = payConfig.credentials;
        const baseUrl = process.env.AAMARPAY_SANDBOX === 'true'
            ? 'https://sandbox.aamarpay.com'
            : 'https://secure.aamarpay.com';

        const paymentData = {
            store_id, signature_key: secret_key, tran_id,
            success_url: `${process.env.BASE_URL}/api/payment/aamarpay/success`,
            fail_url: `${process.env.BASE_URL}/api/payment/aamarpay/fail`,
            cancel_url: `${process.env.BASE_URL}/api/payment/aamarpay/cancel`,
            amount, currency: 'BDT',
            desc: invoice.invoice_type || 'Subscription Invoice',
            cus_name: shop?.name || 'Shop Owner',
            cus_email: shop?.email || 'owner@example.com',
            cus_add1: 'Bangladesh', cus_phone: '01700000000',
            type: 'json'
        };

        const response = await axios.post(`${baseUrl}/api/v1/initiate-payment`, paymentData, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data?.payment_url) {
            await invoice.update({ transaction_id: tran_id });
            return { success: true, payment_url: response.data.payment_url, transaction_id: tran_id };
        }
        throw new AppError('Failed to initiate AamarPay payment for invoice', 500);

    } else if (gateway === 'sslcommerz') {
        const payConfig = await PaymentConfig.findOne({
            where: { shop_id: shopId, gateway: 'sslcommerz', is_enabled: true }
        });
        if (!payConfig?.credentials) throw new AppError('SSLCommerz is not configured for this shop', 400);

        const { store_id, store_password } = payConfig.credentials;
        const environment = payConfig.config?.environment || 'sandbox';
        const baseUrl = environment === 'sandbox'
            ? 'https://sandbox.sslcommerz.com'
            : 'https://securepay.sslcommerz.com';

        const paymentData = {
            store_id, store_passwd: store_password,
            total_amount: amount, currency: 'BDT', tran_id,
            success_url: `${process.env.BASE_URL}/api/payment/sslcommerz/success`,
            fail_url: `${process.env.BASE_URL}/api/payment/sslcommerz/fail`,
            cancel_url: `${process.env.BASE_URL}/api/payment/sslcommerz/cancel`,
            ipn_url: `${process.env.BASE_URL}/api/payment/sslcommerz/ipn`,
            product_name: invoice.invoice_type || 'Subscription Invoice',
            product_category: 'Subscription', product_profile: 'general',
            cus_name: shop?.name || 'Shop Owner',
            cus_email: shop?.email || 'owner@example.com',
            cus_add1: 'Bangladesh', cus_phone: '01700000000',
            cus_city: 'Dhaka', cus_country: 'Bangladesh',
            shipping_method: 'NO', num_of_item: 1,
            product_amount: amount, vat: 0, discount_amount: 0, convenience_fee: 0
        };

        const response = await axios.post(
            `${baseUrl}/gwprocess/v4/api.php`,
            new URLSearchParams(paymentData).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        if (response.data?.status === 'SUCCESS' && response.data?.GatewayPageURL) {
            await invoice.update({ transaction_id: tran_id });
            return { success: true, payment_url: response.data.GatewayPageURL, transaction_id: tran_id };
        }
        throw new AppError(response.data?.failedreason || 'Failed to initiate SSLCommerz payment for invoice', 500);
    }

    throw new AppError('Invalid payment gateway. Use aamarpay or sslcommerz', 400);
}

/**
 * Extract invoice_number from an INV- prefixed tran_id.
 * tran_id format: INV-YYYYMM-XXXXXX-<timestamp>
 * invoice_number: INV-YYYYMM-XXXXXX (first 3 dash-separated segments)
 */
function extractInvoiceNumber(tranId) {
    return tranId.split('-').slice(0, 3).join('-');
}

/**
 * Verify AamarPay payment callback
 */
async function verifyAamarPayCallback(callbackData) {
    const { mer_txnid, pay_status, status_code, verify_sign, verify_key, amount, store_id } = callbackData;

    if (!mer_txnid) {
        throw new AppError('Invalid callback data', 400);
    }

    // Subscription invoice payment — tran_id starts with 'INV-'
    if (mer_txnid.startsWith('INV-')) {
        const invoiceNumber = extractInvoiceNumber(mer_txnid);
        const invoice = await Invoice.findOne({ where: { invoice_number: invoiceNumber } });
        if (!invoice) throw new AppError('Invoice not found', 404);

        const payConfig = await PaymentConfig.findOne({ where: { shop_id: invoice.shop_id, gateway: 'aamarpay' } });
        if (!payConfig?.credentials) throw new AppError('AamarPay configuration not found', 400);

        const { store_id: configStoreId, secret_key } = payConfig.credentials;
        if (store_id && configStoreId && store_id !== configStoreId) throw new AppError('Invalid AamarPay store ID', 403);

        if (!verify_sign || !verify_key) throw new AppError('Missing AamarPay signature', 403);
        const keys = String(verify_key).split(',').map(k => k.trim()).filter(Boolean);
        const signaturePayload = keys.map(k => `${k}=${callbackData[k] ?? ''}`).join('&');
        const useMd5 = process.env.AAMARPAY_USE_MD5_SIGNATURE === 'true';
        const expected = useMd5
            ? crypto.createHash('md5').update(`${signaturePayload}&signature_key=${secret_key}`).digest('hex')
            : crypto.createHmac('sha256', secret_key).update(`${signaturePayload}&signature_key=${secret_key}`).digest('hex');
        if (expected !== verify_sign) throw new AppError('Invalid AamarPay signature', 403);

        if (pay_status === 'Successful' && status_code === '2') {
            const subscriptionService = require('../subscription/subscription.service');
            await subscriptionService.deliverConversationPackCredit(invoice);
            return { success: true, type: 'invoice', invoice };
        } else {
            await invoice.update({ status: 'failed' });
            return { success: false, type: 'invoice', invoice };
        }
    }

    // Extract order number from transaction ID
    const orderNumber = mer_txnid.split('-')[0];

    // Find order
    const order = await Order.findOne({
        where: { order_number: orderNumber }
    });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    const paymentConfig = await PaymentConfig.findOne({
        where: { shop_id: order.shop_id, gateway: 'aamarpay' }
    });

    if (!paymentConfig || !paymentConfig.credentials) {
        throw new AppError('AamarPay configuration not found', 400);
    }

    const { store_id: configStoreId, secret_key } = paymentConfig.credentials;

    if (store_id && configStoreId && store_id !== configStoreId) {
        throw new AppError('Invalid AamarPay store ID', 403);
    }

    // HMAC-SHA256 signature verification (required in ALL environments, not MD5)
    if (!verify_sign || !verify_key) {
        throw new AppError('Missing AamarPay signature', 403);
    }

    const keys = String(verify_key)
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);

    const signaturePayload = keys
        .map((key) => `${key}=${callbackData[key] ?? ''}`)
        .join('&');

    // HMAC-SHA256 required (not MD5). Set AAMARPAY_USE_MD5_SIGNATURE=true only if gateway does not support SHA256.
    const useMd5 = process.env.AAMARPAY_USE_MD5_SIGNATURE === 'true';
    const expected = useMd5
        ? crypto.createHash('md5').update(`${signaturePayload}&signature_key=${secret_key}`).digest('hex')
        : crypto.createHmac('sha256', secret_key).update(`${signaturePayload}&signature_key=${secret_key}`).digest('hex');

    if (expected !== verify_sign) {
        throw new AppError('Invalid AamarPay signature', 403);
    }

    if (amount !== undefined && Number.isFinite(parseFloat(amount))) {
        const orderTotal = parseFloat(order.total);
        const paidAmount = parseFloat(amount);
        if (Math.abs(orderTotal - paidAmount) > 0.01) {
            throw new AppError('AamarPay amount mismatch', 400);
        }
    }

    // Verify payment status
    if (pay_status === 'Successful' && status_code === '2') {
        // Bug #12: record when payment was confirmed
        await order.update({ payment_status: 'paid', paid_at: new Date() });
        return { success: true, order };
    } else {
        await order.update({ payment_status: 'failed' });
        return { success: false, order };
    }
}

/**
 * Verify SSLCommerz payment callback — P2-7: server-side POST only (no query-string validation).
 * Callers must pass req.body; GET/query params must not be used.
 */
async function verifySSLCommerzCallback(callbackData) {
    const { tran_id, val_id, status } = callbackData;

    if (!tran_id) {
        throw new AppError('Invalid callback data', 400);
    }

    // Subscription invoice payment — tran_id starts with 'INV-'
    if (tran_id.startsWith('INV-')) {
        const invoiceNumber = extractInvoiceNumber(tran_id);
        const invoice = await Invoice.findOne({ where: { invoice_number: invoiceNumber } });
        if (!invoice) throw new AppError('Invoice not found', 404);

        const payConfig = await PaymentConfig.findOne({
            where: { shop_id: invoice.shop_id, gateway: 'sslcommerz', is_enabled: true }
        });
        if (!payConfig?.credentials) throw new AppError('SSLCommerz configuration not found', 400);

        const { store_id, store_password } = payConfig.credentials;
        const environment = payConfig.config?.environment || 'sandbox';
        const baseUrl = environment === 'sandbox'
            ? 'https://sandbox.sslcommerz.com'
            : 'https://securepay.sslcommerz.com';

        try {
            if (status === 'VALID' || status === 'VALIDATED') {
                const validationUrl = `${baseUrl}/validator/api/validationserverAPI.php?val_id=${val_id}&store_id=${store_id}&store_passwd=${store_password}&format=json`;
                const validation = await axios.get(validationUrl);
                if (validation.data?.status === 'VALID') {
                    const subscriptionService = require('../subscription/subscription.service');
                    await subscriptionService.deliverConversationPackCredit(invoice);
                    return { success: true, type: 'invoice', invoice };
                }
            }
            await invoice.update({ status: 'failed' });
            return { success: false, type: 'invoice', invoice };
        } catch (error) {
            console.error('SSLCommerz invoice validation error:', error.message);
            await invoice.update({ status: 'failed' });
            return { success: false, type: 'invoice', invoice };
        }
    }

    // Extract order number from transaction ID
    const orderNumber = tran_id.split('-')[0];

    // Find order
    const order = await Order.findOne({ where: { order_number: orderNumber } });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    // Get SSLCommerz configuration for validation
    const config = await PaymentConfig.findOne({
        where: { shop_id: order.shop_id, gateway: 'sslcommerz', is_enabled: true }
    });

    if (!config || !config.credentials) {
        throw new AppError('SSLCommerz configuration not found', 400);
    }

    const { store_id, store_password } = config.credentials;
    const environment = config.config?.environment || 'sandbox';
    const baseUrl = environment === 'sandbox'
        ? 'https://sandbox.sslcommerz.com'
        : 'https://securepay.sslcommerz.com';

    // Validate transaction with SSLCommerz
    try {
        if (status === 'VALID' || status === 'VALIDATED') {
            if (callbackData.store_id && callbackData.store_id !== store_id) {
                throw new AppError('Invalid SSLCommerz store ID', 403);
            }

            const validationUrl = `${baseUrl}/validator/api/validationserverAPI.php?val_id=${val_id}&store_id=${store_id}&store_passwd=${store_password}&format=json`;
            const validation = await axios.get(validationUrl);

            if (validation.data && validation.data.status === 'VALID') {
                // Bug #12: record when payment was confirmed
                await order.update({ payment_status: 'paid', paid_at: new Date() });
                return { success: true, order };
            }
        }

        await order.update({ payment_status: 'failed' });
        return { success: false, order };
    } catch (error) {
        console.error('SSLCommerz validation error:', error.message);
        await order.update({ payment_status: 'failed' });
        return { success: false, order };
    }
}

/**
 * Verify Rocket payment callback
 * Called when customer completes checkout on Rocket
 */
async function verifyRocketCallback(callbackData) {
    const { transaction_id, order_id, status, amount } = callbackData;

    if (!transaction_id || !order_id) {
        throw new AppError('Invalid Rocket callback data', 400);
    }

    // Find order by order number
    const order = await Order.findOne({ where: { order_number: order_id } });

    if (!order) {
        throw new AppError('Order not found', 404);
    }

    // Verify amount matches
    if (parseFloat(amount) !== parseFloat(order.total)) {
        console.error('Rocket amount mismatch:', { received: amount, expected: order.total });
        await order.update({ payment_status: 'failed' });
        throw new AppError('Payment amount mismatch', 400);
    }

    // Get Rocket configuration for verification
    const config = await PaymentConfig.findOne({
        where: { shop_id: order.shop_id, gateway: 'rocket', is_enabled: true }
    });

    if (!config || !config.credentials) {
        throw new AppError('Rocket configuration not found', 400);
    }

    try {
        const rocketMerchantService = require('./rocket-merchant.service');
        
        // Verify payment with Rocket API
        const verification = await rocketMerchantService.verifyPayment(order.shop_id, transaction_id);

        if (verification.success && verification.status === 'completed') {
            // Update order payment status
            await order.update({ 
                payment_status: 'paid', 
                paid_at: new Date(),
                payment_method: 'rocket'
            });
            
            return { 
                success: true, 
                order, 
                transaction_id,
                message: 'Payment verified successfully'
            };
        }

        await order.update({ payment_status: 'failed' });
        return { 
            success: false, 
            order, 
            message: `Payment verification failed: ${verification.message}`
        };

    } catch (error) {
        console.error('Rocket payment verification error:', error.message);
        await order.update({ payment_status: 'failed' });
        throw new AppError(`Failed to verify Rocket payment: ${error.message}`, 500);
    }
}

/**
 * Verify Rocket webhook notification
 * Called for asynchronous payment status updates from Rocket
 */
async function verifyRocketWebhook(webhookData) {
    const { transaction_id, order_id, status, amount, signature } = webhookData;

    if (!transaction_id || !order_id || !signature) {
        throw new AppError('Invalid Rocket webhook data', 400);
    }

    // Find order
    const order = await Order.findOne({ where: { order_number: order_id } });

    if (!order) {
        throw new AppError('Order not found for webhook', 404);
    }

    // Get Rocket configuration for signature verification
    const config = await PaymentConfig.findOne({
        where: { shop_id: order.shop_id, gateway: 'rocket', is_enabled: true }
    });

    if (!config || !config.credentials) {
        throw new AppError('Rocket configuration not found', 400);
    }

    try {
        // Verify webhook signature
        const rocketMerchantService = require('./rocket-merchant.service');
        const signatureData = {
            transaction_id,
            order_id,
            status,
            amount
        };

        // Reconstruct signature to verify
        const expectedSignature = crypto
            .createHmac('sha256', config.credentials.api_key)
            .update(Object.keys(signatureData)
                .sort()
                .map(key => `${key}=${signatureData[key]}`)
                .join('&'))
            .digest('hex');

        if (signature !== expectedSignature) {
            console.error('Rocket webhook signature mismatch');
            throw new AppError('Invalid webhook signature', 403);
        }

        // Process based on status
        if (status === 'completed' || status === 'success') {
            if (parseFloat(amount) === parseFloat(order.total)) {
                await order.update({ 
                    payment_status: 'paid', 
                    paid_at: new Date(),
                    payment_method: 'rocket'
                });
                return { 
                    success: true, 
                    order,
                    message: 'Webhook processed: Payment confirmed'
                };
            }
        } else if (status === 'failed' || status === 'cancelled') {
            await order.update({ payment_status: 'failed' });
            return { 
                success: false, 
                order,
                message: `Webhook processed: Payment ${status}`
            };
        }

        return { 
            success: false, 
            order,
            message: `Unknown payment status: ${status}`
        };

    } catch (error) {
        console.error('Rocket webhook processing error:', error.message);
        throw new AppError(`Failed to process Rocket webhook: ${error.message}`, 500);
    }
}
