const express = require('express');
const sessionController = require('./session.controller');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

// GET /auth/sessions - Get all active sessions for current user
router.get('/sessions', authenticate, sessionController.getSessions);

// DELETE /auth/sessions/:sessionId - Revoke a specific session
router.delete('/sessions/:sessionId', authenticate, sessionController.revokeSession);

// POST /auth/sessions/revoke-others - Revoke all other sessions
router.post('/sessions/revoke-others', authenticate, sessionController.revokeOtherSessions);

// POST /auth/sessions/revoke-all - Revoke all sessions (force logout everywhere)
router.post('/sessions/revoke-all', authenticate, sessionController.revokeAllSessions);

module.exports = router;
