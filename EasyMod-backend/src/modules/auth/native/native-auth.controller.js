'use strict';

const nativeAuthService = require('./native-auth.service');

/**
 * POST /api/auth/native/signin
 * Body tokens only — never sets a cookie of any kind.
 */
const signin = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const result = await nativeAuthService.signin({ email, password }, req);

        if (result.requires2fa) {
            return res.status(200).json({
                success: true,
                message: 'Two-factor authentication required',
                data: { requires2fa: true, tempToken: result.tempToken },
            });
        }

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                sid: result.sid,
                shopId: result.shopId,
                user: result.user,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/auth/native/2fa/verify
 */
const verifyTwoFactor = async (req, res, next) => {
    try {
        const { tempToken, token } = req.body;
        const result = await nativeAuthService.verifyTwoFactor({ tempToken, token }, req);

        res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                sid: result.sid,
                shopId: result.shopId,
                user: result.user,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/auth/native/refresh
 * Reads the refresh token from the BODY, never a cookie.
 *
 * Returns shopId + the same safeUser(user) shape signin/2fa-verify return
 * (Phase 2 contract fix), so a cold-start refresh can fully restore session
 * context instead of leaving the client's `user` null. Purely additive to
 * this response body — no existing field removed or changed.
 */
const refresh = async (req, res, next) => {
    try {
        const result = await nativeAuthService.refresh(req.body?.refresh_token, req);

        res.status(200).json({
            success: true,
            message: 'Access token refreshed successfully',
            data: {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                shopId: result.shopId,
                user: result.user,
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/auth/native/logout
 */
const logout = async (req, res, next) => {
    try {
        await nativeAuthService.logout(req);
        res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /api/auth/native/switch-shop
 */
const switchShop = async (req, res, next) => {
    try {
        const result = await nativeAuthService.switchShop(req, req.body.shopId);
        res.status(200).json({
            success: true,
            message: 'Shop switched successfully',
            data: { accessToken: result.accessToken, shopId: result.shopId },
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    signin,
    verifyTwoFactor,
    refresh,
    logout,
    switchShop,
};
