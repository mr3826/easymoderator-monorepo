'use strict';

/**
 * comment-to-dm.controller.js
 *
 * REST endpoints for the Comment-to-DM feature:
 *   GET  /api/comment-to-dm/events            — list shop's events (paginated)
 *   GET  /api/comment-to-dm/events/:id        — single event detail
 *   GET  /api/comment-to-dm/settings/:channelId — read settings from MetaChannelSettings
 *   PUT  /api/comment-to-dm/settings/:channelId — update comment-to-dm settings
 *
 * Auth: all endpoints require authenticated shop context (shop_id from request).
 * Authorization: events/settings scoped to req.user.shopId.
 */

const { Op } = require('sequelize');
const { createLogger } = require('../../utils/structured-logger');
const CommentToDmEvent = require('./comment-to-dm.entity');
const MetaChannelSettings = require('../channel-providers/meta-channel-settings.entity');
const MetaChannel = require('../channel-providers/meta-channel.entity');
const { getLiveSellingSettings, updateLiveSellingSettings } = require('./live-selling-settings');

const logger = createLogger('CommentToDmController');

/**
 * GET /api/comment-to-dm/events
 * Query params: status, limit (max 100), cursor (ISO timestamp for cursor pagination)
 */
async function listEvents(req, res) {
    try {
        const shopId = req.user.shopId;
        const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
        const status = req.query.status || null;
        const cursor = req.query.cursor || null;

        const where = { shop_id: shopId };
        if (status) where.state = status;
        if (cursor) {
            where.created_at = { [Op.lt]: new Date(cursor) };
        }

        const rows = await CommentToDmEvent.findAll({
            where,
            order: [['created_at', 'DESC']],
            limit: limit + 1,
        });

        const hasMore = rows.length > limit;
        const data    = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? data[data.length - 1].created_at?.toISOString() : null;

        return res.json({
            success: true,
            data:    data.map(serializeEvent),
            pagination: { limit, hasMore, nextCursor },
        });
    } catch (err) {
        logger.error('CommentToDm listEvents error', { error: err.message });
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * GET /api/comment-to-dm/events/:id
 */
async function getEvent(req, res) {
    try {
        const shopId  = req.user.shopId;
        const eventId = req.params.id;

        const event = await CommentToDmEvent.findOne({
            where: { id: eventId, shop_id: shopId },
        });
        if (!event) {
            return res.status(404).json({ success: false, error: 'Event not found' });
        }
        return res.json({ success: true, data: serializeEvent(event) });
    } catch (err) {
        logger.error('CommentToDm getEvent error', { error: err.message });
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * GET /api/comment-to-dm/settings/:channelId
 */
async function getSettings(req, res) {
    try {
        const shopId    = req.user.shopId;
        const channelId = req.params.channelId;

        // Verify channel belongs to this shop
        const channel = await MetaChannel.findOne({ where: { id: channelId, shop_id: shopId } });
        if (!channel) {
            return res.status(404).json({ success: false, error: 'Channel not found' });
        }

        const settings = await MetaChannelSettings.findOne({ where: { channel_id: channelId } });
        if (!settings) {
            return res.status(404).json({ success: false, error: 'Settings not found' });
        }

        return res.json({ success: true, data: serializeSettings(settings) });
    } catch (err) {
        logger.error('CommentToDm getSettings error', { error: err.message });
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * PUT /api/comment-to-dm/settings/:channelId
 * Body: { comment_to_dm_enabled, comment_to_dm_keywords, comment_to_dm_post_filter }
 */
async function updateSettings(req, res) {
    try {
        const shopId    = req.user.shopId;
        const channelId = req.params.channelId;

        // Verify ownership
        const channel = await MetaChannel.findOne({ where: { id: channelId, shop_id: shopId } });
        if (!channel) {
            return res.status(404).json({ success: false, error: 'Channel not found' });
        }

        const settings = await MetaChannelSettings.findOne({ where: { channel_id: channelId } });
        if (!settings) {
            return res.status(404).json({ success: false, error: 'Settings not found' });
        }

        const allowed = ['comment_to_dm_enabled', 'comment_to_dm_keywords', 'comment_to_dm_post_filter'];
        const updates = {};
        for (const key of allowed) {
            if (req.body[key] !== undefined) {
                updates[key] = req.body[key];
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: 'No valid fields to update' });
        }

        // Validate keywords is an array of strings
        if (updates.comment_to_dm_keywords !== undefined) {
            if (!Array.isArray(updates.comment_to_dm_keywords)) {
                return res.status(400).json({ success: false, error: 'comment_to_dm_keywords must be an array' });
            }
        }
        if (updates.comment_to_dm_post_filter !== undefined) {
            if (!Array.isArray(updates.comment_to_dm_post_filter)) {
                return res.status(400).json({ success: false, error: 'comment_to_dm_post_filter must be an array' });
            }
        }
        const finalEnabled = updates.comment_to_dm_enabled !== undefined
            ? updates.comment_to_dm_enabled
            : settings.comment_to_dm_enabled;
        const finalKeywords = updates.comment_to_dm_keywords !== undefined
            ? updates.comment_to_dm_keywords
            : (settings.comment_to_dm_keywords || []);
        if (finalEnabled === true && finalKeywords.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'comment_to_dm_keywords must contain at least one trigger keyword when comment-to-DM is enabled'
            });
        }

        await settings.update(updates);

        logger.info('CommentToDm settings updated', { channelId, shopId, updates: Object.keys(updates) });
        return res.json({ success: true, data: serializeSettings(settings) });
    } catch (err) {
        logger.error('CommentToDm updateSettings error', { error: err.message });
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * GET /api/comment-to-dm/live-selling
 * Per-shop live-selling capture settings (shop.settings.live_selling).
 */
async function getLiveSelling(req, res) {
    try {
        const shopId = req.user.shopId;
        const settings = await getLiveSellingSettings(shopId);
        return res.json({ success: true, data: settings });
    } catch (err) {
        logger.error('CommentToDm getLiveSelling error', { error: err.message });
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
}

/**
 * PUT /api/comment-to-dm/live-selling
 * Body: { enabled?: boolean, intent_keywords?: string[] }
 */
async function updateLiveSelling(req, res) {
    try {
        const shopId = req.user.shopId;
        const { enabled, intent_keywords } = req.body;

        if (enabled !== undefined && typeof enabled !== 'boolean') {
            return res.status(400).json({ success: false, error: 'enabled must be a boolean' });
        }
        if (intent_keywords !== undefined && !Array.isArray(intent_keywords)) {
            return res.status(400).json({ success: false, error: 'intent_keywords must be an array' });
        }
        if (enabled === undefined && intent_keywords === undefined) {
            return res.status(400).json({ success: false, error: 'No valid fields to update' });
        }

        const updated = await updateLiveSellingSettings(shopId, { enabled, intent_keywords });
        logger.info('CommentToDm live-selling settings updated', { shopId, enabled: updated.enabled });
        return res.json({ success: true, data: updated });
    } catch (err) {
        const status = err.statusCode || 500;
        logger.error('CommentToDm updateLiveSelling error', { error: err.message });
        return res.status(status).json({ success: false, error: status === 500 ? 'Internal server error' : err.message });
    }
}

// ── Serializers ───────────────────────────────────────────────────────────────

function serializeEvent(event) {
    return {
        id:                  event.id,
        shopId:              event.shop_id,
        channelId:           event.channel_id,
        platform:            event.platform,
        postId:              event.post_id,
        commentId:           event.comment_id,
        parentCommentId:     event.parent_comment_id,
        commenterExternalId: event.commenter_external_id,
        commenterName:       event.commenter_name,
        commentText:         event.comment_text,
        matchedKeyword:      event.matched_keyword,
        state:               event.state,
        customerId:          event.customer_id,
        conversationId:      event.conversation_id,
        lastTransitionAt:    event.last_transition_at,
        lastError:           event.last_error,
        metadata:            event.metadata,
        createdAt:           event.created_at,
        updatedAt:           event.updated_at,
    };
}

function serializeSettings(settings) {
    return {
        channelId:              settings.channel_id,
        commentToDmEnabled:     settings.comment_to_dm_enabled,
        commentToDmKeywords:    settings.comment_to_dm_keywords,
        commentToDmPostFilter:  settings.comment_to_dm_post_filter,
        automationMode:         settings.automation_mode,
        updatedAt:              settings.updated_at,
    };
}

module.exports = { listEvents, getEvent, getSettings, updateSettings, getLiveSelling, updateLiveSelling };
