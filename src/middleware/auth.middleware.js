const { AppError } = require('src/utils/AppError');
const { verifyAccessToken } = require('src/utils/jwt.util');
const { isTokenBlacklisted } = require('src/modules/auth/auth.service');

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

module.exports = { authenticate };
