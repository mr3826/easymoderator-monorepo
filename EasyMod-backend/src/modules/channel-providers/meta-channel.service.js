/**
 * MetaChannelService
 *
 * Singleton CRUD entry point for the meta_channels table.
 * All methods are scoped by shop_id for multi-tenant safety.
 *
 * Dual-write intent: called AFTER legacy writes succeed so the legacy
 * path can continue to function during the Phase 1-5 transition.
 *
 * Token encryption is handled transparently by the MetaChannel entity's
 * virtual getter/setter — callers pass and receive plaintext tokens.
 */

'use strict';

const { Op } = require('sequelize');
const { sequelize } = require('../../utils/database/database-setup');
const MetaChannel = require('./meta-channel.entity');
const MetaChannelSettings = require('./meta-channel-settings.entity');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const { drainChannelJobs } = require('../../jobs/message-queue');

const logger = createLogger('MetaChannelService');

const VALID_STATUSES = ['CONNECTED', 'TOKEN_EXPIRED', 'REVOKED', 'DISCONNECTED', 'ERROR'];
const RELEASABLE_CROSS_SHOP_STATUSES = new Set(['DISCONNECTED', 'REVOKED', 'TOKEN_EXPIRED', 'ERROR']);
const REASSIGNED_LAST_ERROR = 'reassigned_to_new_shop_after_fresh_meta_oauth';

function sameId(a, b) {
    return a && b && String(a) === String(b);
}

function canReleaseCrossShopClaim(channel, userId) {
    if (!channel) return false;
    if (RELEASABLE_CROSS_SHOP_STATUSES.has(channel.status)) return true;
    if (!channel.page_access_token_ct) return true;
    // Legacy rows before the OAuth audit fix can have no connector id. A fresh
    // Meta OAuth page token is the current ownership proof, so let those rows be
    // released instead of permanently blocking the Page.
    if (!channel.connected_by_user_id) return true;
    return sameId(channel.connected_by_user_id, userId);
}

class MetaChannelService {

    /**
     * Upsert a MetaChannel row from an OAuth connect flow, and create a default
     * MetaChannelSettings row if one does not already exist.
     *
     * @param {object} params
     * @param {string} params.shopId
     * @param {string} params.userId             - User who completed OAuth
     * @param {'facebook'} params.platform
     * @param {string} params.metaAssetId        - Facebook Page ID
     * @param {string} params.displayName
     * @param {string|null} params.pictureUrl
     * @param {string} params.pageAccessToken     - Plaintext token (entity setter encrypts it)
     * @param {Date|null} params.tokenExpiresAt
     * @param {string|null} params.webhookVerifyToken
     * @param {string[]|null} params.webhookSubscribedFields
     * @returns {Promise<MetaChannel>}
     */
    async upsertFromOAuth({
        shopId,
        userId,
        platform,
        metaAssetId,
        displayName,
        pictureUrl = null,
        pageAccessToken,
        tokenExpiresAt = null,
        webhookVerifyToken = null,
        webhookSubscribedFields = []
    }) {
        if (!shopId) throw new Error('MetaChannelService.upsertFromOAuth: shopId is required');
        if (!platform) throw new Error('MetaChannelService.upsertFromOAuth: platform is required');
        if (!metaAssetId) throw new Error('MetaChannelService.upsertFromOAuth: metaAssetId is required');

        const transaction = await sequelize.transaction();
        let committed = false;
        let channel = null;
        const releasedConflictingChannels = [];
        try {
            const now = new Date();
            // Check if this asset is claimed by a different shop (cross-shop guard).
            // Stale/non-routable claims are released after a fresh Meta OAuth
            // proves the current user can manage this Page. A modern active claim
            // from another user still blocks to prevent accidental tenant takeover.
            const conflictingChannels = await MetaChannel.findAll({
                where: {
                    meta_asset_id: metaAssetId,
                    shop_id: { [Op.ne]: shopId }
                },
                transaction
            });
            const blockingConflict = conflictingChannels.find((existing) => (
                !canReleaseCrossShopClaim(existing, userId)
            ));
            if (blockingConflict) {
                throw new AppError(
                    'This Facebook Page is already connected to another EasyModerator shop. Disconnect it there first, or ask support to release the old connection.',
                    409,
                    'META_ASSET_ALREADY_CONNECTED',
                    {
                        metaAssetId,
                        conflictingChannelId: blockingConflict.id,
                        conflictingShopId: blockingConflict.shop_id,
                    }
                );
            }

            for (const existing of conflictingChannels) {
                const previousStatus = existing.status;
                existing.status = 'DISCONNECTED';
                existing.page_access_token_ct = null;
                existing.disconnected_at = now;
                existing.last_error = REASSIGNED_LAST_ERROR;
                await existing.save({ transaction });
                releasedConflictingChannels.push({
                    id: existing.id,
                    shop_id: existing.shop_id,
                    platform: existing.platform,
                    previousStatus,
                });
            }

            // Phase 1: upsert on (shop_id, meta_asset_id). A second page of the
            // same platform now creates a new row instead of overwriting the first.
            // Reconnecting the same page still updates in place.
            channel = await MetaChannel.findOne({
                where: { shop_id: shopId, meta_asset_id: metaAssetId },
                transaction
            });

            if (channel) {
                // Update existing row — entity setter encrypts token automatically
                channel.meta_asset_id = metaAssetId;
                channel.display_name = displayName;
                channel.picture_url = pictureUrl;
                // Trigger setter (encryption) only when token provided
                if (pageAccessToken) {
                    channel.page_access_token_ct = pageAccessToken;
                }
                channel.token_expires_at = tokenExpiresAt;
                channel.token_last_refreshed_at = now;
                channel.token_refresh_attempts = 0;
                if (webhookVerifyToken) {
                    channel.webhook_verify_token = webhookVerifyToken;
                }
                if (webhookSubscribedFields && webhookSubscribedFields.length > 0) {
                    channel.webhook_subscribed_fields = webhookSubscribedFields;
                }
                channel.status = 'CONNECTED';
                channel.last_error = null;
                channel.connected_by_user_id = userId;
                channel.connected_at = now;
                channel.disconnected_at = null;
                await channel.save({ transaction });
            } else {
                // Create new row
                channel = await MetaChannel.create({
                    shop_id: shopId,
                    platform,
                    meta_asset_id: metaAssetId,
                    display_name: displayName,
                    picture_url: pictureUrl,
                    page_access_token_ct: pageAccessToken,  // setter encrypts
                    token_expires_at: tokenExpiresAt,
                    token_last_refreshed_at: now,
                    token_refresh_attempts: 0,
                    webhook_verify_token: webhookVerifyToken,
                    webhook_subscribed_fields: webhookSubscribedFields || [],
                    status: 'CONNECTED',
                    connected_by_user_id: userId,
                    connected_at: now
                }, { transaction });
            }

            // Create default settings row if missing (idempotent)
            const [, created] = await MetaChannelSettings.findOrCreate({
                where: { channel_id: channel.id },
                defaults: { channel_id: channel.id },
                transaction
            });
            if (created) {
                logger.info('MetaChannelService: created default settings', { channelId: channel.id });
            }

            await transaction.commit();
            committed = true;
        } catch (err) {
            if (!committed) {
                await transaction.rollback();
            }
            // Expand Sequelize ValidationError/UniqueConstraintError so the
            // log line names the offending field instead of the parent
            // "Validation error" summary, which is useless on its own.
            const fields = Array.isArray(err.errors)
                ? err.errors.map(e => ({ path: e.path, message: e.message, validatorKey: e.validatorKey }))
                : undefined;
            logger.error('MetaChannelService.upsertFromOAuth: failed', {
                error: err.message,
                errorName: err.name,
                fields,
                shopId,
                platform,
                metaAssetId,
            });
            throw err;
        }

        for (const released of releasedConflictingChannels) {
            try {
                const { removed } = await drainChannelJobs({
                    metaChannelId: released.id,
                    shopId: released.shop_id,
                    platform: released.platform,
                });
                logger.info('MetaChannelService.upsertFromOAuth: drained reassigned channel jobs', {
                    releasedChannelId: released.id,
                    previousShopId: released.shop_id,
                    queueJobsDrained: removed,
                });
            } catch (drainErr) {
                logger.warn('MetaChannelService.upsertFromOAuth: failed to drain reassigned channel jobs', {
                    releasedChannelId: released.id,
                    previousShopId: released.shop_id,
                    error: drainErr.message,
                });
            }
        }

        logger.info('MetaChannelService.upsertFromOAuth: success', {
            channelId: channel.id,
            shopId,
            platform,
            metaAssetId,
            releasedCrossShopClaims: releasedConflictingChannels.length,
        });
        return channel;
    }

    /**
     * Find the channel for a given shop + platform combination.
     * Returns null if not found.
     *
     * @deprecated Phase 1 allows multiple channels per (shop, platform). This
     * method returns an arbitrary row (the first match) when more than one
     * exists. Migrate callers to {@link findByShopAndAsset} (by meta_asset_id)
     * or {@link listByShopAndPlatform} (full list) in Phase 2.
     *
     * @param {string} shopId
     * @param {'facebook'} platform
     * @returns {Promise<MetaChannel|null>}
     */
    async findByShopAndPlatform(shopId, platform) {
        if (!shopId || !platform) return null;
        return MetaChannel.findOne({
            where: { shop_id: shopId, platform },
            order: [['created_at', 'ASC']]
        });
    }

    /**
     * Find a specific channel by (shop_id, meta_asset_id). This is the
     * unambiguous lookup after Phase 1 — a shop can own multiple channels
     * per platform, but each (shop, asset) pair is unique.
     *
     * @param {string} shopId
     * @param {string} metaAssetId
     * @returns {Promise<MetaChannel|null>}
     */
    async findByShopAndAsset(shopId, metaAssetId) {
        if (!shopId || !metaAssetId) return null;
        return MetaChannel.findOne({ where: { shop_id: shopId, meta_asset_id: metaAssetId } });
    }

    /**
     * List all channels for a shop on a given platform. Returns an empty
     * array when none exist. Use this when iterating over every connected
     * Page/IG account of a platform.
     *
     * @param {string} shopId
     * @param {'facebook'} platform
     * @returns {Promise<MetaChannel[]>}
     */
    async listByShopAndPlatform(shopId, platform) {
        if (!shopId || !platform) return [];
        return MetaChannel.findAll({
            where: { shop_id: shopId, platform },
            order: [['created_at', 'ASC']]
        });
    }

    /**
     * Find a channel by its Meta asset ID (Facebook Page ID).
     * Used by the webhook router to identify which shop owns an incoming event.
     *
     * @param {string} metaAssetId
     * @returns {Promise<MetaChannel|null>}
     */
    async findByMetaAssetId(metaAssetId) {
        if (!metaAssetId) return null;
        return MetaChannel.findOne({
            where: { meta_asset_id: metaAssetId, status: 'CONNECTED' },
            order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
        });
    }

    /**
     * Find a channel by its webhook verify token.
     * Used during the Meta webhook GET handshake to identify the channel.
     *
     * @param {string} token
     * @returns {Promise<MetaChannel|null>}
     */
    async findByWebhookVerifyToken(token) {
        if (!token) return null;
        return MetaChannel.findOne({ where: { webhook_verify_token: token } });
    }

    /**
     * List all channels for a shop, ordered by creation time.
     *
     * @param {string} shopId
     * @returns {Promise<MetaChannel[]>}
     */
    async listByShop(shopId) {
        if (!shopId) return [];
        return MetaChannel.findAll({
            where: { shop_id: shopId },
            order: [['created_at', 'ASC']],
            include: [{
                model: MetaChannelSettings,
                as: 'settings',
                attributes: ['purpose_label'],
                required: false
            }]
        });
    }

    /**
     * Update a channel's connection status with optional error message.
     * Status transitions are audited via the updated_at timestamp.
     *
     * @param {string} channelId
     * @param {'CONNECTED'|'TOKEN_EXPIRED'|'REVOKED'|'DISCONNECTED'|'ERROR'} status
     * @param {string|null} [lastError]
     * @returns {Promise<MetaChannel>}
     */
    async updateStatus(channelId, status, lastError = null) {
        if (!VALID_STATUSES.includes(status)) {
            throw new Error(`MetaChannelService.updateStatus: invalid status "${status}"`);
        }
        const channel = await MetaChannel.findByPk(channelId);
        if (!channel) throw new Error(`MetaChannelService.updateStatus: channel ${channelId} not found`);

        channel.status = status;
        channel.last_error = lastError ?? null;
        if (status === 'DISCONNECTED') {
            channel.disconnected_at = new Date();
        }
        await channel.save();
        logger.info('MetaChannelService.updateStatus', { channelId, status });
        return channel;
    }

    /**
     * Confirm a channel's webhook is verified AND active. Performs three writes in
     * one save: stamps webhook_last_verified_at (now), (re)asserts status='CONNECTED',
     * and clears last_error. Call ONLY after verifyWebhookSubscription returns ok.
     *
     * @param {string} channelId
     * @param {string[]|null} webhookSubscribedFields
     * @returns {Promise<MetaChannel>}
     */
    async confirmWebhookActive(channelId, webhookSubscribedFields = null) {
        const channel = await MetaChannel.findByPk(channelId);
        if (!channel) throw new Error(`confirmWebhookActive: channel ${channelId} not found`);
        channel.webhook_last_verified_at = new Date();
        if (Array.isArray(webhookSubscribedFields)) {
            channel.webhook_subscribed_fields = [...new Set(webhookSubscribedFields)];
        }
        channel.status = 'CONNECTED';
        channel.last_error = null;
        await channel.save();
        logger.info('MetaChannelService.confirmWebhookActive', {
            channelId,
            webhookSubscribedFields: channel.webhook_subscribed_fields,
        });
        return channel;
    }

    /**
     * Update a channel's tokens (used by the token refresh job).
     * Resets refresh_attempts to 0 on success and stamps token_last_refreshed_at.
     *
     * @param {string} channelId
     * @param {object} params
     * @param {string} params.pageAccessToken  - New plaintext token
     * @param {Date|null} params.tokenExpiresAt
     * @returns {Promise<MetaChannel>}
     */
    async updateTokens(channelId, { pageAccessToken, tokenExpiresAt }) {
        const channel = await MetaChannel.findByPk(channelId);
        if (!channel) throw new Error(`MetaChannelService.updateTokens: channel ${channelId} not found`);

        channel.page_access_token_ct = pageAccessToken;  // entity setter encrypts
        channel.token_expires_at = tokenExpiresAt ?? null;
        channel.token_last_refreshed_at = new Date();
        channel.token_refresh_attempts = 0;
        channel.status = 'CONNECTED';
        channel.last_error = null;
        await channel.save();
        logger.info('MetaChannelService.updateTokens: success', { channelId });
        return channel;
    }

    /**
     * Disconnect a channel: set status to DISCONNECTED, clear the stored token,
     * and drain any pending message-processing queue jobs for this channel so
     * they don't keep retrying with a now-cleared token until they hit the DLQ.
     *
     * @param {string} channelId
     * @returns {Promise<MetaChannel>}
     */
    async disconnect(channelId, {
        status = 'DISCONNECTED',
        lastError = null,
    } = {}) {
        if (!VALID_STATUSES.includes(status)) {
            throw new Error(`MetaChannelService.disconnect: invalid status "${status}"`);
        }
        const channel = await MetaChannel.findByPk(channelId);
        if (!channel) throw new Error(`MetaChannelService.disconnect: channel ${channelId} not found`);

        channel.status = status;
        channel.page_access_token_ct = null;
        channel.token_expires_at = null;
        channel.disconnected_at = new Date();
        channel.last_error = lastError;
        await channel.save();

        // Best-effort: drain queued jobs for this channel. Non-fatal — if Redis
        // is temporarily unavailable the disconnect still succeeds and the jobs
        // will simply fail on their next attempt with a token-absent error.
        const { removed } = await drainChannelJobs({
            metaChannelId: channel.id,
            shopId: channel.shop_id,
            platform: channel.platform,
        });
        logger.info('MetaChannelService.disconnect', { channelId, queueJobsDrained: removed });
        return channel;
    }

    /**
     * Return MetaChannelSettings for a channel, creating default row if missing.
     *
     * @param {string} channelId
     * @returns {Promise<MetaChannelSettings>}
     */
    async getSettings(channelId) {
        const [settings] = await MetaChannelSettings.findOrCreate({
            where: { channel_id: channelId },
            defaults: { channel_id: channelId }
        });
        return settings;
    }

    /**
     * Partially update MetaChannelSettings for a channel.
     * Only known settings fields are allowed through (prevents arbitrary injection).
     *
     * @param {string} channelId
     * @param {Partial<MetaChannelSettings>} patch
     * @returns {Promise<MetaChannelSettings>}
     */
    async updateSettings(channelId, patch) {
        const settings = await this.getSettings(channelId);

        const ALLOWED_KEYS = [
            'ai_auto_reply',
            'automation_mode',
            'confidence_threshold_send',
            'confidence_threshold_suggest',
            'business_hours',
            'allow_order_creation',
            'purpose_label'
        ];

        const sanitizedPatch = {};
        for (const key of ALLOWED_KEYS) {
            if (Object.prototype.hasOwnProperty.call(patch, key)) {
                sanitizedPatch[key] = patch[key];
            }
        }

        await settings.update(sanitizedPatch);
        logger.info('MetaChannelService.updateSettings', { channelId, keys: Object.keys(sanitizedPatch) });
        return settings;
    }
}

module.exports = new MetaChannelService();
