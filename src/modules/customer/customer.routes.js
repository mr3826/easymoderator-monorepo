const express = require('express');
const customerController = require('./customer.controller');
const customerValidator = require('./customer.validator');
const { validate } = require('../helpers');
const { authenticate } = require('src/middleware/auth.middleware');
const { idempotencyMiddleware, storeIdempotencyResult } = require('../audit/idempotency.middleware');
const { auditLogMiddleware } = require('../audit/audit.middleware');

const router = express.Router();

// All customer routes require authentication
router.use(authenticate);

// RESTful routes
router.get('/', validate(customerValidator.listCustomers), customerController.getCustomers);
router.get('/external/:customerId', customerController.getCustomerExternal);
router.post('/external', customerController.createCustomerExternal);
router.patch('/external/:customerId', customerController.updateCustomerExternal);
router.get('/:id', validate(customerValidator.getCustomerById), customerController.getCustomerById);
router.post('/',
    idempotencyMiddleware,
    validate(customerValidator.createCustomer),
    customerController.createCustomerRest,
    storeIdempotencyResult(201),
    auditLogMiddleware('CREATE', 'CUSTOMER')
);
router.patch('/:id',
    idempotencyMiddleware,
    validate(customerValidator.updateCustomerById),
    customerController.updateCustomerById,
    storeIdempotencyResult(200),
    auditLogMiddleware('UPDATE', 'CUSTOMER')
);
router.delete('/:id',
    idempotencyMiddleware,
    validate(customerValidator.deleteCustomerById),
    customerController.deleteCustomerById,
    storeIdempotencyResult(200),
    auditLogMiddleware('DELETE', 'CUSTOMER')
);

// Legacy routes for backward compatibility
router.get('/list', validate(customerValidator.listCustomers), customerController.listCustomers);
router.get('/get', validate(customerValidator.getCustomer), customerController.getCustomer);
router.post('/create', validate(customerValidator.createCustomer), customerController.createCustomer);
router.post('/update', validate(customerValidator.updateCustomer), customerController.updateCustomer);

module.exports = router;
