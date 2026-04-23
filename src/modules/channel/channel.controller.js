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
