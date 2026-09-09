/**
 * meta-channel.controller.js
 *
 * Canonical channel CRUD/lifecycle controller for /api/channels/meta/*.
 * Reads exclusively from meta_channels via MetaChannelService (single source of truth).
 *
 * Endpoints:
 *   GET    /api/channels/meta
 *   POST   /api/channels/meta/:channelId/disconnect
 *   POST   /api/channels/meta/:channelId/reconnect
 *   POST   /api/channels/meta/:channelId/test-webhook
 */

'use strict';

const { Op } = require('sequelize');
const MetaChannel = require('./meta-channel.entity');
const MetaChannelSettings = require('./meta-channel-settings.entity');
const MetaChannelConsentEvent = require('./meta-channel-consent-event.entity');
const metaChannelService = require('./meta-channel.service');
const oauthService = require('./meta-oauth.service');
const { getProvider } = require('./provider.registry');
const { AppError } = require('../../utils/AppError');
const { createLogger } = require('../../utils/structured-logger');
const { serializeChannel } = require('./meta-channel.serializer');

const logger = createLogger('MetaChannelController');

async function assertChannelBelongsToShop(channelId, shopId) {
    const row = await MetaChannel.findByPk(channelId);
    if (!row) throw new AppError('Channel not found', 404);
    if (row.shop_id !== shopId) throw new AppError('Channel does not belong to this shop', 403);
    return row;
}

/**
 * GET /api/channels/meta
 * Lists this shop's meta channels.
 */
exports.list = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        const channels = await metaChannelService.listByShop(shopId);
        res.json({ success: true, data: channels.map(serializeChannel) });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/channels/meta/:channelId/disconnect
 * Marks status=DISCONNECTED, clears the encrypted token, and best-effort
 * unsubscribes the page from the Meta App's webhook subscription. The row
 * is preserved for audit history.
 */
exports.disconnect = async (req, res, next) => {
    try {
        const { channelId } = req.params;
        const { shopId } = req.user;
        const channel = await assertChannelBelongsToShop(channelId, shopId);

        // Best-effort webhook unsubscribe before we lose the token.
        if (channel.page_access_token_ct && channel.meta_asset_id) {
            try {
                const provider = getProvider(channel.platform);
                await provider.unsubscribeWebhook({ channel });
                logger.info('Webhook unsubscribed', { channelId, platform: channel.platform });
            } catch (err) {
                // Non-fatal — the token may already be revoked Meta-side.
                logger.warn('Webhook unsubscribe failed (non-fatal)', {
                    channelId,
                    err: err.message,
                });
            }
        }

        const updated = await metaChannelService.disconnect(channelId);
        res.json({ success: true, data: serializeChannel(updated) });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/channels/meta/:channelId/reconnect
 * Generates a fresh OAuth initiate URL with the channelId baked into state,
 * so the OAuth callback page can route the user back to the right channel.
 * The actual asset-reconnect happens through the normal connect-asset flow —
 * upsertFromOAuth updates the existing row in place when the same
 * (shop_id, platform) pair already exists.
 */
exports.reconnect = async (req, res, next) => {
    try {
        const { channelId } = req.params;
        const { userId, shopId } = req.user;
        const channel = await assertChannelBelongsToShop(channelId, shopId);

        const { redirectUrl, state } = await oauthService.initiateOAuth(
            userId,
            shopId,
            channel.platform,
            {
                targetChannelId: channel.id,
                targetAssetId: channel.meta_asset_id,
            },
        );

        logger.info('Reconnect initiated', { channelId, platform: channel.platform });
        res.json({
            success: true,
            data: {
                redirectUrl,
                state,
                channelId: channel.id,
                platform: channel.platform,
            },
        });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/channels/meta/:channelId/test-webhook
 * Pings the Meta API as a connectivity check, then returns a synthetic
 * normalized event so the frontend can verify the inbound path is wired up.
 * Does NOT actually exercise the live webhook — Meta initiates those — but it
 * validates that the access token and provider are still functional.
 */
/**
 * GET /api/channels/meta/:channelId/consent-summary
 * Aggregate opt-in / opt-out counts and the 10 most recent consent events for
 * this channel. Used by the Channels UI to surface compliance state at a glance.
 */
exports.consentSummary = async (req, res, next) => {
    try {
        const { channelId } = req.params;
        const { shopId } = req.user;
        await assertChannelBelongsToShop(channelId, shopId);

        const [optIns, optOuts, deauths, dataDeletions, recent] = await Promise.all([
            MetaChannelConsentEvent.count({
                where: { channel_id: channelId, event: { [Op.in]: ['OPT_IN_IMPLICIT', 'OPT_IN_EXPLICIT'] } },
            }),
            MetaChannelConsentEvent.count({
                where: { channel_id: channelId, event: 'OPT_OUT' },
            }),
            MetaChannelConsentEvent.count({
                where: { channel_id: channelId, event: 'DEAUTHORIZED' },
            }),
            MetaChannelConsentEvent.count({
                where: { channel_id: channelId, event: 'DATA_DELETED' },
            }),
            MetaChannelConsentEvent.findAll({
                where: { channel_id: channelId },
                order: [['created_at', 'DESC']],
                limit: 10,
            }),
        ]);

        res.json({
            success: true,
            data: {
                channelId,
                counts: {
                    optIns,
                    optOuts,
                    deauthorized: deauths,
                    dataDeleted: dataDeletions,
                },
                recentEvents: recent.map((e) => ({
                    id: e.id,
                    event: e.event,
                    source: e.source,
                    customerId: e.customer_id,
                    metadata: e.metadata,
                    createdAt: e.created_at,
                })),
            },
        });
    } catch (err) {
        next(err);
    }
};

const SETTINGS_WHITELIST = [
    'confidence_threshold_send', 'confidence_threshold_suggest',
    'business_hours',
    'allow_order_creation',
    'purpose_label',
];

const UNSUPPORTED_PAGE_SETTINGS = new Set([
    'aiAutoReply',
    'automationMode',
    'ai_auto_reply',
    'automation_mode',
]);

function assertNoUnsupportedPageSettings(body) {
    const unsupportedKey = Object.keys(body || {}).find((key) => UNSUPPORTED_PAGE_SETTINGS.has(key));
    if (unsupportedKey) {
        throw new AppError(
            `${unsupportedKey} is not supported for Page settings; configure the business AI reply mode instead`,
            400,
            'VALIDATION_ERROR'
        );
    }
}

function serializeSettings(s) {
    if (!s) return null;
    return {
        confidenceThresholdSend:    parseFloat(s.confidence_threshold_send),
        confidenceThresholdSuggest: parseFloat(s.confidence_threshold_suggest),
        businessHours:              s.business_hours ?? null,
        allowOrderCreation:         s.allow_order_creation,
        purposeLabel:               s.purpose_label ?? null,
    };
}

/**
 * GET /api/channels/meta/:channelId/settings
 */
exports.getSettings = async (req, res, next) => {
    try {
        const { channelId } = req.params;
        const { shopId } = req.user;
        await assertChannelBelongsToShop(channelId, shopId);
        const settings = await metaChannelService.getSettings(channelId);
        res.json({ success: true, data: serializeSettings(settings) });
    } catch (err) {
        next(err);
    }
};

/**
 * PATCH /api/channels/meta/:channelId/settings
 * Accepts camelCase keys (frontend-friendly); converts to snake_case before writing.
 */
exports.updateChannelSettings = async (req, res, next) => {
    try {
        const { channelId } = req.params;
        const { shopId } = req.user;
        await assertChannelBelongsToShop(channelId, shopId);
        assertNoUnsupportedPageSettings(req.body);

        const camelToSnake = {
            confidenceThresholdSend: 'confidence_threshold_send',
            confidenceThresholdSuggest: 'confidence_threshold_suggest',
            businessHours: 'business_hours',
            allowOrderCreation: 'allow_order_creation',
            purposeLabel: 'purpose_label',
        };

        const patch = {};
        for (const [camel, snake] of Object.entries(camelToSnake)) {
            if (req.body[camel] !== undefined) patch[snake] = req.body[camel];
        }
        // also accept snake_case keys directly
        for (const key of SETTINGS_WHITELIST) {
            if (req.body[key] !== undefined) patch[key] = req.body[key];
        }

        if (Object.keys(patch).length === 0) {
            return res.json({ success: true, data: serializeSettings(await metaChannelService.getSettings(channelId)) });
        }

        await metaChannelService.updateSettings(channelId, patch);
        const updated = await metaChannelService.getSettings(channelId);
        res.json({ success: true, data: serializeSettings(updated) });
    } catch (err) {
        next(err);
    }
};

/**
 * PATCH /api/channels/meta/:channelId/purpose-label
 * Cosmetic per-channel label that lets a merchant disambiguate multiple
 * Pages/IG accounts (e.g. "Sales", "Live selling", "Regional"). Display only —
 * does not affect AI routing or product scope.
 *
 * Body: { purposeLabel: string|null }  (empty string or null clears the label)
 */
exports.updatePurposeLabel = async (req, res, next) => {
    try {
        const { channelId } = req.params;
        const { shopId } = req.user;
        await assertChannelBelongsToShop(channelId, shopId);

        const raw = req.body.purposeLabel;
        const normalized = (raw === '' || raw === undefined) ? null : raw;

        await metaChannelService.updateSettings(channelId, { purpose_label: normalized });

        // Re-fetch the channel with settings JOIN so the response carries the
        // updated label in the same shape as GET /api/channels/meta.
        const refreshed = await MetaChannel.findByPk(channelId, {
            include: [{
                model: MetaChannelSettings,
                as: 'settings',
                attributes: ['purpose_label'],
                required: false,
            }],
        });

        res.json({ success: true, data: serializeChannel(refreshed) });
    } catch (err) {
        next(err);
    }
};

exports.testWebhook = async (req, res, next) => {
    try {
        const { channelId } = req.params;
        const { shopId } = req.user;
        const channel = await assertChannelBelongsToShop(channelId, shopId);
        const repairSubscription = req.body?.repairSubscription === true;

        const provider = getProvider(channel.platform);
        const pingResult = await provider.ping({ channel }).catch((err) => ({
            ok: false,
            error: err.message,
        }));
        const requiredFields = typeof provider.webhookFields === 'function'
            ? provider.webhookFields()
            : ['messages'];
        let subscriptionResult = await provider.verifyWebhookSubscription({ channel }).catch((err) => ({
            ok: false,
            fields: [],
            error: err.message,
        }));
        let repaired = false;

        if (!subscriptionResult.ok && repairSubscription) {
            await provider.subscribeWebhook({ channel });
            repaired = true;
            subscriptionResult = await provider.verifyWebhookSubscription({ channel }).catch((err) => ({
                ok: false,
                fields: [],
                error: err.message,
            }));
        }

        if (subscriptionResult.ok) {
            await metaChannelService.confirmWebhookActive(channelId, subscriptionResult.fields);
        }

        res.json({
            success: true,
            data: {
                channelId,
                platform: channel.platform,
                ping: pingResult,
                subscription: {
                    ok: subscriptionResult.ok,
                    fields: subscriptionResult.fields || [],
                    requiredFields,
                    repaired,
                },
                checkedAt: new Date().toISOString(),
            },
        });
    } catch (err) {
        next(err);
    }
};
