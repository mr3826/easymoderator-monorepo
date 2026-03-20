const axios = require('axios');
const crypto = require('crypto');
const MetaIntegration = require('./meta-integration.entity');
const config = require('../../config/config');
const { AppError } = require('../../utils/AppError');

// Meta API configuration
const META_CONFIG = {
  graphApiVersion: 'v18.0'
};

class MetaService {

  /**
   * Subscribe to webhooks for a specific asset
   */
  async subscribeToWebhooks(accessToken, assetId, platform) {
    try {
      const subscriptionData = {
        object: platform === 'facebook' ? 'page' : platform,
        callback_url: `${process.env.BASE_URL || 'http://localhost:3000'}/webhooks/meta`,
        verify_token: process.env.META_WEBHOOK_VERIFY_TOKEN,
        fields: this.getWebhookFields(platform)
      };

      const response = await axios.post(
        `https://graph.facebook.com/${META_CONFIG.graphApiVersion}/${assetId}/subscribed_apps`,
        null,
        {
          params: {
            access_token: accessToken,
            ...subscriptionData
          }
        }
      );

      return response.data;
    } catch (error) {
      throw new AppError('Failed to subscribe to webhooks', 500);
    }
  }

  /**
   * Get webhook fields for platform
   */
  getWebhookFields(platform) {
    switch (platform) {
      case 'facebook':
        return 'messages,messaging_postbacks,messaging_optins,message_deliveries,message_reads';
      case 'instagram':
        return 'messages,message_echoes';
      case 'whatsapp':
        return 'messages';
      default:
        return 'messages';
    }
  }

  /**
   * Encrypt access token for storage
   */
  encryptToken(token) {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(config.jwtAccessSecret, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    cipher.setAAD(Buffer.from('meta-token'));

    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt access token
   */
  decryptToken(encryptedToken) {
    try {
      const algorithm = 'aes-256-gcm';
      const key = crypto.scryptSync(config.jwtAccessSecret, 'salt', 32);
      const [ivHex, authTagHex, encrypted] = encryptedToken.split(':');

      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      decipher.setAAD(Buffer.from('meta-token'));
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new AppError('Failed to decrypt token', 500);
    }
  }

  /**
   * Check if asset is already connected to another shop
   */
  async checkAssetAvailability(metaAssetId) {
    const existing = await MetaIntegration.findOne({
      where: { meta_asset_id: metaAssetId }
    });
    return !existing;
  }

  /**
   * Create or update Meta integration
   */
  async createIntegration(shopId, platform, metaAssetId, displayName, accessToken) {
    // Check if asset is available
    const isAvailable = await this.checkAssetAvailability(metaAssetId);
    if (!isAvailable) {
      throw new AppError('This Meta asset is already connected to another shop', 409);
    }

    // Encrypt token
    const encryptedToken = this.encryptToken(accessToken);

    // Create or update integration
    const [integration, created] = await MetaIntegration.upsert({
      shop_id: shopId,
      platform,
      meta_asset_id: metaAssetId,
      display_name: displayName,
      access_token: encryptedToken,
      status: 'CONNECTED'
    }, {
      returning: true
    });

    return integration;
  }

  /**
   * Get integration status for shop
   */
  async getShopIntegrations(shopId) {
    const integrations = await MetaIntegration.findAll({
      where: { shop_id: shopId },
      attributes: ['platform', 'display_name', 'connected_at', 'status']
    });

    // Return status for all platforms
    const platforms = ['facebook', 'instagram', 'whatsapp'];
    return platforms.map(platform => {
      const integration = integrations.find(i => i.platform === platform);
      return {
        platform,
        connected: integration?.status === 'CONNECTED',
        display_name: integration?.display_name || null,
        connected_at: integration?.connected_at || null
      };
    });
  }

  /**
   * Disconnect integration
   */
  async disconnectIntegration(shopId, platform) {
    const integration = await MetaIntegration.findOne({
      where: { shop_id: shopId, platform }
    });

    if (!integration) {
      throw new AppError('Integration not found', 404);
    }

    // Revoke Meta permissions and unsubscribe webhooks
    try {
      const accessToken = this.decryptToken(integration.access_token);
      await this.unsubscribeFromWebhooks(accessToken, integration.meta_asset_id, platform);
    } catch (error) {
      // Log but don't fail the disconnect
      console.warn('Failed to unsubscribe from webhooks:', error.message);
    }

    // Update status
    await integration.update({ status: 'DISCONNECTED' });

    return { success: true };
  }

  /**
   * Unsubscribe from webhooks
   */
  async unsubscribeFromWebhooks(accessToken, assetId, platform) {
    try {
      await axios.delete(
        `https://graph.facebook.com/${META_CONFIG.graphApiVersion}/${assetId}/subscribed_apps`,
        {
          params: { access_token: accessToken }
        }
      );
    } catch (error) {
      throw new AppError('Failed to unsubscribe from webhooks', 500);
    }
  }
}

module.exports = new MetaService();
