const Joi = require('joi');

class ChannelValidator {
    createChannel = {
        body: Joi.object({
            channel_type: Joi.string().valid('messenger', 'whatsapp', 'instagram').optional(),
            type: Joi.string().valid('facebook', 'whatsapp', 'instagram').optional(),
            name: Joi.string().trim().optional(),
            page_id: Joi.string().trim().optional().max(100),
            access_token: Joi.string().trim().optional(),
            systemUserToken: Joi.string().trim().optional(),
            businessManagerId: Joi.string().trim().optional(),
            verify_token: Joi.string().trim().optional(),
            webhook_secret: Joi.string().trim().optional(),
            config: Joi.object().optional(),
            settings: Joi.object().optional()
        }).custom((value, helpers) => {
            const hasLegacy = Boolean(value.channel_type && value.page_id && value.access_token);
            const hasFrontend = Boolean(value.type && value.systemUserToken);

            if (!hasLegacy && !hasFrontend) {
                return helpers.message('channel_type/page_id/access_token or type/systemUserToken is required');
            }

            return value;
        })
    };

    updateChannel = {
        params: Joi.object({
            id: Joi.string().uuid().required().messages({
                'string.uuid': 'Channel ID must be a valid UUID',
                'any.required': 'Channel ID is required'
            })
        }),
        body: Joi.object({
            page_id: Joi.string().trim().optional().max(100),
            access_token: Joi.string().trim().optional(),
            systemUserToken: Joi.string().trim().optional(),
            businessManagerId: Joi.string().trim().optional(),
            verify_token: Joi.string().trim().optional(),
            webhook_secret: Joi.string().trim().optional(),
            settings: Joi.object().optional().messages({
                'object.base': 'Settings must be an object'
            }),
            config: Joi.object().optional(),
            is_active: Joi.boolean().optional()
        })
    };

    getChannels = {
        query: Joi.object({
            page: Joi.number().integer().min(1).default(1),
            limit: Joi.number().integer().min(1).max(100).default(20)
        })
    };

    getChannelById = {
        params: Joi.object({
            id: Joi.string().uuid().required().messages({
                'string.uuid': 'Channel ID must be a valid UUID',
                'any.required': 'Channel ID is required'
            })
        })
    };

    deleteChannel = {
        params: Joi.object({
            id: Joi.string().uuid().required().messages({
                'string.uuid': 'Channel ID must be a valid UUID',
                'any.required': 'Channel ID is required'
            })
        })
    };

    connectChannel = {
        body: Joi.object({
            channel_type: Joi.string().valid('messenger', 'whatsapp', 'instagram').optional(),
            type: Joi.string().valid('facebook', 'whatsapp', 'instagram').optional(),
            name: Joi.string().trim().optional(),
            page_id: Joi.string().trim().optional().max(100),
            access_token: Joi.string().trim().optional(),
            systemUserToken: Joi.string().trim().optional(),
            businessManagerId: Joi.string().trim().optional(),
            verify_token: Joi.string().trim().optional(),
            webhook_secret: Joi.string().trim().optional(),
            config: Joi.object().optional(),
            settings: Joi.object().optional()
        }).custom((value, helpers) => {
            const hasLegacy = Boolean(value.channel_type && value.page_id && value.access_token);
            const hasFrontend = Boolean(value.type && value.systemUserToken);

            if (!hasLegacy && !hasFrontend) {
                return helpers.message('channel_type/page_id/access_token or type/systemUserToken is required');
            }

            return value;
        })
    };

    disconnectChannel = {
        params: Joi.object({
            id: Joi.string().uuid().required().messages({
                'string.uuid': 'Channel ID must be a valid UUID',
                'any.required': 'Channel ID is required'
            })
        })
    };
}

module.exports = new ChannelValidator();
