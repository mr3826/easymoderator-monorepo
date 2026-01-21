const express = require('express');
const orderController = require('./order.controller');
const orderValidator = require('./order.validator');
const { validate } = require('../helpers');
const { authenticate } = require('src/middleware/auth.middleware');

const router = express.Router();

// All order routes require authentication
router.use(authenticate);

// RESTful routes
router.get('/', validate(orderValidator.getOrders), orderController.getOrders);
router.get('/:id', validate(orderValidator.getOrderById), orderController.getOrderById);
router.post('/', validate(orderValidator.createOrder), orderController.createOrderRest);
router.patch('/:id', validate(orderValidator.updateOrder), orderController.updateOrderById);
router.delete('/:id', validate(orderValidator.deleteOrder), orderController.deleteOrderById);

// Legacy routes (for backward compatibility)
router.get('/list', validate(orderValidator.getOrders), orderController.listOrders);
router.get('/get', orderController.getOrder); // This needs proper validation
router.post('/create', validate(orderValidator.createOrder), orderController.createOrder);
router.post('/update', orderController.updateOrder); // This needs proper validation
router.post('/delete', orderController.deleteOrder); // This needs proper validation

// Additional routes
router.post('/draft', validate(orderValidator.createOrder), orderController.createDraftOrder);
router.post('/confirm', validate(orderValidator.confirmOrder), orderController.confirmOrder);

module.exports = router;
