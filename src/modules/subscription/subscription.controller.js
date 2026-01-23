const subscriptionService = require('./subscription.service');
const { validationResult } = require('express-validator');
const { AppError } = require('src/utils/AppError');

/**
 * Get subscription details
 */
const getSubscription = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const data = await subscriptionService.getSubscription(shopId, req.user.userId);

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update subscription plan
 */
const updatePlan = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const subscription = await subscriptionService.updatePlan(
            shopId,
            req.user.userId,
            req.body
        );

        res.status(200).json({
            success: true,
            message: 'Subscription plan updated successfully',
            data: subscription
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Request conversation pack
 */
const requestConversationPack = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { amount, price } = req.body;

        const result = await subscriptionService.requestConversationPack(
            shopId,
            req.user.userId,
            amount,
            price
        );

        res.status(200).json({
            success: true,
            message: result.message,
            data: result.invoice
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get invoices
 */
const getInvoices = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const invoices = await subscriptionService.getInvoices(shopId, req.user.userId);

        res.status(200).json({
            success: true,
            data: invoices
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get invoice by ID
 */
const getInvoiceById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { invoiceId } = req.params;

        const invoice = await subscriptionService.getInvoiceById(
            invoiceId,
            shopId,
            req.user.userId
        );

        res.status(200).json({
            success: true,
            data: invoice
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getSubscription,
    updatePlan,
    requestConversationPack,
    getInvoices,
    getInvoiceById
};
