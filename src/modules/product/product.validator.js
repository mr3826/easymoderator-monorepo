const { body, query, param } = require('express-validator');

/**
 * Validator for creating a product
 */
const createProductValidator = [
    body('name')
        .trim()
        .notEmpty()
        .withMessage('Product name is required')
        .isLength({ max: 255 })
        .withMessage('Product name must not exceed 255 characters'),

    body('description')
        .optional()
        .trim(),

    body('sku')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('SKU must not exceed 100 characters'),

    body('category_id')
        .optional()
        .isUUID()
        .withMessage('Category ID must be a valid UUID'),

    body('price')
        .notEmpty()
        .withMessage('Price is required')
        .isFloat({ min: 0 })
        .withMessage('Price must be a positive number'),

    body('compare_at_price')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Compare at price must be a positive number'),

    body('cost_per_item')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Cost per item must be a positive number'),

    body('track_quantity')
        .optional()
        .isBoolean()
        .withMessage('Track quantity must be a boolean'),

    body('quantity')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Quantity must be a non-negative integer'),

    body('allow_backorder')
        .optional()
        .isBoolean()
        .withMessage('Allow backorder must be a boolean'),

    body('low_stock_threshold')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Low stock threshold must be a non-negative integer'),

    body('images')
        .optional()
        .isArray()
        .withMessage('Images must be an array'),

    body('images.*')
        .optional()
        .isString()
        .withMessage('Each image must be a string'),

    body('weight')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Weight must be a positive number'),

    body('weight_unit')
        .optional()
        .isIn(['kg', 'g', 'lb', 'oz'])
        .withMessage('Weight unit must be one of: kg, g, lb, oz'),

    body('is_active')
        .optional()
        .isBoolean()
        .withMessage('is_active must be a boolean'),

    body('is_featured')
        .optional()
        .isBoolean()
        .withMessage('is_featured must be a boolean'),

    body('tags')
        .optional()
        .isArray()
        .withMessage('Tags must be an array'),

    body('tags.*')
        .optional()
        .isString()
        .withMessage('Each tag must be a string')
];

/**
 * Validator for updating a product
 */
const updateProductValidator = [
    body('productId')
        .trim()
        .notEmpty()
        .withMessage('Product ID is required')
        .isUUID()
        .withMessage('Product ID must be a valid UUID'),

    body('name')
        .optional()
        .trim()
        .notEmpty()
        .withMessage('Product name cannot be empty')
        .isLength({ max: 255 })
        .withMessage('Product name must not exceed 255 characters'),

    body('description')
        .optional()
        .trim(),

    body('sku')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('SKU must not exceed 100 characters'),

    body('category_id')
        .optional()
        .isUUID()
        .withMessage('Category ID must be a valid UUID'),

    body('price')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Price must be a positive number'),

    body('compare_at_price')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Compare at price must be a positive number'),

    body('cost_per_item')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Cost per item must be a positive number'),

    body('track_quantity')
        .optional()
        .isBoolean()
        .withMessage('Track quantity must be a boolean'),

    body('quantity')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Quantity must be a non-negative integer'),

    body('allow_backorder')
        .optional()
        .isBoolean()
        .withMessage('Allow backorder must be a boolean'),

    body('low_stock_threshold')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Low stock threshold must be a non-negative integer'),

    body('images')
        .optional()
        .isArray()
        .withMessage('Images must be an array'),

    body('images.*')
        .optional()
        .isString()
        .withMessage('Each image must be a string'),

    body('weight')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Weight must be a positive number'),

    body('weight_unit')
        .optional()
        .isIn(['kg', 'g', 'lb', 'oz'])
        .withMessage('Weight unit must be one of: kg, g, lb, oz'),

    body('is_active')
        .optional()
        .isBoolean()
        .withMessage('is_active must be a boolean'),

    body('is_featured')
        .optional()
        .isBoolean()
        .withMessage('is_featured must be a boolean'),

    body('tags')
        .optional()
        .isArray()
        .withMessage('Tags must be an array'),

    body('tags.*')
        .optional()
        .isString()
        .withMessage('Each tag must be a string')
];

/**
 * Validator for deleting a product
 */
const deleteProductValidator = [
    body('productId')
        .trim()
        .notEmpty()
        .withMessage('Product ID is required')
        .isUUID()
        .withMessage('Product ID must be a valid UUID')
];

/**
 * Validator for getting a single product
 */
const getProductValidator = [
    query('productId')
        .trim()
        .notEmpty()
        .withMessage('Product ID is required')
        .isUUID()
        .withMessage('Product ID must be a valid UUID')
];

/**
 * Validator for listing products with filters
 */
const listProductsValidator = [
    query('search')
        .optional()
        .trim(),

    query('category_id')
        .optional()
        .isUUID()
        .withMessage('Category ID must be a valid UUID'),

    query('status')
        .optional()
        .isIn(['active', 'inactive'])
        .withMessage('Status must be either active or inactive'),

    query('min_price')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Minimum price must be a positive number'),

    query('max_price')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Maximum price must be a positive number')
];

/**
 * RESTful validators
 */
const getProductByIdValidator = [
    param('id')
        .isUUID()
        .withMessage('Product ID must be a valid UUID')
];

const updateProductByIdValidator = [
    param('id')
        .isUUID()
        .withMessage('Product ID must be a valid UUID'),
    // Same as updateProductValidator but without productId in body
    body('name')
        .optional()
        .trim()
        .notEmpty()
        .withMessage('Product name cannot be empty')
        .isLength({ max: 255 })
        .withMessage('Product name must not exceed 255 characters'),

    body('description')
        .optional()
        .trim(),

    body('sku')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('SKU must not exceed 100 characters'),

    body('category_id')
        .optional()
        .isUUID()
        .withMessage('Category ID must be a valid UUID'),

    body('price')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Price must be a positive number'),

    body('compare_at_price')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Compare at price must be a positive number'),

    body('cost_per_item')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Cost per item must be a positive number'),

    body('track_quantity')
        .optional()
        .isBoolean()
        .withMessage('Track quantity must be a boolean'),

    body('quantity')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Quantity must be a non-negative integer'),

    body('min_stock_level')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Minimum stock level must be a non-negative integer'),

    body('images')
        .optional()
        .isArray()
        .withMessage('Images must be an array'),

    body('images.*')
        .optional()
        .isString()
        .withMessage('Each image must be a string'),

    body('weight')
        .optional()
        .isFloat({ min: 0 })
        .withMessage('Weight must be a positive number'),

    body('weight_unit')
        .optional()
        .isIn(['kg', 'g', 'lb', 'oz'])
        .withMessage('Weight unit must be one of: kg, g, lb, oz'),

    body('is_active')
        .optional()
        .isBoolean()
        .withMessage('is_active must be a boolean'),

    body('is_featured')
        .optional()
        .isBoolean()
        .withMessage('is_featured must be a boolean'),

    body('tags')
        .optional()
        .isArray()
        .withMessage('Tags must be an array'),

    body('tags.*')
        .optional()
        .isString()
        .withMessage('Each tag must be a string')
];

const deleteProductByIdValidator = [
    param('id')
        .isUUID()
        .withMessage('Product ID must be a valid UUID')
];

module.exports = {
    createProductValidator,
    updateProductValidator,
    deleteProductValidator,
    getProductValidator,
    listProductsValidator,
    // RESTful validators
    getProductByIdValidator,
    updateProductByIdValidator,
    deleteProductByIdValidator
};
