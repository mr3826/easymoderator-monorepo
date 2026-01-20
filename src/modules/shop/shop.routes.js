const express = require('express');
const shopController = require('./shop.controller');
const { authenticate } = require('src/middleware/auth.middleware');
const {
    shopCreateValidator,
    shopUpdateValidator,
    shopGetValidator,
    addUserValidator,
    removeUserValidator,
    updateRoleValidator
} = require('./shop.validator');

const router = express.Router();

// All shop routes require authentication
router.use(authenticate);

// GET /shop/list - Get all shops for user
router.get('/list', shopController.getUserShops);

// GET /shop/get - Get user's shops from token
router.get('/get', shopController.getShop);

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

module.exports = router;
