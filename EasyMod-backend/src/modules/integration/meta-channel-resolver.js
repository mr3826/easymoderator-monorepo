'use strict';

/**
 * Single resolution path from an inbound Meta asset id to a routable channel.
 *
 * Shared by the live webhook router and the receipt reconciler so a replayed
 * event can never resolve a Page differently from its first delivery.
 *
 * Reads exclusively from meta_channels (single source of truth).
 */

const metaChannelService = require('../channel-providers/meta-channel.service');
const MetaChannel = require('../channel-providers/meta-channel.entity');

function serializeConnectedChannel(channel) {
    if (!channel) return null;
    return {
        id: channel.id,
        shop_id: channel.shop_id,
        platform: channel.platform,
        asset_id: channel.meta_asset_id,
        meta_asset_id: channel.meta_asset_id,
        display_name: channel.display_name,
        status: channel.status,
        source: 'meta_channels',
    };
}

/**
 * @returns {Promise<object|null>} null when the asset is unknown OR its channel
 *   is not CONNECTED. A DISCONNECTED / TOKEN_EXPIRED / REVOKED channel can never
 *   send a reply, so dispatching an AI job would burn quota and fail at send.
 *   The caller records the event as IDENTITY_NOT_RESOLVED and retries it later.
 */
async function resolveConnectedChannel(assetId, platform) {
    const channel = await metaChannelService.findByMetaAssetId(assetId);
    if (!channel) return null;
    if (channel.status !== 'CONNECTED') return null;
    const expectedPlatform = platform === 'facebook' || platform === 'messenger'
        ? 'facebook'
        : null;
    if (!expectedPlatform || channel.platform !== expectedPlatform) return null;
    if (!channel.meta_asset_id || String(channel.meta_asset_id) !== String(assetId)) return null;
    return serializeConnectedChannel(channel);
}

/** Resolve a replay only through the tenant/channel captured at acceptance. */
async function resolveConnectedChannelForReceipt({ channelId, shopId, assetId, platform }) {
    const expectedPlatform = platform === 'facebook' || platform === 'messenger'
        ? 'facebook'
        : null;
    if (!channelId || !shopId || !assetId || !expectedPlatform) return null;
    const channel = await MetaChannel.findOne({
        where: {
            id: channelId,
            shop_id: shopId,
            meta_asset_id: assetId,
            platform: expectedPlatform,
            status: 'CONNECTED',
        },
    });
    return serializeConnectedChannel(channel);
}

module.exports = { resolveConnectedChannel, resolveConnectedChannelForReceipt };
