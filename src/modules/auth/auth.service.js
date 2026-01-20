const { User, Shop, UserShop } = require('src/modules/entities');
const { hashPassword, comparePassword } = require('src/utils/password.util');
const { generateAccessToken, generateRefreshToken } = require('src/utils/jwt.util');
const { sequelize } = require('src/utils/database/database-setup');
const { AppError } = require('src/utils/AppError');

/**
 * Generate unique 5-6 character shop code
 */
const generateUniqueShopCode = async () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const length = Math.random() > 0.5 ? 5 : 6; // Randomly choose 5 or 6 characters

    let code;
    let isUnique = false;

    while (!isUnique) {
        code = '';
        for (let i = 0; i < length; i++) {
            code += characters.charAt(Math.floor(Math.random() * characters.length));
        }

        // Check if code already exists
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
        const { email, password, full_name, phone } = userData;

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

        // Generate unique shop code
        const shopCode = await generateUniqueShopCode();

        // Create shop
        const shop = await Shop.create({
            unique_code: shopCode
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

        // Generate tokens with shopId included
        const accessToken = generateAccessToken({
            userId: user.id,
            email: user.email,
            shopId: shop.id
        });
        const refreshToken = generateRefreshToken({ userId: user.id });

        // Hash and save refresh token
        const hashedRefreshToken = await hashPassword(refreshToken);
        await user.update({ refresh_token: hashedRefreshToken });

        // Return user data without password
        const userResponse = {
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            phone: user.phone,
            profile_picture: user.profile_picture
        };

        return {
            user: userResponse,
            shop: {
                id: shop.id,
                unique_code: shop.unique_code,
                role: 'owner'
            },
            accessToken,
            refreshToken
        };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

/**
 * Authenticate user
 */
const authenticateUser = async (email, password) => {
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
        throw new AppError('Invalid email or password', 401);
    }

    // Compare password
    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
        throw new AppError('Invalid email or password', 401);
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

    // Generate tokens with shopId included
    const accessToken = generateAccessToken({
        userId: user.id,
        email: user.email,
        shopId: loggedShopId
    });
    const refreshToken = generateRefreshToken({ userId: user.id });

    // Hash and save refresh token
    const hashedRefreshToken = await hashPassword(refreshToken);
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

    return {
        user: userResponse,
        currentShop: {
            id: loggedShop.id,
            unique_code: loggedShop.unique_code,
            shop_name: loggedShop.shop_name,
            role: loggedShop.UserShop.role
        },
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
 * Validate refresh token and generate new access token
 */
const validateRefreshToken = async (refreshToken) => {
    const { verifyRefreshToken } = require('src/utils/jwt.util');

    try {
        // Verify refresh token
        const decoded = verifyRefreshToken(refreshToken);

        // Find user
        const user = await User.findByPk(decoded.userId);
        if (!user || !user.refresh_token) {
            throw new AppError('Invalid refresh token', 401);
        }

        // Compare refresh token with stored hash
        const isTokenValid = await comparePassword(refreshToken, user.refresh_token);
        if (!isTokenValid) {
            throw new AppError('Invalid refresh token', 401);
        }

        // Generate new access token
        const accessToken = generateAccessToken({ userId: user.id, email: user.email });

        return { accessToken };
    } catch (error) {
        throw new AppError('Invalid or expired refresh token', 401);
    }
};

module.exports = {
    createUserWithShop,
    authenticateUser,
    validateRefreshToken,
    generateUniqueShopCode
};
