const express = require('express');
const orderController = require('./order.controller');
const orderValidator = require('./order.validator');
const { validate } = require('../helpers');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

// All order routes require authentication
router.use(authenticate);

// Legacy routes (for backward compatibility)
// Keep static legacy paths before parameterized routes to avoid route shadowing.
router.get('/list', validate(orderValidator.getOrders), orderController.listOrders);
router.get('/get', validate(orderValidator.legacyGet), orderController.getOrder);
router.post('/create', validate(orderValidator.createOrder), orderController.createOrder);
router.post('/update', validate(orderValidator.legacyUpdate), orderController.updateOrder);
router.post('/delete', validate(orderValidator.legacyDelete), orderController.deleteOrder);

// Additional routes
router.post('/draft', validate(orderValidator.createOrder), orderController.createDraftOrder);
router.post('/confirm', validate(orderValidator.confirmOrder), orderController.confirmOrder);

// RESTful routes
router.get('/', validate(orderValidator.getOrders), orderController.getOrders);
router.get('/by-customer/:customerId', orderController.getOrdersByCustomer);
router.get('/:id', validate(orderValidator.getOrderById), orderController.getOrderById);
router.post('/', validate(orderValidator.createOrder), orderController.createOrderRest);
router.patch('/:id', validate(orderValidator.updateOrder), orderController.updateOrderById);
router.patch('/:orderId/cancel', orderController.cancelOrder);
router.post('/:orderId/return-request', orderController.createReturnRequest);
router.delete('/:id', validate(orderValidator.deleteOrder), orderController.deleteOrderById);

module.exports = router;
