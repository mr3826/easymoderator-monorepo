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

