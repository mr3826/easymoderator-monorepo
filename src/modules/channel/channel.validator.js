const Joi = require('joi');

class ChannelValidator {
    createChannel = {
        body: Joi.object({
            name: Joi.string().trim().required().max(255).messages({
                'string.empty': 'Channel name is required',
                'string.max': 'Channel name must not exceed 255 characters',
                'any.required': 'Channel name is required'
            }),
            type: Joi.string().valid('facebook', 'whatsapp', 'telegram', 'webchat').required().messages({
                'any.only': 'Channel type must be one of: facebook, whatsapp, telegram, webchat',
                'any.required': 'Channel type is required'
            }),
            config: Joi.object().optional()
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
            name: Joi.string().trim().optional().max(255).messages({
                'string.max': 'Channel name must not exceed 255 characters'
            }),
            config: Joi.object().optional().messages({
                'object.base': 'Config must be an object'
            })
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
}

module.exports = new ChannelValidator();