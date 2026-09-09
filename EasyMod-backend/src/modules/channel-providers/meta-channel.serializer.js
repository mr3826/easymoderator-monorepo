'use strict';

const {
    HEALTHY_STATUSES,
    RECONNECT_REQUIRED_STATUSES,
} = require('./meta-channel.statuses');

/**
 * Serialize a Meta channel for merchant-facing API responses.
 *
 * This is intentionally an allowlist. MetaChannel's token field has a
 * decrypting getter, so spreading or returning toJSON() directly would turn
 * an encrypted-at-rest secret into a response secret.
 */
function serializeChannel(channel, options = {}) {
    if (!channel) return null;

    const plain = typeof channel.toJSON === 'function' ? channel.toJSON() : channel;
    const read = (...keys) => {
        for (const key of keys) {
            if (plain?.[key] !== undefined) return plain[key];
            if (channel?.[key] !== undefined) return channel[key];
        }
        return undefined;
    };
    const settings = read('settings') || channel?.get?.('settings') || null;
    const status = read('status');

    const serialized = {
        id: read('id'),
        shopId: read('shop_id', 'shopId'),
        platform: read('platform'),
        metaAssetId: read('meta_asset_id', 'metaAssetId'),
        displayName: read('display_name', 'displayName'),
        pictureUrl: read('picture_url', 'pictureUrl'),
        status,
        isHealthy: HEALTHY_STATUSES.has(status),
        needsReconnect: RECONNECT_REQUIRED_STATUSES.has(status),
        lastError: read('last_error', 'lastError'),
        tokenExpiresAt: read('token_expires_at', 'tokenExpiresAt'),
        tokenLastRefreshedAt: read('token_last_refreshed_at', 'tokenLastRefreshedAt'),
        webhookSubscribedFields: read('webhook_subscribed_fields', 'webhookSubscribedFields') ?? [],
        webhookLastVerifiedAt: read('webhook_last_verified_at', 'webhookLastVerifiedAt'),
        connectedAt: read('connected_at', 'connectedAt'),
        disconnectedAt: read('disconnected_at', 'disconnectedAt'),
        createdAt: read('created_at', 'createdAt'),
        updatedAt: read('updated_at', 'updatedAt'),
        purposeLabel: settings?.purpose_label ?? settings?.purposeLabel ?? null,
    };

    const webhookSubscribed = read('webhook_subscribed', 'webhookSubscribed');
    if (webhookSubscribed !== undefined) serialized.webhookSubscribed = webhookSubscribed;

    if (Object.prototype.hasOwnProperty.call(options, 'webhookWarning')) {
        serialized.webhookWarning = options.webhookWarning;
    }

    return serialized;
}

module.exports = { serializeChannel };
