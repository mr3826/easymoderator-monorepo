const crypto = require('crypto');
const config = require('../config/config');
const { AppError } = require('../utils/AppError');

/**
 * IP allowlist middleware for payment gateway callbacks.
 * Block requests from IPs not in PAYMENT_GATEWAY_IP_ALLOWLIST.
 * In production/staging, allowlist is required.
 */
const paymentGatewayIpAllowlist = (req, res, next) => {
    const allowlist = config.paymentGatewayIpAllowlist || [];

    if (['production', 'staging'].includes(config.env) && allowlist.length === 0) {
        return next(new AppError('Payment gateway IP allowlist not configured', 500));
    }

    if (allowlist.length === 0) {
        return next(); // Development: no allowlist = allow all
    }

    // Express derives req.ip using the configured trust-proxy hop count. Never
    // parse X-Forwarded-For here because the client can supply that header.
    const clientIp = req.ip || req.socket?.remoteAddress || '';
    if (!allowlist.includes(clientIp)) {
        return next(new AppError('Payment callback rejected: IP not in allowlist', 403));
    }

    next();
};

/**
 * Require HMAC-SHA256 signature verification for payment callbacks.
 * Expects X-Payment-Hmac-Sha256 header with HMAC-SHA256 of raw body.
 * Required in ALL environments when PAYMENT_CALLBACK_HMAC_SECRET is set.
 */
const paymentCallbackHmacVerify = (req, res, next) => {
    const secret = config.paymentCallbackHmacSecret;
    if (!secret) {
        if (['production', 'staging'].includes(config.env)) {
            return next(new AppError('Payment callback verification is unavailable', 503));
        }
        return next();
    }

    const receivedSignature = req.headers['x-payment-hmac-sha256'];
    if (!receivedSignature) {
        return next(new AppError('Missing payment callback signature', 403));
    }

    const rawBody = req.rawBody || JSON.stringify(req.body);
    const expected = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

    if (
        !/^[a-f0-9]{64}$/i.test(receivedSignature)
        || Buffer.byteLength(receivedSignature) !== Buffer.byteLength(expected)
        || !crypto.timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expected))
    ) {
        return next(new AppError('Invalid payment callback signature', 403));
    }

    next();
};

/**
 * Require POST only for payment callbacks.
 * Payment gateway validation must use POST body, not GET query string.
 */
const paymentCallbackPostOnly = (req, res, next) => {
    if (req.method !== 'POST') {
        return next(new AppError('Payment callbacks must use POST', 405));
    }
    next();
};

module.exports = {
    paymentGatewayIpAllowlist,
    paymentCallbackHmacVerify,
    paymentCallbackPostOnly
};
