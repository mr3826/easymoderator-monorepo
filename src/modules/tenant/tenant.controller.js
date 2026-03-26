const tenantService = require('./tenant.service');
const whiteLabelService = require('./white-label.service');
const { validationResult } = require('express-validator');
const { AppError } = require('../../utils/AppError');

/**
 * Get tenant details
 */
const getTenant = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { tenantId } = req.params;
        const tenant = await tenantService.getTenantById(tenantId);

        res.status(200).json({
            success: true,
            data: {
                tenant_id: tenant.id,
                name: tenant.name,
                is_active: tenant.is_active,
                created_at: tenant.created_at,
                updated_at: tenant.updated_at,
                settings: tenant.settings || {}
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get tenant shops
 */
const getTenantShops = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { tenantId } = req.params;
        const tenant = await tenantService.getTenantById(tenantId);
        
        // For now, return empty shops array since specific shop listing logic would need to be implemented
        res.status(200).json({
            success: true,
            data: {
                tenant_id: tenant.id,
                shops: []
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get specific tenant shop
 */
const getTenantShop = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { tenantId, shopId } = req.params;
        const result = await tenantService.getTenantShop(tenantId, shopId);

        res.status(200).json({
            success: true,
            data: {
                tenant_id: result.tenant.id,
                shop_id: result.shop.id,
                shop_name: result.shop.name,
                is_active: result.shop.is_active,
                business_hours: result.shop.business_hours || {},
                settings: result.shop.settings || {},
                created_at: result.shop.created_at,
                updated_at: result.shop.updated_at
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Validate tenant
 */
const validateTenant = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { tenantId } = req.params;
        const tenant = await tenantService.getTenantById(tenantId);

        res.status(200).json({
            success: true,
            data: {
                tenant_id: tenant.id,
                is_valid: tenant.is_active,
                name: tenant.name,
                validation_timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /tenant/white-label
 * Return the white-label branding config for the current shop (from token).
 */
const getWhiteLabel = async (req, res, next) => {
    try {
        const shopId = req.user?.shopId;
        if (!shopId) throw new AppError('No shop selected. Please login again.', 400);
        const data = await whiteLabelService.getWhiteLabelConfig(shopId);
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /tenant/white-label
 * Update the white-label branding config for the current shop.
 * Body: { brandName?, logoUrl?, primaryColor?, accentColor?, faviconUrl? }
 */
const updateWhiteLabel = async (req, res, next) => {
    try {
        const shopId = req.user?.shopId;
        if (!shopId) throw new AppError('No shop selected. Please login again.', 400);
        const data = await whiteLabelService.updateWhiteLabelConfig(shopId, req.body);
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /tenant/white-label/css
 * Return CSS custom properties string for the shop's branding colours.
 */
const getWhiteLabelCss = async (req, res, next) => {
    try {
        const shopId = req.user?.shopId;
        if (!shopId) throw new AppError('No shop selected. Please login again.', 400);
        const css = await whiteLabelService.getCssVariables(shopId);
        res.status(200).json({ success: true, data: { css } });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getTenant,
    getTenantShops,
    getTenantShop,
    validateTenant,
    getWhiteLabel,
    updateWhiteLabel,
    getWhiteLabelCss
};
