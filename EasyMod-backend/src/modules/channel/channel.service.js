const { Channel, Conversation } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { UserShop } = require('../entities');
const { Op, fn, col } = require('sequelize');

/**
 * Verify user has access to shop
 */
const verifyShopAccess = async (userId, shopId) => {
    const userShop = await UserShop.findOne({
        where: {
            user_id: userId,
            shop_id: shopId,
            is_active: true
        }
    });

    if (!userShop) {
        throw new AppError('You do not have access to this shop', 403);
    }
    return userShop;
};

const mapChannelTypeFromFrontend = (type) => {
    if (type === 'facebook') return 'messenger';
    return type;
};

const mapChannelTypeToFrontend = (channelType) => {
    if (channelType === 'messenger') return 'facebook';
    return channelType;
};

const buildPageId = (payload) => {
    return payload.page_id
        || payload.pageId
        || payload.asset_id
        || payload.assetId
        || payload.accountId
        || payload.businessManagerId
        || payload.business_manager_id
        || null;
};

const normalizeChannelPayload = (payload) => {
    const resolvedType = payload.channel_type || mapChannelTypeFromFrontend(payload.type);
    const accessToken = payload.access_token || payload.accessToken || payload.systemUserToken;
    const pageId = buildPageId(payload);
    const settings = {
        ...(payload.settings || payload.config || {}),
        display_name: payload.name || payload.display_name || payload.channel_name || null,
        businessManagerId: payload.businessManagerId || payload.business_manager_id || null
    };

    return {
        channel_type: resolvedType,
        page_id: pageId,
        access_token: accessToken,
        verify_token: payload.verify_token,
        webhook_secret: payload.webhook_secret,
        settings
    };
};

const mapChannel = (channel) => {
    const frontendType = mapChannelTypeToFrontend(channel.channel_type);
    const displayName = channel.settings?.display_name || frontendType;
    const connected = Boolean(channel.is_active);

    return {
        id: channel.id,
        shop_id: channel.shop_id,
        name: displayName,
        type: frontendType,
        status: channel.is_active ? 'active' : 'inactive',
        connected,
        page_id: channel.page_id || null,
        config: {
            // Never return the decrypted token to the client.
            // The frontend only needs to know whether a token is stored.
            hasToken: Boolean(channel.access_token),
            businessManagerId: channel.settings?.businessManagerId || null
        },
        token_expires_at: channel.token_expires_at ? channel.token_expires_at.toISOString() : null,
        last_sync: channel.updated_at ? channel.updated_at.toISOString() : null,
        message_count: 0,
        created_at: channel.created_at,
        updated_at: channel.updated_at,
        channel_id: channel.id,
        channel_type: channel.channel_type,
        is_active: channel.is_active,
        webhook_verify_token: channel.verify_token,
        settings: channel.settings || {}
    };
};

/**
 * Fetch the most recent conversation updated_at per channel type for a shop.
 * Returns a map of channelType → ISO string (or null if no conversations).
 */
const getLastMessageTimes = async (shopId) => {
    try {
        // Conversation.channel stores the frontend type ('facebook', 'whatsapp', 'instagram')
        const rows = await Conversation.findAll({
            attributes: ['channel', [fn('MAX', col('updated_at')), 'last_at']],
            where: { shop_id: shopId },
            group: ['channel'],
            raw: true
        });
        return Object.fromEntries(rows.map(r => [r.channel, r.last_at ? new Date(r.last_at).toISOString() : null]));
    } catch (_) {
        return {};
    }
};

/**
 * Get all channels for a shop
 */
const getChannels = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const [channels, lastMessageTimes] = await Promise.all([
        Channel.findAll({ where: { shop_id: shopId }, order: [['created_at', 'ASC']] }),
        getLastMessageTimes(shopId)
    ]);

    return channels.map(channel => {
        const mapped = mapChannel(channel);
        const frontendType = mapChannelTypeToFrontend(channel.channel_type);
        mapped.last_sync = lastMessageTimes[frontendType] || mapped.last_sync;
        return mapped;
    });
};

/**
 * Get channel by ID
 */
const getChannelById = async (channelId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const channel = await Channel.findOne({
        where: { id: channelId, shop_id: shopId }
    });

    if (!channel) {
        throw new AppError('Channel not found', 404);
    }

    return mapChannel(channel);
};

const getChannelByType = async (userId, shopId, channelType) => {
    await verifyShopAccess(userId, shopId);

    const channel = await Channel.findOne({
        where: { shop_id: shopId, channel_type: channelType }
    });

    if (!channel) {
        throw new AppError('Channel not found', 404);
    }

    return mapChannel(channel);
};

/**
 * Verify a Meta System User token is valid by calling the Graph API /me endpoint.
 * Throws AppError with a user-facing message on failure.
 * Skipped in test environment to avoid real network calls.
 */
const verifyMetaToken = async (accessToken, channelType) => {
    if (process.env.NODE_ENV === 'test') return;

    try {
        const url = `https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(accessToken)}&fields=id,name`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const data = await res.json();

        if (!res.ok || data.error) {
            const reason = data.error?.message || `HTTP ${res.status}`;
            throw new AppError(`Meta token validation failed: ${reason}`, 400);
        }
    } catch (err) {
        if (err instanceof AppError) throw err;
        // Network timeout or unreachable — warn but don't block (avoids false rejections)
        console.warn(`Meta token pre-validation skipped (network error): ${err.message}`);
    }
};

/**
 * Create a new channel
 */
const createChannel = async (userId, shopId, channelData) => {
    await verifyShopAccess(userId, shopId);

    const { checkChannelLimit } = require('../subscription/subscription.service');
    await checkChannelLimit(shopId);

    const { channel_type, page_id, access_token, verify_token, webhook_secret, settings } = normalizeChannelPayload(channelData);

    if (!channel_type) {
        throw new AppError('Channel type is required', 400);
    }

    if (!access_token) {
        throw new AppError('System user token is required', 400);
    }

    // Verify the token is valid with Meta before storing
    await verifyMetaToken(access_token, channel_type);

    // Check if channel type already exists for this shop
    const existingChannel = await Channel.findOne({
        where: { shop_id: shopId, channel_type }
    });

    if (existingChannel) {
        throw new AppError(`Channel type ${channel_type} already exists for this shop`, 400);
    }

    const channel = await Channel.create({
        shop_id: shopId,
        channel_type,
        page_id,
        access_token,
        verify_token: verify_token || null,
        webhook_secret: webhook_secret || null,
        token_expires_at: channelData.token_expires_at || null,
        settings: settings || {},
        is_active: true
    });

    return mapChannel(channel);
};

/**
 * Update a channel
 */
const updateChannel = async (channelId, userId, shopId, updateData) => {
    await verifyShopAccess(userId, shopId);

    const channel = await Channel.findOne({
        where: { id: channelId, shop_id: shopId }
    });

    if (!channel) {
        throw new AppError('Channel not found', 404);
    }

    const { page_id, access_token, verify_token, webhook_secret, settings, is_active, systemUserToken, businessManagerId, config, token_expires_at } = updateData;
    const mergedSettings = {
        ...(channel.settings || {}),
        ...(settings || config || {})
    };

    if (businessManagerId !== undefined) {
        mergedSettings.businessManagerId = businessManagerId;
    }

    if (page_id !== undefined) channel.page_id = page_id;
    if (access_token !== undefined) channel.access_token = access_token;
    if (systemUserToken !== undefined) channel.access_token = systemUserToken;
    if (verify_token !== undefined) channel.verify_token = verify_token;
    if (webhook_secret !== undefined) channel.webhook_secret = webhook_secret;
    if (settings !== undefined || config !== undefined || businessManagerId !== undefined) {
        channel.settings = mergedSettings;
    }
    if (is_active !== undefined) channel.is_active = is_active;
    if (token_expires_at !== undefined) channel.token_expires_at = token_expires_at;

    await channel.save();

    return mapChannel(channel);
};

/**
 * Connect or create a channel with credentials
 */
const connectChannel = async (userId, shopId, payload) => {
    await verifyShopAccess(userId, shopId);
    const normalizedPayload = normalizeChannelPayload(payload);

    // Validate token with Meta before upsert
    if (normalizedPayload.access_token) {
        await verifyMetaToken(normalizedPayload.access_token, normalizedPayload.channel_type);
    }

    const existingChannel = await Channel.findOne({
        where: { shop_id: shopId, channel_type: normalizedPayload.channel_type }
    });

    if (existingChannel) {
        if (normalizedPayload.page_id !== undefined) {
            existingChannel.page_id = normalizedPayload.page_id;
        }
        if (normalizedPayload.access_token !== undefined) {
            existingChannel.access_token = normalizedPayload.access_token;
        }
        if (normalizedPayload.verify_token !== undefined) {
            existingChannel.verify_token = normalizedPayload.verify_token;
        }
        if (normalizedPayload.webhook_secret !== undefined) {
            existingChannel.webhook_secret = normalizedPayload.webhook_secret;
        }

        existingChannel.settings = {
            ...(existingChannel.settings || {}),
            ...(normalizedPayload.settings || {})
        };
        existingChannel.is_active = true;
        await existingChannel.save();
        return mapChannel(existingChannel);
    }

    return createChannel(userId, shopId, payload);
};

/**
 * Disconnect a channel
 */
const disconnectChannel = async (channelId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const channel = await Channel.findOne({
        where: { id: channelId, shop_id: shopId }
    });

    if (!channel) {
        throw new AppError('Channel not found', 404);
    }

    // Clear the token so it cannot be reactivated accidentally without reconnecting.
    // The channel row is preserved (for audit / settings history) but is inert.
    channel.is_active = false;
    channel.access_token = null;
    await channel.save();

    // Also mark the MetaIntegration as DISCONNECTED so the webhook stops routing messages.
    const MetaIntegration = require('../integration/meta-integration.entity');
    const platformMap = { messenger: 'facebook', instagram: 'instagram' };
    const platform = platformMap[channel.channel_type];
    if (platform) {
        await MetaIntegration.update(
            { status: 'DISCONNECTED' },
            { where: { shop_id: shopId, platform } }
        ).catch(err => console.warn('[disconnectChannel] MetaIntegration update failed:', err.message));
    }

    return mapChannel(channel);
};

/**
 * Delete a channel
 */
const deleteChannel = async (channelId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const channel = await Channel.findOne({
        where: { id: channelId, shop_id: shopId }
    });

    if (!channel) {
        throw new AppError('Channel not found', 404);
    }

    await channel.destroy();
    return { message: 'Channel deleted successfully' };
};

/**
 * Return the channel-level AI behaviour settings for a given shop + platform.
 * Used by the chatbot pipeline to apply per-channel overrides on top of
 * shop-level AI settings. Never throws — returns {} on miss so callers can
 * spread safely.
 */
const getChannelAISettings = async (shopId, platform) => {
    const channelType = mapChannelTypeFromFrontend(platform);
    try {
        const channel = await Channel.findOne({
            where: { shop_id: shopId, channel_type: channelType, is_active: true },
            attributes: ['settings']
        });
        if (!channel) return {};
        const s = channel.settings || {};
        // Return only the known AI-behaviour keys; ignore free-form metadata.
        return {
            ...(s.aiAutoReply          !== undefined && { aiAutoReply:          s.aiAutoReply }),
            ...(s.requireApproval      !== undefined && { requireApproval:      s.requireApproval }),
            ...(s.businessHours        !== undefined && { businessHours:        s.businessHours }),
            ...(s.allowOrderCreation   !== undefined && { allowOrderCreation:   s.allowOrderCreation }),
            ...(s.autoDetectProducts   !== undefined && { autoDetectProducts:   s.autoDetectProducts }),
            ...(s.draftOrdersOnly      !== undefined && { draftOrdersOnly:      s.draftOrdersOnly }),
            ...(s.requireManualConfirmation !== undefined && { requireManualConfirmation: s.requireManualConfirmation }),
        };
    } catch (_) {
        return {};
    }
};

/**
 * Bug #10: Unified channel config — returns connection status AND AI behaviour
 * settings in a single response so the frontend doesn't need two separate
 * components (Channels modal + ChatSettings) to configure one channel.
 *
 * Callers can use this to render a single "Channel Setup" panel.
 */
const getChannelFullConfig = async (channelId, userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const channel = await Channel.findOne({ where: { id: channelId, shop_id: shopId } });
    if (!channel) throw new AppError('Channel not found', 404);

    const s = channel.settings || {};
    return {
        // Connection / identity
        id:           channel.id,
        channel_type: mapChannelTypeToFrontend(channel.channel_type),
        display_name: channel.display_name,
        is_active:    channel.is_active,
        page_id:      channel.page_id,
        status:       channel.status,
        connected_at: channel.connected_at,
        // AI behaviour (previously only visible in ChatSettings)
        aiAutoReply:              s.aiAutoReply              ?? true,
        requireApproval:          s.requireApproval          ?? false,
        draftOrdersOnly:          s.draftOrdersOnly          ?? false,
        allowOrderCreation:       s.allowOrderCreation       ?? true,
        autoDetectProducts:       s.autoDetectProducts       ?? true,
        requireManualConfirmation: s.requireManualConfirmation ?? false,
        businessHours:            s.businessHours            ?? null,
    };
};

/**
 * Bug Fix: Facebook Token Auto-Refresh
 * Returns all active channels (across all shops) whose token_expires_at is within
 * the next `withinDays` days, including already-expired tokens.
 * Used by the token-refresh-check scheduled job AND exposed as an admin endpoint.
 *
 * For a shop-scoped call the caller must pass userId + shopId to enforce access control.
 */
const getExpiringChannels = async (userId, shopId, withinDays = 7) => {
    await verifyShopAccess(userId, shopId);

    const now = new Date();
    const threshold = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

    const channels = await Channel.findAll({
        where: {
            shop_id: shopId,
            is_active: true,
            token_expires_at: {
                [Op.not]: null,
                [Op.lte]: threshold
            }
        },
        order: [['token_expires_at', 'ASC']]
    });

    return channels.map(channel => {
        const expiresAt = new Date(channel.token_expires_at);
        const isExpired = expiresAt <= now;
        const daysUntilExpiry = Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000));
        return {
            ...mapChannel(channel),
            token_expires_at: expiresAt.toISOString(),
            is_expired: isExpired,
            days_until_expiry: daysUntilExpiry,
            action_required: true
        };
    });
};

module.exports = {
    getChannels,
    getChannelById,
    getChannelByType,
    getChannelAISettings,
    getChannelFullConfig,
    getExpiringChannels,
    createChannel,
    updateChannel,
    deleteChannel,
    connectChannel,
    disconnectChannel
};
