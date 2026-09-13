'use strict';

/**
 * ADR M-004 — native (body-token) auth orchestration.
 *
 * Reuses auth.service's existing password/lockout/TOTP logic and
 * session.service's existing createSession/revokeSession/getUserSessions —
 * no parallel identity model, no duplicated credential checking. This file
 * owns only what's genuinely new: 15-minute access tokens with a `sid`
 * claim, rotating body refresh tokens, and reuse detection.
 */

const authService = require('../auth.service');
const sessionService = require('../session.service');
const Session = require('../session.entity');
const totpService = require('../totp.service');
const { User, UserShop } = require('../../entities');
const { AppError } = require('../../../utils/AppError');
const AuditService = require('../../audit/audit.service');
const {
    signNativeAccessToken,
    signNativeRefreshToken,
    verifyNativeRefreshToken,
    hashToken,
} = require('./native-token.util');

/**
 * ADR M-005: any audit call this module makes carries metadata.source:
 * 'MOBILE' when the request carried X-EM-Client; absent (identical to
 * today's shape) otherwise.
 */
const attributionMetadata = (req) => (req?.mobileClient ? { source: 'MOBILE' } : {});

const safeUser = (user) => ({
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    phone: user.phone,
    profile_picture: user.profile_picture,
});

/**
 * Create a brand-new per-device session (first real caller of
 * session.service's createSession, per ADR M-004) and issue its initial
 * access + refresh token pair.
 */
const issueNewSession = async (user, shopId, req, { mfaVerified = false } = {}) => {
    const created = await sessionService.createSession(user, shopId, req);
    const generation = 1;

    const refreshToken = signNativeRefreshToken({
        userId: user.id,
        sid: created.sessionId,
        tokenVersion: user.token_version,
        mfaVerified,
        generation,
    });

    await Session.update(
        {
            refresh_token_hash: hashToken(refreshToken),
            refresh_token_generation: generation,
        },
        { where: { id: created.sessionId } },
    );

    const accessToken = signNativeAccessToken({
        userId: user.id,
        email: user.email,
        shopId,
        tokenVersion: user.token_version,
        mfaVerified,
        sid: created.sessionId,
    });

    return {
        accessToken,
        refreshToken,
        sid: created.sessionId,
        expiresAt: created.expiresAt,
        shopId,
        user: safeUser(user),
    };
};

/**
 * POST /api/auth/native/signin
 * Calls into auth.service's resolveAuthenticatedUser — the exact same
 * lockout/password/2FA-gate/shop-resolution logic authenticateUser uses —
 * without ever touching the single web refresh_token slot that
 * authenticateUser writes afterwards.
 */
const signin = async ({ email, password }, req) => {
    const resolved = await authService.resolveAuthenticatedUser(email, password);
    if (resolved.requires2fa) {
        return { requires2fa: true, tempToken: resolved.tempToken };
    }
    return issueNewSession(resolved.user, resolved.loggedShopId, req, { mfaVerified: false });
};

/**
 * POST /api/auth/native/2fa/verify
 * Mirrors totp.controller.js's `verify` step-2 flow exactly (same
 * totpService calls), diverging only at the point of token issuance.
 */
const verifyTwoFactor = async ({ tempToken, token }, req) => {
    const userId = await totpService.consumeTempToken(tempToken);
    if (!userId) {
        throw new AppError('Invalid or expired session. Please login again.', 401);
    }
    await totpService.verifyTotpToken(userId, String(token));

    const user = await User.findByPk(userId);
    if (!user) throw new AppError('User not found', 404);

    const shopId = user.last_logged_shop_id || null;
    if (!shopId) {
        throw new AppError('No active shop session found. Please login again.', 401);
    }

    return issueNewSession(user, shopId, req, { mfaVerified: true });
};

/**
 * POST /api/auth/native/refresh
 * Body-only (no cookie). Rotates on every use; a presented token whose
 * hash/generation no longer match the session row's current values names a
 * real session (the JWT signature proves the `sid` is genuine) but is not
 * the current token — i.e. reuse of an already-rotated token — and revokes
 * the whole session family.
 */
const refresh = async (refreshTokenBody, req) => {
    if (!refreshTokenBody) {
        throw new AppError('Refresh token is required', 400);
    }

    let decoded;
    try {
        decoded = verifyNativeRefreshToken(refreshTokenBody);
    } catch (_error) {
        throw new AppError('Invalid or expired refresh token', 401);
    }

    const { userId, sid, generation } = decoded;
    const session = sid ? await Session.findByPk(sid) : null;

    if (!session || session.user_id !== userId) {
        throw new AppError('Invalid or expired refresh token', 401);
    }

    if (!session.is_active) {
        throw new AppError('Session has been revoked. Please login again.', 401);
    }

    const presentedHash = hashToken(refreshTokenBody);
    const isCurrentToken = presentedHash === session.refresh_token_hash
        && generation === session.refresh_token_generation;

    if (!isCurrentToken) {
        // Compromise: a signed, non-expired token for a still-active session
        // whose hash/generation don't match the session's current record.
        // The only way to hold a validly-signed token for this sid that is
        // not the current one is for the current one to have already been
        // rotated — this is a replay of an old link in the chain.
        await session.update({
            is_active: false,
            metadata: {
                ...(session.metadata || {}),
                deactivated_reason: 'refresh_token_reuse_detected',
                deactivated_at: new Date().toISOString(),
            },
        });

        await AuditService.logOperation({
            userId,
            shopId: session.shop_id,
            action: 'NATIVE_REFRESH_TOKEN_REUSE_DETECTED',
            resourceType: 'USER',
            resourceId: userId,
            metadata: {
                session_id: sid,
                presented_generation: generation,
                current_generation: session.refresh_token_generation,
                ip_address: req.ip,
                user_agent: req.get('User-Agent'),
                timestamp: new Date().toISOString(),
                ...attributionMetadata(req),
            },
        });

        throw new AppError('Refresh token reuse detected. This session has been revoked.', 401);
    }

    // Re-validate the user + tokenVersion + shop membership on every refresh
    // — a revoked/removed user or a password reset cannot silently keep
    // refreshing (ADR M-004).
    const user = await User.findByPk(userId);
    if (!user) throw new AppError('Invalid or expired refresh token', 401);
    if (user.token_version !== decoded.tokenVersion) {
        throw new AppError('Invalid or expired refresh token', 401);
    }

    const shopId = session.shop_id;
    if (shopId) {
        const membership = await UserShop.findOne({
            where: { user_id: userId, shop_id: shopId, is_active: true },
        });
        if (!membership) {
            throw new AppError('Shop membership is no longer active. Please login again.', 401);
        }
    }

    const newGeneration = generation + 1;
    const newRefreshToken = signNativeRefreshToken({
        userId,
        sid,
        tokenVersion: user.token_version,
        mfaVerified: decoded.mfaVerified === true,
        generation: newGeneration,
    });

    await session.update({
        refresh_token_hash: hashToken(newRefreshToken),
        refresh_token_generation: newGeneration,
        last_activity_at: new Date(),
    });

    const newAccessToken = signNativeAccessToken({
        userId,
        email: user.email,
        shopId,
        tokenVersion: user.token_version,
        mfaVerified: decoded.mfaVerified === true,
        sid,
    });

    await AuditService.logOperation({
        userId,
        shopId,
        action: 'NATIVE_TOKEN_REFRESH',
        resourceType: 'USER',
        resourceId: userId,
        metadata: {
            session_id: sid,
            ip_address: req.ip,
            user_agent: req.get('User-Agent'),
            timestamp: new Date().toISOString(),
            ...attributionMetadata(req),
        },
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
};

/**
 * POST /api/auth/native/logout
 * Blacklists the access token (reusing auth.service's blacklistToken, now
 * additively exported) and revokes the session row — never touches
 * user.refresh_token, the single web slot.
 */
const logout = async (req) => {
    const sid = req.user?.sid;
    if (!sid) {
        throw new AppError('This endpoint requires a native session token.', 400);
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (token) {
        await authService.blacklistToken(token, req.user);
    }

    await sessionService.revokeSession(req.user.userId, sid);
};

/**
 * POST /api/auth/native/switch-shop
 * Verifies active membership, then issues a new access token scoped to the
 * requested shop for the SAME session (sid unchanged). Does not rotate the
 * refresh token.
 */
const switchShop = async (req, shopId) => {
    const sid = req.user?.sid;
    if (!sid) {
        throw new AppError('This endpoint requires a native session token.', 400);
    }

    const membership = await UserShop.findOne({
        where: { user_id: req.user.userId, shop_id: shopId, is_active: true },
    });
    if (!membership) {
        throw new AppError('You do not have active access to that shop.', 403);
    }

    const session = await Session.findByPk(sid);
    if (!session || !session.is_active || session.user_id !== req.user.userId) {
        throw new AppError('Session not found or has been revoked.', 404);
    }

    const user = await User.findByPk(req.user.userId);
    if (!user) throw new AppError('User not found', 404);

    await session.update({ shop_id: shopId, last_activity_at: new Date() });

    const accessToken = signNativeAccessToken({
        userId: user.id,
        email: user.email,
        shopId,
        tokenVersion: user.token_version,
        mfaVerified: req.user.mfaVerified === true,
        sid,
    });

    return { accessToken, shopId };
};

module.exports = {
    signin,
    verifyTwoFactor,
    refresh,
    logout,
    switchShop,
};
