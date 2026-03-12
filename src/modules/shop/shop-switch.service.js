const { User } = require('../entities');
const { generateAccessToken } = require('../../utils/jwt.util');
const { AppError } = require('../../utils/AppError');

/**
 * Switch to a different shop
 */
const switchShop = async (userId, shopId) => {
    // Verify user has access to this shop
    const user = await User.findByPk(userId, {
        include: [{
            model: require('../shop/shop.entity'),
            as: 'shops',
            where: { id: shopId },
            through: {
                where: { is_active: true }
            }
        }]
    });

    if (!user || !user.shops || user.shops.length === 0) {
        throw new AppError('You do not have access to this shop', 403);
    }

    // Update last logged shop
    await user.update({ last_logged_shop_id: shopId });

    // Generate new access token with new shopId
    const accessToken = generateAccessToken({
        userId: user.id,
        email: user.email,
        shopId: shopId
    });

    const shop = user.shops[0];

    return {
        accessToken,
        currentShop: {
            id: shop.id,
            unique_code: shop.unique_code,
            shop_name: shop.shop_name,
            role: shop.UserShop.role
        }
    };
};

module.exports = {
    switchShop
};
