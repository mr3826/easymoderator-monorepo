const Joi = require('joi');

class ConversationValidator {
    getConversations = {
        query: Joi.object({
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(20),
            status: Joi.string().valid('active', 'closed', 'archived'),
            channel: Joi.string().valid('telegram', 'messenger', 'instagram', 'web', 'webchat')
        })
    };

    getMessages = {
        params: Joi.object({
            conversationId: Joi.string().uuid().required()
        }),
        query: Joi.object({
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(50)
        })
    };

    createConversation = {
        body: Joi.object({
            customer_id: Joi.string().uuid().required(),
            channel: Joi.string().valid('telegram', 'messenger', 'instagram', 'web', 'webchat').optional(),
            channel_type: Joi.string().valid('telegram', 'messenger', 'instagram', 'web', 'webchat').optional(),
            role: Joi.string().valid('user', 'assistant', 'system').default('user'),
            message: Joi.string().required(),
            title: Joi.string().max(255),
            status: Joi.string().valid('active', 'closed', 'archived').default('active'),
            intent: Joi.string().max(50).optional(),
            intent_confidence: Joi.number().min(0).max(1).optional(),
            normalized_message: Joi.string().optional(),
            entities: Joi.object().optional(),
            response_metadata: Joi.object().optional(),
            metadata: Joi.object()
        }).or('channel', 'channel_type')
    };

    createMessage = {
        params: Joi.object({
            conversationId: Joi.string().uuid().required()
        }),
        body: Joi.object({
            content: Joi.string().required(),
            sender: Joi.string().valid('customer', 'agent', 'ai').required(),
            message_type: Joi.string().valid('text', 'image', 'file', 'location').default('text'),
            metadata: Joi.object(),
            ai_suggestion: Joi.string(),
            ai_confidence: Joi.number().min(0).max(1),
            message_tag: Joi.string().valid(
                'CONFIRMED_EVENT_UPDATE',
                'POST_PURCHASE_UPDATE',
                'ACCOUNT_UPDATE'
            ).optional()
        })
    };

    updateConversation = {
        params: Joi.object({
            conversationId: Joi.string().uuid().required()
        }),
        body: Joi.object({
            hitl: Joi.boolean(),
            status: Joi.string().valid('active', 'closed', 'archived'),
            assignee_id: Joi.string().uuid().allow(null),
            resolution_note: Joi.string().max(1000).allow('', null)
        }).min(1)
    };

    updateConversationStatus = {
        params: Joi.object({
            conversationId: Joi.string().uuid().required()
        }),
        body: Joi.object({
            status: Joi.string().valid('active', 'closed', 'archived').required()
        })
    };
}

module.exports = new ConversationValidator();
