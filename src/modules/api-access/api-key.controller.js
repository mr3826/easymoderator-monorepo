/**
 * API Key Controller
 */

const apiKeyService = require('./api-key.service');
const { AppError } = require('../../utils/AppError');

/**
 * POST /api-keys
 * Generate a new API key.
 * Body: { name, scopes }
 */
const create = async (req, res, next) => {
    try {
        const shopId = req.user?.shopId;
        if (!shopId) throw new AppError('No shop selected. Please login again.', 400);

        const { name, scopes = [] } = req.body;
        const result = await apiKeyService.generateApiKey(shopId, name, scopes);

        res.status(201).json({
            success: true,
            data: result,
            warning: 'Store the key value now — it will not be shown again.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api-keys
 * List all API keys for the current shop (no plaintext key, no hash).
 */
const list = async (req, res, next) => {
    try {
        const shopId = req.user?.shopId;
        if (!shopId) throw new AppError('No shop selected. Please login again.', 400);

        const keys = await apiKeyService.listApiKeys(shopId);
        res.status(200).json({ success: true, data: keys });
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /api-keys/:keyId
 * Revoke an API key.
 */
const revoke = async (req, res, next) => {
    try {
        const shopId = req.user?.shopId;
        if (!shopId) throw new AppError('No shop selected. Please login again.', 400);

        const { keyId } = req.params;
        const result = await apiKeyService.revokeApiKey(shopId, keyId);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api-keys/scopes
 * Return list of valid scopes so the frontend can show a checkbox list.
 */
const scopes = async (req, res, next) => {
    try {
        res.status(200).json({ success: true, data: apiKeyService.VALID_SCOPES });
    } catch (error) {
        next(error);
    }
};

module.exports = { create, list, revoke, scopes };
