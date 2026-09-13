'use strict';

/**
 * GET /api/auth/native/sessions, DELETE /api/auth/native/sessions/:id
 *
 * Thin wrappers over session.service.js's existing (previously unwired)
 * getUserSessions/revokeSession — no session logic is duplicated here.
 * Mounted at a clean path (see native.routes.js); does NOT reuse the
 * existing double-mounted `/api/auth/sessions/sessions` path, which is left
 * untouched.
 */

const sessionService = require('../session.service');

const list = async (req, res, next) => {
    try {
        const sessions = await sessionService.getUserSessions(req.user.userId);
        const withCurrent = sessions.map((session) => ({
            ...session,
            isCurrent: Boolean(req.user.sid) && session.id === req.user.sid,
        }));

        res.status(200).json({
            success: true,
            data: {
                sessions: withCurrent,
                maxSessions: sessionService.MAX_CONCURRENT_SESSIONS,
                activeCount: sessions.length,
            },
        });
    } catch (error) {
        next(error);
    }
};

const revoke = async (req, res, next) => {
    try {
        await sessionService.revokeSession(req.user.userId, req.params.id);
        res.status(200).json({ success: true, message: 'Session revoked successfully' });
    } catch (error) {
        next(error);
    }
};

module.exports = { list, revoke };
