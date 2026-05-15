/**
 * Phone Number Validators
 * 
 * Centralized validation for phone number formats used across the application.
 * Supports Bangladesh mobile numbers in multiple formats.
 * 
 * @module utils/validators/phone
 */

/**
 * Phone number validation formats
 * Each format includes regex and description for documentation
 */
const VALIDATORS = {
  BD_MOBILE: {
    regex: /^(?:\+?88)?01[3-9]\d{8}$/,
    description: 'Bangladesh mobile (01XXX with operators 3-9, with optional +88 prefix)',
    examples: ['01712345678', '+8801712345678', '8801712345678']
  },
  BD_MOBILE_STRICT: {
    regex: /^01[3-9]\d{8}$/,
    description: 'Bangladesh mobile without country code (01XXX)',
    examples: ['01712345678']
  },
  BD_LANDLINE: {
    regex: /^0\d{9,10}$/,
    description: 'Bangladesh landline',
    examples: ['0241234567']
  }
};

/**
 * Validate phone number against a specified format
 * 
 * @param {string} phone - Phone number to validate
 * @param {string} [format='BD_MOBILE'] - Format name to validate against
 * @returns {boolean} True if phone matches the format
 * @throws {Error} If format is not recognized
 * 
 * @example
 * validatePhone('01712345678'); // true
 * validatePhone('+8801712345678'); // true
 * validatePhone('invalid'); // false
 * validatePhone('01712345678', 'BD_MOBILE_STRICT'); // true
 */
function validatePhone(phone, format = 'BD_MOBILE') {
  if (!phone || typeof phone !== 'string') {
    return false;
  }

  const validator = VALIDATORS[format];
  if (!validator) {
    throw new Error(`Unknown phone format: ${format}`);
  }

  return validator.regex.test(phone);
}

/**
 * Normalize phone number to standard format (01XXX)
 * 
 * Converts phone numbers with +88 prefix or 88 prefix to 01XXX format.
 * 
 * @param {string} phone - Phone number to normalize
 * @returns {string|null} Normalized phone (01XXX format) or null if invalid
 * 
 * @example
 * normalizePhone('01712345678'); // '01712345678'
 * normalizePhone('+8801712345678'); // '01712345678'
 * normalizePhone('8801712345678'); // '01712345678'
 * normalizePhone(null); // null
 */
function normalizePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  // Remove + prefix
  let normalized = phone.replace(/^\+/, '');

  // Convert 88 prefix to 0
  if (normalized.startsWith('88')) {
    normalized = '0' + normalized.substring(2);
  }

  // Ensure starts with 0
  if (!normalized.startsWith('0')) {
    normalized = '0' + normalized;
  }

  return normalized;
}

/**
 * Extract mobile number from various formats
 * 
 * Handles different input formats and extracts the mobile number
 * in standard format (01XXX).
 * 
 * @param {string} input - Phone number in any supported format
 * @returns {string|null} Extracted mobile number or null if invalid
 * 
 * @example
 * extractMobile('+8801712345678'); // '01712345678'
 * extractMobile('8801712345678'); // '01712345678'
 * extractMobile('01712345678'); // '01712345678'
 */
function extractMobile(input) {
  const normalized = normalizePhone(input);
  if (!normalized || !validatePhone(normalized, 'BD_MOBILE_STRICT')) {
    return null;
  }
  return normalized;
}

/**
 * Convert phone to international format
 * 
 * Converts phone number to +88XXXXXXXXX format for international usage.
 * 
 * @param {string} phone - Phone number in any supported format
 * @returns {string|null} International format or null if invalid
 * 
 * @example
 * toInternationalFormat('01712345678'); // '+8801712345678'
 * toInternationalFormat('+8801712345678'); // '+8801712345678'
 */
function toInternationalFormat(phone) {
  const normalized = extractMobile(phone);
  if (!normalized) {
    return null;
  }
  // Remove leading 0 and add +88
  return '+88' + normalized.substring(1);
}

/**
 * Get operator information from BD mobile number
 * 
 * Bangladesh operators use specific digit prefixes:
 * - 3,4: Grameenphone
 * - 5,6: Banglalink
 * - 7,8: Robi/Airtel
 * - 9: Teletalk
 * 
 * @param {string} phone - Phone number to analyze
 * @returns {Object|null} Operator info or null if not a valid mobile
 * 
 * @example
 * getOperator('01712345678'); // { code: '017', operator: 'Grameenphone' }
 * getOperator('01512345678'); // { code: '015', operator: 'Banglalink' }
 */
function getOperator(phone) {
  const normalized = extractMobile(phone);
  if (!normalized) {
    return null;
  }

  const operatorPrefix = normalized.substring(1, 3);
  const operatorMap = {
    '13': 'Grameenphone', '14': 'Grameenphone',
    '15': 'Banglalink', '16': 'Banglalink',
    '17': 'Robi/Airtel', '18': 'Robi/Airtel',
    '19': 'Teletalk'
  };

  return {
    code: '0' + operatorPrefix,
    operator: operatorMap[operatorPrefix] || 'Unknown',
    isMobile: true
  };
}

module.exports = {
  VALIDATORS,
  validatePhone,
  normalizePhone,
  extractMobile,
  toInternationalFormat,
  getOperator,
  // Export regexes for express-validator integration
  bdMobileRegex: VALIDATORS.BD_MOBILE.regex,
  bdMobileStrictRegex: VALIDATORS.BD_MOBILE_STRICT.regex,
  bdLandlineRegex: VALIDATORS.BD_LANDLINE.regex
};
