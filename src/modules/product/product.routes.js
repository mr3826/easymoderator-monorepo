const express = require('express');
const productController = require('./product.controller');
const { authenticate } = require('src/middleware/auth.middleware');
const {
    createProductValidator,
    updateProductValidator,
    deleteProductValidator,
    getProductValidator,
    listProductsValidator
} = require('./product.validator');

const router = express.Router();

// All product routes require authentication
router.use(authenticate);

// GET /product/list - Get all products for shop with filters
router.get('/list', listProductsValidator, productController.listProducts);

// GET /product/get - Get single product
router.get('/get', getProductValidator, productController.getProduct);

// POST /product/create - Create new product
router.post('/create', createProductValidator, productController.createProduct);

// POST /product/update - Update product
router.post('/update', updateProductValidator, productController.updateProduct);

// POST /product/delete - Delete product
router.post('/delete', deleteProductValidator, productController.deleteProduct);

module.exports = router;
