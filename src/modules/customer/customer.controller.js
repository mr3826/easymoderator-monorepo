const customerService = require('./customer.service');
const { validationResult } = require('express-validator');
const { AppError } = require('src/utils/AppError');

/**
 * Create a new customer
 */
const createCustomer = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const customer = await customerService.createCustomer(
            req.user.userId,
            shopId,
            req.body
        );

        res.status(201).json({
            success: true,
            message: 'Customer created successfully',
            data: customer
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update a customer
 */
const updateCustomer = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { customerId, ...updateData } = req.body;
        const customer = await customerService.updateCustomer(
            customerId,
            req.user.userId,
            shopId,
            updateData
        );

        res.status(200).json({
            success: true,
            message: 'Customer updated successfully',
            data: customer
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get a single customer
 */
const getCustomer = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { customerId } = req.query;
        const customer = await customerService.getCustomerById(
            customerId,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            success: true,
            data: customer
        });
    } catch (error) {
        next(error);
    }
};

/**
 * List all customers for the shop with filters
 */
const listCustomers = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        // Extract filters from query parameters
        const filters = {
            search: req.query.search,
            email: req.query.email,
            number: req.query.number,
            channel: req.query.channel,
            start_date: req.query.start_date,
            end_date: req.query.end_date
        };

        const customers = await customerService.listCustomers(
            req.user.userId,
            shopId,
            filters
        );

        res.status(200).json({
            success: true,
            data: customers
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createCustomer,
    updateCustomer,
    getCustomer,
    listCustomers
};
