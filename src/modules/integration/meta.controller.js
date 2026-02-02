const metaService = require('./meta.service');
const AppError = require('src/utils/AppError');
const auditService = require('src/modules/audit/audit.service');

class MetaController {
  /**
   * Start OAuth flow
    * GET /integrations/meta/connect?platform=facebook|instagram|whatsapp
   */
  async connect(req, res, next) {
    try {
      const { platform } = req.query;
      const shopId = req.shop.id;

      // Validate platform
      if (!['facebook', 'instagram', 'whatsapp'].includes(platform)) {
        throw new AppError('Invalid platform specified', 400);
      }

      // Generate OAuth URL
      const oauthUrl = metaService.generateOAuthUrl(shopId, platform);

      // Log audit event
      await auditService.logOperation(req.user.id, shopId, 'META_OAUTH_START', 'meta_integration', null, {
        platform,
        action: 'connect_start'
      });

      // Redirect to Meta OAuth
      res.redirect(oauthUrl);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle OAuth callback
   * GET /integrations/meta/callback
   */
  async callback(req, res, next) {
    try {
      const { code, state, error, error_description } = req.query;

      // Handle OAuth errors
      if (error) {
        console.error('Meta OAuth error:', error, error_description);
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/chat-settings?error=oauth_failed`);
      }

      if (!code || !state) {
        throw new AppError('Missing authorization code or state', 400);
      }

      // Validate and decode state
      const stateData = metaService.validateOAuthState(state);
      const { shop_id: shopId, platform } = stateData;

      // Exchange code for token
      const tokenData = await metaService.exchangeCodeForToken(code);
      const longLivedToken = await metaService.exchangeForLongLivedToken(tokenData.access_token);

      // Fetch user assets
      const assets = await metaService.fetchUserAssets(longLivedToken.access_token);

      // Filter assets by platform
      let availableAssets = [];
      let assetType = '';

      switch (platform) {
        case 'facebook':
          availableAssets = assets.pages;
          assetType = 'page';
          break;
        case 'instagram':
          availableAssets = assets.instagram_accounts;
          assetType = 'instagram_account';
          break;
        case 'whatsapp':
          availableAssets = assets.whatsapp_accounts;
          assetType = 'whatsapp_business_account';
          break;
      }

      if (availableAssets.length === 0) {
        return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/chat-settings?error=no_assets&platform=${platform}`);
      }

      // For now, auto-select the first available asset
      // In a real implementation, you'd show a selection UI
      const selectedAsset = availableAssets[0];

      // Subscribe to webhooks
      const subscription = await metaService.subscribeToWebhooks(
        longLivedToken.access_token,
        selectedAsset.id,
        platform
      );

      // Create integration
      const integration = await metaService.createIntegration(
        shopId,
        platform,
        selectedAsset.id,
        selectedAsset.name || selectedAsset.username || `Meta ${platform} Account`,
        longLivedToken.access_token
      );

      // Log audit event
      await auditService.logOperation(req.user?.id || 'system', shopId, 'META_OAUTH_COMPLETE', 'meta_integration', null, {
        platform,
        meta_asset_id: selectedAsset.id,
        display_name: integration.display_name,
        action: 'connect_complete'
      });

      // Redirect to success
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/chat-settings?success=connected&platform=${platform}`);
    } catch (error) {
      console.error('Meta OAuth callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/chat-settings?error=callback_failed`);
    }
  }

  /**
   * Get integration status
   * GET /integrations/meta/status
   */
  async getStatus(req, res, next) {
    try {
      const shopId = req.shop.id;
      const status = await metaService.getShopIntegrations(shopId);

      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Disconnect integration
   * POST /integrations/meta/disconnect
   */
  async disconnect(req, res, next) {
    try {
      const { platform } = req.body;
      const shopId = req.shop.id;
      const userId = req.user.id;

      if (!['facebook', 'instagram', 'whatsapp'].includes(platform)) {
        throw new AppError('Invalid platform specified', 400);
      }

      await metaService.disconnectIntegration(shopId, platform);

      // Log audit event
      await auditService.logOperation(userId, shopId, 'META_DISCONNECT', 'meta_integration', null, {
        platform,
        action: 'disconnect'
      });

      res.json({
        success: true,
        data: { message: 'Integration disconnected successfully' }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Manual connect (UI-provided credentials)
   * POST /integrations/meta/manual-connect
   */
  async manualConnect(req, res, next) {
    try {
      const { platform, asset_id, display_name, access_token } = req.body;
      const shopId = req.shop.id;

      if (!['facebook', 'instagram', 'whatsapp'].includes(platform)) {
        throw new AppError('Invalid platform specified', 400);
      }

      if (!access_token || !asset_id) {
        throw new AppError('access_token and asset_id are required', 400);
      }

      // Subscribe to webhooks using provided token
      await metaService.subscribeToWebhooks(access_token, asset_id, platform);

      // Create integration
      const integration = await metaService.createIntegration(
        shopId,
        platform,
        asset_id,
        display_name || `Meta ${platform} Account`,
        access_token
      );

      // Log audit event
      await auditService.logOperation(req.user?.id || 'system', shopId, 'META_MANUAL_CONNECT', 'meta_integration', null, {
        platform,
        meta_asset_id: asset_id,
        display_name: integration.display_name,
        action: 'manual_connect'
      });

      res.json({
        success: true,
        data: {
          platform,
          display_name: integration.display_name,
          connected_at: integration.connected_at
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new MetaController();