const Joi = require('joi');

const disconnectSchema = Joi.object({
  platform: Joi.string()
    .valid('messenger', 'instagram', 'whatsapp')
    .required()
    .messages({
      'any.only': 'Platform must be one of: messenger, instagram, whatsapp',
      'any.required': 'Platform is required'
    })
});

const connectQuerySchema = Joi.object({
  platform: Joi.string()
    .valid('messenger', 'instagram', 'whatsapp')
    .required()
    .messages({
      'any.only': 'Platform must be one of: messenger, instagram, whatsapp',
      'any.required': 'Platform query parameter is required'
    })
});

module.exports = {
  disconnectSchema,
  connectQuerySchema
};