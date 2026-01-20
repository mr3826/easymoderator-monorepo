const categoryService = require('./category.service');
const { validationResult } = require('express-validator');
const { AppError } = require('src/utils/AppError');

/**
 * Create a new category
 */
const createCategory = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const category = await categoryService.createCategory(
            req.user.userId,
            shopId,
            req.body
        );

        res.status(201).json({
            success: true,
            message: 'Category created successfully',
            data: category
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update a category
 */
const updateCategory = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { categoryId, ...updateData } = req.body;
        const category = await categoryService.updateCategory(
            categoryId,
            req.user.userId,
            shopId,
            updateData
        );

        res.status(200).json({
            success: true,
            message: 'Category updated successfully',
            data: category
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Delete a category
 */
const deleteCategory = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { categoryId } = req.body;
        const result = await categoryService.deleteCategory(
            categoryId,
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
 * Get a single category
 */
const getCategory = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const { categoryId } = req.query;
        const category = await categoryService.getCategoryById(
            categoryId,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            success: true,
            data: category
        });
    } catch (error) {
        next(error);
    }
};

/**
 * List all categories for the shop
 */
const listCategories = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        // Get search query from request
        const { search } = req.query;

        const categories = await categoryService.listCategories(
            req.user.userId,
            shopId,
            search
        );

        res.status(200).json({
            success: true,
            data: categories
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createCategory,
    updateCategory,
    deleteCategory,
    getCategory,
    listCategories
};
