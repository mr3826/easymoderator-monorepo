'use strict';

/**
 * meta-oauth.service.js
 *
 * Phase 5: replaces the deleted channel/channel.oauth.service.js.
 *
 * Implements the Meta OAuth lifecycle using the provider registry:
 *   - initiateOAuth()   — builds the OAuth redirect URL + CSRF state token
 *   - handleCallback()  — exchanges code → long-lived user token + lists pages
 *   - connectPage()     — connects the chosen page/IG account to the shop
 *
 * All channel writes go to meta_channels only (legacy dual-write removed).
 */

const crypto = require('crypto');
const metaChannelService = require('./meta-channel.service');
const { getProvider } = require('./provider.registry');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('MetaOAuthService');

// In-memory temp-token store (keyed by state).
// A Redis-backed store could be used here if needed; for short-lived OAuth state
// (< 15 minutes) in-memory is sufficient and avoids a Redis dependency.
const _tempTokenStore = new Map();
const TEMP_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function storeTemp(state, payload) {
    _tempTokenStore.set(state, { payload, expiresAt: Date.now() + TEMP_TOKEN_TTL_MS });
}

function consumeTemp(state) {
    const entry = _tempTokenStore.get(state);
    if (!entry) return null;
    _tempTokenStore.delete(state);
    if (Date.now() > entry.expiresAt) return null;
    return entry.payload;
}

/**
 * Generate a CSRF-safe OAuth state token containing shopId + platform.
 * Signed with a random 128-bit nonce; stored in the temp store keyed by state.
 *
 * @param {string} userId
 * @param {string} shopId
 * @param {'facebook'|'instagram'} platform
 * @returns {{ redirectUrl: string, state: string }}
 */
async function initiateOAuth(userId, shopId, platform) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = `${platform}:${shopId}:${userId}:${nonce}`;

    storeTemp(state, { userId, shopId, platform });

    const provider = getProvider(platform === 'instagram' ? 'instagram' : 'facebook');
    const redirectUrl = await provider.buildAuthUrl({ state, scopes: [] });

    logger.info('OAuth initiated', { shopId, platform });
    return { redirectUrl, state };
}

/**
 * Exchange the OAuth code for a long-lived user token + list the pages/IG
 * accounts the user manages.
 *
 * @param {string} code
 * @param {string} state  — must match a previously stored initiateOAuth state
 * @param {string} userId
 * @param {string} shopId
 * @returns {{ pages: Asset[], tempToken: string }}
 */
async function handleCallback(code, state, userId, shopId) {
    // Recover state (validates CSRF nonce)
    const stored = consumeTemp(state);
    if (!stored) {
        throw Object.assign(new Error('Invalid or expired OAuth state token'), { status: 400 });
    }

    const platform = stored.platform;
    const provider = getProvider(platform === 'instagram' ? 'instagram' : 'facebook');

    // Exchange code for long-lived user token
    const { userToken } = await provider.exchangeCode({ code });

    // List pages/IG accounts this user manages
    const pages = await provider.listManagedAssets({ userToken });

    // Store the user token for the subsequent connectPage call. The key is
    // scoped by platform so concurrent FB and IG OAuth flows for the same shop
    // do not clobber each other's callback payloads.
    const tempToken = userToken;
    storeTemp(`callback:${shopId}:${platform}`, { userToken, platform, pages });

    logger.info('OAuth callback processed', { shopId, platform, pageCount: pages.length });
    return { pages, tempToken };
}

/**
 * Connect a chosen page/IG asset to the shop.
 * Upserts a meta_channels row, subscribes webhook, returns the channel.
 *
 * @param {string} assetId
 * @param {string} displayName
 * @param {string} tempToken    — long-lived user access token from handleCallback
 * @param {string} userId
 * @param {string} shopId
 * @param {'facebook'|'instagram'} platform — required since Phase 1; concurrent
 *   FB + IG flows for the same shop now use distinct temp-store keys, so the
 *   caller must say which one to consume.
 * @returns {MetaChannel}
 */
async function connectPage(assetId, displayName, tempToken, userId, shopId, platform) {
    if (!platform) {
        throw Object.assign(new Error('platform is required to connect a Meta asset'), { status: 400 });
    }
    // Consume the platform-scoped callback entry. Other platforms' entries (if
    // a concurrent flow is in progress) remain untouched.
    consumeTemp(`callback:${shopId}:${platform}`);

    const provider = getProvider(platform === 'instagram' ? 'instagram' : 'facebook');

    // Get page-specific access token.
    // MetaInstagramProvider.getAssetAccessToken also returns linkedFbPageId (the
    // parent Facebook Page ID required for IG webhook subscription).
    // MetaMessengerProvider returns { token, expiresAt } with no linkedFbPageId.
    const { token: pageToken, expiresAt, linkedFbPageId = null } = await provider.getAssetAccessToken({
        assetId,
        userToken: tempToken,
    });

    // Upsert into meta_channels
    const channel = await metaChannelService.upsertFromOAuth({
        shopId,
        platform,
        metaAssetId: assetId,
        displayName,
        pageAccessToken: pageToken,
        tokenExpiresAt: expiresAt,
        linkedFbPageId,          // null for FB pages; parent Page ID for IG accounts
        connectedByUserId: userId,
    });

    // Subscribe, then HARD-VERIFY. A page can report success on subscribe yet not
    // actually deliver — so we re-read subscribed_apps and only keep CONNECTED if
    // the app is really subscribed for `messages`.
    let webhookWarning = null;
    try {
        await provider.subscribeWebhook({ channel });
        const verify = await provider.verifyWebhookSubscription({ channel });
        if (verify.ok) {
            await metaChannelService.confirmWebhookActive(channel.id);
            logger.info('Webhook subscribed + verified', { channelId: channel.id, platform });
        } else {
            webhookWarning = 'Webhook subscription could not be verified — action required.';
            await metaChannelService.updateStatus(channel.id, 'ERROR', 'webhook_subscription_unverified');
            logger.warn('Webhook unverified after subscribe', { channelId: channel.id, fields: verify.fields });
        }
    } catch (err) {
        webhookWarning = `Webhook subscription failed: ${err.message}`;
        await metaChannelService.updateStatus(channel.id, 'ERROR', 'webhook_subscription_failed');
        logger.warn('Webhook subscription failed', { channelId: channel.id, err: err.message });
    }

    logger.info('Asset connected', { shopId, assetId, channelId: channel.id, webhookWarning: !!webhookWarning });
    return { ...channel.toJSON(), webhookWarning };
}

/**
 * Unified FB+IG OAuth: one consent dialog covering both platforms.
 * Customer-facing benefit — single popup instead of two. Backed by the
 * MetaMessengerProvider since `me/accounts` already returns both pages and
 * their linked instagram_business_account.
 *
 * Scopes combine MessengerProvider.DEFAULT_SCOPES + InstagramProvider.DEFAULT_SCOPES,
 * de-duped. The auth URL still hits dialog/oauth — same endpoint, wider scope.
 */
async function initiateUnifiedOAuth(userId, shopId) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = `unified:${shopId}:${userId}:${nonce}`;

    storeTemp(state, { userId, shopId, platform: 'unified' });

    // business_management was intentionally REMOVED before App Review: it is a
    // high-sensitivity scope and the only thing it bought was discovering pages
    // owned by a Business Portfolio that /me/accounts omits — a minority of BD
    // f-commerce merchants, who are personal Page admins. Portfolio discovery is
    // now opt-in (MetaMessengerProvider.listManagedAssets includeBusinessPortfolio)
    // and isolated, so its absence degrades gracefully to /me/accounts only.
    //
    // Provider DEFAULT_SCOPES are module-private; this list mirrors them.
    const unifiedScopes = [
        'pages_show_list',
        'pages_messaging',
        'pages_read_engagement',
        'pages_manage_metadata',
        'pages_manage_posts',
        'instagram_basic',
        'instagram_manage_messages',
        'instagram_manage_comments',
    ];

    // Build the auth URL via the Messenger provider (same dialog endpoint).
    const fb = getProvider('facebook');
    const redirectUrl = await fb.buildAuthUrl({ state, scopes: unifiedScopes });

    logger.info('Unified OAuth initiated', { shopId, scopeCount: unifiedScopes.length });
    return { redirectUrl, state };
}

/**
 * Unified callback: returns BOTH FB pages and their linked IG accounts in a
 * single response so the picker can render everything the merchant can connect.
 *
 * Stored tempToken is keyed under both 'facebook' and 'instagram' so the
 * existing per-platform connectAsset() works unchanged for either platform.
 */
async function handleUnifiedCallback(code, state, userId, shopId) {
    const stored = consumeTemp(state);
    if (!stored) {
        throw Object.assign(new Error('Invalid or expired OAuth state token'), { status: 400 });
    }

    const fb = getProvider('facebook');

    // Single token exchange via Messenger provider.
    const { userToken } = await fb.exchangeCode({ code });

    // `me/accounts` already includes nested instagram_business_account when
    // the page has one linked — MessengerProvider.listManagedAssets exposes it
    // as `instagramAccount` on each page entry.
    const pages = await fb.listManagedAssets({ userToken, includeBusinessPortfolio: false });

    // Flatten into two arrays for the frontend: facebook pages + instagram accounts.
    const facebookPages = pages.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        pictureUrl: p.pictureUrl,
        platform: 'facebook',
    }));
    const instagramAccounts = pages
        .filter(p => p.instagramAccount?.id)
        .map(p => ({
            id: p.instagramAccount.id,
            name: p.instagramAccount.name || p.instagramAccount.username,
            username: p.instagramAccount.username,
            linkedPageId: p.id,
            linkedPageName: p.name,
            platform: 'instagram',
        }));

    const tempToken = userToken;
    // Store under BOTH platform keys so connectAsset(platform, ...) works for either.
    storeTemp(`callback:${shopId}:facebook`, { userToken, platform: 'facebook', pages: facebookPages });
    storeTemp(`callback:${shopId}:instagram`, { userToken, platform: 'instagram', pages: instagramAccounts });

    logger.info('Unified OAuth callback processed', {
        shopId,
        fbPageCount: facebookPages.length,
        igAccountCount: instagramAccounts.length,
    });

    return { facebookPages, instagramAccounts, tempToken };
}

module.exports = { initiateOAuth, handleCallback, connectPage, initiateUnifiedOAuth, handleUnifiedCallback };
