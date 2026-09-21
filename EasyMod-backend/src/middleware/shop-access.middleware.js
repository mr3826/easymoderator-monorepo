const { AppError } = require('../utils/AppError');
const { findActiveMembership } = require('../utils/active-membership');

/**
 * Shop access middleware
 * Verifies user has access to the shop via UserShop table
 * Attaches shop data and user role to request
 */
const verifyShopAccess = async (req, res, next) => {
    try {
        // JWT ONLY — no body, no header (IDOR protection)
        const shopId = req.user?.shopId;

        if (!shopId) {
            throw new AppError('Shop ID is required', 400);
        }

        // Reuse the membership checked by authenticate when available. Direct
        // callers still get the same live membership and shop-status check.
        const userShop = req.activeMembership?.shop_id === shopId
            ? req.activeMembership
            : await findActiveMembership(req.user.userId, shopId);

        if (!userShop) {
            throw new AppError('You do not have access to this shop', 403);
        }

        // Attach shop and role to request
        req.shop = userShop.shop;
        req.userRole = userShop.role;
        req.activeMembership = userShop;
        if (req.user) req.user.role = userShop.role;

        next();
    } catch (error) {
        next(error);
    }
};

module.exports = { verifyShopAccess };
