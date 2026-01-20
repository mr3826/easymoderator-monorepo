const paymentService = require('./payment.service');
const { validationResult } = require('express-validator');
const { AppError } = require('src/utils/AppError');

/**
 * Confirm COD payment
 */
const confirmCodPayment = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

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
            message: 'COD payment confirmed successfully',
            data: order
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    confirmCodPayment
};