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
const { getRedisClient } = require('../../../utils/redis-client');
const AuditService = require('../../audit/audit.service');
const {
    signNativeAccessToken,
    signNativeRefreshToken,
    verifyNativeRefreshToken,
    hashToken,
} = require('./native-token.util');

// Per-account brute-force boundary for native 2FA. The per-IP limiter in
// native.routes.js cannot stop guesses spread across many client IPs. Each
// guess already costs a password sign-in (the challenge is single-use), so only
// a holder of the password reaches this counter: after TWO_FACTOR_MAX_FAILURES
// failed codes in the sliding window, the account's native 2FA verification is
// refused, even with a correct code. Redis errors propagate (fail closed).
const TWO_FACTOR_FAILURE_PREFIX = 'native_2fa_fail:';
const TWO_FACTOR_MAX_FAILURES = 5;
const TWO_FACTOR_FAILURE_WINDOW_SECONDS = 5 * 60;

const twoFactorFailureStore = () => {
    const redis = getRedisClient();
    if (!redis) throw new AppError('Two-factor verification is temporarily unavailable.', 503);
    return redis;
};

const assertTwoFactorAttemptsRemaining = async (userId) => {
    const failures = Number(await twoFactorFailureStore().get(`${TWO_FACTOR_FAILURE_PREFIX}${userId}`)) || 0;
    if (failures >= TWO_FACTOR_MAX_FAILURES) {
        throw new AppError('Too many 2FA attempts. Please try again later.', 429, 'RATE_LIMIT_EXCEEDED');
    }
};

const recordTwoFactorFailure = async (userId) => {
    const key = `${TWO_FACTOR_FAILURE_PREFIX}${userId}`;
    const results = await twoFactorFailureStore().multi().incr(key).expire(key, TWO_FACTOR_FAILURE_WINDOW_SECONDS).exec();
    const failed = (results || []).find(([error]) => error);
    if (failed) throw failed[0];
};

const clearTwoFactorFailures = async (userId) => {
    await twoFactorFailureStore().del(`${TWO_FACTOR_FAILURE_PREFIX}${userId}`);
};

const hasUnexpiredSession = (session) => {
    const expiresAt = new Date(session?.expires_at).getTime();
    return Boolean(session?.is_active) && Number.isFinite(expiresAt) && expiresAt > Date.now();
};

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
 * Chooses the shop a new native session is bound to from the user's *current*
 * active memberships, with the same precedence as the password path
 * (auth.service resolveAuthenticatedUser): the last-used shop if still active,
 * else an owned shop, else any active shop. Memberships can change during the
 * five-minute 2FA challenge, so `last_logged_shop_id` alone is not proof.
 */
const resolveActiveShopId = async (user) => {
    const memberships = await UserShop.findAll({
        attributes: ['shop_id', 'role'],
        where: { user_id: user.id, is_active: true },
        order: [['createdAt', 'ASC']],
    });
    if (memberships.length === 0) return null;
    if (memberships.some((m) => m.shop_id === user.last_logged_shop_id)) return user.last_logged_shop_id;
    return (memberships.find((m) => m.role === 'owner') || memberships[0]).shop_id;
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
    await assertTwoFactorAttemptsRemaining(userId);
    try {
        await totpService.verifyTotpToken(userId, String(token));
    } catch (error) {
        // Wrong or replayed codes count; infrastructure failures do not.
        if (error instanceof AppError && error.status === 400) await recordTwoFactorFailure(userId);
        throw error;
    }
    await clearTwoFactorFailures(userId);

    const user = await User.findByPk(userId);
    if (!user) throw new AppError('User not found', 404);

    const shopId = await resolveActiveShopId(user);
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

    if (!hasUnexpiredSession(session)) {
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

    // Atomic compare-and-swap: the row is only rotated if it still holds the
    // exact hash/generation we just read. Two near-simultaneous refreshes
    // presenting the same not-yet-rotated token (a client-side retry after an
    // apparent timeout, or a single-flight guard failing across processes)
    // would otherwise both pass the isCurrentToken check above and then race
    // to overwrite each other's row — the loser's own new token would then
    // look like a replay on its NEXT use and wrongly revoke the whole
    // session. Losing the CAS here instead fails closed immediately, with no
    // session mutation and no reuse-detected audit entry, since we cannot
    // tell a benign race apart from a real replay from this state alone.
    const [affectedCount] = await Session.update(
        {
            refresh_token_hash: hashToken(newRefreshToken),
            refresh_token_generation: newGeneration,
            last_activity_at: new Date(),
        },
        {
            where: {
                id: sid,
                refresh_token_hash: session.refresh_token_hash,
                refresh_token_generation: generation,
            },
        },
    );

    if (affectedCount === 0) {
        throw new AppError('Refresh already in progress for this session. Please retry.', 409);
    }

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

    // ADR M-003/Phase 2 contract fix: a cold-start refresh must be able to
    // fully restore session context (shop + user), not just a bare token
    // pair — mirroring exactly what signin/2fa-verify already return. This
    // is a response-shape addition only; every check and mutation above is
    // unchanged.
    return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        shopId,
        user: safeUser(user),
    };
};

/**
 * POST /api/auth/native/logout
 * Blacklists the access token (reusing auth.service's blacklistToken, now
 * additively exported) and revokes the session row — never touches
 * user.refresh_token, the single web slot.
 */
const logoutWithRefreshToken = async (refreshToken, req) => {
    let decoded;
    try {
        decoded = verifyNativeRefreshToken(refreshToken);
    } catch (_error) {
        throw new AppError('Invalid or expired refresh token', 401);
    }

    const { userId, sid, generation } = decoded;
    if (!userId || !sid || !Number.isInteger(generation)) {
        throw new AppError('Invalid or expired refresh token', 401);
    }

    const session = await Session.findByPk(sid);
    const isCurrentToken = session
        && session.is_active
        && session.user_id === userId
        && hashToken(refreshToken) === session.refresh_token_hash
        && generation === session.refresh_token_generation;

    if (!isCurrentToken) {
        throw new AppError('Invalid or expired refresh token', 401);
    }

    if (req.user?.sid && (req.user.sid !== sid || req.user.userId !== userId)) {
        throw new AppError('Invalid native session', 401);
    }

    // Revocation is intentionally allowed for an expired access token (and
    // even an expired session row) once the current signed refresh token proves
    // ownership of this exact session. It is a monotonic, non-privileged action.
    await sessionService.revokeSession(userId, sid);
};

const logout = async (req, refreshToken = req.body?.refresh_token) => {
    const sid = req.user?.sid;

    const authHeader = req.headers?.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (refreshToken) {
        await logoutWithRefreshToken(refreshToken, req);
        if (token && req.user?.sid) {
            await authService.blacklistToken(token, req.user);
        }
        return;
    }

    if (!sid) {
        throw new AppError('This endpoint requires a native session token or refresh_token.', 400);
    }

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
    if (!session || !hasUnexpiredSession(session) || session.user_id !== req.user.userId) {
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
    // Disposable E2E fixture reset only (mobile-e2e-fixtures.js).
    clearTwoFactorFailures,
};
