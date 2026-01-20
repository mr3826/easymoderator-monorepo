const express = require('express');
const productController = require('./product.controller');
const { authenticate } = require('src/middleware/auth.middleware');
const {
    createProductValidator,
    updateProductValidator,
    deleteProductValidator,
    getProductValidator,
    listProductsValidator,
    getProductByIdValidator,
    updateProductByIdValidator,
    deleteProductByIdValidator
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

// RESTful routes (new)
router.get('/', listProductsValidator, productController.getProducts);
router.get('/:id', getProductByIdValidator, productController.getProductById);
router.post('/', createProductValidator, productController.createProductRest);
router.patch('/:id', updateProductByIdValidator, productController.updateProductById);
router.delete('/:id', deleteProductByIdValidator, productController.deleteProductById);

module.exports = router;
