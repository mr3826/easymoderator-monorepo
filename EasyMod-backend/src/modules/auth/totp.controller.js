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
        res.set('Cache-Control', 'no-store');
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
        res.set('Cache-Control', 'no-store');
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

        const challenge = await totpService.consumeTempTokenDetails(tempToken);
        if (!challenge?.userId || !Number.isInteger(challenge.tokenVersion)) {
            throw new AppError('Invalid or expired session. Please login again.', 401);
        }
        const { userId } = challenge;

        await totpService.verifyTotpToken(userId, String(token));

        // Token valid — issue full JWT
        const user = await User.findByPk(userId, {
            include: [{
                model: Shop,
                as: 'shops',
                through: {
                    attributes: ['role', 'is_active'],
                    where: { is_active: true },
                },
            }],
        });
        if (!user) throw new AppError('User not found', 404);
        if (Number(user.token_version) !== challenge.tokenVersion) {
            throw new AppError('Invalid or expired session. Please login again.', 401);
        }
        const { getTemporaryPasswordAuthData } = require('./auth.service');
        const temporaryPasswordAuthData = getTemporaryPasswordAuthData(user);

        // Resolve shop context from active memberships, never from a stale
        // last_logged_shop_id left by an earlier merchant session.
        const { getActiveGrowthOsRole, isInitialGrowthBootstrapUser } = require('./auth.service');
        const activeGrowthOsRole = await getActiveGrowthOsRole(user.id);
        if (activeGrowthOsRole === undefined) {
            throw new AppError('Unable to verify internal access role. Please retry.', 503, 'AUTH_ROLE_LOOKUP_UNAVAILABLE');
        }
        const isGrowthOsUser = Boolean(activeGrowthOsRole);
        const isInitialBootstrapUser = isInitialGrowthBootstrapUser(user);
        const activeShops = Array.isArray(user.shops) ? user.shops : [];
        let shopId = null;
        if (!isGrowthOsUser && activeShops.length > 0) {
            const lastShop = activeShops.find((shop) => shop.id === user.last_logged_shop_id);
            const ownerShop = activeShops.find((shop) => shop.UserShop?.role === 'owner');
            shopId = lastShop?.id || ownerShop?.id || activeShops[0].id;
        }
        if (user.last_logged_shop_id !== shopId) {
            await user.update({ last_logged_shop_id: shopId });
        }
        // A null shopId is only acceptable for internal Growth OS staff
        // accounts (no active shop membership); everyone else must re-login.
        if (!shopId) {
            if (!isGrowthOsUser && !isInitialBootstrapUser) {
                throw new AppError('No active shop session found. Please login again.', 401);
            }
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
            bootstrapOperator: isInitialBootstrapUser,
            ...(temporaryPasswordAuthData
                ? {
                    passwordChangeRequired: true,
                    temporaryPasswordExpiresAt: temporaryPasswordAuthData.temporaryPasswordExpiresAt,
                }
                : {}),
        });
        const refreshToken = generateRefreshToken({
            userId: user.id,
            tokenVersion: user.token_version,
            mfaVerified: true,
            bootstrapOperator: isInitialBootstrapUser,
            ...(temporaryPasswordAuthData
                ? {
                    passwordChangeRequired: true,
                    temporaryPasswordExpiresAt: temporaryPasswordAuthData.temporaryPasswordExpiresAt,
                }
                : {}),
        });

        // Use SHA-256 for refresh token storage (not bcrypt - too expensive for high-entropy tokens)
        const hashedRefreshToken = require('crypto').createHash('sha256').update(refreshToken).digest('hex');
        await user.update({ refresh_token: hashedRefreshToken });

        // Set httpOnly cookies - never return tokens in response body
        setAuthCookies(res, accessToken, refreshToken, req);

        res.set('Cache-Control', 'no-store');
        res.status(200).json({
            success: true,
            data: { authenticated: true, ...(temporaryPasswordAuthData || {}) }
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
