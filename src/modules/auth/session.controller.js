const sessionService = require('./session.service');
const { AppError } = require('../../utils/AppError');
const { authenticate } = require('../../middleware/auth.middleware');
const auditService = require('../audit/audit.service');

/**
 * Get all active sessions for the current user
 */
const getSessions = async (req, res, next) => {
    try {
        const sessions = await sessionService.getUserSessions(req.user.userId);
        
        // Mark current session
        const currentSessionToken = req.cookies?.session_token || req.headers['x-session-token'];
        const sessionsWithCurrent = sessions.map(session => ({
            ...session,
            isCurrent: session.sessionToken === currentSessionToken
        }));

        res.status(200).json({
            success: true,
            data: {
                sessions: sessionsWithCurrent,
                maxSessions: sessionService.MAX_CONCURRENT_SESSIONS,
                activeCount: sessions.length
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Revoke a specific session
 */
const revokeSession = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        
        await sessionService.revokeSession(req.user.userId, sessionId);

        res.status(200).json({
            success: true,
            message: 'Session revoked successfully'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Revoke all other sessions (keep current one)
 */
const revokeOtherSessions = async (req, res, next) => {
    try {
        const currentSessionId = req.body.currentSessionId;
        const revokedCount = await sessionService.revokeOtherSessions(req.user.userId, currentSessionId);

        // Log bulk session revocation
        await auditService.logOperation({
            userId: req.user.userId,
            shopId: req.user.shopId,
            action: 'BULK_SESSION_REVOKE',
            resourceType: 'USER',
            resourceId: req.user.userId,
            metadata: {
                revoked_count: revokedCount,
                current_session_id: currentSessionId,
                ip_address: req.ip,
                user_agent: req.get('User-Agent'),
                timestamp: new Date().toISOString()
            }
        });

        res.status(200).json({
            success: true,
            message: `Revoked ${revokedCount} other session(s)`,
            data: { revokedCount }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Revoke all sessions for the user (force logout everywhere)
 */
const revokeAllSessions = async (req, res, next) => {
    try {
        const sessions = await sessionService.getUserSessions(req.user.userId);
        
        // Revoke all sessions
        for (const session of sessions) {
            try {
                await sessionService.revokeSession(req.user.userId, session.id);
            } catch (error) {
                // Continue with other sessions even if one fails
                console.error('Failed to revoke session:', session.id, error);
            }
        }

        // Log force logout
        await auditService.logOperation({
            userId: req.user.userId,
            shopId: req.user.shopId,
            action: 'FORCE_LOGOUT',
            resourceType: 'USER',
            resourceId: req.user.userId,
            metadata: {
                total_sessions: sessions.length,
                ip_address: req.ip,
                user_agent: req.get('User-Agent'),
                timestamp: new Date().toISOString()
            }
        });

        res.status(200).json({
            success: true,
            message: 'All sessions revoked successfully',
            data: { revokedCount: sessions.length }
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getSessions,
    revokeSession,
    revokeOtherSessions,
    revokeAllSessions
};
