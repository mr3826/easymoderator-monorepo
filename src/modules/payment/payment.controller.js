const paymentService = require('./payment.service');
const { AppError } = require('../../utils/AppError');

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
    deletePaymentConfig,
    initiatePayment,
    handleAamarPaySuccess,
    handleAamarPayFail,
    handleSSLCommerzSuccess,
    handleSSLCommerzFail,
    handleSSLCommerzIPN
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
            data: savedConfig
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

/**
 * Initiate payment
 */
async function initiatePayment(req, res, next) {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { orderId, gateway } = req.body;

        let result;
        if (gateway === 'aamarpay') {
            result = await paymentService.initiateAamarPayPayment(orderId, shopId, req.user.userId);
        } else if (gateway === 'sslcommerz') {
            result = await paymentService.initiateSSLCommerzPayment(orderId, shopId, req.user.userId);
        } else {
            throw new AppError('Invalid payment gateway', 400);
        }

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Handle AamarPay success callback
 */
async function handleAamarPaySuccess(req, res, next) {
    try {
        const result = await paymentService.verifyAamarPayCallback(req.body);

        if (result.type === 'invoice') {
            const status = result.success ? 'success' : 'failed';
            return res.redirect(`${process.env.FRONTEND_URL}/subscription?payment=${status}`);
        }
        if (result.success) {
            res.redirect(`${process.env.FRONTEND_URL}/orders?payment=success&order=${result.order.order_number}`);
        } else {
            res.redirect(`${process.env.FRONTEND_URL}/orders?payment=failed&order=${result.order.order_number}`);
        }
    } catch (error) {
        res.redirect(`${process.env.FRONTEND_URL}/orders?payment=error`);
    }
}

/**
 * Handle AamarPay fail callback
 */
async function handleAamarPayFail(req, res, next) {
    try {
        const result = await paymentService.verifyAamarPayCallback(req.body);
        if (result.type === 'invoice') {
            return res.redirect(`${process.env.FRONTEND_URL}/subscription?payment=failed`);
        }
        res.redirect(`${process.env.FRONTEND_URL}/orders?payment=failed&order=${result.order.order_number}`);
    } catch (error) {
        res.redirect(`${process.env.FRONTEND_URL}/orders?payment=error`);
    }
}

/**
 * Handle SSLCommerz success callback
 */
async function handleSSLCommerzSuccess(req, res, next) {
    try {
        const result = await paymentService.verifySSLCommerzCallback(req.body, req.body.shop_id);

        if (result.type === 'invoice') {
            const status = result.success ? 'success' : 'failed';
            return res.redirect(`${process.env.FRONTEND_URL}/subscription?payment=${status}`);
        }
        if (result.success) {
            res.redirect(`${process.env.FRONTEND_URL}/orders?payment=success&order=${result.order.order_number}`);
        } else {
            res.redirect(`${process.env.FRONTEND_URL}/orders?payment=failed&order=${result.order.order_number}`);
        }
    } catch (error) {
        res.redirect(`${process.env.FRONTEND_URL}/orders?payment=error`);
    }
}

/**
 * Handle SSLCommerz fail callback
 */
async function handleSSLCommerzFail(req, res, next) {
    try {
        const result = await paymentService.verifySSLCommerzCallback(req.body, req.body.shop_id);
        if (result.type === 'invoice') {
            return res.redirect(`${process.env.FRONTEND_URL}/subscription?payment=failed`);
        }
        res.redirect(`${process.env.FRONTEND_URL}/orders?payment=failed&order=${result.order.order_number}`);
    } catch (error) {
        res.redirect(`${process.env.FRONTEND_URL}/orders?payment=error`);
    }
}

/**
 * Handle SSLCommerz IPN (Instant Payment Notification)
 */
async function handleSSLCommerzIPN(req, res, next) {
    try {
        const result = await paymentService.verifySSLCommerzCallback(req.body, req.body.shop_id);
        
        res.status(200).json({
            success: result.success,
            message: result.success ? 'Payment verified' : 'Payment failed'
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
}
