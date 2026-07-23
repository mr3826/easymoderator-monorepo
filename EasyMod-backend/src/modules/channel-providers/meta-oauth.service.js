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
const MetaUserIdentity = require('./meta-user-identity.entity');
const { getProvider } = require('./provider.registry');
const { createLogger } = require('../../utils/structured-logger');
const stateStore = require('./oauth-state.store');

const logger = createLogger('MetaOAuthService');

function callbackKey(shopId, platform, token) {
    return `callback:${shopId}:${platform}:${token}`;
}

function findAuthorizedPage(pages, assetId) {
    return (Array.isArray(pages) ? pages : [])
        .find((page) => String(page.id) === String(assetId));
}

/**
 * Generate a CSRF-safe OAuth state token containing shopId + platform.
 * Signed with a random 128-bit nonce; stored in the temp store keyed by state.
 *
 * @param {string} userId
 * @param {string} shopId
 * @param {'facebook'} platform
 * @returns {{ redirectUrl: string, state: string }}
 */
async function initiateOAuth(userId, shopId, platform) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const state = `${platform}:${shopId}:${userId}:${nonce}`;

    await stateStore.put(state, { userId, shopId, platform });

    const provider = getProvider('facebook');
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
    const stored = await stateStore.take(state);
    if (!stored) {
        throw Object.assign(new Error('Invalid or expired OAuth state token'), { status: 400 });
    }

    const platform = stored.platform;
    const provider = getProvider('facebook');

    // Exchange code for long-lived user token
    const { userToken } = await provider.exchangeCode({ code });

    // List pages/IG accounts this user manages
    const [pages, metaIdentity] = await Promise.all([
        provider.listManagedAssets({ userToken }),
        provider.getOAuthIdentity({ userToken }),
    ]);

    // Store the user token server-side for the subsequent connectPage calls.
    // The returned tempToken is intentionally opaque: the frontend should never
    // need to hold a raw Meta user token, and connectPage validates assetId
    // against the exact pages returned by this callback.
    const tempToken = crypto.randomBytes(32).toString('hex');
    await stateStore.put(callbackKey(shopId, platform, tempToken), {
        userToken,
        platform,
        pages,
        metaIdentity,
        userId,
        shopId,
    });

    logger.info('OAuth callback processed', { shopId, platform, pageCount: pages.length });
    return { pages, tempToken };
}

/**
 * Connect a chosen page/IG asset to the shop.
 * Upserts a meta_channels row, subscribes webhook, returns the channel.
 *
 * @param {string} assetId
 * @param {string} displayName
 * @param {string} tempToken    — opaque callback token from handleCallback
 * @param {string} userId
 * @param {string} shopId
 * @param {'facebook'} platform — required; the temp-store callback entry is
 *   keyed by platform so the caller must say which one to consume.
 * @returns {MetaChannel}
 */
async function connectPage(assetId, displayName, tempToken, userId, shopId, platform) {
    if (!platform) {
        throw Object.assign(new Error('platform is required to connect a Meta asset'), { status: 400 });
    }

    const callbackPayload = await stateStore.get(callbackKey(shopId, platform, tempToken));
    if (!callbackPayload || callbackPayload.platform !== platform) {
        throw Object.assign(new Error('OAuth callback expired. Please reconnect Facebook and select the Page again.'), { status: 400 });
    }
    if (callbackPayload.userId && callbackPayload.userId !== userId) {
        throw Object.assign(new Error('OAuth callback belongs to a different user.'), { status: 403 });
    }
    if (callbackPayload.shopId && callbackPayload.shopId !== shopId) {
        throw Object.assign(new Error('OAuth callback belongs to a different shop.'), { status: 403 });
    }

    const authorizedPage = findAuthorizedPage(callbackPayload.pages, assetId);
    if (!authorizedPage) {
        throw Object.assign(new Error('This Facebook Page was not selected in the Meta authorization step. Please reconnect and select it in Facebook first.'), { status: 403 });
    }

    const provider = getProvider('facebook');

    // Get page-specific access token from the Messenger provider.
    const { token: pageToken, expiresAt } = await provider.getAssetAccessToken({
        assetId,
        userToken: callbackPayload.userToken,
    });

    // Upsert into meta_channels. NOTE: the key is `userId` — upsertFromOAuth
    // destructures `userId` (not `connectedByUserId`); the old name left
    // connected_by_user_id NULL on every connect.
    const channel = await metaChannelService.upsertFromOAuth({
        shopId,
        platform,
        metaAssetId: assetId,
        displayName: authorizedPage.name || displayName,
        pageAccessToken: pageToken,
        tokenExpiresAt: expiresAt,
        userId,
    });

    const metaIdentity = callbackPayload.metaIdentity;
    if (!metaIdentity?.appScopedUserId) {
        await metaChannelService.updateStatus(
            channel.id,
            'ERROR',
            'meta_identity_mapping_missing',
        );
        throw Object.assign(
            new Error('Meta identity could not be bound to this Page. Please reconnect Facebook.'),
            { status: 502, code: 'META_IDENTITY_MAPPING_REQUIRED' },
        );
    }

    const pageIdentity = (metaIdentity.pageScopedIdentities || [])
        .find((identity) => String(identity.pageId) === String(assetId));
    try {
        const [identityRow] = await MetaUserIdentity.findOrCreate({
            where: {
                app_scoped_user_id: String(metaIdentity.appScopedUserId),
                channel_id: channel.id,
            },
            defaults: {
                app_scoped_user_id: String(metaIdentity.appScopedUserId),
                page_scoped_user_id: pageIdentity?.pageScopedUserId || null,
                internal_user_id: userId,
                shop_id: shopId,
                channel_id: channel.id,
                source: 'facebook_oauth',
                last_verified_at: new Date(),
            },
        });
        await identityRow.update({
            page_scoped_user_id: pageIdentity?.pageScopedUserId || null,
            internal_user_id: userId,
            shop_id: shopId,
            last_verified_at: new Date(),
        });
    } catch (identityErr) {
        await metaChannelService.updateStatus(
            channel.id,
            'ERROR',
            'meta_identity_mapping_failed',
        );
        logger.error('Meta identity mapping failed', {
            channelId: channel.id,
            shopId,
            error: identityErr.message,
        });
        throw identityErr;
    }

    // Subscribe, then HARD-VERIFY. A page can report success on subscribe yet not
    // actually deliver — so we re-read subscribed_apps and only keep CONNECTED if
    // the app is really subscribed for `messages`.
    let webhookWarning = null;
    try {
        await provider.subscribeWebhook({ channel });
        const verify = await provider.verifyWebhookSubscription({ channel });
        if (verify.ok) {
            await metaChannelService.confirmWebhookActive(channel.id, verify.fields);
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

module.exports = { initiateOAuth, handleCallback, connectPage, _private: { callbackKey, findAuthorizedPage } };
