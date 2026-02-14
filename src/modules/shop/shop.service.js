const { User, Shop, UserShop } = require('src/modules/entities');
const { AppError } = require('src/utils/AppError');
const { sequelize } = require('src/utils/database/database-setup');

/**
 * Get all shops for a user
 */
const getShopsByUserId = async (userId) => {
    const userShops = await UserShop.findAll({
        where: {
            user_id: userId,
            is_active: true
        },
        include: [{
            model: Shop,
            as: 'shop'
        }]
    });

    return userShops.map(us => ({
        ...us.shop.toJSON(),
        role: us.role
    }));
};

/**
 * Get shop by ID with access verification
 */
const getShopById = async (shopId, userId) => {
    const userShop = await UserShop.findOne({
        where: {
            shop_id: shopId,
            user_id: userId,
            is_active: true
        },
        include: [{
            model: Shop,
            as: 'shop'
        }]
    });

    if (!userShop) {
        throw new AppError('Shop not found or you do not have access', 404);
    }

    return {
        ...userShop.shop.toJSON(),
        role: userShop.role
    };
};

/**
 * Create new shop for user
 */
const createShop = async (userId, shopData) => {
    const transaction = await sequelize.transaction();

    try {
        // Create shop
        const resolvedName = shopData.shop_name || shopData.name || 'My Shop';
        const shop = await Shop.create({
            ...shopData,
            name: resolvedName,
            shop_name: resolvedName
        }, { transaction });

        // Create UserShop relationship with owner role
        await UserShop.create({
            user_id: userId,
            shop_id: shop.id,
            role: 'owner',
            is_active: true
        }, { transaction });

        await transaction.commit();

        return {
            ...shop.toJSON(),
            role: 'owner'
        };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

/**
 * Update shop by ID with permission verification
 */
const updateShopById = async (shopId, userId, updateData) => {
    // Verify user has access to shop
    const userShop = await UserShop.findOne({
        where: {
            shop_id: shopId,
            user_id: userId,
            is_active: true
        }
    });

    if (!userShop) {
        throw new AppError('Shop not found or you do not have access', 404);
    }

    // Find and update shop
    const shop = await Shop.findByPk(shopId);
    if (!shop) {
        throw new AppError('Shop not found', 404);
    }

    // Don't allow updating unique_code
    delete updateData.id;

    if (updateData.shop_name && !updateData.name) {
        updateData.name = updateData.shop_name;
    }

    await shop.update(updateData);

    return {
        ...shop.toJSON(),
        role: userShop.role
    };
};

/**
 * Delete shop by ID (owner only)
 */
const deleteShopById = async (shopId, userId) => {
    // Verify user is owner
    const userShop = await UserShop.findOne({
        where: {
            shop_id: shopId,
            user_id: userId,
            role: 'owner',
            is_active: true
        }
    });

    if (!userShop) {
        throw new AppError('Only shop owners can delete the shop', 403);
    }

    // Delete shop (this will cascade delete UserShop records)
    await Shop.destroy({ where: { id: shopId } });

    return { message: 'Shop deleted successfully' };
};

/**
 * Add user to shop with role
 */
const addUserToShop = async (shopId, requestingUserId, email, role) => {
    // Verify requesting user is owner or admin
    const requestingUserShop = await UserShop.findOne({
        where: {
            shop_id: shopId,
            user_id: requestingUserId,
            is_active: true
        }
    });

    if (!requestingUserShop || (requestingUserShop.role !== 'owner' && requestingUserShop.role !== 'admin')) {
        throw new AppError('Only shop owners or admins can add users', 403);
    }

    // Find user by email
    const user = await User.findOne({ where: { email } });
    if (!user) {
        throw new AppError('User not found with this email', 404);
    }

    // Check if user already has access to this shop
    const existingUserShop = await UserShop.findOne({
        where: {
            shop_id: shopId,
            user_id: user.id
        }
    });

    if (existingUserShop) {
        if (existingUserShop.is_active) {
            throw new AppError('User already has access to this shop', 400);
        } else {
            // Reactivate if previously deactivated
            await existingUserShop.update({ is_active: true, role });
            return existingUserShop;
        }
    }

    // Create UserShop record
    const userShop = await UserShop.create({
        user_id: user.id,
        shop_id: shopId,
        role,
        is_active: true
    });

    return userShop;
};

/**
 * Remove user from shop
 */
const removeUserFromShop = async (shopId, requestingUserId, targetUserId) => {
    // Verify requesting user is owner or admin
    const requestingUserShop = await UserShop.findOne({
        where: {
            shop_id: shopId,
            user_id: requestingUserId,
            is_active: true
        }
    });

    if (!requestingUserShop || (requestingUserShop.role !== 'owner' && requestingUserShop.role !== 'admin')) {
        throw new AppError('Only shop owners or admins can remove users', 403);
    }

    // Cannot remove owner
    const targetUserShop = await UserShop.findOne({
        where: {
            shop_id: shopId,
            user_id: targetUserId
        }
    });

    if (!targetUserShop) {
        throw new AppError('User not found in this shop', 404);
    }

    if (targetUserShop.role === 'owner') {
        throw new AppError('Cannot remove shop owner', 400);
    }

    // Deactivate user access
    await targetUserShop.update({ is_active: false });

    return { message: 'User removed from shop successfully' };
};

/**
 * Update user role in shop
 */
const updateUserRole = async (shopId, requestingUserId, targetUserId, newRole) => {
    // Verify requesting user is owner
    const requestingUserShop = await UserShop.findOne({
        where: {
            shop_id: shopId,
            user_id: requestingUserId,
            role: 'owner',
            is_active: true
        }
    });

    if (!requestingUserShop) {
        throw new AppError('Only shop owners can update user roles', 403);
    }

    // Find target user shop
    const targetUserShop = await UserShop.findOne({
        where: {
            shop_id: shopId,
            user_id: targetUserId,
            is_active: true
        }
    });

    if (!targetUserShop) {
        throw new AppError('User not found in this shop', 404);
    }

    // Cannot change owner role
    if (targetUserShop.role === 'owner' || newRole === 'owner') {
        throw new AppError('Cannot change owner role', 400);
    }

    // Update role
    await targetUserShop.update({ role: newRole });

    return targetUserShop;
};

/**
 * Get user's role in shop
 */
const getUserRoleInShop = async (shopId, userId) => {
    const userShop = await UserShop.findOne({
        where: {
            shop_id: shopId,
            user_id: userId,
            is_active: true
        }
    });

    return userShop ? userShop.role : null;
};

module.exports = {
    getShopsByUserId,
    getShopById,
    createShop,
    updateShopById,
    deleteShopById,
    addUserToShop,
    removeUserFromShop,
    updateUserRole,
    getUserRoleInShop
};
