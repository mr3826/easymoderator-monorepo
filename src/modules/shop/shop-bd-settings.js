/**
 * BD (Bangladesh) Shop Settings Helper
 *
 * Reads/writes Bangladesh-specific settings from shop.settings.bd.
 * Follows the same pattern as settings.ai (see shop.service.js).
 *
 * Schema — shop.settings.bd:
 * {
 *   mfs_mode:    "self" | "business"   // "self" = personal bKash/Nagad number
 *   mfs_type:    "bkash" | "nagad" | "rocket"
 *   mfs_number:  "01XXXXXXXXX"         // shop owner's personal MFS number (Self mode only)
 *
 *   google_sheet_id:    "spreadsheet_id"   // for stock sync via Sheets webhook
 *   google_sheet_range: "Sheet1!A:Z"       // range that contains product/stock data
 * }
 *
 * Courier credentials are stored in the delivery_integrations table (DeliveryIntegration entity),
 * NOT here — that table is already per-shop and credential-aware.
 */

const { Shop } = require('./shop.entity');
const { AppError } = require('../../utils/AppError');

const BD_PHONE_REGEX = /^(?:\+?88)?01[3-9]\d{8}$/;
const VALID_MFS_TYPES = ['bkash', 'nagad', 'rocket'];
const VALID_MFS_MODES = ['self', 'business'];

const DEFAULT_BD_SETTINGS = {
    mfs_mode: null,
    mfs_type: null,
    mfs_number: null,
    google_sheet_id: null,
    google_sheet_range: 'Sheet1!A:Z'
};

/**
 * Get BD settings for a shop, merged with defaults.
 * @param {string} shopId
 * @returns {Promise<object>}
 */
const getBdSettings = async (shopId) => {
    const shop = await Shop.findByPk(shopId, { attributes: ['id', 'settings'] });
    if (!shop) return { ...DEFAULT_BD_SETTINGS };
    return { ...DEFAULT_BD_SETTINGS, ...(shop.settings?.bd || {}) };
};

/**
 * Update BD settings for a shop (partial update, preserves other settings keys).
 * Validates sensitive fields before saving.
 * @param {string} shopId
 * @param {object} updates  — partial BD settings
 * @returns {Promise<object>} updated BD settings
 */
const updateBdSettings = async (shopId, updates) => {
    const shop = await Shop.findByPk(shopId);
    if (!shop) throw new AppError('Shop not found', 404);

    if (updates.mfs_type && !VALID_MFS_TYPES.includes(updates.mfs_type)) {
        throw new AppError(`mfs_type must be one of: ${VALID_MFS_TYPES.join(', ')}`, 400);
    }
    if (updates.mfs_mode && !VALID_MFS_MODES.includes(updates.mfs_mode)) {
        throw new AppError(`mfs_mode must be one of: ${VALID_MFS_MODES.join(', ')}`, 400);
    }
    if (updates.mfs_number && !BD_PHONE_REGEX.test(updates.mfs_number)) {
        throw new AppError('mfs_number must be a valid Bangladesh mobile number', 400);
    }

    const currentSettings = shop.settings || {};
    const currentBd = currentSettings.bd || {};
    const newBd = { ...currentBd, ...updates };

    await shop.update({ settings: { ...currentSettings, bd: newBd } });
    return { ...DEFAULT_BD_SETTINGS, ...newBd };
};

/**
 * Returns true if the shop has Self MFS configured (personal number + mfs_mode = self).
 * @param {object} bdSettings — result of getBdSettings()
 */
const hasSelfMfs = (bdSettings) =>
    bdSettings.mfs_mode === 'self' &&
    Boolean(bdSettings.mfs_number) &&
    Boolean(bdSettings.mfs_type);

module.exports = { getBdSettings, updateBdSettings, hasSelfMfs, BD_PHONE_REGEX };
