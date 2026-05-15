const { User, Shop, UserShop, Tenant } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { sequelize } = require('../../utils/database/database-setup');
const { DEFAULT_AI_SETTINGS } = require('./shop-defaults');
const { validateAISettings, validateSettings, sanitizeSettings } = require('./shop-settings.validator');

/**
 * Get the single shop for a user.
 * Each account owns at most one shop.
 */
const getMyShop = async (userId) => {
    const userShop = await UserShop.findOne({
        where: { user_id: userId, is_active: true },
        include: [{ model: Shop, as: 'shop' }],
        order: [['created_at', 'ASC']]
    });
    if (!userShop) return null;
    return { ...userShop.shop.toJSON(), role: userShop.role };
};

// Legacy alias kept so existing callers continue to work.
// Returns a single-element array for backward compatibility.
const getShopsByUserId = async (userId) => {
    const shop = await getMyShop(userId);
    return shop ? [shop] : [];
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
    // One shop per user — owners cannot create a second shop
    const existingUserShop = await UserShop.findOne({
        where: { user_id: userId, role: 'owner', is_active: true }
    });
    if (existingUserShop) {
        throw new AppError('Each account can only have one shop. Please manage your existing shop.', 409);
    }

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

    // Always deep-merge settings instead of replacing — preserves unrelated keys.
    const currentSettings = shop.settings || {};
    if (updateData.settings) {
        updateData.settings = { ...currentSettings, ...updateData.settings };
    }

    // Bug #13: keep settings.businessInfo.shopName in sync with the shop name column
    // so Knowledge Base and ManageShop always show the same value.
    const newShopName = updateData.shop_name || updateData.name;
    if (newShopName) {
        const mergedSettings = updateData.settings || currentSettings;
        const currentBusinessInfo = mergedSettings.businessInfo || {};
        updateData.settings = {
            ...mergedSettings,
            businessInfo: {
                ...currentBusinessInfo,
                shopName: newShopName
            }
        };
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

        // Multi-owner safety validation
        const owners = await UserShop.count({ where: { shop_id: shop.id, role: 'owner', is_active: true }, transaction });
        if (owners > 1) throw new AppError('Shop cannot have multiple owners', 400);
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

/**
 * Get shop AI settings
 */
const getShopAiSettings = async (shopId) => {
    const shop = await Shop.findByPk(shopId);
    
    if (!shop) {
        return null;
    }

    // Return AI settings from the settings JSON field, with defaults.
    // Key is `settings.ai` — used by both the chatbot pipeline and this service.
    // shop_created_at is included so callers can enforce the 48h onboarding DRAFT window.
    const defaultSettings = { ...DEFAULT_AI_SETTINGS };

    return {
        ...defaultSettings,
        ...(shop.settings?.ai || {}),
        shop_created_at: shop.created_at
    };
};

/**
 * Update shop AI behaviour settings (writes to settings.ai, preserves other settings keys)
 */
const updateShopAiSettings = async (shopId, userId, updates) => {
    const shop = await Shop.findByPk(shopId);
    if (!shop) throw new AppError('Shop not found', 404);

    // Validate updates before applying
    validateAISettings(updates);

    const currentSettings = shop.settings || {};
    const currentAI = currentSettings.ai || {};

    // Deep-merge required_fields and handoff_settings sub-objects
    const newAI = { ...currentAI, ...updates };
    if (updates.required_fields) {
        newAI.required_fields = { ...(currentAI.required_fields || {}), ...updates.required_fields };
    }
    if (updates.handoff_settings) {
        newAI.handoff_settings = { ...(currentAI.handoff_settings || {}), ...updates.handoff_settings };
    }
    // Deep-merge intent_confidence_map to preserve per-intent settings
    if (updates.intent_confidence_map) {
        newAI.intent_confidence_map = { ...(currentAI.intent_confidence_map || {}), ...updates.intent_confidence_map };
    }

    // Sanitize and validate complete settings
    const sanitizedSettings = sanitizeSettings({ ...currentSettings, ai: newAI });
    validateSettings(sanitizedSettings);

    await shop.update({ settings: sanitizedSettings });
    return newAI;
};

/**
 * ✅ NEW: Get effective confidence threshold for a specific intent
 * Falls back to global confidence_threshold if no intent-specific override exists
 * 
 * @param {string} shopId - Shop ID
 * @param {string} intent - Intent type (e.g., 'product_inquiry', 'complaint')
 * @returns {Promise<number>} - Threshold as 0-100 integer
 */
const getEffectiveThresholdForIntent = async (shopId, intent) => {
    const aiSettings = await getShopAiSettings(shopId);
    if (!aiSettings) return 60; // Default fallback

    // Check if there's a per-intent override
    const intentMap = aiSettings.intent_confidence_map || {};
    if (intentMap[intent] !== undefined) {
        return intentMap[intent];
    }

    // Fall back to global threshold
    return aiSettings.confidence_threshold || 60;
};

/**
 * Return the canonical AI defaults (used by GET /shop/settings/ai-defaults).
 * No DB access needed — these are static defaults.
 */
const getAiDefaults = () => ({ ...DEFAULT_AI_SETTINGS });

/**
 * Apply a named branding preset to a shop's AI settings.
 * Merges preset values into settings.ai.branding.
 *
 * @param {string} shopId
 * @param {string} presetName - 'FRIENDLY' | 'PROFESSIONAL' | 'FUN'
 * @returns {Promise<object>} Updated branding object
 */
const applyBrandingPreset = async (shopId, presetName) => {
    const { BRANDING_PRESETS } = require('./branding-presets');

    const preset = BRANDING_PRESETS[presetName];
    if (!preset) {
        throw new AppError(
            `Unknown branding preset "${presetName}". Valid options: ${Object.keys(BRANDING_PRESETS).join(', ')}`,
            400
        );
    }

    const shop = await Shop.findByPk(shopId);
    if (!shop) throw new AppError('Shop not found', 404);

    const currentSettings = shop.settings || {};
    const currentAI = currentSettings.ai || {};
    const currentBranding = currentAI.branding || {};

    const newBranding = { ...currentBranding, ...preset, preset: presetName };

    await shop.update({
        settings: {
            ...currentSettings,
            ai: {
                ...currentAI,
                branding: newBranding
            }
        }
    });

    return newBranding;
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
    getUserRoleInShop,
    getShopAiSettings,
    updateShopAiSettings,
    getEffectiveThresholdForIntent,
    getAiDefaults,
    applyBrandingPreset
};
