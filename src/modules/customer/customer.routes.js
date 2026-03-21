const express = require('express');
const customerController = require('./customer.controller');
const customerValidator = require('./customer.validator');
const { validate } = require('../helpers');
const { authenticate } = require('../../middleware/auth.middleware');
const { idempotencyMiddleware, storeIdempotencyResult } = require('../audit/idempotency.middleware');
const { auditLogMiddleware } = require('../audit/audit.middleware');

const router = express.Router();

// All customer routes require authentication
router.use(authenticate);

// ─── Legacy routes must come BEFORE /:id ──────────────────────────────────────
// Express matches routes in registration order. /list and /get are literal paths
// and would be swallowed by /:id if registered after it.

const deprecationWarning = (_req, res, next) => {
    res.set('Deprecation', 'true');
    res.set('Sunset', 'Sat, 01 Nov 2026 00:00:00 GMT');
    res.set('Link', '</api/customer>; rel="successor-version"');
    next();
};

router.get(
    '/list',
    deprecationWarning,
    validate({ query: customerValidator.listCustomers }),
    customerController.listCustomers
);

router.get(
    '/get',
    deprecationWarning,
    validate({ query: customerValidator.getCustomer }),
    customerController.getCustomer
);

router.post(
    '/create',
    deprecationWarning,
    idempotencyMiddleware,
    validate({ body: customerValidator.createCustomer }),
    customerController.createCustomer,
    storeIdempotencyResult(201),
    auditLogMiddleware('CREATE', 'CUSTOMER')
);

router.post(
    '/update',
    deprecationWarning,
    idempotencyMiddleware,
    validate({ body: customerValidator.updateCustomer }),
    customerController.updateCustomer,
    storeIdempotencyResult(200),
    auditLogMiddleware('UPDATE', 'CUSTOMER')
);

// ─── V2 External API (channel integrations / webhooks) ────────────────────────
// Also before /:id because /external/:customerId would otherwise match /:id='external'

router.get(
    '/external/:customerId',
    validate({ params: customerValidator.getCustomerExternal }),
    customerController.getCustomerExternal
);

router.post(
    '/external',
    idempotencyMiddleware,
    validate({ body: customerValidator.createCustomerExternal }),
    customerController.createCustomerExternal,
    storeIdempotencyResult(201)
);

router.patch(
    '/external/:customerId',
    idempotencyMiddleware,
    validate({ body: customerValidator.updateCustomerExternal }),
    customerController.updateCustomerExternal,
    storeIdempotencyResult(200)
);

// ─── RESTful routes ────────────────────────────────────────────────────────────

router.get(
    '/',
    validate({ query: customerValidator.listCustomers }),
    customerController.getCustomers
);

router.get(
    '/:id',
    validate({ params: customerValidator.getCustomerById }),
    customerController.getCustomerById
);

router.post(
    '/',
    idempotencyMiddleware,
    validate({ body: customerValidator.createCustomer }),
    customerController.createCustomerRest,
    storeIdempotencyResult(201),
    auditLogMiddleware('CREATE', 'CUSTOMER')
);

router.patch(
    '/:id',
    idempotencyMiddleware,
    validate({ body: customerValidator.updateCustomerById }),
    customerController.updateCustomerById,
    storeIdempotencyResult(200),
    auditLogMiddleware('UPDATE', 'CUSTOMER')
);

router.delete(
    '/:id',
    idempotencyMiddleware,
    validate({ params: customerValidator.deleteCustomerById }),
    customerController.deleteCustomerById,
    storeIdempotencyResult(200),
    auditLogMiddleware('DELETE', 'CUSTOMER')
);

module.exports = router;
