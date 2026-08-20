const { AppError } = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/jwt.util');
const { isTokenBlacklisted } = require('../modules/auth/auth.service');
const { User } = require('../modules/entities');
const cacheService = require('../utils/cache.service');

/**
 * Authentication middleware
 * Checks Bearer header first, then falls back to httpOnly cookie.
 * Also verifies the token has not been blacklisted (logout revocation).
 */
const authenticate = async (req, res, next) => {
    try {
        // 1. Extract token — prefer Authorization header, fall back to cookie
        let token = null;
        const authHeader = req.headers.authorization;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.cookies?.access_token) {
            token = req.cookies.access_token;
        }

        if (!token) {
            throw new AppError('No token provided. Please authenticate.', 401);
        }

        // 2. Verify JWT signature + expiry. Keep malformed/expired credentials
        // distinct from failures in the revocation stores below.
        let decoded;
        try {
            decoded = verifyAccessToken(token);
        } catch (_error) {
            throw new AppError('Invalid or expired token. Please login again.', 401);
        }

        // 3. Check if the token has been revoked (logout)
        const blacklisted = await isTokenBlacklisted(token);
        if (blacklisted) {
            throw new AppError('Token has been revoked. Please login again.', 401);
        }

        // 4. Verify token_version to invalidate tokens after password reset.
        // Cache the DB value for 60 s per user to avoid a SELECT on every request.
        // The cache is invalidated immediately when token_version is incremented
        // (see auth.service.js resetPassword).
        if (!Number.isInteger(decoded.tokenVersion) || decoded.tokenVersion < 0) {
            throw new AppError('Token is missing required revocation state. Please login again.', 401);
        }
        const tvCacheKey = `user:${decoded.userId}:token_version`;
        let dbTokenVersion = await cacheService.get(tvCacheKey);
        if (dbTokenVersion === null) {
            const user = await User.findByPk(decoded.userId, {
                attributes: ['token_version']
            });
            if (!user) {
                throw new AppError('Token has been invalidated. Please login again.', 401);
            }
            dbTokenVersion = user.token_version;
            await cacheService.set(tvCacheKey, dbTokenVersion, 60);
        }
        if (dbTokenVersion !== decoded.tokenVersion) {
            throw new AppError('Token has been invalidated. Please login again.', 401);
        }

        // 5. Attach user data to request
        req.user = {
            userId: decoded.userId,
            email: decoded.email,
            shopId: decoded.shopId,
            exp: decoded.exp, // needed for logout/blacklist TTL
            // This claim is issued only after the TOTP login step. A signed
            // token without it is intentionally not sufficient for privileged
            // Growth roles.
            mfaVerified: decoded.mfaVerified === true,
        };

        next();
    } catch (error) {
        if (error instanceof AppError) {
            next(error);
        } else {
            next(new AppError('Authentication service is temporarily unavailable. Please retry.', 503, 'AUTH_SERVICE_UNAVAILABLE'));
        }
    }
};

/**
 * Block API access for suspended shops.
 * Caches subscription status for 60 seconds to avoid a DB hit on every request.
 * Fails closed on DB/cache errors so an unavailable authorization store cannot
 * silently restore access to a suspended shop.
 */
const checkSubscriptionStatus = async (req, res, next) => {
    try {
        const shopId = req.user?.shopId;
        if (!shopId) return next();

        const cacheKey = 'subscription:status';
        let status = await cacheService.getForShop(shopId, cacheKey);

        if (status === null) {
            // Lazy-require to avoid circular dependency at module load time
            const { Subscription } = require('../modules/entities');
            const subscription = await Subscription.findOne({
                where: { shop_id: shopId },
                attributes: ['status']
            });
            status = subscription?.status || 'active';
            await cacheService.setForShop(shopId, cacheKey, status, 60);
        }

        if (status === 'suspended') {
            return next(new AppError(
                'Your subscription is suspended due to an unpaid invoice. Please visit Billing to resolve.',
                402
            ));
        }

        next();
    } catch (err) {
        // Authorization state is security-sensitive. Return a temporary failure
        // and let the caller retry instead of treating an unavailable store as
        // proof that the shop is active.
        next(new AppError('Subscription status is temporarily unavailable. Please retry.', 503));
    }
};

module.exports = { authenticate, checkSubscriptionStatus };
