/**
 * BdPhoneValidator
 *
 * Validates and normalizes Bangladesh mobile numbers.
 * BD operators: Grameenphone (017/013), Robi (018/016), Banglalink (019/014),
 *               Teletalk (015), Airtel (016)
 *
 * Accepts formats:
 *   01XXXXXXXXX          — standard 11-digit
 *   +8801XXXXXXXXX       — E.164 with country code
 *   8801XXXXXXXXX        — without +
 *   spaces/dashes ignored
 *
 * Returns normalized 11-digit format: 01XXXXXXXXX
 */

const BD_PHONE_PATTERN = /(?:\+?88)?0(1[3-9]\d{8})/;

/**
 * Normalize a BD phone number to 11-digit local format.
 * @param {string} raw
 * @returns {string|null} — normalized "01XXXXXXXXX" or null if invalid
 */
const normalize = (raw) => {
    if (!raw || typeof raw !== 'string') return null;
    const cleaned = raw.replace(/[\s\-().]/g, '');
    const match = cleaned.match(BD_PHONE_PATTERN);
    return match ? `0${match[1]}` : null;
};

/**
 * Validate a BD phone number.
 * @param {string} raw
 * @returns {{ valid: boolean, normalized: string|null, operator: string|null }}
 */
const validate = (raw) => {
    const normalized = normalize(raw);
    if (!normalized) return { valid: false, normalized: null, operator: null };

    const prefix = normalized.substring(0, 3);
    const operatorMap = {
        '017': 'Grameenphone',
        '013': 'Grameenphone',
        '018': 'Robi',
        '016': 'Robi/Airtel',
        '019': 'Banglalink',
        '014': 'Banglalink',
        '015': 'Teletalk'
    };

    return {
        valid: true,
        normalized,
        operator: operatorMap[prefix] || 'Unknown'
    };
};

/**
 * Format a normalized phone number for display (e.g. in courier parcel).
 * Couriers generally expect 11-digit without country code.
 * @param {string} raw
 * @returns {string} — normalized or original if validation fails
 */
const formatForCourier = (raw) => normalize(raw) || raw;

module.exports = { validate, normalize, formatForCourier };
