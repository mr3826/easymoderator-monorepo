const { AppError } = require('../utils/AppError');
const { verifyAccessToken } = require('../utils/jwt.util');
const { isTokenBlacklisted } = require('../modules/auth/auth.service');
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

        // 2. Verify JWT signature + expiry
        const decoded = verifyAccessToken(token);

        // 3. Check if the token has been revoked (logout)
        const blacklisted = await isTokenBlacklisted(token);
        if (blacklisted) {
            throw new AppError('Token has been revoked. Please login again.', 401);
        }

        // 4. Attach user data to request
        req.user = {
            userId: decoded.userId,
            email: decoded.email,
            shopId: decoded.shopId,
            exp: decoded.exp // needed for logout/blacklist TTL
        };

        next();
    } catch (error) {
        if (error instanceof AppError) {
            next(error);
        } else {
            next(new AppError('Invalid or expired token. Please login again.', 401));
        }
    }
};

/**
 * Block API access for suspended shops.
 * Caches subscription status for 60 seconds to avoid a DB hit on every request.
 * Fails open (next()) on DB/cache errors — never block users due to infrastructure issues.
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
    } catch (_) {
        next(); // fail open — infrastructure errors must not lock out users
    }
};

module.exports = { authenticate, checkSubscriptionStatus };
