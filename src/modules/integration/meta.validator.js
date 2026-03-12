const Joi = require('joi');

const disconnectSchema = Joi.object({
  platform: Joi.string()
    .valid('facebook', 'instagram', 'whatsapp')
    .required()
    .messages({
      'any.only': 'Platform must be one of: facebook, instagram, whatsapp',
      'any.required': 'Platform is required'
    })
});

const manualConnectSchema = Joi.object({
  platform: Joi.string()
    .valid('facebook', 'instagram', 'whatsapp')
    .required(),
  asset_id: Joi.string().required(),
  display_name: Joi.string().allow('', null),
  access_token: Joi.string().required(),
  app_id: Joi.string().allow('', null),
  app_secret: Joi.string().min(10).allow('', null).messages({
    'string.min': 'app_secret must be at least 10 characters when provided'
  })
});

module.exports = {
  disconnectSchema,
  manualConnectSchema
};
