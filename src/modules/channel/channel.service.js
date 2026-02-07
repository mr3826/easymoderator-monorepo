const { Channel } = require('src/modules/entities');
const { AppError } = require('src/utils/AppError');
const { UserShop } = require('src/modules/entities');

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

const mapChannel = (channel) => ({
    id: channel.id,
    name: channel.name,
    type: channel.type,
    status: channel.status,
    connected: channel.connected,
    lastSync: channel.last_sync?.toISOString(),
    messageCount: channel.message_count,
    config: channel.config || null
});

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

/**
 * Create a new channel
 */
const createChannel = async (userId, shopId, channelData) => {
    await verifyShopAccess(userId, shopId);

    const { name, type } = channelData;

    // Check if channel type already exists for this shop
    const existingChannel = await Channel.findOne({
        where: { shop_id: shopId, type }
    });

    if (existingChannel) {
        throw new AppError(`Channel type ${type} already exists for this shop`, 400);
    }

    const channel = await Channel.create({
        shop_id: shopId,
        name,
        type,
        status: 'inactive',
        connected: false,
        message_count: 0
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

    const { name, config } = updateData;

    if (name) channel.name = name;
    if (config) channel.config = config;

    await channel.save();

    return mapChannel(channel);
};

/**
 * Connect or create a channel with credentials
 */
const connectChannel = async (userId, shopId, payload) => {
    await verifyShopAccess(userId, shopId);

    const { type, name, config, appId, appSecret, assetId } = payload;

    const computedConfig = config || {
        appId,
        appSecret,
        assetId
    };

    let channel = await Channel.findOne({
        where: { shop_id: shopId, type }
    });

    if (!channel) {
        channel = await Channel.create({
            shop_id: shopId,
            name: name || type,
            type,
            status: 'active',
            connected: true,
            config: computedConfig,
            last_sync: new Date(),
            message_count: 0
        });
    } else {
        channel.name = name || channel.name;
        channel.status = 'active';
        channel.connected = true;
        channel.config = computedConfig;
        channel.last_sync = new Date();
        await channel.save();
    }

    return mapChannel(channel);
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

    channel.status = 'inactive';
    channel.connected = false;
    channel.last_sync = null;
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
    createChannel,
    updateChannel,
    deleteChannel,
    connectChannel,
    disconnectChannel
};