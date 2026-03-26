/**
 * White-Label Service
 *
 * Allows shops to configure custom branding (name, logo, colours) that
 * overrides default EasyMod branding. Config is stored in shop.settings.whiteLabel.
 */

const { Shop } = require('../entities');
const { AppError } = require('../../utils/AppError');

// Simple hex colour validator
const isValidHex = (value) => /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(value);

// Allowed URL protocols
const isValidUrl = (value) => {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol);
    } catch (_) {
        return false;
    }
};

/**
 * Get the white-label config for a shop.
 * @param {string} shopId
 * @returns {{ brandName, logoUrl, primaryColor, accentColor, faviconUrl }}
 */
const getWhiteLabelConfig = async (shopId) => {
    const shop = await Shop.findByPk(shopId, { attributes: ['id', 'settings', 'shop_name'] });
    if (!shop) throw new AppError('Shop not found', 404);

    const wl = shop.settings?.whiteLabel || {};
    return {
        brandName: wl.brandName || shop.shop_name || null,
        logoUrl: wl.logoUrl || null,
        primaryColor: wl.primaryColor || '#2563EB',
        accentColor: wl.accentColor || '#F59E0B',
        faviconUrl: wl.faviconUrl || null
    };
};

/**
 * Update the white-label config for a shop.
 * @param {string} shopId
 * @param {{ brandName?, logoUrl?, primaryColor?, accentColor?, faviconUrl? }} config
 */
const updateWhiteLabelConfig = async (shopId, config) => {
    const shop = await Shop.findByPk(shopId);
    if (!shop) throw new AppError('Shop not found', 404);

    const { brandName, logoUrl, primaryColor, accentColor, faviconUrl } = config;

    // Validate optional fields
    if (primaryColor !== undefined && !isValidHex(primaryColor)) {
        throw new AppError('primaryColor must be a valid hex colour (e.g. #2563EB)', 400);
    }
    if (accentColor !== undefined && !isValidHex(accentColor)) {
        throw new AppError('accentColor must be a valid hex colour (e.g. #F59E0B)', 400);
    }
    if (logoUrl !== undefined && logoUrl !== null && !isValidUrl(logoUrl)) {
        throw new AppError('logoUrl must be a valid http/https URL', 400);
    }
    if (faviconUrl !== undefined && faviconUrl !== null && !isValidUrl(faviconUrl)) {
        throw new AppError('faviconUrl must be a valid http/https URL', 400);
    }
    if (brandName !== undefined && brandName !== null && String(brandName).trim().length === 0) {
        throw new AppError('brandName cannot be empty', 400);
    }

    const currentSettings = shop.settings || {};
    const currentWL = currentSettings.whiteLabel || {};

    const newWL = { ...currentWL };
    if (brandName    !== undefined) newWL.brandName    = brandName    ? String(brandName).trim() : null;
    if (logoUrl      !== undefined) newWL.logoUrl      = logoUrl      || null;
    if (primaryColor !== undefined) newWL.primaryColor = primaryColor;
    if (accentColor  !== undefined) newWL.accentColor  = accentColor;
    if (faviconUrl   !== undefined) newWL.faviconUrl   = faviconUrl   || null;

    await shop.update({ settings: { ...currentSettings, whiteLabel: newWL } });

    return {
        brandName: newWL.brandName || shop.shop_name,
        logoUrl: newWL.logoUrl,
        primaryColor: newWL.primaryColor || '#2563EB',
        accentColor: newWL.accentColor || '#F59E0B',
        faviconUrl: newWL.faviconUrl
    };
};

/**
 * Return CSS custom-property string for the shop's branding colours.
 * @param {string} shopId
 * @returns {string} e.g. "--primary: #2563EB; --accent: #F59E0B;"
 */
const getCssVariables = async (shopId) => {
    const config = await getWhiteLabelConfig(shopId);
    return `--primary: ${config.primaryColor}; --accent: ${config.accentColor};`;
};

module.exports = { getWhiteLabelConfig, updateWhiteLabelConfig, getCssVariables };
