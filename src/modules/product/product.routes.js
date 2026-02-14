const express = require('express');
const productController = require('./product.controller');
const productValidator = require('./product.validator');
const { validate } = require('../helpers');
const { authenticate } = require('src/middleware/auth.middleware');

const router = express.Router();

// All product routes require authentication
router.use(authenticate);

// RESTful routes
router.get('/', validate(productValidator.getProducts), productController.getProducts);
router.post('/ai-extract', validate(productValidator.aiExtract), productController.extractProducts);
router.post('/search', productController.searchProducts);
router.get('/:id', validate(productValidator.getProductById), productController.getProductById);
router.post('/', validate(productValidator.createProduct), productController.createProductRest);
router.patch('/:id', validate(productValidator.updateProduct), productController.updateProductById);
router.delete('/:id', validate(productValidator.deleteProduct), productController.deleteProductById);

// Legacy routes (for backward compatibility)
router.get('/list', validate(productValidator.getProducts), productController.listProducts);
router.get('/get', validate(productValidator.legacyGet), productController.getProduct);
router.post('/create', validate(productValidator.createProduct), productController.createProduct);
router.post('/update', validate(productValidator.legacyUpdate), productController.updateProduct);
router.post('/delete', validate(productValidator.legacyDelete), productController.deleteProduct);

module.exports = router;
