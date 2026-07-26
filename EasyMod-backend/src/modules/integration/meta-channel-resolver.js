'use strict';

/**
 * Single resolution path from an inbound Meta asset id to a routable channel.
 *
 * Shared by the live webhook router and the receipt reconciler so a replayed
 * event can never resolve a Page differently from its first delivery.
 *
 * Phase 5: reads exclusively from meta_channels (single source of truth).
 */

const metaChannelService = require('../channel-providers/meta-channel.service');

/**
 * @returns {Promise<object|null>} null when the asset is unknown OR its channel
 *   is not CONNECTED. A DISCONNECTED / TOKEN_EXPIRED / REVOKED channel can never
 *   send a reply, so dispatching an AI job would burn quota and fail at send.
 *   The caller records the event as IDENTITY_NOT_RESOLVED and retries it later.
 */
async function resolveConnectedChannel(assetId, _platform) {
    const channel = await metaChannelService.findByMetaAssetId(assetId);
    if (!channel) return null;
    if (channel.status !== 'CONNECTED') return null;
    return {
        id: channel.id,
        shop_id: channel.shop_id,
        platform: channel.platform,
        asset_id: channel.meta_asset_id,
        display_name: channel.display_name,
        status: channel.status,
        source: 'meta_channels',
    };
}

module.exports = { resolveConnectedChannel };
