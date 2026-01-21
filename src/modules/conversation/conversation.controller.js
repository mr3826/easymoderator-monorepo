const conversationService = require('./conversation.service');

class ConversationController {
    async getConversations(req, res) {
        try {
            const shopId = req.shop.id;
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
            const shopId = req.shop.id;

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
            const shopId = req.shop.id;
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
            const shopId = req.shop.id;
            const conversationData = req.body; // Already validated

            const conversation = await conversationService.createConversation(shopId, conversationData);

            res.status(201).json({
                success: true,
                data: conversation
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
            const shopId = req.shop.id;
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
            const shopId = req.shop.id;
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
}

module.exports = new ConversationController();