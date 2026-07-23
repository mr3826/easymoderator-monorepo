'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const { requirePlatformAdmin, PLATFORM_ROLES } = require('../../middleware/platform-admin.middleware');
const ctrl = require('./admin.controller');

const router = express.Router();

// Every admin route requires auth + at least SUPPORT_ADMIN (reads).
router.use(authenticate, requirePlatformAdmin());

const superOnly = requirePlatformAdmin(PLATFORM_ROLES.SUPER_ADMIN);

// Reads (SUPPORT_ADMIN or SUPER_ADMIN)
router.get('/dashboard', ctrl.getDashboard);
router.get('/meta-identity-readiness', ctrl.getMetaIdentityReadiness);
router.get('/payment-processing-reconciliation', ctrl.getStalePaymentProcessing);
router.get('/shops', ctrl.listShops);
router.get('/shops/:shopId', ctrl.getShopOverview);
router.get('/shops/:shopId/channels', ctrl.getShopChannels);
router.get('/shops/:shopId/billing', ctrl.getShopBilling);
router.get('/audit-logs', ctrl.getAuditLogs);

// Mutations (SUPER_ADMIN only)
router.patch('/shops/:shopId/status', superOnly, ctrl.setShopStatus);
router.patch('/shops/:shopId/billing', superOnly, ctrl.changePlan);
router.post('/shops/:shopId/add-credits', superOnly, ctrl.addCredits);
router.post('/shops/:shopId/extend-trial', superOnly, ctrl.extendTrial);
router.patch('/shops/:shopId/channels/:channelId/reconnect', superOnly, ctrl.markChannelReconnect);
router.post('/shops/:shopId/ai/emergency-off', superOnly, ctrl.emergencyDisableAi);

module.exports = router;
