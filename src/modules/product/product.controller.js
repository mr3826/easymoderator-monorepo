const productService = require('./product.service');
const { validationResult } = require('express-validator');
const { AppError } = require('src/utils/AppError');

/**
 * Create a new product
 */
const createProduct = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const product = await productService.createProduct(
            req.user.userId,
            shopId,
            req.body
        );

        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            data: product
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update a product
 */
const updateProduct = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { productId, ...updateData } = req.body;
        const product = await productService.updateProduct(
            productId,
            req.user.userId,
            shopId,
            updateData
        );

        res.status(200).json({
            success: true,
            message: 'Product updated successfully',
            data: product
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Delete a product
 */
const deleteProduct = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { productId } = req.body;
        const result = await productService.deleteProduct(
            productId,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get a single product
 */
const getProduct = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { productId } = req.query;
        const product = await productService.getProductById(
            productId,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            success: true,
            data: product
        });
    } catch (error) {
        next(error);
    }
};

/**
 * List all products for the shop with filters
 */
const listProducts = async (req, res, next) => {
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
            category_id: req.query.category_id,
            status: req.query.status,
            min_price: req.query.min_price ? parseFloat(req.query.min_price) : undefined,
            max_price: req.query.max_price ? parseFloat(req.query.max_price) : undefined
        };

        const products = await productService.listProducts(
            req.user.userId,
            shopId,
            filters
        );

        res.status(200).json({
            success: true,
            data: products
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createProduct,
    updateProduct,
    deleteProduct,
    getProduct,
    listProducts
};
