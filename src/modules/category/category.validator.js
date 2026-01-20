const { body, query } = require('express-validator');

/**
 * Validator for creating a category
 */
const createCategoryValidator = [
    body('name')
        .trim()
        .notEmpty()
        .withMessage('Category name is required')
        .isLength({ max: 255 })
        .withMessage('Category name must not exceed 255 characters'),

    body('description')
        .optional()
        .trim(),

    body('cover_image')
        .optional()
        .trim(),

    body('image')
        .optional()
        .trim(),

    body('subcategories')
        .optional()
        .isArray()
        .withMessage('Subcategories must be an array'),

    body('subcategories.*.name')
        .if(body('subcategories').exists())
        .trim()
        .notEmpty()
        .withMessage('Subcategory name is required')
        .isLength({ max: 255 })
        .withMessage('Subcategory name must not exceed 255 characters'),

    body('subcategories.*.description')
        .optional()
        .trim(),

    body('subcategories.*.cover_image')
        .optional()
        .trim(),

    body('subcategories.*.image')
        .optional()
        .trim()
];

/**
 * Validator for updating a category
 */
const updateCategoryValidator = [
    body('categoryId')
        .trim()
        .notEmpty()
        .withMessage('Category ID is required')
        .isUUID()
        .withMessage('Category ID must be a valid UUID'),

    body('name')
        .optional()
        .trim()
        .notEmpty()
        .withMessage('Category name cannot be empty')
        .isLength({ max: 255 })
        .withMessage('Category name must not exceed 255 characters'),

    body('description')
        .optional()
        .trim(),

    body('cover_image')
        .optional()
        .trim(),

    body('image')
        .optional()
        .trim(),

    body('is_active')
        .optional()
        .isBoolean()
        .withMessage('is_active must be a boolean'),

    body('subcategories')
        .optional()
        .isArray()
        .withMessage('Subcategories must be an array'),

    body('subcategories.*.id')
        .optional()
        .isUUID()
        .withMessage('Subcategory ID must be a valid UUID'),

    body('subcategories.*.name')
        .if(body('subcategories').exists())
        .trim()
        .notEmpty()
        .withMessage('Subcategory name is required')
        .isLength({ max: 255 })
        .withMessage('Subcategory name must not exceed 255 characters'),

    body('subcategories.*.description')
        .optional()
        .trim(),

    body('subcategories.*.cover_image')
        .optional()
        .trim(),

    body('subcategories.*.image')
        .optional()
        .trim(),

    body('subcategories.*.is_active')
        .optional()
        .isBoolean()
        .withMessage('Subcategory is_active must be a boolean')
];

/**
 * Validator for deleting a category
 */
const deleteCategoryValidator = [
    body('categoryId')
        .trim()
        .notEmpty()
        .withMessage('Category ID is required')
        .isUUID()
        .withMessage('Category ID must be a valid UUID')
];

/**
 * Validator for getting a single category
 */
const getCategoryValidator = [
    query('categoryId')
        .trim()
        .notEmpty()
        .withMessage('Category ID is required')
        .isUUID()
        .withMessage('Category ID must be a valid UUID')
];

module.exports = {
    createCategoryValidator,
    updateCategoryValidator,
    deleteCategoryValidator,
    getCategoryValidator
};
