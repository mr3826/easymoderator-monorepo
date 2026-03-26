const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const apiKeyController = require('./api-key.controller');

const router = express.Router();

// All API key management routes require a logged-in user
router.use(authenticate);

// GET  /api-keys/scopes   — list available scopes
router.get('/scopes', apiKeyController.scopes);

// GET  /api-keys          — list keys for current shop
router.get('/', apiKeyController.list);

// POST /api-keys          — generate a new key
router.post('/', apiKeyController.create);

// DELETE /api-keys/:keyId — revoke a key
router.delete('/:keyId', apiKeyController.revoke);

module.exports = router;
