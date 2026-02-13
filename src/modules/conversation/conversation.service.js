const { Conversation, Message, Customer } = require('../entities');
const { Op } = require('sequelize');
const subscriptionService = require('../subscription/subscription.service');
const { createLogger } = require('../../utils/structured-logger');
const { AppError } = require('../../utils/AppError');

class ConversationService {
    mapConversation(conversation) {
        const meta = conversation.metadata || {};
        const channel = conversation.channel === 'messenger'
            ? 'facebook'
            : conversation.channel === 'web'
                ? 'webchat'
                : conversation.channel;

        return {
            id: conversation.id,
            customer_id: conversation.customer_id,
            customer: conversation.customer || null,
            channel,
            title: conversation.title || meta.title || conversation.intent || null,
            status: conversation.status || meta.status || 'active',
            lastMessage: conversation.message,
            unreadCount: meta.unreadCount || 0,
            created_at: conversation.created_at,
            updated_at: conversation.updated_at
        };
    }

    async getConversations(shopId, options = {}) {
        try {
            const { page = 1, limit = 20, channel, customer_id } = options;
            const offset = (page - 1) * limit;

            const whereClause = { shop_id: shopId };
            if (channel) whereClause.channel = channel;
            if (customer_id) whereClause.customer_id = customer_id;

            const conversations = await Conversation.findAndCountAll({
                where: whereClause,
                order: [['created_at', 'DESC']],
                limit,
                offset,
                include: [{ model: Customer, as: 'customer' }]
            });

            return {
                conversations: conversations.rows.map((row) => this.mapConversation(row)),
                pagination: {
                    total: conversations.count,
                    page,
                    limit,
                    totalPages: Math.ceil(conversations.count / limit)
                }
            };
        } catch (error) {
            throw new Error(`Failed to fetch conversations: ${error.message}`);
        }
    }

    async getConversationById(conversationId, shopId) {
        try {
            const conversation = await Conversation.findOne({
                where: {
                    id: conversationId,
                    shop_id: shopId
                },
                include: [{ model: Customer, as: 'customer' }]
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            return this.mapConversation(conversation);
        } catch (error) {
            throw new Error(`Failed to fetch conversation: ${error.message}`);
        }
    }

    async getMessages(conversationId, shopId, options = {}) {
        try {
            const { page = 1, limit = 50 } = options;
            const offset = (page - 1) * limit;

            const conversation = await Conversation.findOne({
                where: {
                    id: conversationId,
                    shop_id: shopId
                }
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const results = await Message.findAndCountAll({
                where: {
                    conversation_id: conversationId
                },
                order: [['created_at', 'ASC']],
                limit,
                offset
            });

            const messages = results.rows.map((message) => ({
                id: message.id,
                conversation_id: message.conversation_id,
                content: message.content,
                sender: message.sender === 'business' ? 'agent' : message.sender,
                message_type: 'text',
                ai_suggestion: message.ai_suggestion || null,
                ai_confidence: message.ai_confidence ? Number(message.ai_confidence) : null,
                created_at: message.created_at,
                updated_at: message.updated_at || message.created_at
            }));

            return {
                messages,
                pagination: {
                    total: results.count,
                    page,
                    limit,
                    totalPages: Math.ceil(results.count / limit)
                }
            };
        } catch (error) {
            throw new Error(`Failed to fetch messages: ${error.message}`);
        }
    }

    async createConversation(shopId, conversationData, requestId = null) {
        const logger = createLogger(requestId, shopId);
        const { sequelize } = require('../../utils/database/database-setup');
        const transaction = await sequelize.transaction();
        
        try {
            const resolvedTitle = conversationData.title
                || conversationData.intent
                || conversationData.metadata?.title
                || null;
            const resolvedStatus = conversationData.status
                || conversationData.metadata?.status
                || 'active';

            const metadata = {
                ...(conversationData.metadata || {}),
                title: resolvedTitle || conversationData.metadata?.title || null,
                status: resolvedStatus || conversationData.metadata?.status || 'active'
            };

            // Create conversation within transaction
            const conversation = await Conversation.create({
                ...conversationData,
                shop_id: shopId,
                title: resolvedTitle,
                status: resolvedStatus,
                metadata
            }, { transaction });

            // Commit transaction - NOW conversation is persisted
            await transaction.commit();

            // ATOMIC: Track usage ONLY after successful DB commit
            // Uses transaction-safe idempotent tracking with request_id
            // Usage increments ONLY on successful database persistence
            try {
                const usageResult = await subscriptionService.trackUsage(
                    shopId,
                    'conversations',
                    1,
                    requestId, // Request-scoped idempotency key - prevents double counting
                    {
                        resourceId: conversation.id,
                        channel: conversation.channel,
                        customerId: conversation.customer_id
                    }
                );
                
                logger.logUsage('conversation_created', shopId, null, {
                    conversationId: conversation.id,
                    channel: conversation.channel,
                    transactionId: usageResult.transactionId,
                    isRetry: usageResult.isRetry
                });
            } catch (usageError) {
                // CRITICAL errors: usage_limit_exceeded, validation errors
                if (usageError.code === 'USAGE_LIMIT_EXCEEDED') {
                    logger.error('Usage limit exceeded on conversation', usageError, { severity: 'critical' });
                    throw usageError;
                }
                
                // Non-critical errors: transient tracking issues don't fail conversation
                logger.error('Failed to track conversation usage', usageError, {
                    conversationId: conversation.id,
                    severity: 'warning'
                });
            }

            return conversation;
        } catch (error) {
            await transaction.rollback();
            if (error instanceof AppError) throw error;
            logger.error('Failed to create conversation', error);
            throw new AppError(`Failed to create conversation: ${error.message}`, 500);
        }
    }

    async createMessage(conversationId, shopId, messageData) {
        try {
            const conversation = await Conversation.findOne({
                where: {
                    id: conversationId,
                    shop_id: shopId
                }
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const sender = messageData.sender === 'agent'
                ? 'business'
                : messageData.sender || 'customer';

            const message = await Message.create({
                conversation_id: conversationId,
                content: messageData.content || messageData.message || '',
                sender,
                ai_suggestion: messageData.ai_suggestion || null,
                ai_confidence: messageData.ai_confidence || null,
                external_id: messageData.metadata?.external_id || null
            });

            return {
                id: message.id,
                conversation_id: message.conversation_id,
                content: message.content,
                sender: sender === 'business' ? 'agent' : sender,
                message_type: 'text',
                ai_suggestion: message.ai_suggestion || null,
                ai_confidence: message.ai_confidence ? Number(message.ai_confidence) : null,
                created_at: message.created_at,
                updated_at: message.updated_at || message.created_at
            };
        } catch (error) {
            throw new Error(`Failed to create message: ${error.message}`);
        }
    }

    async updateConversationStatus(conversationId, shopId, status) {
        try {
            const conversation = await Conversation.findOne({
                where: {
                    id: conversationId,
                    shop_id: shopId
                }
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const resolvedStatus = status || 'active';
            const metadata = {
                ...(conversation.metadata || {}),
                status: resolvedStatus
            };

            await conversation.update({ status: resolvedStatus, metadata });

            return this.mapConversation(conversation);
        } catch (error) {
            throw new Error(`Failed to update conversation status: ${error.message}`);
        }
    }

    async getHistoryByCustomer(shopId, customerId, options = {}) {
        const { limit = 10, within_hours } = options;
        const whereClause = {
            shop_id: shopId,
            customer_id: customerId
        };

        if (within_hours) {
            const since = new Date(Date.now() - Number(within_hours) * 60 * 60 * 1000);
            whereClause.created_at = {
                [Op.gte]: since
            };
        }

        const entries = await Conversation.findAll({
            where: whereClause,
            order: [['created_at', 'DESC']],
            limit: Number(limit)
        });

        return entries;
    }
}

module.exports = new ConversationService();