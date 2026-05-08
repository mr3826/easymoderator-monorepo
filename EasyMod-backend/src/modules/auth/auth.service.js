const { User, Shop, UserShop, Tenant, PasswordResetToken } = require('../entities');
const { Op } = require('sequelize');
const { hashPassword, comparePassword } = require('../../utils/password.util');
const { generateAccessToken, generateRefreshToken } = require('../../utils/jwt.util');
const { sequelize } = require('../../utils/database/database-setup');
const { AppError } = require('../../utils/AppError');
const { getRedisClient } = require('../../utils/redis-client');
const config = require('../../config/config');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const emailService = require('../../utils/email.service');
const { passwordResetEmail } = require('../../utils/email-templates/password-reset');

const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// ── Token blacklist (Redis) ────────────────────────────────────────────

const TOKEN_BLACKLIST_PREFIX = 'token_blacklist:';

/**
 * Blacklist a JWT so it can no longer be used.
 * TTL is set to the token's remaining lifetime.
 */
const blacklistToken = async (token, decoded) => {
    const redis = getRedisClient();
    if (!redis) return; // graceful no-op if Redis unavailable in dev

    const now = Math.floor(Date.now() / 1000);
    const ttl = decoded.exp ? Math.max(0, decoded.exp - now) : 0;
    if (ttl > 0) {
        await redis.setex(`${TOKEN_BLACKLIST_PREFIX}${token}`, ttl, '1');
    }
};

/**
 * Check whether a token has been blacklisted.
 */
const isTokenBlacklisted = async (token) => {
    const redis = getRedisClient();
    if (!redis) return false;

    const result = await redis.get(`${TOKEN_BLACKLIST_PREFIX}${token}`);
    return result === '1';
};

// ── Account lockout (Redis) ────────────────────────────────────────────

const LOGIN_ATTEMPTS_PREFIX = 'login_attempts:';
const LOGIN_LOCKOUT_PREFIX = 'login_lockout:';

/**
 * Check if an account is currently locked out.
 */
const checkAccountLockout = async (email) => {
    const redis = getRedisClient();
    if (!redis) return; // no lockout enforcement without Redis

    const locked = await redis.get(`${LOGIN_LOCKOUT_PREFIX}${email}`);
    if (locked) {
        const ttl = await redis.ttl(`${LOGIN_LOCKOUT_PREFIX}${email}`);
        throw new AppError(
            `Account temporarily locked due to too many failed login attempts. Try again in ${Math.ceil(ttl / 60)} minute(s).`,
            429
        );
    }
};

/**
 * Record a failed login attempt. Locks the account after maxLoginAttempts.
 */
const recordFailedLogin = async (email) => {
    const redis = getRedisClient();
    if (!redis) return;

    const key = `${LOGIN_ATTEMPTS_PREFIX}${email}`;
    const attempts = await redis.incr(key);

    // Set expiry on first attempt
    if (attempts === 1) {
        await redis.expire(key, config.loginLockoutMinutes * 60);
    }

    if (attempts >= config.maxLoginAttempts) {
        // Lock the account
        await redis.setex(
            `${LOGIN_LOCKOUT_PREFIX}${email}`,
            config.loginLockoutMinutes * 60,
            '1'
        );
        // Clear the attempt counter
        await redis.del(key);
    }
};

/**
 * Clear failed login attempts on successful login.
 */
const clearFailedLogins = async (email) => {
    const redis = getRedisClient();
    if (!redis) return;

    await redis.del(`${LOGIN_ATTEMPTS_PREFIX}${email}`);
    await redis.del(`${LOGIN_LOCKOUT_PREFIX}${email}`);
};

// ── Existing auth logic ────────────────────────────────────────────────

/**
 * Generate unique 5-6 character shop code — P2-10: crypto.randomBytes (not Math.random)
 */
const generateUniqueShopCode = async () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    let code;
    let isUnique = false;

    while (!isUnique) {
        const length = crypto.randomBytes(1)[0] % 2 === 0 ? 5 : 6;
        const bytes = crypto.randomBytes(length);
        code = '';
        for (let i = 0; i < length; i++) {
            code += characters.charAt(bytes[i] % characters.length);
        }

        const existingShop = await Shop.findOne({ where: { unique_code: code } });
        if (!existingShop) {
            isUnique = true;
        }
    }

    return code;
};

/**
 * Create user with first shop
 */
const createUserWithShop = async (userData) => {
    const transaction = await sequelize.transaction();

    try {
        const { email, password, full_name, phone, shop_name } = userData;

        // Check if user already exists
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser) {
            throw new AppError('User with this email already exists', 400);
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Create user
        const user = await User.create({
            email,
            password: hashedPassword,
            full_name,
            phone
        }, { transaction });

        const tenantName = shop_name || full_name || email.split('@')[0] || 'Default Tenant';

        // Create tenant
        const tenant = await Tenant.create({
            name: tenantName
        }, { transaction });

        // Generate unique shop code
        const shopCode = await generateUniqueShopCode();

        const resolvedShopName = shop_name || full_name || 'My Shop';

        // Create shop
        const shop = await Shop.create({
            unique_code: shopCode,
            tenant_id: tenant.id,
            name: resolvedShopName,
            shop_name: resolvedShopName
        }, { transaction });

        // Create UserShop relationship with owner role
        await UserShop.create({
            user_id: user.id,
            shop_id: shop.id,
            role: 'owner',
            is_active: true
        }, { transaction });

        await transaction.commit();

        // Set the first shop as last logged shop
        await user.update({ last_logged_shop_id: shop.id });

        // Generate tokens with shopId and token_version included
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            shopId: shop.id,
            tokenVersion: user.token_version
        });
        const refreshToken = generateRefreshToken({ userId: user.id });

        // Hash and save refresh token using SHA-256 (not bcrypt - too expensive for high-entropy tokens)
        const hashedRefreshToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
        await user.update({ refresh_token: hashedRefreshToken });

        // Return user data without password
        const userResponse = {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            phone: user.phone,
            profile_picture: user.profile_picture
        };

        const currentShop = {
            id: shop.id,
            unique_code: shop.unique_code,
            shop_name: shop.shop_name,
            role: 'owner'
        };

        return {
            user: userResponse,
            currentShop,
            allShops: [currentShop],
            accessToken,
            refreshToken
        };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

/**
 * Authenticate user (with lockout check)
 */
const authenticateUser = async (email, password) => {
    // Check if account is locked
    await checkAccountLockout(email);

    // Find user
    const user = await User.findOne({
        where: { email },
        include: [{
            model: Shop,
            as: 'shops',
            through: {
                attributes: ['role', 'is_active'],
                where: { is_active: true }
            }
        }]
    });

    if (!user) {
        await recordFailedLogin(email);
        throw new AppError('Invalid email or password', 401);
    }

    // Compare password
    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
        await recordFailedLogin(email);
        throw new AppError('Invalid email or password', 401);
    }

    // Successful login — clear any failed attempt counters
    await clearFailedLogins(email);

    // 2FA check — if enabled, return a short-lived temp token instead of full JWT
    if (user.settings?.totp_enabled) {
        const { saveTempToken } = require('./totp.service');
        const tempToken = crypto.randomBytes(32).toString('hex');
        await saveTempToken(user.id, tempToken);
        return { requires2fa: true, tempToken };
    }

    // Check if user has any shops
    if (!user.shops || user.shops.length === 0) {
        throw new AppError('User has no associated shops', 403);
    }

    // Determine which shop to log into
    let loggedShopId;

    // If user has last_logged_shop_id and it's still accessible, use it
    if (user.last_logged_shop_id) {
        const hasAccessToLastShop = user.shops.some(shop => shop.id === user.last_logged_shop_id);
        if (hasAccessToLastShop) {
            loggedShopId = user.last_logged_shop_id;
        }
    }

    // Otherwise, use the first shop (or first owner shop if available)
    if (!loggedShopId) {
        const ownerShop = user.shops.find(shop => shop.UserShop.role === 'owner');
        loggedShopId = ownerShop ? ownerShop.id : user.shops[0].id;
    }

    // Update last logged shop
    await user.update({ last_logged_shop_id: loggedShopId });

    // Generate tokens with shopId and token_version included
    const accessToken = generateAccessToken({
        userId: user.id,
        email: user.email,
        shopId: loggedShopId,
        tokenVersion: user.token_version
    });
    const refreshToken = generateRefreshToken({ userId: user.id });

    // Hash and save refresh token using SHA-256 (not bcrypt)
    const hashedRefreshToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await user.update({ refresh_token: hashedRefreshToken });

    // Get the logged shop details
    const loggedShop = user.shops.find(shop => shop.id === loggedShopId);

    // Return user data without password
    const userResponse = {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        phone: user.phone,
        profile_picture: user.profile_picture
    };

    const currentShop = {
        id: loggedShop.id,
        unique_code: loggedShop.unique_code,
        shop_name: loggedShop.shop_name,
        role: loggedShop.UserShop.role
    };

    return {
        user: userResponse,
        currentShop,
        allShops: user.shops.map(shop => ({
            id: shop.id,
            unique_code: shop.unique_code,
            shop_name: shop.shop_name,
            role: shop.UserShop.role
        })),
        accessToken,
        refreshToken
    };
};

/**
 * Request a password reset email.
 * Generates a cryptographically random one-time token, stores its SHA-256 hash
 * in the database, and emails the raw token in a reset link.
 */
const requestPasswordReset = async (email) => {
    const user = await User.findOne({ where: { email } });
    if (!user) {
        // Always return the same response to prevent email enumeration
        return { sent: false };
    }

    // Invalidate any existing unused tokens for this user
    await PasswordResetToken.destroy({
        where: { user_id: user.id, used_at: null },
    });

    // Generate one-time token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

    await PasswordResetToken.create({
        user_id: user.id,
        token_hash: tokenHash,
        expires_at: expiresAt,
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;

    const { subject, html, text } = passwordResetEmail(resetUrl);
    await emailService.sendEmail({ to: user.email, subject, html, text });

    return { sent: true };
};

/**
 * Reset password using a one-time token.
 * Looks up by SHA-256 hash, verifies it is unused and not expired,
 * then atomically marks the token used and updates the password.
 */
const resetPassword = async (rawToken, newPassword) => {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const record = await PasswordResetToken.findOne({
        where: {
            token_hash: tokenHash,
            used_at: null,
            expires_at: { [Op.gt]: new Date() },
        },
    });

    if (!record) {
        throw new AppError('Invalid or expired reset token', 400);
    }

    const user = await User.findByPk(record.user_id);
    if (!user) {
        throw new AppError('Invalid or expired reset token', 400);
    }

    const hashedPassword = await hashPassword(newPassword);

    // Atomically mark token used, update password, and increment token_version
    // Incrementing token_version invalidates all existing access tokens
    const t = await sequelize.transaction();
    try {
        await record.update({ used_at: new Date() }, { transaction: t });
        await user.update({
            password: hashedPassword,
            refresh_token: null,
            token_version: sequelize.literal('token_version + 1')
        }, { transaction: t });
        await t.commit();
    } catch (err) {
        await t.rollback();
        throw err;
    }

    return { success: true };
};

/**
 * Validate refresh token and generate new access token
 */
const validateRefreshToken = async (refreshToken) => {
    const { verifyRefreshToken } = require('../../utils/jwt.util');

    try {
        // Verify refresh token
        const decoded = verifyRefreshToken(refreshToken);

        // Find user
        const user = await User.findByPk(decoded.userId);
        if (!user || !user.refresh_token) {
            throw new AppError('Invalid refresh token', 401);
        }

        // Compare refresh token with stored hash using SHA-256 (not bcrypt - too expensive)
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        if (tokenHash !== user.refresh_token) {
            throw new AppError('Invalid refresh token', 401);
        }

        // Require valid shopId - reject if user has no active shop session
        if (!user.last_logged_shop_id) {
            throw new AppError('No active shop session found. Please login again.', 401);
        }

        // Generate new access token with shopId and token_version
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            shopId: user.last_logged_shop_id,
            tokenVersion: user.token_version
        });

        return { accessToken };
    } catch (error) {
        throw new AppError('Invalid or expired refresh token', 401);
    }
};

/**
 * Get auth context for current user
 */
const getAuthContext = async (userId, shopIdFromToken) => {
    const user = await User.findOne({
        where: { id: userId },
        include: [{
            model: Shop,
            as: 'shops',
            through: {
                attributes: ['role', 'is_active'],
                where: { is_active: true }
            }
        }]
    });

    if (!user || !user.shops || user.shops.length === 0) {
        throw new AppError('User has no associated shops', 403);
    }

    let resolvedShopId = shopIdFromToken || user.last_logged_shop_id;
    if (resolvedShopId && !user.shops.some(shop => shop.id === resolvedShopId)) {
        resolvedShopId = null;
    }

    if (!resolvedShopId) {
        const ownerShop = user.shops.find(shop => shop.UserShop.role === 'owner');
        resolvedShopId = ownerShop ? ownerShop.id : user.shops[0].id;
    }

    const currentShop = user.shops.find(shop => shop.id === resolvedShopId) || user.shops[0];

    const userResponse = {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        phone: user.phone,
        profile_picture: user.profile_picture
    };

    return {
        user: userResponse,
        currentShop: {
            id: currentShop.id,
            unique_code: currentShop.unique_code,
            shop_name: currentShop.shop_name,
            role: currentShop.UserShop.role
        },
        allShops: user.shops.map(shop => ({
            id: shop.id,
            unique_code: shop.unique_code,
            shop_name: shop.shop_name,
            role: shop.UserShop.role
        }))
    };
};

/**
 * Logout — blacklist the access token and clear the stored refresh token
 */
const logoutUser = async (accessToken, decoded) => {
    // Blacklist the access token so it cannot be reused
    await blacklistToken(accessToken, decoded);

    // Clear the stored refresh token for this user
    const user = await User.findByPk(decoded.userId);
    if (user) {
        await user.update({ refresh_token: null });
    }
};

module.exports = {
    createUserWithShop,
    authenticateUser,
    requestPasswordReset,
    resetPassword,
    validateRefreshToken,
    getAuthContext,
    logoutUser,
    isTokenBlacklisted,
    generateUniqueShopCode
};
