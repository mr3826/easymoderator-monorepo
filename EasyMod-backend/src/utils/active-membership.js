'use strict';

const { Shop, UserShop } = require('../modules/entities');

/**
 * Read the live membership row instead of trusting shopId from a token.
 * No cache is used here because membership removal must take effect on the
 * next request, including when Redis is unavailable.
 */
const findActiveMembership = async (userId, shopId) => {
    if (!userId || !shopId) return null;

    return UserShop.findOne({
        where: {
            user_id: userId,
            shop_id: shopId,
            is_active: true,
        },
        include: [{
            model: Shop,
            as: 'shop',
            // Keep this projection deliberately narrow; callers only need the
            // shop identity and active-state proof for authorization.
            attributes: ['id', 'is_active'],
            where: { is_active: true },
            required: true,
        }],
    });
};

module.exports = { findActiveMembership };
