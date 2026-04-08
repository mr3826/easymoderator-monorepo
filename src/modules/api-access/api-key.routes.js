const express = require('express');
const rateLimit = require('express-rate-limit');
const { authenticate } = require('../../middleware/auth.middleware');
const apiKeyController = require('./api-key.controller');

const router = express.Router();

// Rate limiter for mutating operations: 10 create/revoke per 15 min per IP
const apiKeyMutationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many API key operations. Try again later.' },
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
});

// All API key management routes require a logged-in user
router.use(authenticate);

// GET  /api-keys/scopes   — list available scopes
router.get('/scopes', apiKeyController.scopes);

// GET  /api-keys          — list keys for current shop
router.get('/', apiKeyController.list);

// POST /api-keys          — generate a new key (rate limited)
router.post('/', apiKeyMutationLimiter, apiKeyController.create);

// DELETE /api-keys/:keyId — revoke a key (rate limited)
router.delete('/:keyId', apiKeyMutationLimiter, apiKeyController.revoke);

module.exports = router;
