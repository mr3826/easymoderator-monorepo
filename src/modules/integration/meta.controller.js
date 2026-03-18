const metaService = require('./meta.service');
const { AppError } = require('../../utils/AppError');
const auditService = require('../audit/audit.service');

class MetaController {
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
