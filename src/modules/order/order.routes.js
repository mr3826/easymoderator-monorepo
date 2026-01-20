const express = require('express');
const { body } = require('express-validator');
const orderController = require('./order.controller');
const { authenticate } = require('src/middleware/auth.middleware');
const {
    createOrderValidator,
    updateOrderValidator,
    listOrdersValidator,
    orderIdValidator
} = require('./order.validator');

const router = express.Router();

// All order routes require authentication
router.use(authenticate);

// GET /order/list - List orders with filters
router.get('/list', listOrdersValidator, orderController.listOrders);

// GET /order/get - Get single order details
router.get('/get', orderIdValidator, orderController.getOrder);

// POST /order/create - Create new order
router.post('/create', createOrderValidator, orderController.createOrder);

// POST /order/update - Update order status/note
router.post('/update', updateOrderValidator, orderController.updateOrder);

// POST /order/delete - Delete order
router.post('/delete', orderIdValidator, orderController.deleteOrder);

// New RESTful routes
router.post('/draft', createOrderValidator, orderController.createDraftOrder);
router.post('/confirm', [body('orderId').isUUID().withMessage('Order ID must be a valid UUID')], orderController.confirmOrder);
router.get('/', listOrdersValidator, orderController.getOrders);
router.get('/:id', orderIdValidator, orderController.getOrderById);

module.exports = router;
