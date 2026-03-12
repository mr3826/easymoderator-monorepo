const { Channel } = require('../entities');
const { AppError } = require('../../utils/AppError');
const { UserShop } = require('../entities');

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
        || 'system-user';
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
        config: {
            systemUserToken: channel.access_token,
            businessManagerId: channel.settings?.businessManagerId || null
        },
        last_sync: channel.updated_at ? channel.updated_at.toISOString() : null,
        message_count: 0,
        created_at: channel.created_at,
        updated_at: channel.updated_at,
        channel_id: channel.id,
        channel_type: channel.channel_type,
        is_active: channel.is_active,
        credentials: {
            page_id: channel.page_id,
            access_token: channel.access_token
        },
        webhook_verify_token: channel.verify_token,
        settings: channel.settings || {}
    };
};

/**
 * Get all channels for a shop
 */
const getChannels = async (userId, shopId) => {
    await verifyShopAccess(userId, shopId);

    const channels = await Channel.findAll({
        where: { shop_id: shopId },
        order: [['created_at', 'ASC']]
    });

    return channels.map(mapChannel);
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
 * Create a new channel
 */
const createChannel = async (userId, shopId, channelData) => {
    await verifyShopAccess(userId, shopId);

    const { channel_type, page_id, access_token, verify_token, webhook_secret, settings } = normalizeChannelPayload(channelData);

    if (!channel_type) {
        throw new AppError('Channel type is required', 400);
    }

    if (!access_token) {
        throw new AppError('System user token is required', 400);
    }

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

    const { page_id, access_token, verify_token, webhook_secret, settings, is_active, systemUserToken, businessManagerId, config } = updateData;
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

    await channel.save();

    return mapChannel(channel);
};

/**
 * Connect or create a channel with credentials
 */
const connectChannel = async (userId, shopId, payload) => {
    await verifyShopAccess(userId, shopId);
    const normalizedPayload = normalizeChannelPayload(payload);

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

    channel.is_active = false;
    await channel.save();

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

module.exports = {
    getChannels,
    getChannelById,
    getChannelByType,
    createChannel,
    updateChannel,
    deleteChannel,
    connectChannel,
    disconnectChannel
};
