const express = require('express');
const customerController = require('./customer.controller');
const { authenticate } = require('src/middleware/auth.middleware');
const {
    createCustomerValidator,
    updateCustomerValidator,
    getCustomerValidator,
    listCustomersValidator
} = require('./customer.validator');

const router = express.Router();

// All customer routes require authentication
router.use(authenticate);

// GET /customer/list - Get all customers for shop with filters
router.get('/list', listCustomersValidator, customerController.listCustomers);

// GET /customer/get - Get single customer
router.get('/get', getCustomerValidator, customerController.getCustomer);

// POST /customer/create - Create new customer
router.post('/create', createCustomerValidator, customerController.createCustomer);

// POST /customer/update - Update customer
router.post('/update', updateCustomerValidator, customerController.updateCustomer);

module.exports = router;
