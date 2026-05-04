const conversationService = require('./conversation.service');
const { sendEscalationAutoReply } = require('./escalation-auto-reply.service');
const cacheService = require('../../utils/cache.service');
const sseManager = require('../../utils/sse-manager');
const { cacheRedis } = require('../../config/redis');
const { Conversation: ConvModel, Customer: CustomerModel } = require('../entities');
const MetaIntegration = require('../integration/meta-integration.entity');
const metaService = require('../integration/meta.service');

const AI_PAUSE_TTL_SECS = 1800; // 30 minutes

// Channels that route through Meta Graph API for delivery
const META_CHANNEL_PLATFORM = {
    messenger: 'facebook',
    facebook:  'facebook',
    instagram: 'instagram',
    whatsapp:  'whatsapp',
};

/**
 * Deliver an outbound message to the customer's Meta channel.
 * Looks up the conversation → customer channel_user_id → integration → sends via Graph API.
 * Best-effort: never throws. Emits SSE `delivery_failed` event so agents see a warning toast
 * when their reply doesn't reach the customer on Messenger/Instagram/WhatsApp.
 */
async function deliverViaMetaIfApplicable(conversationId, shopId, content) {
    let isMetaChannel = false;
    let failureReason = null;
    try {
        const conversation = await ConvModel.findOne({
            where: { id: conversationId, shop_id: shopId },
            include: [{ model: CustomerModel, as: 'customer' }]
        });
        if (!conversation) return;

        const platform = META_CHANNEL_PLATFORM[conversation.channel];
        if (!platform) return; // webchat/telegram — no Meta delivery expected

        isMetaChannel = true; // past this point: failures should surface to the agent

        const recipientId = conversation.customer?.channel_user_id;
        if (!recipientId) {
            failureReason = 'Customer Meta ID missing — message saved but not delivered to Messenger';
            return;
        }

        const integration = await MetaIntegration.findOne({
            where: { shop_id: shopId, platform, status: 'CONNECTED' }
        });
        if (!integration) {
            failureReason = `No active ${platform} integration — connect your page in Settings → Channels`;
            return;
        }

        if (integration.token_expires_at && new Date(integration.token_expires_at) < new Date()) {
            failureReason = 'Access token expired — reconnect the channel in Settings → Channels';
            return;
        }

        const accessToken = metaService.decryptToken(integration.access_token);
        await metaService.sendTextMessage(platform, accessToken, recipientId, content);
        console.log(`[inbox] Message delivered via ${platform} to ${recipientId} (conv: ${conversationId})`);
    } catch (err) {
        failureReason = err.message;
        console.error(`[inbox] Meta delivery failed for conversation ${conversationId}: ${err.message}`);
    } finally {
        if (isMetaChannel && failureReason) {
            sseManager.emit(shopId, 'delivery_failed', {
                conversation_id: conversationId,
                reason: failureReason
            });
        }
    }
}

class ConversationController {
    async getConversations(req, res, next) {
        try {
            const shopId = req.body?.shopId || req.headers['x-shop-id'] || req.user?.shopId;

            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
                });
            }

            const options = req.query;
            const result = await conversationService.getConversations(shopId, options);

            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }

    async getConversationById(req, res, next) {
        try {
            const { conversationId } = req.params;
            const shopId = req.body?.shopId || req.headers['x-shop-id'] || req.user?.shopId;

            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
                });
            }

            const conversation = await conversationService.getConversationById(conversationId, shopId);
            res.json({ success: true, data: conversation });
        } catch (error) {
            next(error);
        }
    }

    async getMessages(req, res, next) {
        try {
            const { conversationId } = req.params;
            const shopId = req.body?.shopId || req.headers['x-shop-id'] || req.user?.shopId;

            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
                });
            }

            const result = await conversationService.getMessages(conversationId, shopId, req.query);
            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }

    async createConversation(req, res) {
        try {
            const shopId = req.body?.shopId || req.headers['x-shop-id'] || req.user?.shopId;
            
            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Shop ID is required'
                    }
                });
            }
            const {
                customer_id,
                channel_type,
                channel,
                role,
                message,
                normalized_message,
                intent,
                intent_confidence,
                title,
                status,
                entities,
                response_metadata
            } = req.body;

            const resolvedChannel = channel_type || channel;

            const conversationData = {
                customer_id,
                channel: resolvedChannel,
                role,
                message,
                intent: intent || null,
                confidence: intent_confidence ? Math.round(intent_confidence * 100) : null,
                llm_used: Boolean(response_metadata && response_metadata.ai_model),
                cache_hit: Boolean(response_metadata && response_metadata.cache_hit),
                keyword_match: Boolean(response_metadata && response_metadata.keyword_match),
                metadata: {
                    normalized_message: normalized_message || null,
                    entities: entities || {},
                    response_metadata: response_metadata || {},
                    title: title || null,
                    status: status || null
                }
            };

            const conversation = await conversationService.createConversation(shopId, conversationData);

            res.status(201).json({
                conversation_id: conversation.id,
                created_at: conversation.created_at
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'CONVERSATION_CREATE_FAILED',
                    message: error.message
                }
            });
        }
    }

    async createMessage(req, res) {
        try {
            const { conversationId } = req.params; // Already validated
            const shopId = req.body?.shopId || req.headers['x-shop-id'] || req.user?.shopId;
            
            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Shop ID is required'
                    }
                });
            }
            const messageData = req.body; // Already validated

            const message = await conversationService.createMessage(conversationId, shopId, messageData);

            // Push real-time update to all open agent tabs for this shop
            sseManager.emit(shopId, 'new_message', { conversation_id: conversationId, message });

            // AI pause: when a human agent sends a message, mute AI replies for 30 min.
            // Frontend sends sender='agent'; service maps it to 'business' in DB — check both.
            const sender = messageData.sender || req.body.sender;
            if (sender === 'agent' || sender === 'business') {
                cacheRedis.setex(`ai:pause:${conversationId}`, AI_PAUSE_TTL_SECS, '1').catch(() => {});
                // Deliver agent reply to customer via Meta Graph API (fire-and-forget)
                deliverViaMetaIfApplicable(conversationId, shopId, message.content);
            }

            res.status(201).json({
                success: true,
                data: message
            });
        } catch (error) {
            const statusCode = error.message === 'Conversation not found' ? 404 : 500;
            const errorCode = statusCode === 404 ? 'CONVERSATION_NOT_FOUND' : 'MESSAGE_CREATE_FAILED';

            res.status(statusCode).json({
                success: false,
                error: {
                    code: errorCode,
                    message: error.message
                }
            });
        }
    }

    async updateConversation(req, res) {
        try {
            const { conversationId } = req.params;
            const shopId = req.body?.shopId || req.headers['x-shop-id'] || req.user?.shopId;

            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
                });
            }

            const { hitl, status, assignee_id, resolution_note } = req.body;
            const conversation = await conversationService.updateConversation(
                conversationId,
                shopId,
                { hitl, status, assignee_id, resolution_note }
            );

            // Notify other agent tabs of HITL change first so the banner appears immediately
            if (hitl !== undefined) {
                sseManager.emit(shopId, 'hitl_changed', {
                    conversation_id: conversationId,
                    hitl: conversation.hitl
                });
            }

            // Send escalation auto-reply synchronously so the agent response only returns
            // after the customer notification attempt is complete (success or logged failure).
            if (hitl === true) {
                try {
                    const autoReplyMsg = await sendEscalationAutoReply(conversationId, shopId);
                    if (autoReplyMsg) {
                        sseManager.emit(shopId, 'new_message', { conversation_id: conversationId, message: autoReplyMsg });
                        await deliverViaMetaIfApplicable(conversationId, shopId, autoReplyMsg.content);
                    }
                } catch (err) {
                    // Non-fatal: HITL is already set; log and surface to the agent via SSE
                    console.error(`[escalation] Auto-reply failed for conv ${conversationId}: ${err.message}`);
                    sseManager.emit(shopId, 'delivery_failed', {
                        conversation_id: conversationId,
                        reason: `Escalation message not delivered to customer: ${err.message}`
                    });
                }
            }

            res.json({ success: true, data: conversation });
        } catch (error) {
            const statusCode = error.message === 'Conversation not found' ? 404 : 500;
            const errorCode = statusCode === 404 ? 'CONVERSATION_NOT_FOUND' : 'CONVERSATION_UPDATE_FAILED';
            res.status(statusCode).json({
                success: false,
                error: { code: errorCode, message: error.message }
            });
        }
    }

    async updateConversationStatus(req, res) {
        try {
            const { conversationId } = req.params; // Already validated
            const shopId = req.body?.shopId || req.headers['x-shop-id'] || req.user?.shopId;
            
            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Shop ID is required'
                    }
                });
            }
            const { status } = req.body; // Already validated

            const conversation = await conversationService.updateConversationStatus(conversationId, shopId, status);

            res.json({
                success: true,
                data: conversation
            });
        } catch (error) {
            const statusCode = error.message === 'Conversation not found' ? 404 : 500;
            const errorCode = statusCode === 404 ? 'CONVERSATION_NOT_FOUND' : 'CONVERSATION_UPDATE_FAILED';

            res.status(statusCode).json({
                success: false,
                error: {
                    code: errorCode,
                    message: error.message
                }
            });
        }
    }

    async getHistory(req, res) {
        try {
            const shopId = req.query?.shop_id || req.headers['x-shop-id'] || req.user?.shopId;
            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Shop ID is required'
                    }
                });
            }

            const { customer_id, limit, within_hours } = req.query;
            if (!customer_id) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'customer_id is required'
                    }
                });
            }

            const entries = await conversationService.getHistoryByCustomer(shopId, customer_id, {
                limit,
                within_hours
            });

            const conversations = entries.map(entry => ({
                id: entry.id,
                role: entry.role,
                message: entry.message,
                normalized_message: entry.metadata?.normalized_message || null,
                intent: entry.intent || null,
                timestamp: entry.created_at,
                metadata: entry.metadata || {}
            }));

            res.status(200).json({
                conversations,
                total: entries.length
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'CONVERSATION_HISTORY_FAILED',
                    message: error.message
                }
            });
        }
    }

    getEventStream(req, res) {
        const shopId = req.headers['x-shop-id'] || req.query.shop_id || req.user?.shopId;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
            });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        // Disable nginx/proxy buffering so events arrive immediately
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        sseManager.register(shopId, res);

        // Heartbeat keeps the connection alive through idle proxies (25s < 30s proxy timeout)
        const heartbeat = setInterval(() => {
            try { res.write(':heartbeat\n\n'); } catch (_) {}
        }, 25000);

        req.on('close', () => {
            clearInterval(heartbeat);
            sseManager.unregister(shopId, res);
        });
    }

    async checkDuplicate(req, res) {
        try {
            const { message_id, customer_id, timestamp } = req.body;
            if (!message_id || !customer_id) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'message_id and customer_id are required'
                    }
                });
            }

            const key = `dedup:${customer_id}:${message_id}`;
            const existing = await cacheService.get(key);

            if (existing) {
                return res.status(200).json({
                    is_duplicate: true,
                    original_timestamp: existing
                });
            }

            const originalTimestamp = timestamp || new Date().toISOString();
            await cacheService.set(key, originalTimestamp, 86400);

            res.status(200).json({
                is_duplicate: false,
                original_timestamp: null
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'DEDUP_CHECK_FAILED',
                    message: error.message
                }
            });
        }
    }
    /**
     * B3: Bulk update status for multiple conversations.
     * PATCH /conversations/bulk-status
     * Body: { conversationIds: [], status: '' }
     */
    async bulkUpdateStatus(req, res) {
        try {
            const shopId = req.body?.shopId || req.headers['x-shop-id'] || req.user?.shopId;
            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
                });
            }

            const { conversationIds, status } = req.body;
            const result = await conversationService.bulkUpdateStatus(shopId, conversationIds, status);

            res.json({ success: true, data: result });
        } catch (error) {
            const statusCode = error.statusCode || 500;
            res.status(statusCode).json({
                success: false,
                error: { code: 'BULK_UPDATE_FAILED', message: error.message }
            });
        }
    }

    /**
     * Bug #2: Full-history inbox search.
     * GET /conversations/search?q=<query>&page=1&limit=20
     */
    async searchConversations(req, res) {
        try {
            const shopId = req.headers['x-shop-id'] || req.user?.shopId;
            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
                });
            }
            const { q, page, limit } = req.query;
            if (!q) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'q (search query) is required' }
                });
            }
            const results = await conversationService.searchConversations(shopId, q, { page, limit });
            res.json({ success: true, data: results });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: { code: 'SEARCH_FAILED', message: error.message }
            });
        }
    }
}

module.exports = new ConversationController();
