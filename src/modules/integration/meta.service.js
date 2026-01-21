const axios = require('axios');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const MetaIntegration = require('./meta-integration.entity');
const config = require('src/config/config');
const AppError = require('src/utils/AppError');

// Meta OAuth configuration
const META_CONFIG = {
  clientId: process.env.META_APP_ID,
  clientSecret: process.env.META_APP_SECRET,
  redirectUri: process.env.META_REDIRECT_URI || `${process.env.BASE_URL || 'http://localhost:3000'}/integrations/meta/callback`,
  graphApiVersion: 'v18.0'
};

// Platform mappings
const PLATFORM_MAPPINGS = {
  messenger: {
    scopes: ['pages_show_list', 'pages_messaging', 'pages_read_engagement'],
    assetType: 'page'
  },
  instagram: {
    scopes: ['instagram_basic', 'instagram_manage_messages'],
    assetType: 'instagram_account'
  },
  whatsapp: {
    scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
    assetType: 'whatsapp_business_account'
  }
};

class MetaService {
  constructor() {
    if (!META_CONFIG.clientId || !META_CONFIG.clientSecret) {
      throw new Error('Meta OAuth configuration missing. Please set META_APP_ID and META_APP_SECRET environment variables.');
    }
  }

  /**
   * Generate OAuth URL for Meta login
   */
  generateOAuthUrl(shopId, platform) {
    if (!PLATFORM_MAPPINGS[platform]) {
      throw new AppError('Invalid platform specified', 400);
    }

    // Create signed state containing shop_id and platform
    const state = jwt.sign(
      { shop_id: shopId, platform },
      config.jwtAccessSecret,
      { expiresIn: '10m' }
    );

    // Build scopes (union of all platforms for unified login)
    const allScopes = [...new Set(
      Object.values(PLATFORM_MAPPINGS).flatMap(p => p.scopes)
    )];

    const params = new URLSearchParams({
      client_id: META_CONFIG.clientId,
      redirect_uri: META_CONFIG.redirectUri,
      state,
      scope: allScopes.join(','),
      response_type: 'code'
    });

    return `https://www.facebook.com/${META_CONFIG.graphApiVersion}/dialog/oauth?${params}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code) {
    try {
      const response = await axios.post(
        `https://graph.facebook.com/${META_CONFIG.graphApiVersion}/oauth/access_token`,
        null,
        {
          params: {
            client_id: META_CONFIG.clientId,
            client_secret: META_CONFIG.clientSecret,
            redirect_uri: META_CONFIG.redirectUri,
            code
          }
        }
      );

      return {
        access_token: response.data.access_token,
        token_type: response.data.token_type,
        expires_in: response.data.expires_in
      };
    } catch (error) {
      throw new AppError('Failed to exchange code for token', 400);
    }
  }

  /**
   * Exchange short-lived token for long-lived token
   */
  async exchangeForLongLivedToken(shortLivedToken) {
    try {
      const response = await axios.get(
        `https://graph.facebook.com/${META_CONFIG.graphApiVersion}/oauth/access_token`,
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: META_CONFIG.clientId,
            client_secret: META_CONFIG.clientSecret,
            fb_exchange_token: shortLivedToken
          }
        }
      );

      return {
        access_token: response.data.access_token,
        token_type: response.data.token_type,
        expires_in: response.data.expires_in
      };
    } catch (error) {
      throw new AppError('Failed to get long-lived token', 400);
    }
  }

  /**
   * Fetch user's Meta assets (Pages, Instagram accounts, WhatsApp accounts)
   */
  async fetchUserAssets(accessToken) {
    try {
      const [pagesResponse, whatsappResponse] = await Promise.all([
        // Fetch Facebook Pages
        axios.get(`https://graph.facebook.com/${META_CONFIG.graphApiVersion}/me/accounts`, {
          params: { access_token: accessToken }
        }).catch(() => ({ data: { data: [] } })),

        // Fetch WhatsApp Business Accounts
        axios.get(`https://graph.facebook.com/${META_CONFIG.graphApiVersion}/me/whatsapp_business_accounts`, {
          params: { access_token: accessToken }
        }).catch(() => ({ data: { data: [] } }))
      ]);

      const assets = {
        pages: pagesResponse.data.data || [],
        whatsapp_accounts: whatsappResponse.data.data || [],
        instagram_accounts: []
      };

      // Fetch Instagram accounts for each page
      for (const page of assets.pages) {
        try {
          const igResponse = await axios.get(
            `https://graph.facebook.com/${META_CONFIG.graphApiVersion}/${page.id}`,
            {
              params: {
                fields: 'instagram_business_account',
                access_token: page.access_token
              }
            }
          );

          if (igResponse.data.instagram_business_account) {
            const igAccount = await axios.get(
              `https://graph.facebook.com/${META_CONFIG.graphApiVersion}/${igResponse.data.instagram_business_account.id}`,
              {
                params: {
                  fields: 'id,name,username',
                  access_token: page.access_token
                }
              }
            );
            assets.instagram_accounts.push({
              ...igAccount.data,
              page_id: page.id,
              page_access_token: page.access_token
            });
          }
        } catch (error) {
          // Instagram account might not exist or be accessible
          continue;
        }
      }

      return assets;
    } catch (error) {
      throw new AppError('Failed to fetch Meta assets', 500);
    }
  }

  /**
   * Subscribe to webhooks for a specific asset
   */
  async subscribeToWebhooks(accessToken, assetId, platform) {
    try {
      const subscriptionData = {
        object: platform === 'messenger' ? 'page' : platform,
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
      case 'messenger':
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
    const cipher = crypto.createCipher(algorithm, key);
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

      const decipher = crypto.createDecipher(algorithm, key);
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
   * Validate and decode OAuth state
   */
  validateOAuthState(state) {
    try {
      return jwt.verify(state, config.jwtAccessSecret);
    } catch (error) {
      throw new AppError('Invalid or expired OAuth state', 400);
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
    const platforms = ['messenger', 'instagram', 'whatsapp'];
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