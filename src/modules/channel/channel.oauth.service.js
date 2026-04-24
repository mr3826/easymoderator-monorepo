const crypto = require('crypto');
const metaService = require('../integration/meta.service');
const channelService = require('./channel.service');
const cache = require('../../utils/cache.service');
const { AppError } = require('../../utils/AppError');

// State and temp tokens expire after 10 minutes — matches Facebook's auth code TTL
const OAUTH_TTL_SECONDS = 600;

class ChannelOAuthService {

  /**
   * Step 1 — Generate CSRF state token, build Facebook OAuth URL.
   * Stores state in Redis: oauth:state:{state} → { shopId, userId, channelType }
   *
   * @param {string} userId
   * @param {string} shopId
   * @param {'facebook'|'instagram'} channelType
   * @returns {{ redirectUrl: string, state: string }}
   */
  async initiateOAuth(userId, shopId, channelType) {
    const state = crypto.randomBytes(32).toString('hex'); // 64 hex chars
    await cache._set(
      `oauth:state:${state}`,
      { shopId, userId, channelType },
      OAUTH_TTL_SECONDS
    );
    const redirectUrl = metaService.buildOAuthUrl(state, channelType);
    return { redirectUrl, state };
  }

  /**
   * Step 2 — Validate CSRF state, exchange auth code for token, return Page list.
   * Stores user token in Redis as tempToken (never exposed to frontend).
   *
   * @param {string} code   - OAuth auth code from Facebook
   * @param {string} state  - CSRF state token returned by initiateOAuth
   * @param {string} userId
   * @param {string} shopId
   * @returns {{ pages: FacebookPage[], tempToken: string }}
   */
  async handleCallback(code, state, userId, shopId) {
    // Validate CSRF state
    const stateData = await cache._get(`oauth:state:${state}`);
    if (!stateData || stateData.shopId !== shopId || stateData.userId !== userId) {
      throw new AppError('Invalid or expired OAuth state', 400);
    }
    await cache._delete(`oauth:state:${state}`);

    // Exchange code → long-lived user access token
    const { access_token: userToken } = await metaService.exchangeCodeForUserToken(code);

    // Verify pages_show_list was granted — if missing, /me/accounts silently returns []
    const grantedPerms = await metaService.checkPermissions(userToken);
    if (!grantedPerms.includes('pages_show_list')) {
      throw new AppError('pages_show_list permission was not granted. Please reconnect and allow page access.', 403);
    }

    // Fetch Pages this user manages (with linked Instagram accounts)
    const rawPages = await metaService.getManagedPages(userToken);

    // For Instagram, only pages with a linked Instagram Business Account can receive DMs
    const filteredPages = stateData.channelType === 'instagram'
      ? rawPages.filter(p => p.instagram_business_account?.id)
      : rawPages;

    const pages = filteredPages.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category || null,
      pictureUrl: p.picture?.data?.url || null,
      instagramAccount: p.instagram_business_account
        ? {
            id: p.instagram_business_account.id,
            name: p.instagram_business_account.name,
            username: p.instagram_business_account.username
          }
        : null
    }));

    // Store user token server-side — frontend only gets an opaque reference
    const tempToken = crypto.randomBytes(32).toString('hex'); // 64 hex chars
    await cache._set(
      `oauth:temp:${tempToken}`,
      { userToken, channelType: stateData.channelType, shopId, userId },
      OAUTH_TTL_SECONDS
    );

    return { pages, tempToken };
  }

  /**
   * Step 3 — Connect a selected Facebook Page as a Channel.
   * Gets Page Access Token, upserts Channel record, subscribes webhook.
   *
   * @param {string} pageId    - Facebook Page ID selected by user
   * @param {string} pageName  - Display name of the Page
   * @param {string} tempToken - Opaque reference to the stored user token
   * @param {string} userId
   * @param {string} shopId
   * @returns {Channel}
   */
  async connectPage(pageId, pageName, tempToken, userId, shopId) {
    const tokenData = await cache._get(`oauth:temp:${tempToken}`);
    if (!tokenData || tokenData.shopId !== shopId || tokenData.userId !== userId) {
      throw new AppError('Invalid or expired connection token', 400);
    }

    const { userToken, channelType } = tokenData;

    // Get the Page Access Token (needed to send messages and subscribe webhooks)
    const pageAccessToken = await metaService.getPageAccessToken(pageId, userToken);

    // For Instagram: the channel identifier is the linked IG Business Account ID, not the Page ID
    let finalPageId = pageId;
    if (channelType === 'instagram') {
      const pages = await metaService.getManagedPages(userToken);
      const page = pages.find(p => p.id === pageId);
      if (page?.instagram_business_account?.id) {
        finalPageId = page.instagram_business_account.id;
      }
    }

    // Upsert Channel — existing service handles AES-256 encryption and UNIQUE(shop_id, channel_type)
    const channel = await channelService.connectChannel(userId, shopId, {
      type: channelType,
      name: pageName,
      page_id: finalPageId,
      systemUserToken: pageAccessToken
    });

    // Upsert MetaIntegration so the webhook handler can route incoming messages to this shop.
    // Must succeed before we return — without it, no conversations will be created.
    await metaService.upsertIntegration(shopId, channelType, finalPageId, pageName, pageAccessToken);

    // Subscribe page to Meta webhooks — await it so failure is surfaced in the response
    let webhookSubscribed = true;
    let webhookWarning = null;
    try {
      await metaService.subscribeToWebhooks(pageAccessToken, pageId, channelType);
    } catch (err) {
      webhookSubscribed = false;
      webhookWarning = 'Channel connected but webhook subscription failed. Messages may not arrive until you re-connect the channel.';
      console.error('[channel.oauth] Webhook subscription failed:', err.message);
    }

    // Clean up temp token — single-use
    await cache._delete(`oauth:temp:${tempToken}`);

    return { ...channel.toJSON?.() ?? channel, webhookSubscribed, webhookWarning };
  }
}

module.exports = new ChannelOAuthService();
