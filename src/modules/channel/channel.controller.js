const channelService = require('./channel.service');
const auditService = require('../audit/audit.service');
const { storeIdempotencyResult } = require('../audit/idempotency.middleware');
const { auditLogMiddleware, setAuditValues } = require('../audit/audit.middleware');

/**
 * RESTful: Get channels with pagination and filters
 */
const getChannels = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const options = req.query; // Already validated
        const result = await channelService.getChannels(req.user.userId, shopId);

        res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Get channel by ID
 */
const getChannelById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated
        const channel = await channelService.getChannelById(id, req.user.userId, shopId);

        res.status(200).json({
            success: true,
            data: channel
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Create channel
 */
const createChannelRest = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const channel = await channelService.createChannel(
            req.user.userId,
            shopId,
            req.body // Already validated
        );

        // Audit log the creation
        await auditService.logOperation({
            userId: req.user.userId,
            shopId,
            action: 'CREATE',
            resourceType: 'CHANNEL',
            resourceId: channel.id,
            newValues: req.body,
            metadata: { endpoint: req.originalUrl },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            idempotencyKey: req.idempotencyKey
        });

        res.status(201).json({
            success: true,
            data: channel
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Update channel by ID
 */
const updateChannelById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated

        // Get current channel for audit logging
        const currentChannel = await channelService.getChannelById(id, req.user.userId, shopId);

        const channel = await channelService.updateChannel(
            id,
            req.user.userId,
            shopId,
            req.body // Already validated
        );

        // Audit log the update
        await auditService.logOperation({
            userId: req.user.userId,
            shopId,
            action: 'UPDATE',
            resourceType: 'CHANNEL',
            resourceId: id,
            oldValues: currentChannel,
            newValues: req.body,
            metadata: { endpoint: req.originalUrl },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            idempotencyKey: req.idempotencyKey
        });

        res.status(200).json({
            success: true,
            data: channel
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Delete channel by ID
 */
const deleteChannelById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params; // Already validated

        // Get current channel for audit logging
        const currentChannel = await channelService.getChannelById(id, req.user.userId, shopId);

        const result = await channelService.deleteChannel(
            id,
            req.user.userId,
            shopId
        );

        // Audit log the deletion
        await auditService.logOperation({
            userId: req.user.userId,
            shopId,
            action: 'DELETE',
            resourceType: 'CHANNEL',
            resourceId: id,
            oldValues: currentChannel,
            metadata: { endpoint: req.originalUrl },
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            idempotencyKey: req.idempotencyKey
        });

        res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Connect channel by type
 */
const connectChannelByType = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const channel = await channelService.connectChannel(
            req.user.userId,
            shopId,
            req.body
        );

        res.status(200).json({
            success: true,
            data: channel
        });
    } catch (error) {
        next(error);
    }
};

/**
 * RESTful: Disconnect channel by ID
 */
const disconnectChannelById = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const channel = await channelService.disconnectChannel(
            req.params.id,
            req.user.userId,
            shopId
        );

        res.status(200).json({
            success: true,
            data: channel
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: Get all channels for the shop (backward compatibility)
 */
const getChannelsLegacy = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const channels = await channelService.getChannels(req.user.userId, shopId);

        res.status(200).json({
            success: true,
            data: channels
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: Create a new channel (backward compatibility)
 */
const createChannel = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const channel = await channelService.createChannel(req.user.userId, shopId, req.body);

        res.status(201).json({
            success: true,
            data: channel
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: Update a channel (backward compatibility)
 */
const updateChannel = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params;
        const channel = await channelService.updateChannel(id, req.user.userId, shopId, req.body);

        res.status(200).json({
            success: true,
            data: channel
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Legacy: Delete a channel (backward compatibility)
 */
const deleteChannel = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { id } = req.params;
        const result = await channelService.deleteChannel(id, req.user.userId, shopId);

        res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * V2: Get channel config by shop and type
 */
const getChannelConfig = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const { channelType } = req.params;
        const channel = await channelService.getChannelByType(
            req.user.userId,
            shopId,
            channelType
        );

        res.status(200).json(channel);
    } catch (error) {
        next(error);
    }
};

/**
 * Bug Fix: Facebook Token Auto-Refresh
 * GET /channel/expiring-tokens[?withinDays=7]
 * Returns channels for the authenticated shop whose tokens expire within
 * the specified window (default 7 days), including already-expired tokens.
 */
const getExpiringTokens = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'No shop selected. Please login again.'
                }
            });
        }

        const withinDays = parseInt(req.query.withinDays, 10) || 7;
        if (withinDays < 1 || withinDays > 90) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'withinDays must be between 1 and 90'
                }
            });
        }

        const channels = await channelService.getExpiringChannels(
            req.user.userId,
            shopId,
            withinDays
        );

        res.status(200).json({
            success: true,
            data: channels,
            meta: {
                total: channels.length,
                within_days: withinDays,
                checked_at: new Date().toISOString()
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Debug endpoint: Check if channel exists for a page ID
 */
const debugChannelByPageId = async (req, res, next) => {
    try {
        const { pageId } = req.params;
        const { Channel } = require('../entities');
        const MetaIntegration = require('../integration/meta-integration.entity');

        // Check Channel table
        const channel = await Channel.findOne({
            where: { page_id: pageId },
            attributes: ['id', 'shop_id', 'channel_type', 'page_id', 'is_active', 'created_at', 'updated_at']
        });

        // Check MetaIntegration table
        const integration = await MetaIntegration.findOne({
            where: { meta_asset_id: pageId },
            attributes: ['id', 'shop_id', 'platform', 'meta_asset_id', 'display_name', 'status', 'created_at', 'updated_at']
        });

        return res.json({
            success: true,
            pageId,
            channel: channel ? {
                found: true,
                id: channel.id,
                shop_id: channel.shop_id,
                channel_type: channel.channel_type,
                is_active: channel.is_active,
                created_at: channel.created_at,
                updated_at: channel.updated_at
            } : { found: false },
            integration: integration ? {
                found: true,
                id: integration.id,
                shop_id: integration.shop_id,
                platform: integration.platform,
                display_name: integration.display_name,
                status: integration.status,
                created_at: integration.created_at,
                updated_at: integration.updated_at
            } : { found: false }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Manually re-subscribe a channel to Meta webhooks and sync MetaIntegration.
 * Fixes the case where the automatic subscription during OAuth connect failed silently.
 *
 * Root-cause note: dbChannel.access_token is returned ALREADY DECRYPTED by the
 * Sequelize AES-256-CBC getter on Channel.entity.js. Calling metaService.decryptToken()
 * on it would try to re-decrypt plaintext as AES-256-GCM and always throw.
 * We must use dbChannel.access_token directly.
 */
const subscribeChannelToWebhooks = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { id } = req.params;
        const metaService = require('../integration/meta.service');
        const MetaIntegration = require('../integration/meta-integration.entity');
        const { Channel } = require('../entities');

        const dbChannel = await Channel.findOne({ where: { id, shop_id: shopId } });
        if (!dbChannel) {
            return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Channel not found' } });
        }
        if (!dbChannel.access_token) {
            return res.status(400).json({ success: false, error: { code: 'MISSING_TOKEN', message: 'Channel has no access token — please reconnect via OAuth' } });
        }
        if (!dbChannel.page_id) {
            return res.status(400).json({ success: false, error: { code: 'MISSING_PAGE_ID', message: 'Channel has no page_id — please reconnect via OAuth' } });
        }

        // dbChannel.access_token is already plaintext — the Sequelize getter (AES-256-CBC)
        // decrypts it automatically. Do NOT call metaService.decryptToken() here.
        const accessToken = dbChannel.access_token;

        const platformMap = { messenger: 'facebook', instagram: 'instagram' };
        const platform = platformMap[dbChannel.channel_type] || 'facebook';
        const pageId = dbChannel.page_id;

        // 1. Ensure MetaIntegration row exists and is CONNECTED so the webhook handler
        //    can route incoming messages to this shop.
        await metaService.upsertIntegration(shopId, platform, pageId, dbChannel.settings?.display_name || platform, accessToken);

        // 2. Subscribe the page to Meta webhooks (messages, postbacks, etc.)
        let subscriptionResult = null;
        let subscriptionError = null;
        try {
            subscriptionResult = await metaService.subscribeToWebhooks(accessToken, pageId, platform);
        } catch (subErr) {
            subscriptionError = subErr.message;
            console.error(`[subscribeChannelToWebhooks] Subscription call to Meta failed for page ${pageId}:`, subErr.message);
        }

        // 3. Verify subscription is live by querying Meta directly
        let metaSubscriptionStatus = null;
        try {
            const axios = require('axios');
            const verifyRes = await axios.get(
                `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps`,
                { params: { access_token: accessToken, fields: 'id,name' } }
            );
            metaSubscriptionStatus = verifyRes.data;
        } catch (verifyErr) {
            console.warn(`[subscribeChannelToWebhooks] Could not verify subscription for page ${pageId}:`, verifyErr.message);
        }

        const isSubscribed = metaSubscriptionStatus?.data?.length > 0;

        res.status(200).json({
            success: true,
            message: subscriptionError
                ? `MetaIntegration synced but webhook subscription failed: ${subscriptionError}`
                : isSubscribed
                    ? 'Webhook subscribed and verified with Meta.'
                    : 'Subscription call succeeded but Meta reports no active subscriptions — check the webhook URL in your Facebook App Dashboard.',
            data: {
                channel_id: id,
                page_id: pageId,
                platform,
                meta_subscription_active: isSubscribed,
                meta_subscribed_apps: metaSubscriptionStatus?.data || [],
                subscription_error: subscriptionError || null
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Fire a synthetic message through the full pipeline to verify the backend works
 * end-to-end without needing Meta to deliver a real webhook.
 * Returns conversation_id if created — proves the DB pipeline is healthy.
 */
const testChannelPipeline = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        const { id } = req.params;
        const { Channel } = require('../entities');
        const MetaIntegration = require('../integration/meta-integration.entity');

        const dbChannel = await Channel.findOne({ where: { id, shop_id: shopId } });
        if (!dbChannel) {
            return res.status(404).json({ success: false, error: { message: 'Channel not found' } });
        }

        const platformMap = { messenger: 'facebook', instagram: 'instagram' };
        const platform = platformMap[dbChannel.channel_type] || 'facebook';

        // Check MetaIntegration exists
        const integration = await MetaIntegration.findOne({
            where: { shop_id: shopId, platform, status: 'CONNECTED' },
            attributes: ['id', 'meta_asset_id', 'status']
        });

        const { storeIncomingMessage } = require('../integration/meta-webhook.routes');

        // Fire a synthetic message through the real pipeline
        const fakeEvent = {
            platform,
            shop_id: shopId,
            sender: `test_user_${Date.now()}`,
            message: 'Pipeline test message — safe to delete',
            attachments: [],
            timestamp: new Date(),
            raw_event: { message: { mid: `test_mid_${Date.now()}` } }
        };

        const result = await storeIncomingMessage(fakeEvent);

        res.json({
            success: true,
            pipeline_ok: true,
            meta_integration: integration
                ? { found: true, meta_asset_id: integration.meta_asset_id, status: integration.status }
                : { found: false, hint: 'MetaIntegration record missing — disconnect and reconnect the channel' },
            created: {
                customer_id: result.customer_id,
                conversation_id: result.conversation_id,
                message_id: result.message_id
            },
            next_step: integration
                ? 'Backend pipeline works. If real messages still dont arrive, the issue is in the Facebook App Dashboard — verify the webhook URL https://api.easymod.tech/webhooks/meta/ is saved and verified there.'
                : 'MetaIntegration record is missing. Disconnect and reconnect the channel via OAuth.'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            pipeline_ok: false,
            error: error.message,
            hint: 'Backend pipeline failed. Share this error for further debugging.'
        });
    }
};

module.exports = {
    // RESTful methods
    getChannels,
    getChannelById,
    createChannelRest,
    updateChannelById,
    deleteChannelById,
    connectChannelByType,
    disconnectChannelById,
    getExpiringTokens,
    debugChannelByPageId,
    subscribeChannelToWebhooks,
    testChannelPipeline,
    // Bug #10: unified full config (connection + AI behaviour) in one call
    getChannelFullConfig: async (req, res, next) => {
        try {
            const { shopId } = req.user;
            const { id } = req.params;
            const config = await channelService.getChannelFullConfig(id, req.user.userId, shopId);
            res.json({ success: true, data: config });
        } catch (error) {
            next(error);
        }
    },
    // Legacy methods for backward compatibility
    getChannelsLegacy,
    createChannel,
    updateChannel,
    deleteChannel,
    getChannelConfig
};
