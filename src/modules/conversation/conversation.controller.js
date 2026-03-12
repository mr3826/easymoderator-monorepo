const conversationService = require('./conversation.service');
const cacheService = require('../../utils/cache.service');

class ConversationController {
    async getConversations(req, res) {
        try {
            // Get shopId from header or body
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

            const options = req.query; // Already validated by Joi

            const result = await conversationService.getConversations(shopId, options);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'CONVERSATION_FETCH_FAILED',
                    message: error.message
                }
            });
        }
    }

    async getConversationById(req, res) {
        try {
            const { conversationId } = req.params; // Already validated
            // Get shopId from header or body
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

            const conversation = await conversationService.getConversationById(conversationId, shopId);

            res.json({
                success: true,
                data: conversation
            });
        } catch (error) {
            const statusCode = error.message === 'Conversation not found' ? 404 : 500;
            const errorCode = statusCode === 404 ? 'CONVERSATION_NOT_FOUND' : 'CONVERSATION_FETCH_FAILED';

            res.status(statusCode).json({
                success: false,
                error: {
                    code: errorCode,
                    message: error.message
                }
            });
        }
    }

    async getMessages(req, res) {
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
            const options = req.query; // Already validated

            const result = await conversationService.getMessages(conversationId, shopId, options);

            res.json({
                success: true,
                data: result
            });
        } catch (error) {
            const statusCode = error.message === 'Conversation not found' ? 404 : 500;
            const errorCode = statusCode === 404 ? 'CONVERSATION_NOT_FOUND' : 'MESSAGES_FETCH_FAILED';

            res.status(statusCode).json({
                success: false,
                error: {
                    code: errorCode,
                    message: error.message
                }
            });
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
}

module.exports = new ConversationController();
