const express = require('express');
const campaignController = require('./campaign.controller');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

// All campaign routes require authentication
router.use(authenticate);

router.get('/', campaignController.getCampaigns);
router.post('/', campaignController.createCampaign);
router.get('/:campaignId/stats', campaignController.getCampaignStats);
router.patch('/:campaignId/schedule', campaignController.scheduleCampaign);
router.post('/:campaignId/run', campaignController.runCampaign);

module.exports = router;
