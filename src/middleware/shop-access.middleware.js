const { AppError } = require('src/utils/AppError');
const { UserShop } = require('src/modules/entities');

/**
 * Shop access middleware
 * Verifies user has access to the shop via UserShop table
 * Attaches shop data and user role to request
 */
const verifyShopAccess = async (req, res, next) => {
    try {
        // Get shopId from body or header
        const shopId = req.body?.shopId || req.headers['x-shop-id'];

        if (!shopId) {
            throw new AppError('Shop ID is required', 400);
        }

        // Check if user has access to this shop
        const userShop = await UserShop.findOne({
            where: {
                user_id: req.user.userId,
                shop_id: shopId,
                is_active: true
            },
            include: ['shop']
        });

        if (!userShop) {
            throw new AppError('You do not have access to this shop', 403);
        }

        // Attach shop and role to request
        req.shop = userShop.shop;
        req.userRole = userShop.role;

        next();
    } catch (error) {
        next(error);
    }
};

module.exports = { verifyShopAccess };
