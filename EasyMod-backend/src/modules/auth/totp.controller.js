/**
 * TOTP 2FA Controller
 */

const totpService = require('./totp.service');
const { AppError } = require('../../utils/AppError');
const { generateAccessToken, generateRefreshToken } = require('../../utils/jwt.util');
const { hashPassword } = require('../../utils/password.util');
const { setAuthCookies } = require('../../utils/auth-cookies');
const { User, Shop } = require('../entities');

/**
 * POST /auth/2fa/setup
 * Generate a new TOTP secret and QR URL for the authenticated user.
 */
const setup = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const result = await totpService.generateTotpSecret(userId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /auth/2fa/enable
 * Confirm the first TOTP token to activate 2FA.
 * Body: { token }
 */
const enable = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { token } = req.body;
        if (!token) throw new AppError('token is required', 400);
        const result = await totpService.enableTotp(userId, String(token));
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /auth/2fa/verify
 * Login step 2 — verify the TOTP token using the tempToken from step 1.
 * Body: { tempToken, token }
 */
const verify = async (req, res, next) => {
    try {
        const { tempToken, token } = req.body;
        if (!tempToken || !token) throw new AppError('tempToken and token are required', 400);

        const userId = await totpService.consumeTempToken(tempToken);
        if (!userId) throw new AppError('Invalid or expired session. Please login again.', 401);

        await totpService.verifyTotpToken(userId, String(token));

        // Token valid — issue full JWT
        const user = await User.findByPk(userId);
        if (!user) throw new AppError('User not found', 404);

        const shopId = user.last_logged_shop_id || null;
        if (!shopId) {
            throw new AppError('No active shop session found. Please login again.', 401);
        }

        // Include tokenVersion so 2FA-issued sessions honour the same revocation
        // check as the normal login path (auth.middleware.js) — a password reset
        // must kill a 2FA session too.
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            shopId,
            tokenVersion: user.token_version,
            mfaVerified: true,
        });
        const refreshToken = generateRefreshToken({
            userId: user.id,
            tokenVersion: user.token_version,
            mfaVerified: true,
        });

        // Use SHA-256 for refresh token storage (not bcrypt - too expensive for high-entropy tokens)
        const hashedRefreshToken = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
        await user.update({ refresh_token: hashedRefreshToken });

        // Set httpOnly cookies - never return tokens in response body
        setAuthCookies(res, accessToken, refreshToken, req);

        res.status(200).json({
            success: true,
            data: { authenticated: true }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /auth/2fa/disable
 * Disable 2FA after verifying the current token.
 * Body: { token }
 */
const disable = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { token } = req.body;
        if (!token) throw new AppError('token is required', 400);
        const result = await totpService.disableTotp(userId, String(token));
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

module.exports = { setup, enable, verify, disable };
