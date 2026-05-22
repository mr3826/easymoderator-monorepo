/**
 * meta-oauth.controller.js
 *
 * Canonical OAuth controller for /api/channels/meta/oauth/*.
 *
 * Phase 5: delegates initiate/callback/connect-asset to channel.oauth.service,
 * which writes exclusively to meta_channels (legacy dual-write removed).
 */

'use strict';

const oauthService = require('./meta-oauth.service');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('MetaOAuthController');

/**
 * POST /api/channels/meta/oauth/initiate
 * body: { platform: 'facebook' | 'instagram' }
 * returns: { redirectUrl, state }
 */
exports.initiate = async (req, res, next) => {
    try {
        const { platform } = req.body;
        const { userId, shopId } = req.user;
        const result = await oauthService.initiateOAuth(userId, shopId, platform);
        logger.info('OAuth initiated', { shopId, platform });
        res.json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/channels/meta/oauth/callback
 * body: { code, state }
 * returns: { pages, tempToken }    (front-end picks one to connect)
 */
exports.callback = async (req, res, next) => {
    try {
        const { code, state } = req.body;
        const { userId, shopId } = req.user;
        const result = await oauthService.handleCallback(code, state, userId, shopId);
        logger.info('OAuth callback processed', { shopId, pageCount: result.pages?.length ?? 0 });
        res.json({ success: true, data: result });
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/channels/meta/oauth/connect-asset
 * body: { assetId, displayName, tempToken, platform }
 * returns: connected channel record + webhook subscription state
 */
exports.connectAsset = async (req, res, next) => {
    try {
        const { assetId, displayName, tempToken, platform } = req.body;
        const { userId, shopId } = req.user;
        const channel = await oauthService.connectPage(
            assetId,
            displayName,
            tempToken,
            userId,
            shopId,
            platform
        );
        logger.info('Asset connected', { shopId, assetId, platform, hasWarning: !!channel.webhookWarning });
        res.json({ success: true, data: channel });
    } catch (err) {
        next(err);
    }
};
