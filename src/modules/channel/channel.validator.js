const Joi = require('joi');

// Schema-locked settings object — only known AI-behaviour keys accepted.
// This prevents prompt-injection via arbitrary JSON in the settings field.
const channelSettingsSchema = Joi.object({
    display_name:              Joi.string().trim().max(100).optional(),
    businessManagerId:         Joi.string().trim().max(64).optional(),
    aiAutoReply:               Joi.boolean().optional(),
    requireApproval:           Joi.boolean().optional(),
    businessHours:             Joi.boolean().optional(),
    allowOrderCreation:        Joi.boolean().optional(),
    autoDetectProducts:        Joi.boolean().optional(),
    draftOrdersOnly:           Joi.boolean().optional(),
    requireManualConfirmation: Joi.boolean().optional(),
}).options({ allowUnknown: false });  // reject any extra keys

class ChannelValidator {
    createChannel = {
        body: Joi.object({
            channel_type: Joi.string().valid('messenger', 'whatsapp', 'instagram').optional(),
            type: Joi.string().valid('facebook', 'whatsapp', 'instagram').optional(),
            name: Joi.string().trim().optional(),
            page_id: Joi.string().trim().optional().max(100),
            access_token: Joi.string().trim().optional(),
            systemUserToken: Joi.string().trim().optional(),
            businessManagerId: Joi.string().trim().max(64).optional(),
            verify_token: Joi.string().trim().optional(),
            webhook_secret: Joi.string().trim().optional(),
            config: channelSettingsSchema.optional(),
            settings: channelSettingsSchema.optional()
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
            businessManagerId: Joi.string().trim().max(64).optional(),
            verify_token: Joi.string().trim().optional(),
            webhook_secret: Joi.string().trim().optional(),
            settings: channelSettingsSchema.optional(),
            config: channelSettingsSchema.optional(),
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
            businessManagerId: Joi.string().trim().max(64).optional(),
            verify_token: Joi.string().trim().optional(),
            webhook_secret: Joi.string().trim().optional(),
            config: channelSettingsSchema.optional(),
            settings: channelSettingsSchema.optional()
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

    // Meta OAuth endpoints
    initiateOAuth = {
        body: Joi.object({
            channelType: Joi.string().valid('facebook', 'instagram').required().messages({
                'any.only': 'channelType must be facebook or instagram',
                'any.required': 'channelType is required'
            })
        })
    };

    oauthCallback = {
        body: Joi.object({
            code: Joi.string().trim().min(10).required().messages({
                'any.required': 'OAuth code is required'
            }),
            state: Joi.string().trim().length(64).required().messages({
                'string.length': 'Invalid state token',
                'any.required': 'State token is required'
            })
        })
    };

    connectOAuthPage = {
        body: Joi.object({
            pageId: Joi.string().trim().max(50).required().messages({
                'any.required': 'pageId is required'
            }),
            pageName: Joi.string().trim().max(200).required().messages({
                'any.required': 'pageName is required'
            }),
            tempToken: Joi.string().trim().length(64).required().messages({
                'string.length': 'Invalid temp token',
                'any.required': 'tempToken is required'
            })
        })
    };
}

module.exports = new ChannelValidator();
