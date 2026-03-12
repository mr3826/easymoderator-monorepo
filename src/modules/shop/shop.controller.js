const shopService = require('./shop.service');
const tenantService = require('../tenant/tenant.service');
const knowledgeService = require('../knowledge/knowledge.service');
const { validationResult } = require('express-validator');
const { AppError } = require('../../utils/AppError');
const { setAuthCookies } = require('../../utils/auth-cookies');

/**
 * Get all shops for user
 */
const getUserShops = async (req, res, next) => {
    try {
        const shops = await shopService.getShopsByUserId(req.user.userId);

        res.status(200).json({
            success: true,
            data: shops
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get current logged-in shop from token
 */
const getShop = async (req, res, next) => {
    try {
        // Get shopId from token
        const { shopId } = req.user;

        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        // Get shop details with user's role
        const shop = await shopService.getShopById(shopId, req.user.userId);

        res.status(200).json({
            success: true,
            data: shop
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get business info for current shop
 */
const getBusinessInfo = async (req, res, next) => {
    try {
        const { shopId, userId } = req.user;

        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const data = await knowledgeService.getKnowledge(userId, shopId);
        
        // Get AI settings for n8n workflow
        const aiSettings = await shopService.getShopAiSettings(shopId);
        
        // Add ai_settings to the response
        if (data && data.data) {
            data.data.ai_settings = aiSettings;
        } else if (data) {
            data.ai_settings = aiSettings;
        }

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update business info for current shop
 */
const updateBusinessInfo = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId, userId } = req.user;

        if (!shopId) {
            throw new AppError('No shop selected. Please login again.', 400);
        }

        const data = await knowledgeService.updateBusinessInfo(userId, shopId, req.body);

        res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Create new shop
 */
const createShop = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const shop = await shopService.createShop(req.user.userId, req.body);

        res.status(201).json({
            success: true,
            data: shop
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update shop
 */
const updateShop = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId, ...updateData } = req.body;
        const shop = await shopService.updateShopById(shopId, req.user.userId, updateData);

        res.status(200).json({
            success: true,
            data: shop
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Delete shop
 */
const deleteShop = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.body;
        const result = await shopService.deleteShopById(shopId, req.user.userId);

        res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Add user to shop
 */
const addUserToShop = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId, email, role } = req.body;
        const userShop = await shopService.addUserToShop(shopId, req.user.userId, email, role);

        res.status(200).json({
            success: true,
            data: userShop
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Remove user from shop
 */
const removeUserFromShop = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId, userId } = req.body;
        const result = await shopService.removeUserFromShop(shopId, req.user.userId, userId);

        res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Update user role
 */
const updateUserRole = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId, userId, role } = req.body;
        const userShop = await shopService.updateUserRole(shopId, req.user.userId, userId, role);

        res.status(200).json({
            success: true,
            data: userShop
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Switch to a different shop
 */
const switchShop = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            throw new AppError(errors.array()[0].msg, 400);
        }

        const { shopId } = req.body;
        const switchService = require('./shop-switch.service');
        const result = await switchService.switchShop(req.user.userId, shopId);

        setAuthCookies(res, result.accessToken, null);

        res.status(200).json({
            success: true,
            data: {
                currentShop: result.currentShop
            }
        });
    } catch (error) {
        next(error);
    }
};

const validateTenant = async (req, res, next) => {
    try {
        const { tenantId } = req.params;
        const tenant = await tenantService.getTenantById(tenantId);

        res.status(200).json({
            tenant_id: tenant.id,
            is_active: tenant.is_active,
            name: tenant.name,
            settings: tenant.settings || {}
        });
    } catch (error) {
        next(error);
    }
};

const validateTenantShop = async (req, res, next) => {
    try {
        const { tenantId, shopId } = req.params;
        const result = await tenantService.getTenantShop(tenantId, shopId);

        res.status(200).json({
            shop_id: result.shop.id,
            tenant_id: result.tenant.id,
            is_active: result.shop.is_active,
            name: result.shop.name,
            business_hours: result.shop.business_hours || {},
            settings: result.shop.settings || {}
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getUserShops,
    getShop,
    createShop,
    updateShop,
    deleteShop,
    addUserToShop,
    removeUserFromShop,
    updateUserRole,
    switchShop,
    getBusinessInfo,
    updateBusinessInfo,
    validateTenant,
    validateTenantShop
};
