'use strict';

/**
 * comment-to-dm.routes.js
 *
 * Mounted at /api/comment-to-dm via routes.js.
 * All routes require authenticated shop context (authMiddleware + requireShop).
 */

const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const { requireShop } = require('../../middleware/requireShop.middleware');
const {
    listEvents,
    getEvent,
    getSettings,
    updateSettings,
    getLiveSelling,
    updateLiveSelling,
} = require('./comment-to-dm.controller');

const router = express.Router();

// All routes require authentication + shop context
router.use(authenticate);
router.use(requireShop);

// Event log
router.get('/events',        listEvents);
router.get('/events/:id',    getEvent);

// Settings (per channel)
router.get('/settings/:channelId',  getSettings);
router.put('/settings/:channelId',  updateSettings);

// Live-selling capture (per shop)
router.get('/live-selling',  getLiveSelling);
router.put('/live-selling',  updateLiveSelling);

module.exports = router;
