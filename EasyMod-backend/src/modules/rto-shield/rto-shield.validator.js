const Joi = require('joi');

const BD_PHONE = Joi.string()
  .pattern(/^01[3-9]\d{8}$/)
  .required()
  .messages({ 'string.pattern.base': 'Must be a valid Bangladeshi mobile number (01XXXXXXXXX)' });

const addEntrySchema = {
  body: Joi.object({
    phone: BD_PHONE,
    reason: Joi.string().trim().min(3).max(255).required(),
    risk_score: Joi.number().integer().min(0).max(100).default(80),
    is_global: Joi.boolean().default(false),
    notes: Joi.string().trim().max(1000).optional().allow('')
  })
};

const checkPhoneSchema = {
  body: Joi.object({
    phone: BD_PHONE
  })
};

const bulkImportSchema = {
  body: Joi.object({
    entries: Joi.array().min(1).max(500).items(Joi.object({
      phone: BD_PHONE,
      reason: Joi.string().trim().min(3).max(255).required(),
      risk_score: Joi.number().integer().min(0).max(100).default(80)
    })).required()
  })
};

const listSchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().optional()
  })
};

const whitelistSchema = {
  body: Joi.object({
    phone: BD_PHONE,
    notes: Joi.string().trim().max(1000).optional().allow('')
  })
};

const networkStatsSchema = {
  query: Joi.object({
    phone: BD_PHONE
  })
};

const networkSettingsSchema = {
  body: Joi.object({
    contribute: Joi.boolean().optional(),
    enforce: Joi.boolean().optional()
  }).min(1)
};

module.exports = {
  addEntrySchema, checkPhoneSchema, bulkImportSchema, listSchema,
  whitelistSchema, networkStatsSchema, networkSettingsSchema
};
