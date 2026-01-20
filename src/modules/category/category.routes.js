const express = require('express');
const categoryController = require('./category.controller');
const { authenticate } = require('src/middleware/auth.middleware');
const {
    createCategoryValidator,
    updateCategoryValidator,
    deleteCategoryValidator,
    getCategoryValidator
} = require('./category.validator');

const router = express.Router();

// All category routes require authentication
router.use(authenticate);

// GET /category/list - Get all categories for shop
router.get('/list', categoryController.listCategories);

// GET /category/get - Get single category with subcategories
router.get('/get', getCategoryValidator, categoryController.getCategory);

// POST /category/create - Create new category
router.post('/create', createCategoryValidator, categoryController.createCategory);

// POST /category/update - Update category
router.post('/update', updateCategoryValidator, categoryController.updateCategory);

// POST /category/delete - Delete category
router.post('/delete', deleteCategoryValidator, categoryController.deleteCategory);

module.exports = router;
