const express = require('express');
const categoryController = require('./category.controller');
const categoryValidator = require('./category.validator');
const { validate } = require('../helpers');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

// All category routes require authentication
router.use(authenticate);

// RESTful routes
router.get('/', validate(categoryValidator.getCategories), categoryController.getCategories);
router.get('/:categoryId/subcategory/:subcategoryId', validate(categoryValidator.getSubcategoryById), categoryController.getSubcategoryById);
router.get('/:id', validate(categoryValidator.getCategoryById), categoryController.getCategoryById);
router.post('/', validate(categoryValidator.createCategory), categoryController.createCategoryRest);
router.patch('/:id', validate(categoryValidator.updateCategory), categoryController.updateCategoryById);
router.delete('/:id', validate(categoryValidator.deleteCategory), categoryController.deleteCategoryById);

// Legacy routes (for backward compatibility)
router.get('/list', validate(categoryValidator.getCategories), categoryController.listCategories);
router.get('/get', categoryController.getCategory); // This needs proper validation
router.post('/create', validate(categoryValidator.createCategory), categoryController.createCategory);
router.post('/update', categoryController.updateCategory); // This needs proper validation
router.post('/delete', categoryController.deleteCategory); // This needs proper validation

module.exports = router;
