const authService = require('./auth.service');
const { AppError } = require('../../utils/AppError');
const { setAuthCookies, clearAuthCookies } = require('../../utils/auth-cookies');

// ── Controllers ────────────────────────────────────────────────────────

/**
 * Signup controller
 */
const signup = async (req, res, next) => {
    try {
        const result = await authService.createUserWithShop(req.body);

        // Set httpOnly cookies
        setAuthCookies(res, result.accessToken, result.refreshToken);

        const { accessToken, refreshToken, ...safeResult } = result;

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: safeResult
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Signin controller
 */
const signin = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const result = await authService.authenticateUser(email, password);

        // Set httpOnly cookies
        setAuthCookies(res, result.accessToken, result.refreshToken);

        const { accessToken, refreshToken, ...safeResult } = result;

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                ...safeResult,
                tokens: {
                    access_token: accessToken,
                    refresh_token: refreshToken
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Refresh token controller
 */
const refresh = async (req, res, next) => {
    try {
        // Accept refresh token from body OR cookie
        const refreshToken = req.body.refresh_token || req.cookies?.refresh_token;
        if (!refreshToken) {
            throw new AppError('Refresh token is required', 400);
        }

        const result = await authService.validateRefreshToken(refreshToken);

        // Update access token cookie
        setAuthCookies(res, result.accessToken, null);

        // Log successful token refresh for security audit
        const auditService = require('../audit/audit.service');
        await auditService.logOperation({
            userId: result.userId,
            shopId: result.shopId,
            action: 'TOKEN_REFRESH',
            resourceType: 'USER',
            resourceId: result.userId,
            metadata: {
                ip_address: req.ip,
                user_agent: req.get('User-Agent'),
                timestamp: new Date().toISOString()
            }
        });

        res.status(200).json({
            success: true,
            message: 'Access token refreshed successfully',
            data: { refreshed: true }
        });
    } catch (error) {
        // Log failed refresh attempts for security monitoring
        const auditService = require('../audit/audit.service');
        try {
            await auditService.logOperation({
                userId: null,
                shopId: null,
                action: 'TOKEN_REFRESH_FAILED',
                resourceType: 'USER',
                resourceId: null,
                metadata: {
                    ip_address: req.ip,
                    user_agent: req.get('User-Agent'),
                    error: error.message,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (auditError) {
            // Don't let audit logging failures break the main flow
            console.error('Failed to log token refresh audit:', auditError);
        }
        
        next(error);
    }
};

/**
 * Get current auth context
 */
const me = async (req, res, next) => {
    try {
        const result = await authService.getAuthContext(req.user.userId, req.user.shopId);

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Logout controller — blacklists the current access token and clears cookies
 */
const logout = async (req, res, next) => {
    try {
        // req.user is set by authenticate middleware
        const token = req.headers.authorization?.substring(7) || req.cookies?.access_token;
        if (token && req.user) {
            await authService.logoutUser(token, req.user);
        }

        clearAuthCookies(res);

        res.status(200).json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Forgot password controller
 */
const forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;
        await authService.requestPasswordReset(email);

        res.status(200).json({
            success: true,
            message: 'If an account exists for this email, a reset link has been sent.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Reset password controller
 */
const resetPassword = async (req, res, next) => {
    try {
        const { token, password } = req.body;
        await authService.resetPassword(token, password);

        res.status(200).json({
            success: true,
            message: 'Password reset successfully.'
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    signup,
    signin,
    refresh,
    me,
    logout,
    forgotPassword,
    resetPassword
};
