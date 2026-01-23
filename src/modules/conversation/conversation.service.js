const { Conversation, Message, Shop, Customer } = require('../entities');
const { Op } = require('sequelize');
const subscriptionService = require('../subscription/subscription.service');
const { createLogger } = require('../../utils/structured-logger');
const { AppError } = require('../../utils/AppError');

class ConversationService {
    async getConversations(shopId, options = {}) {
        try {
            const { page = 1, limit = 20, status, channel } = options;
            const offset = (page - 1) * limit;

            const whereClause = { shop_id: shopId };
            if (status) whereClause.status = status;
            if (channel) whereClause.channel = channel;

            const conversations = await Conversation.findAndCountAll({
                where: whereClause,
                include: [
                    {
                        model: Customer,
                        as: 'customer',
                        attributes: ['id', 'name', 'email', 'phone']
                    },
                    {
                        model: Message,
                        as: 'messages',
                        limit: 1,
                        order: [['created_at', 'DESC']],
                        attributes: ['id', 'content', 'sender', 'created_at']
                    }
                ],
                order: [['updated_at', 'DESC']],
                limit,
                offset
            });

            return {
                conversations: conversations.rows,
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
                include: [
                    {
                        model: Customer,
                        as: 'customer',
                        attributes: ['id', 'name', 'email', 'phone']
                    }
                ]
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            return conversation;
        } catch (error) {
            throw new Error(`Failed to fetch conversation: ${error.message}`);
        }
    }

    async getMessages(conversationId, shopId, options = {}) {
        try {
            const { page = 1, limit = 50 } = options;
            const offset = (page - 1) * limit;

            // First verify the conversation belongs to the shop
            const conversation = await Conversation.findOne({
                where: {
                    id: conversationId,
                    shop_id: shopId
                }
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const messages = await Message.findAndCountAll({
                where: { conversation_id: conversationId },
                order: [['created_at', 'ASC']],
                limit,
                offset
            });

            return {
                messages: messages.rows,
                pagination: {
                    total: messages.count,
                    page,
                    limit,
                    totalPages: Math.ceil(messages.count / limit)
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
            // Create conversation within transaction
            const conversation = await Conversation.create({
                ...conversationData,
                shop_id: shopId,
                status: conversationData.status || 'active'
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
            // Verify conversation belongs to shop
            const conversation = await Conversation.findOne({
                where: {
                    id: conversationId,
                    shop_id: shopId
                }
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const message = await Message.create({
                ...messageData,
                conversation_id: conversationId
            });

            // Update conversation's updated_at timestamp
            await conversation.update({ updated_at: new Date() });

            return message;
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

            await conversation.update({ status });
            return conversation;
        } catch (error) {
            throw new Error(`Failed to update conversation status: ${error.message}`);
        }
    }
}

module.exports = new ConversationService();