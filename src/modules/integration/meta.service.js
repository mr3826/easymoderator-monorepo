const axios = require('axios');
const crypto = require('crypto');
const MetaIntegration = require('./meta-integration.entity');
const config = require('../../config/config');
const { AppError } = require('../../utils/AppError');

// Meta API configuration
const META_CONFIG = {
  graphApiVersion: 'v21.0'
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
   * Bug #6: Exchange a short-lived token for a long-lived one via Meta Graph API.
   * Meta long-lived tokens last ~60 days; call this after any OAuth flow.
   */
  async exchangeForLongLivedToken(shortLivedToken) {
    try {
      const response = await axios.get(
        `https://graph.facebook.com/${META_CONFIG.graphApiVersion}/oauth/access_token`,
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: process.env.META_APP_ID,
            client_secret: process.env.META_APP_SECRET,
            fb_exchange_token: shortLivedToken,
            appsecret_proof: this._buildAppSecretProof(shortLivedToken)
          }
        }
      );
      const { access_token, expires_in } = response.data;
      // expires_in is in seconds; convert to absolute Date
      const expiresAt = expires_in
        ? new Date(Date.now() + expires_in * 1000)
        : null;
      return { access_token, expiresAt };
    } catch (error) {
      // Fall back to using the original token rather than breaking the flow
      console.warn('[meta.service] Token exchange failed, using original token:', error.message);
      return { access_token: shortLivedToken, expiresAt: null };
    }
  }

  /**
   * Bug #6: Refresh a stored long-lived token before it expires.
   * Meta allows refreshing by exchanging it again — same endpoint works.
   */
  async refreshTokenForIntegration(integration) {
    try {
      const currentToken = this.decryptToken(integration.access_token);
      const { access_token: newToken, expiresAt } = await this.exchangeForLongLivedToken(currentToken);
      const encryptedToken = this.encryptToken(newToken);
      await integration.update({
        access_token: encryptedToken,
        token_expires_at: expiresAt,
        status: 'CONNECTED'
      });
      return integration;
    } catch (error) {
      await integration.update({ status: 'ERROR' });
      throw new AppError('Failed to refresh Meta token', 500);
    }
  }

  /**
   * Bug #6: Proactively refresh any integrations whose token expires within 7 days.
   * Call this from a daily cron job.
   */
  async refreshExpiringTokens() {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const { Op } = require('sequelize');
    const expiring = await MetaIntegration.findAll({
      where: {
        status: 'CONNECTED',
        token_expires_at: { [Op.lte]: sevenDaysFromNow }
      }
    });
    const results = await Promise.allSettled(
      expiring.map(integration => this.refreshTokenForIntegration(integration))
    );
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      console.error(`[meta.service] Token refresh: ${failed}/${expiring.length} integrations failed`);
    }
    return { refreshed: expiring.length - failed, failed };
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

    // Bug #6: exchange for long-lived token on connect
    const { access_token: longLivedToken, expiresAt } =
      await this.exchangeForLongLivedToken(accessToken);

    const encryptedToken = this.encryptToken(longLivedToken);

    // Create or update integration
    const [integration, created] = await MetaIntegration.upsert({
      shop_id: shopId,
      platform,
      meta_asset_id: metaAssetId,
      display_name: displayName,
      access_token: encryptedToken,
      token_expires_at: expiresAt,
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
   * Build the Facebook OAuth authorization URL for the popup window.
   * @param {string} state - CSRF state token (caller stores this in Redis before calling)
   * @param {string} channelType - 'facebook' | 'instagram'
   */
  buildOAuthUrl(state, channelType) {
    const scopes = channelType === 'instagram'
      ? 'pages_show_list,instagram_basic,instagram_manage_messages,instagram_manage_comments,pages_read_engagement,pages_manage_metadata'
      : 'pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata';

    const params = new URLSearchParams({
      client_id: config.metaAppId,
      redirect_uri: config.metaOAuthRedirectUri,
      scope: scopes,
      response_type: 'code',
      state
    });
    return `https://www.facebook.com/${META_CONFIG.graphApiVersion}/dialog/oauth?${params}`;
  }

  /**
   * Exchange an OAuth auth code for a short-lived user token, then extend to long-lived (~60 days).
   * Reuses the existing exchangeForLongLivedToken method.
   * @param {string} code - Auth code from Facebook OAuth redirect
   */
  async exchangeCodeForUserToken(code) {
    const response = await axios.get(
      `https://graph.facebook.com/${META_CONFIG.graphApiVersion}/oauth/access_token`,
      {
        params: {
          client_id: config.metaAppId,
          client_secret: config.metaAppSecret,
          redirect_uri: config.metaOAuthRedirectUri,
          code
        }
      }
    );
    return this.exchangeForLongLivedToken(response.data.access_token);
  }

  /**
   * Generate appsecret_proof for server-side Graph API calls.
   * Meta requires this when "Require App Secret" is enabled in the App Dashboard.
   * @param {string} accessToken
   */
  _buildAppSecretProof(accessToken) {
    return crypto.createHmac('sha256', config.metaAppSecret || process.env.META_APP_SECRET)
      .update(accessToken)
      .digest('hex');
  }

  /**
   * Get all Pages the authenticated user manages, including linked Instagram business accounts.
   * @param {string} userAccessToken - Long-lived user access token
   * @returns {Array} Array of page objects with id, name, category, picture, instagram_business_account
   */
  async getManagedPages(userAccessToken) {
    const response = await axios.get(
      `https://graph.facebook.com/${META_CONFIG.graphApiVersion}/me/accounts`,
      {
        params: {
          fields: 'id,name,category,picture{url},instagram_business_account{id,name,username}',
          access_token: userAccessToken,
          appsecret_proof: this._buildAppSecretProof(userAccessToken)
        }
      }
    );
    const pages = response.data.data || [];
    console.log(`[meta.service] getManagedPages returned ${pages.length} page(s)`);
    return pages;
  }

  /**
   * Check which permissions were actually granted in the user's access token.
   * Used to surface a specific error when pages_show_list is missing.
   * @param {string} userToken
   * @returns {string[]} Array of granted permission names
   */
  async checkPermissions(userToken) {
    const response = await axios.get(
      `https://graph.facebook.com/${META_CONFIG.graphApiVersion}/me/permissions`,
      { params: { access_token: userToken } }
    );
    return (response.data.data || [])
      .filter(p => p.status === 'granted')
      .map(p => p.permission);
  }

  /**
   * Get the Page-scoped access token for a specific Page.
   * Page access tokens are needed to send messages and subscribe webhooks.
   * @param {string} pageId - Facebook Page ID
   * @param {string} userAccessToken - Long-lived user access token
   */
  async getPageAccessToken(pageId, userAccessToken) {
    const response = await axios.get(
      `https://graph.facebook.com/${META_CONFIG.graphApiVersion}/${pageId}`,
      {
        params: {
          fields: 'access_token',
          access_token: userAccessToken,
          appsecret_proof: this._buildAppSecretProof(userAccessToken)
        }
      }
    );
    return response.data.access_token;
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
