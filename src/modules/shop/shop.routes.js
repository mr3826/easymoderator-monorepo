const express = require('express');
const shopController = require('./shop.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const {
    shopCreateValidator,
    shopUpdateValidator,
    shopGetValidator,
    addUserValidator,
    removeUserValidator,
    updateRoleValidator,
    shopBusinessInfoValidator
} = require('./shop.validator');

const router = express.Router();

// All shop routes require authentication
router.use(authenticate);

// GET /shop/list - Get all shops for user
router.get('/list', shopController.getUserShops);

// GET /shop/me - Get current shop context (RESTful alias for /shop/get)
router.get('/me', shopController.getShop);

// POST /shop/create - Create new shop
router.post('/create', shopCreateValidator, shopController.createShop);

// POST /shop/update - Update shop
router.post('/update', shopUpdateValidator, shopController.updateShop);

// POST /shop/delete - Delete shop
router.post('/delete', shopGetValidator, shopController.deleteShop);

// POST /shop/add-user - Add user to shop
router.post('/add-user', addUserValidator, shopController.addUserToShop);

// POST /shop/remove-user - Remove user from shop
router.post('/remove-user', removeUserValidator, shopController.removeUserFromShop);

// POST /shop/update-role - Update user role
router.post('/update-role', updateRoleValidator, shopController.updateUserRole);

// POST /shop/switch - Switch to a different shop
router.post('/switch', shopGetValidator, shopController.switchShop);

// GET /shop/business-info - Get business info for current shop
router.get('/business-info', shopController.getBusinessInfo);

// PUT /shop/business-info - Update business info for current shop
router.put('/business-info', shopBusinessInfoValidator, shopController.updateBusinessInfo);

// GET /shop/llm-config - Get LLM model configuration for this shop
router.get('/llm-config', shopController.getLLMConfig);

// PUT /shop/llm-config - Update LLM model configuration
router.put('/llm-config', shopController.updateLLMConfig);

// GET /shop/ai-settings - Get AI behaviour settings
router.get('/ai-settings', shopController.getAISettings);

// PUT /shop/ai-settings - Update AI behaviour settings
router.put('/ai-settings', shopController.updateAISettings);

// GET /shop/ai-settings/intent-thresholds - Get per-intent confidence thresholds
router.get('/ai-settings/intent-thresholds', shopController.getIntentThresholds);

// PUT /shop/ai-settings/intent-thresholds - Update per-intent confidence thresholds
router.put('/ai-settings/intent-thresholds', shopController.updateIntentThresholds);

// GET /shop/settings/ai-defaults - Return canonical AI defaults (DRAFT mode deprecated)
router.get('/settings/ai-defaults', shopController.getAiDefaults);

// POST /shop/branding-preset - Apply a named branding preset (FRIENDLY | PROFESSIONAL | FUN)
router.post('/branding-preset', shopController.applyBrandingPreset);

// GET /shop/bd-settings - Get BD-specific settings (MFS, Google Sheets)
router.get('/bd-settings', shopController.getBdSettings);

// PUT /shop/bd-settings - Update BD-specific settings
router.put('/bd-settings', shopController.updateBdSettings);

// GET /shop/agents - List team members for the current shop (used by inbox assignment)
router.get('/agents', shopController.getShopAgents);

module.exports = router;
