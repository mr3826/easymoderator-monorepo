const express = require('express');
const auditController = require('./audit.controller');
const { authenticate } = require('src/middleware/auth.middleware');

const router = express.Router();

// All audit routes require authentication
router.use(authenticate);

// GET /audit/logs - Get audit logs for shop with filters
router.get('/logs', auditController.getAuditLogs);

// GET /audit/resource/:type/:id - Get audit logs for specific resource
router.get('/resource/:type/:id', auditController.getResourceAuditLogs);

// POST /audit/cleanup - Clean up expired idempotency keys (admin only)
router.post('/cleanup', auditController.cleanupIdempotencyKeys);

module.exports = router;
