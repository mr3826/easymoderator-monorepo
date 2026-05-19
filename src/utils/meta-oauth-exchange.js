'use strict';

/**
 * meta-oauth-exchange.js
 *
 * Standalone utility for exchanging a Meta short-lived or page access token
 * for a long-lived token via the Graph API `fb_exchange_token` grant.
 *
 * Extracted from meta.service.js during Phase 5 cutover so the token-refresh
 * job no longer imports the legacy meta.service module.
 *
 * Returns: { access_token: string, expiresAt: Date | null }
 */

const axios = require('axios');
const crypto = require('crypto');
const { createLogger } = require('./structured-logger');

const logger = createLogger('MetaOAuthExchange');

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Build the appsecret_proof HMAC required by the Meta Graph API when
 * calling server-side endpoints that accept a user access token.
 *
 * @param {string} token - The access token to prove
 * @returns {string} hex HMAC-SHA256
 */
function buildAppSecretProof(token) {
    const secret = process.env.META_APP_SECRET;
    if (!secret) throw new Error('META_APP_SECRET is not configured');
    return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * Exchange a Meta access token (short-lived user token OR existing page /
 * long-lived token) for a new long-lived token.
 *
 * Meta allows re-exchange of an already-long-lived token — the cron job
 * calls this on every 6-hour sweep for channels approaching expiry.
 *
 * @param {string} token - Current access token (plain-text, pre-decrypted)
 * @returns {Promise<{ access_token: string, expiresAt: Date|null }>}
 * @throws {Error} On HTTP/network failure — caller decides retry policy
 */
async function exchangeForLongLivedToken(token) {
    if (!token) throw new Error('exchangeForLongLivedToken: token is required');

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) throw new Error('META_APP_ID and META_APP_SECRET must be set');

    try {
        const response = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
            params: {
                grant_type: 'fb_exchange_token',
                client_id: appId,
                client_secret: appSecret,
                fb_exchange_token: token,
                appsecret_proof: buildAppSecretProof(token),
            },
        });

        const { access_token, expires_in } = response.data;
        const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null;

        logger.debug('Token exchange successful', { expiresAt });
        return { access_token, expiresAt };
    } catch (err) {
        const metaMsg = err.response?.data?.error?.message || err.message;
        const metaCode = err.response?.data?.error?.code;
        logger.error('Token exchange failed', { metaCode, metaMsg });
        // Re-throw so the caller (MetaTokenRefreshJob) can mark the channel TOKEN_EXPIRED
        throw new Error(`Meta token exchange failed: ${metaMsg}`);
    }
}

module.exports = { exchangeForLongLivedToken };
