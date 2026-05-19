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

    // Store the user token for the subsequent connectPage call
    const tempToken = userToken;
    storeTemp(`callback:${shopId}`, { userToken, platform, pages });

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
 * @returns {MetaChannel}
 */
async function connectPage(assetId, displayName, tempToken, userId, shopId) {
    // Determine platform: try Facebook first, then IG
    // We could accept platform from the caller; for now detect from stored state
    const storedCallback = consumeTemp(`callback:${shopId}`);
    const platform = storedCallback?.platform || 'facebook';

    const provider = getProvider(platform === 'instagram' ? 'instagram' : 'facebook');

    // Get page-specific access token
    const { token: pageToken, expiresAt } = await provider.getAssetAccessToken({
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
        connectedByUserId: userId,
    });

    // Best-effort webhook subscription
    let webhookWarning = null;
    try {
        await provider.subscribeWebhook({ channel });
        logger.info('Webhook subscribed', { channelId: channel.id, platform });
    } catch (err) {
        webhookWarning = `Webhook subscription failed: ${err.message}`;
        logger.warn('Webhook subscription failed (non-fatal)', { channelId: channel.id, err: err.message });
    }

    logger.info('Asset connected', { shopId, assetId, channelId: channel.id, webhookWarning: !!webhookWarning });
    return { ...channel.toJSON(), webhookWarning };
}

module.exports = { initiateOAuth, handleCallback, connectPage };
