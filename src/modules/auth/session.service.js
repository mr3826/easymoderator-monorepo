const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { sequelize } = require('../../utils/database/database-setup');
const Session = require('./session.entity');
const { AppError } = require('../../utils/AppError');
const { getRedisClient } = require('../../utils/redis-client');

const SESSION_PREFIX = 'session:';
const MAX_CONCURRENT_SESSIONS = 3; // Configurable limit for concurrent sessions

/**
 * Generate device fingerprint from request headers
 */
const generateDeviceFingerprint = (req) => {
    const userAgent = req.get('User-Agent') || '';
    const acceptLanguage = req.get('Accept-Language') || '';
    const acceptEncoding = req.get('Accept-Encoding') || '';
    
    const fingerprint = crypto.createHash('sha256')
        .update(`${userAgent}|${acceptLanguage}|${acceptEncoding}`)
        .digest('hex');
    
    return fingerprint.substring(0, 64); // Truncate for storage
};

/**
 * Get approximate location from IP address (basic implementation)
 */
const getLocationFromIP = (ip) => {
    // This is a placeholder - in production, you'd use a proper IP geolocation service
    // For Bangladesh compliance, ensure this service handles local data properly
    return {
        country: 'BD',
        city: 'Dhaka', // Default
        source: 'ip_lookup'
    };
};

/**
 * Create a new session for user
 */
const createSession = async (user, shopId, req) => {
    const transaction = await sequelize.transaction();
    
    try {
        // Check existing active sessions count
        const activeSessionsCount = await Session.count({
            where: {
                user_id: user.id,
                is_active: true,
                expires_at: { [sequelize.Op.gt]: new Date() }
            },
            transaction
        });

        // If user has reached max sessions, deactivate oldest one
        if (activeSessionsCount >= MAX_CONCURRENT_SESSIONS) {
            const oldestSession = await Session.findOne({
                where: {
                    user_id: user.id,
                    is_active: true,
                    expires_at: { [sequelize.Op.gt]: new Date() }
                },
                order: [['last_activity_at', 'ASC']],
                transaction
            });

            if (oldestSession) {
                await oldestSession.update({
                    is_active: false,
                    metadata: {
                        ...oldestSession.metadata,
                        deactivated_reason: 'max_sessions_reached',
                        deactivated_at: new Date().toISOString()
                    }
                }, { transaction });

                // Also remove from Redis cache
                const redis = getRedisClient();
                if (redis) {
                    await redis.del(`${SESSION_PREFIX}${oldestSession.session_token}`);
                }
            }
        }

        // Create new session
        const sessionToken = uuidv4();
        const deviceFingerprint = generateDeviceFingerprint(req);
        const location = getLocationFromIP(req.ip);
        
        const session = await Session.create({
            user_id: user.id,
            shop_id: shopId,
            session_token: sessionToken,
            device_fingerprint: deviceFingerprint,
            user_agent: req.get('User-Agent'),
            ip_address: req.ip,
            location,
            is_active: true,
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
            last_activity_at: new Date(),
            metadata: {
                device_type: detectDeviceType(req.get('User-Agent')),
                os: detectOS(req.get('User-Agent')),
                browser: detectBrowser(req.get('User-Agent'))
            }
        }, { transaction });

        // Cache session in Redis for quick lookup
        const redis = getRedisClient();
        if (redis) {
            await redis.setex(
                `${SESSION_PREFIX}${sessionToken}`,
                30 * 24 * 60 * 60, // 30 days TTL
                JSON.stringify({
                    userId: user.id,
                    shopId,
                    sessionId: session.id,
                    deviceFingerprint
                })
            );
        }

        await transaction.commit();

        // Log session creation for audit
        const auditService = require('../audit/audit.service');
        await auditService.logOperation({
            userId: user.id,
            shopId,
            action: 'SESSION_CREATED',
            resourceType: 'USER',
            resourceId: user.id,
            metadata: {
                session_id: session.id,
                ip_address: req.ip,
                user_agent: req.get('User-Agent'),
                device_fingerprint: deviceFingerprint,
                location,
                timestamp: new Date().toISOString()
            }
        });

        return {
            sessionId: session.id,
            sessionToken,
            expiresAt: session.expires_at
        };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

/**
 * Validate session from token
 */
const validateSession = async (sessionToken) => {
    // First check Redis cache
    const redis = getRedisClient();
    if (redis) {
        try {
            const cached = await redis.get(`${SESSION_PREFIX}${sessionToken}`);
            if (cached) {
                const sessionData = JSON.parse(cached);
                return sessionData;
            }
        } catch (error) {
            // Redis error, continue with database lookup
        }
    }

    // Fallback to database
    const session = await Session.findOne({
        where: {
            session_token: sessionToken,
            is_active: true,
            expires_at: { [sequelize.Op.gt]: new Date() }
        },
        include: [{
            model: require('../entities').User,
            as: 'user',
            attributes: ['id', 'email', 'full_name', 'phone', 'profile_picture']
        }]
    });

    if (!session) {
        throw new AppError('Invalid or expired session', 401);
    }

    // Update last activity
    await session.update({ last_activity_at: new Date() });

    // Update cache
    if (redis) {
        await redis.setex(
            `${SESSION_PREFIX}${sessionToken}`,
            Math.ceil((session.expires_at - new Date()) / 1000), // Remaining seconds
            JSON.stringify({
                userId: session.user_id,
                shopId: session.shop_id,
                sessionId: session.id,
                deviceFingerprint: session.device_fingerprint
            })
        );
    }

    return {
        userId: session.user_id,
        shopId: session.shop_id,
        sessionId: session.id,
        user: session.user
    };
};

/**
 * Get all active sessions for a user
 */
const getUserSessions = async (userId) => {
    const sessions = await Session.findAll({
        where: {
            user_id: userId,
            is_active: true,
            expires_at: { [sequelize.Op.gt]: new Date() }
        },
        order: [['last_activity_at', 'DESC']],
        attributes: [
            'id', 'session_token', 'device_fingerprint', 'user_agent',
            'ip_address', 'location', 'created_at', 'last_activity_at',
            'expires_at', 'metadata', 'is_active'
        ]
    });

    return sessions.map(session => ({
        id: session.id,
        deviceFingerprint: session.device_fingerprint,
        userAgent: session.user_agent,
        ipAddress: session.ip_address,
        location: session.location,
        createdAt: session.created_at,
        lastActivityAt: session.last_activity_at,
        expiresAt: session.expires_at,
        isActive: session.is_active,
        metadata: session.metadata,
        isCurrent: false // Will be set by caller
    }));
};

/**
 * Revoke a specific session
 */
const revokeSession = async (userId, sessionId) => {
    const session = await Session.findOne({
        where: {
            id: sessionId,
            user_id: userId
        }
    });

    if (!session) {
        throw new AppError('Session not found', 404);
    }

    await session.update({
        is_active: false,
        metadata: {
            ...session.metadata,
            deactivated_reason: 'user_revoked',
            deactivated_at: new Date().toISOString()
        }
    });

    // Remove from Redis cache
    const redis = getRedisClient();
    if (redis) {
        await redis.del(`${SESSION_PREFIX}${session.session_token}`);
    }

    // Log session revocation
    const auditService = require('../audit/audit.service');
    await auditService.logOperation({
        userId,
        shopId: session.shop_id,
        action: 'SESSION_REVOKED',
        resourceType: 'USER',
        resourceId: userId,
        metadata: {
            session_id: sessionId,
            revoked_at: new Date().toISOString()
        }
    });
};

/**
 * Revoke all sessions except current one
 */
const revokeOtherSessions = async (userId, currentSessionId) => {
    const sessions = await Session.findAll({
        where: {
            user_id: userId,
            id: { [sequelize.Op.ne]: currentSessionId },
            is_active: true
        }
    });

    for (const session of sessions) {
        await session.update({
            is_active: false,
            metadata: {
                ...session.metadata,
                deactivated_reason: 'login_elsewhere',
                deactivated_at: new Date().toISOString()
            }
        });

        // Remove from Redis cache
        const redis = getRedisClient();
        if (redis) {
            await redis.del(`${SESSION_PREFIX}${session.session_token}`);
        }
    }

    return sessions.length;
};

// Helper functions for device detection
const detectDeviceType = (userAgent) => {
    const ua = userAgent.toLowerCase();
    if (/mobile|android|iphone|ipad|phone/i.test(ua)) {
        return 'mobile';
    } else if (/tablet|ipad/i.test(ua)) {
        return 'tablet';
    }
    return 'desktop';
};

const detectOS = (userAgent) => {
    const ua = userAgent.toLowerCase();
    if (/windows/i.test(ua)) return 'Windows';
    if (/mac/i.test(ua)) return 'macOS';
    if (/linux/i.test(ua)) return 'Linux';
    if (/android/i.test(ua)) return 'Android';
    if (/ios|iphone|ipad/i.test(ua)) return 'iOS';
    return 'Unknown';
};

const detectBrowser = (userAgent) => {
    const ua = userAgent.toLowerCase();
    if (/chrome/i.test(ua)) return 'Chrome';
    if (/firefox/i.test(ua)) return 'Firefox';
    if (/safari/i.test(ua)) return 'Safari';
    if (/edge/i.test(ua)) return 'Edge';
    return 'Unknown';
};

module.exports = {
    createSession,
    validateSession,
    getUserSessions,
    revokeSession,
    revokeOtherSessions,
    MAX_CONCURRENT_SESSIONS
};
