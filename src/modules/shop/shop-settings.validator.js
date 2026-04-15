/**
 * Settings Validation Schema
 * Validates shop settings structure using Joi-like validation
 */

const { AppError } = require('../../utils/AppError');

// Validation helpers
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidPhone = (phone) => /^(?:\+?88)?01[3-9]\d{8}$/.test(phone);
const isNonEmptyString = (val) => typeof val === 'string' && val.trim().length > 0;

// AI Settings Schema
const AI_SETTINGS_SCHEMA = {
  automation_mode: (val) => ['AUTO', 'DRAFT', 'MANUAL'].includes(val),
  confidence_threshold: (val) => typeof val === 'number' && val >= 0 && val <= 100,
  auto_reply_enabled: (val) => typeof val === 'boolean',
  max_auto_order_value: (val) => typeof val === 'number' && val >= 0,
  ask_email: (val) => typeof val === 'boolean',
  primary_language: (val) => ['mixed', 'bn', 'en'].includes(val),
  required_fields: (val) => {
    if (typeof val !== 'object' || val === null) return false;
    const validFields = ['customer_name', 'mobile_number', 'delivery_address', 'payment_method', 'email_address', 'special_instructions'];
    return Object.keys(val).every(k => validFields.includes(k) && typeof val[k] === 'boolean');
  },
  handoff_settings: (val) => {
    if (typeof val !== 'object' || val === null) return false;
    const required = ['trigger_keywords', 'notification_channel', 'cooldown_minutes'];
    if (!required.every(k => k in val)) return false;
    return (
      Array.isArray(val.trigger_keywords) &&
      ['in_app', 'email', 'sms'].includes(val.notification_channel) &&
      typeof val.cooldown_minutes === 'number' && val.cooldown_minutes >= 0
    );
  }
};

// BD Settings Schema
const BD_SETTINGS_SCHEMA = {
  mfs_mode: (val) => val === null || ['self', 'business'].includes(val),
  mfs_type: (val) => val === null || ['bkash', 'nagad', 'rocket'].includes(val),
  mfs_number: (val) => val === null || isValidPhone(val),
  google_sheet_id: (val) => val === null || isNonEmptyString(val),
  google_sheet_range: (val) => typeof val === 'string'
};

// Business Info Schema
const BUSINESS_INFO_SCHEMA = {
  shopName: (val) => typeof val === 'string',
  address: (val) => typeof val === 'string',
  phone: (val) => typeof val === 'string',
  openingHours: (val) => typeof val === 'string',
  deliveryAreas: (val) => Array.isArray(val) && val.every(v => typeof v === 'string'),
  paymentMethods: (val) => Array.isArray(val) && val.every(v => typeof v === 'string')
};

/**
 * Validate AI settings object
 * @param {object} settings - AI settings to validate
 * @throws {AppError} If validation fails
 */
const validateAISettings = (settings) => {
  if (typeof settings !== 'object' || settings === null) {
    throw new AppError('AI settings must be an object', 400);
  }

  const errors = [];
  
  for (const [key, validator] of Object.entries(AI_SETTINGS_SCHEMA)) {
    if (key in settings) {
      if (!validator(settings[key])) {
        errors.push(`Invalid value for ${key}: ${JSON.stringify(settings[key])}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new AppError(`AI settings validation failed: ${errors.join(', ')}`, 400);
  }

  return true;
};

/**
 * Validate BD settings object
 * @param {object} settings - BD settings to validate
 * @throws {AppError} If validation fails
 */
const validateBDSettings = (settings) => {
  if (typeof settings !== 'object' || settings === null) {
    throw new AppError('BD settings must be an object', 400);
  }

  const errors = [];
  
  for (const [key, validator] of Object.entries(BD_SETTINGS_SCHEMA)) {
    if (key in settings) {
      if (!validator(settings[key])) {
        errors.push(`Invalid value for ${key}: ${JSON.stringify(settings[key])}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new AppError(`BD settings validation failed: ${errors.join(', ')}`, 400);
  }

  return true;
};

/**
 * Validate business info object
 * @param {object} info - Business info to validate
 * @throws {AppError} If validation fails
 */
const validateBusinessInfo = (info) => {
  if (typeof info !== 'object' || info === null) {
    throw new AppError('Business info must be an object', 400);
  }

  const errors = [];
  
  for (const [key, validator] of Object.entries(BUSINESS_INFO_SCHEMA)) {
    if (key in info) {
      if (!validator(info[key])) {
        errors.push(`Invalid value for ${key}: ${JSON.stringify(info[key])}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new AppError(`Business info validation failed: ${errors.join(', ')}`, 400);
  }

  return true;
};

/**
 * Validate complete settings object
 * @param {object} settings - Complete settings object
 * @throws {AppError} If validation fails
 */
const validateSettings = (settings) => {
  if (typeof settings !== 'object' || settings === null) {
    throw new AppError('Settings must be an object', 400);
  }

  // Validate nested sections if present
  if (settings.ai) {
    validateAISettings(settings.ai);
  }
  if (settings.bd) {
    validateBDSettings(settings.bd);
  }
  if (settings.businessInfo) {
    validateBusinessInfo(settings.businessInfo);
  }

  return true;
};

/**
 * Sanitize settings object (removes unknown keys)
 * @param {object} settings - Settings to sanitize
 * @returns {object} Sanitized settings
 */
const sanitizeSettings = (settings) => {
  if (typeof settings !== 'object' || settings === null) {
    return {};
  }

  const sanitized = {};
  
  // Only keep known top-level keys
  const knownKeys = ['ai', 'bd', 'businessInfo', 'branding'];
  for (const key of knownKeys) {
    if (key in settings) {
      sanitized[key] = settings[key];
    }
  }

  return sanitized;
};

module.exports = {
  validateAISettings,
  validateBDSettings,
  validateBusinessInfo,
  validateSettings,
  sanitizeSettings,
  AI_SETTINGS_SCHEMA,
  BD_SETTINGS_SCHEMA,
  BUSINESS_INFO_SCHEMA
};
