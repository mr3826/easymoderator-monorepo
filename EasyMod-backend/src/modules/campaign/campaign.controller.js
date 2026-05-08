const campaignService = require('./campaign.service');

/**
 * Create a new draft campaign
 * POST /campaigns
 */
const createCampaign = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const campaign = await campaignService.createCampaign(shopId, req.body);
        res.status(201).json({ success: true, data: campaign });
    } catch (error) {
        next(error);
    }
};

/**
 * Schedule a campaign
 * PATCH /campaigns/:campaignId/schedule
 */
const scheduleCampaign = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { campaignId } = req.params;
        const { scheduledAt } = req.body;
        const campaign = await campaignService.scheduleCampaign(shopId, campaignId, scheduledAt);
        res.status(200).json({ success: true, data: campaign });
    } catch (error) {
        next(error);
    }
};

/**
 * List all campaigns for the shop
 * GET /campaigns
 */
const getCampaigns = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const campaigns = await campaignService.getCampaigns(shopId);
        res.status(200).json({ success: true, data: campaigns });
    } catch (error) {
        next(error);
    }
};

/**
 * Get stats for a single campaign
 * GET /campaigns/:campaignId/stats
 */
const getCampaignStats = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { campaignId } = req.params;
        const stats = await campaignService.getCampaignStats(shopId, campaignId);
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        next(error);
    }
};

/**
 * Run a campaign — enqueues per-recipient send jobs
 * POST /campaigns/:campaignId/run  (also reachable via /launch)
 */
const runCampaign = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' }
            });
        }

        const { campaignId } = req.params;
        const campaign = await campaignService.runCampaign(shopId, campaignId);
        res.status(200).json({ success: true, data: campaign });
    } catch (error) {
        next(error);
    }
};

const getCampaign = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' } });
        }
        const campaign = await campaignService.getCampaignById(shopId, req.params.campaignId);
        res.status(200).json({ success: true, data: campaign });
    } catch (error) {
        next(error);
    }
};

const updateCampaign = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' } });
        }
        const campaign = await campaignService.updateCampaign(shopId, req.params.campaignId, req.body);
        res.status(200).json({ success: true, data: campaign });
    } catch (error) {
        next(error);
    }
};

const deleteCampaign = async (req, res, next) => {
    try {
        const { shopId } = req.user;
        if (!shopId) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No shop selected. Please login again.' } });
        }
        await campaignService.deleteCampaign(shopId, req.params.campaignId);
        res.status(204).end();
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createCampaign,
    scheduleCampaign,
    getCampaigns,
    getCampaign,
    getCampaignStats,
    updateCampaign,
    deleteCampaign,
    runCampaign
};
