const { User, Shop, UserShop, Session, Tenant } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { sequelize } = require('../../utils/database/database-setup');
const { DEFAULT_AI_SETTINGS } = require('./shop-defaults');
const {
    validateAISettings,
    mergeAndSanitizeSettings,
    stripAutomationModeFromShopUpdate,
} = require('./shop-settings.validator');
const { invalidateShopSettingsCaches } = require('../../utils/shop-settings-cache');
const { normalizeAiReplyMode, isAutoSendMode } = require('./ai-reply-mode');
const cacheService = require('../../utils/cache.service');

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

const recordMembershipAudit = async ({
    actorUserId,
    targetUserId,
    shopId,
    action,
    metadata = {},
    oldValues,
    newValues,
}) => {
    try {
        const auditService = require('../audit/audit.service');
        await auditService.logOperation({
            userId: actorUserId,
            shopId,
            action,
            resourceType: 'USER_SHOP',
            resourceId: `${targetUserId}:${shopId}`,
            metadata: { target_user_id: targetUserId, ...metadata },
            ...(oldValues ? { oldValues } : {}),
            ...(newValues ? { newValues } : {}),
        });
    } catch (_) {
        // Audit failure must not undo an already-authorized membership change.
    }
};

const invalidateUserMembershipAccess = async (userId, shopId, actorUserId) => {
    const user = await User.findByPk(userId);
    if (!user) return;

    const updates = {
        token_version: sequelize.literal('token_version + 1'),
        refresh_token: null,
    };
    if (String(user.last_logged_shop_id || '') === String(shopId)) {
        updates.last_logged_shop_id = null;
    }

    await user.update(updates);
    try {
        if (Session?.update) {
            await Session.update(
                { is_active: false },
                { where: { user_id: userId, shop_id: shopId, is_active: true } },
            );
        }
    } catch (_) {
        // JWT membership checks remain authoritative if session storage is down.
    }
    await cacheService.delete(`user:${userId}:token_version`).catch(() => {});

    try {
        const sseManager = require('../../utils/sse-manager');
        if (typeof sseManager.disconnectUser === 'function') {
            // token_version and refresh_token are user-global, so disconnecting
            // every local stream keeps multi-shop sessions consistent with the
            // forced global logout contract.
            sseManager.disconnectUser(userId);
        }
    } catch (_) {
        // Token and refresh invalidation above remain authoritative.
    }

    await recordMembershipAudit({
        actorUserId,
        targetUserId: userId,
        shopId,
        action: 'SHOP_MEMBERSHIP_REVOKED',
        metadata: { revoked_at: new Date().toISOString() },
    });
};

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

        const { createDefaultSubscription } = require('../subscription/subscription.service');
        await createDefaultSubscription(shop.id, { transaction, emitEvent: false });

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

    const nextUpdate = stripAutomationModeFromShopUpdate({ ...updateData });

    // Don't allow updating unique_code
    delete nextUpdate.id;

    if (nextUpdate.shop_name && !nextUpdate.name) {
        nextUpdate.name = nextUpdate.shop_name;
    }

    const currentSettings = shop.settings || {};
    if (nextUpdate.settings) {
        nextUpdate.settings = mergeAndSanitizeSettings(currentSettings, nextUpdate.settings);
    }

    // Bug #13: keep settings.businessInfo.shopName in sync with the shop name column
    // so Knowledge Base and ManageShop always show the same value.
    const newShopName = nextUpdate.shop_name || nextUpdate.name;
    if (newShopName) {
        nextUpdate.settings = mergeAndSanitizeSettings(
            currentSettings,
            {
                ...(nextUpdate.settings || {}),
                businessInfo: {
                    ...(nextUpdate.settings?.businessInfo || {}),
                    shopName: newShopName
                }
            }
        );
    }

    await shop.update(nextUpdate);
    if (nextUpdate.settings || newShopName) {
        await invalidateShopSettingsCaches(shopId);
    }

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
    if (role === 'owner') {
        throw new AppError('A shop can only have one owner', 400);
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
            await recordMembershipAudit({
                actorUserId: requestingUserId,
                targetUserId: user.id,
                shopId,
                action: 'SHOP_MEMBERSHIP_GRANTED',
                metadata: { role, reactivated: true },
            });
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

    await recordMembershipAudit({
        actorUserId: requestingUserId,
        targetUserId: user.id,
        shopId,
        action: 'SHOP_MEMBERSHIP_GRANTED',
        metadata: { role, reactivated: false },
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
    await invalidateUserMembershipAccess(targetUserId, shopId, requestingUserId);

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
    const previousRole = targetUserShop.role;
    await targetUserShop.update({ role: newRole });

    await recordMembershipAudit({
        actorUserId: requestingUserId,
        targetUserId,
        shopId,
        action: 'SHOP_MEMBERSHIP_ROLE_CHANGED',
        metadata: { changed_at: new Date().toISOString() },
        oldValues: { role: previousRole },
        newValues: { role: newRole },
    });

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

    const merged = {
        ...defaultSettings,
        ...(shop.settings?.ai || {}),
        shop_created_at: shop.created_at
    };
    // All callers receive the same canonical business-level reply mode.
    merged.automation_mode = normalizeAiReplyMode(merged.automation_mode);
    // Keep the legacy flag as a derived compatibility value; it cannot diverge
    // from the canonical mode or become a second runtime switch.
    merged.auto_reply_enabled = isAutoSendMode(merged.automation_mode);
    return merged;
};

/**
 * Update shop AI behaviour settings (writes to settings.ai, preserves other settings keys)
 */
const updateShopAiSettings = async (shopId, userId, updates) => {
    const shop = await Shop.findByPk(shopId);
    if (!shop) throw new AppError('Shop not found', 404);

    // Validate updates before applying
    validateAISettings(updates);

    const normalizedUpdates = { ...updates };
    const modeWasProvided = hasOwn(updates, 'automation_mode');
    const oldMode = normalizeAiReplyMode(shop.settings?.ai?.automation_mode);
    if (modeWasProvided) {
        normalizedUpdates.automation_mode = normalizeAiReplyMode(updates.automation_mode);
        // Reply mode is the source of truth for this legacy derived flag.
        normalizedUpdates.auto_reply_enabled = isAutoSendMode(normalizedUpdates.automation_mode);
    }

    const currentSettings = shop.settings || {};
    const currentAI = currentSettings.ai || {};

    // Deep-merge nested settings blocks so partial updates do not erase
    // sibling values that were not included in the request.
    const newAI = { ...currentAI, ...normalizedUpdates };
    if (normalizedUpdates.required_fields) {
        newAI.required_fields = { ...(currentAI.required_fields || {}), ...normalizedUpdates.required_fields };
    }
    if (normalizedUpdates.handoff_settings) {
        newAI.handoff_settings = { ...(currentAI.handoff_settings || {}), ...normalizedUpdates.handoff_settings };
    }
    if (normalizedUpdates.greeting) {
        newAI.greeting = { ...(currentAI.greeting || {}), ...normalizedUpdates.greeting };
    }
    if (normalizedUpdates.closing) {
        newAI.closing = { ...(currentAI.closing || {}), ...normalizedUpdates.closing };
    }
    // Deep-merge intent_confidence_map to preserve per-intent settings
    if (normalizedUpdates.intent_confidence_map) {
        newAI.intent_confidence_map = { ...(currentAI.intent_confidence_map || {}), ...normalizedUpdates.intent_confidence_map };
    }
    // Keep the legacy boolean derived even when an older client sends it
    // without a mode. The boolean is compatibility data, never authority.
    newAI.automation_mode = normalizeAiReplyMode(newAI.automation_mode);
    newAI.auto_reply_enabled = isAutoSendMode(newAI.automation_mode);

    const sanitizedSettings = mergeAndSanitizeSettings(currentSettings, { ai: newAI });

    await shop.update({ settings: sanitizedSettings });
    await invalidateShopSettingsCaches(shopId);

    if (modeWasProvided) {
        const newMode = normalizeAiReplyMode(newAI.automation_mode);
        newAI.automation_mode = newMode;

        if (oldMode !== newMode) {
            const modeChange = {
                shop_id: shopId,
                old_mode: oldMode,
                new_mode: newMode,
                actor_id: userId || null,
            };

            // Audit failures must not turn a successful settings write into a
            // failed request; AuditService follows the same convention.
            try {
                const AuditService = require('../audit/audit.service');
                await AuditService.logOperation({
                    userId: userId || null,
                    shopId,
                    action: 'AI_REPLY_MODE_CHANGED',
                    resourceType: 'SHOP',
                    resourceId: shopId,
                    oldValues: { automation_mode: oldMode },
                    newValues: { automation_mode: newMode },
                    metadata: modeChange,
                });
            } catch (error) {
                console.error('Failed to record AI reply mode change audit:', error);
            }

            try {
                const sseManager = require('../../utils/sse-manager');
                sseManager.emit(shopId, 'ai_reply_mode_changed', { mode: newMode });
            } catch (error) {
                console.warn('Failed to publish AI reply mode change:', error.message);
            }
        }
    }

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
        settings: mergeAndSanitizeSettings(currentSettings, {
            ai: {
                ...currentAI,
                branding: newBranding
            }
        })
    });
    await invalidateShopSettingsCaches(shopId);

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
