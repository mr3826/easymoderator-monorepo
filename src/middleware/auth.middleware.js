const { AppError } = require('src/utils/AppError');
const { verifyAccessToken } = require('src/utils/jwt.util');

/**
 * Authentication middleware
 * Verifies JWT access token and attaches user data to request
 */
const authenticate = (req, res, next) => {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new AppError('No token provided. Please authenticate.', 401);
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify token
        const decoded = verifyAccessToken(token);

        // Attach user data to request
        req.user = {
            userId: decoded.userId,
            email: decoded.email,
            shopId: decoded.shopId // Include shopId from token
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
