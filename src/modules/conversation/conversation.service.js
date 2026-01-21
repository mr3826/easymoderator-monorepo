const { Conversation, Message, Shop, Customer } = require('../entities');
const { Op } = require('sequelize');

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

    async createConversation(shopId, conversationData) {
        try {
            const conversation = await Conversation.create({
                ...conversationData,
                shop_id: shopId,
                status: conversationData.status || 'active'
            });

            return conversation;
        } catch (error) {
            throw new Error(`Failed to create conversation: ${error.message}`);
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