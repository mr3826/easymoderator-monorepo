/**
 * MetaMessengerProvider
 *
 * Concrete ChannelProvider for Facebook Messenger.
 * Talks to the Meta Graph API on behalf of a connected Page.
 *
 * All outbound sends MUST receive a PolicyDecision with allow=true.
 * The provider honours decision.augment.message_tag for outside-24h sends.
 */

'use strict';

const axios = require('axios');
const crypto = require('crypto');
const ChannelProvider = require('../ChannelProvider');
const config = require('../../../config/config');
const { AppError } = require('../../../utils/AppError');
const { createLogger } = require('../../../utils/structured-logger');

const logger = createLogger('MetaMessengerProvider');

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const DEFAULT_SCOPES = [
    'pages_show_list',
    'pages_messaging',
    'pages_read_engagement',
    'pages_manage_metadata',
    'pages_manage_posts'  // added for comment reply support (Phase 4)
];

const WEBHOOK_FIELDS = [
    'messages',
    'messaging_postbacks',
    'messaging_optins',
    'message_deliveries',
    'message_reads',
    'feed'  // 'feed' carries comment events for Comment-to-DM (Phase 4)
];

function appsecretProof(token) {
    const secret = config.metaAppSecret || process.env.META_APP_SECRET;
    return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

function metaError(err, context) {
    const msg = err.response?.data?.error?.message || err.message;
    const code = err.response?.data?.error?.code;
    logger.error(`${context} failed`, { metaCode: code, metaMsg: msg });
    return new AppError(`${context}: ${msg}`, err.response?.status || 500);
}

class MetaMessengerProvider extends ChannelProvider {

    get platform() { return 'facebook'; }

    async buildAuthUrl({ state, scopes }) {
        const finalScopes = (scopes && scopes.length ? scopes : DEFAULT_SCOPES).join(',');
        const params = new URLSearchParams({
            client_id: config.metaAppId,
            redirect_uri: config.metaOAuthRedirectUri,
            scope: finalScopes,
            response_type: 'code',
            state
        });
        return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`;
    }

    async exchangeCode({ code, redirectUri }) {
        try {
            const short = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
                params: {
                    client_id: config.metaAppId,
                    client_secret: config.metaAppSecret,
                    redirect_uri: redirectUri || config.metaOAuthRedirectUri,
                    code
                }
            });
            const shortToken = short.data.access_token;

            // Extend to long-lived (~60 days)
            const long = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
                params: {
                    grant_type: 'fb_exchange_token',
                    client_id: config.metaAppId,
                    client_secret: config.metaAppSecret,
                    fb_exchange_token: shortToken,
                    appsecret_proof: appsecretProof(shortToken)
                }
            });

            const { access_token, expires_in } = long.data;
            return {
                userToken: access_token,
                expiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null
            };
        } catch (err) {
            throw metaError(err, 'exchangeCode');
        }
    }

    async listManagedAssets({ userToken, includeBusinessPortfolio = false }) {
        const PAGE_FIELDS =
            'id,name,category,access_token,' +
            'picture{data{url}},' +
            'instagram_business_account{id,name,username,profile_picture_url},' +
            'tasks';

        // ── Step 1: /me/accounts — REQUIRED. A failure here is fatal (nothing to show).
        const meAccountsRaw = [];
        try {
            let url = `${GRAPH_BASE}/me/accounts`;
            let params = {
                fields: PAGE_FIELDS,
                limit: 100,
                access_token: userToken,
                appsecret_proof: appsecretProof(userToken),
            };
            while (url) {
                const resp = await axios.get(url, { params });
                const batch = resp.data?.data || [];
                meAccountsRaw.push(...batch);
                const next = resp.data?.paging?.next;
                if (next && batch.length > 0) { url = next; params = {}; }
                else { url = null; }
            }
        } catch (err) {
            throw metaError(err, 'listManagedAssets:me/accounts');
        }

        // ── Step 2: Business Portfolio — OPTIONAL + ISOLATED. Only runs when the
        // caller opts in (i.e. business_management was actually granted). ANY failure
        // here is swallowed so it can never discard the Step 1 results above.
        const bizPagesRaw = [];
        let ownedCount = 0;
        let clientCount = 0;
        let portfolioError = null;
        if (includeBusinessPortfolio) {
            try {
                let bizUrl = `${GRAPH_BASE}/me/businesses`;
                let bizParams = {
                    fields: 'id,name',
                    limit: 100,
                    access_token: userToken,
                    appsecret_proof: appsecretProof(userToken),
                };
                const businesses = [];
                while (bizUrl) {
                    const resp = await axios.get(bizUrl, { params: bizParams });
                    const batch = resp.data?.data || [];
                    businesses.push(...batch);
                    const next = resp.data?.paging?.next;
                    if (next && batch.length > 0) { bizUrl = next; bizParams = {}; }
                    else { bizUrl = null; }
                }

                for (const biz of businesses) {
                    for (const edge of ['owned_pages', 'client_pages']) {
                        let edgeUrl = `${GRAPH_BASE}/${biz.id}/${edge}`;
                        let edgeParams = {
                            fields: PAGE_FIELDS,
                            limit: 100,
                            access_token: userToken,
                            appsecret_proof: appsecretProof(userToken),
                        };
                        while (edgeUrl) {
                            const resp = await axios.get(edgeUrl, { params: edgeParams });
                            const batch = resp.data?.data || [];
                            bizPagesRaw.push(...batch);
                            if (edge === 'owned_pages') ownedCount += batch.length;
                            else clientCount += batch.length;
                            const next = resp.data?.paging?.next;
                            if (next && batch.length > 0) { edgeUrl = next; edgeParams = {}; }
                            else { edgeUrl = null; }
                        }
                    }
                }
            } catch (err) {
                // Non-fatal and expected when business_management was not granted.
                // Captured here; the metaAssetsListed metrics log below carries
                // portfolioError, so we don't emit a separate (redundant) warn line.
                portfolioError = err.response?.data?.error?.message || err.message;
            }
        }

        // ── Step 3: merge + dedup by page id (me/accounts wins) ──
        const seenIds = new Set();
        const mergedRaw = [];
        for (const p of [...meAccountsRaw, ...bizPagesRaw]) {
            if (!seenIds.has(p.id)) { seenIds.add(p.id); mergedRaw.push(p); }
        }

        // ── Step 4: normalise ──
        const result = mergedRaw.map(p => ({
            id: p.id,
            name: p.name,
            category: p.category || null,
            pictureUrl: p.picture?.data?.url || p.picture?.url || null,
            instagramAccount: p.instagram_business_account
                ? {
                    id: p.instagram_business_account.id,
                    name: p.instagram_business_account.name,
                    username: p.instagram_business_account.username,
                }
                : null,
        }));

        // ── Per-source discovery metrics — emitted on every call ──
        // source_* counts are raw (pre-dedup); `deduped` is the post-merge total.
        logger.info('metaAssetsListed', {
            source_me_accounts: meAccountsRaw.length,
            source_owned_pages: ownedCount,
            source_client_pages: clientCount,
            portfolioAttempted: includeBusinessPortfolio,
            portfolioError,
            deduped: result.length,
            withIG: result.filter(p => p.instagramAccount !== null).length,
        });

        return result;
    }

    async getAssetAccessToken({ assetId, userToken }) {
        try {
            const resp = await axios.get(`${GRAPH_BASE}/${assetId}`, {
                params: {
                    fields: 'access_token',
                    access_token: userToken,
                    appsecret_proof: appsecretProof(userToken)
                }
            });
            return { token: resp.data.access_token, expiresAt: null };  // Page tokens are non-expiring
        } catch (err) {
            throw metaError(err, 'getAssetAccessToken');
        }
    }

    async refreshAssetToken({ channel }) {
        // Page Access Tokens derived from a long-lived User Access Token survive as long as
        // the user token. To refresh, exchange the current page token as the fb_exchange_token.
        const currentToken = channel.page_access_token_ct;  // entity getter decrypts
        if (!currentToken) throw new Error('refreshAssetToken: channel has no token');
        try {
            const resp = await axios.get(`${GRAPH_BASE}/oauth/access_token`, {
                params: {
                    grant_type: 'fb_exchange_token',
                    client_id: config.metaAppId,
                    client_secret: config.metaAppSecret,
                    fb_exchange_token: currentToken,
                    appsecret_proof: appsecretProof(currentToken)
                }
            });
            const { access_token, expires_in } = resp.data;
            return {
                token: access_token,
                expiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null
            };
        } catch (err) {
            throw metaError(err, 'refreshAssetToken');
        }
    }

    async revokeAsset({ channel }) {
        // Meta auto-revokes on user-side deauth. Best-effort unsubscribe is handled
        // separately via unsubscribeWebhook. No revoke endpoint to call here.
        return;
    }

    webhookFields() {
        return [...WEBHOOK_FIELDS];
    }

    async subscribeWebhook({ channel }) {
        const token = channel.page_access_token_ct;
        if (!token) throw new Error('subscribeWebhook: channel has no token');
        try {
            await axios.post(
                `${GRAPH_BASE}/${channel.meta_asset_id}/subscribed_apps`,
                null,
                {
                    params: {
                        access_token: token,
                        subscribed_fields: this.webhookFields().join(',')
                    }
                }
            );
        } catch (err) {
            throw metaError(err, 'subscribeWebhook');
        }
    }

    async unsubscribeWebhook({ channel }) {
        const token = channel.page_access_token_ct;
        if (!token) return;  // already disconnected — nothing to unsubscribe
        try {
            await axios.delete(
                `${GRAPH_BASE}/${channel.meta_asset_id}/subscribed_apps`,
                { params: { access_token: token } }
            );
        } catch (err) {
            // Non-fatal — channel is being disconnected anyway
            logger.warn('unsubscribeWebhook failed', { error: err.message, channelId: channel.id });
        }
    }

    async verifyWebhookSubscription({ channel }) {
        const token = channel.page_access_token_ct;
        const targetId = channel.meta_asset_id;
        if (!token) return { ok: false, fields: [] };
        try {
            const resp = await axios.get(`${GRAPH_BASE}/${targetId}/subscribed_apps`, {
                params: { access_token: token }
            });
            const apps = resp.data?.data || [];
            const fields = apps.flatMap(a => a.subscribed_fields || []);
            return { ok: apps.length > 0 && fields.includes('messages'), fields };
        } catch (err) {
            logger.warn('verifyWebhookSubscription failed', { error: err.message, channelId: channel.id });
            return { ok: false, fields: [] };
        }
    }

    async verifyWebhookSignature({ rawBody, signature }) {
        if (!signature || typeof signature !== 'string' || !signature.startsWith('sha256=')) {
            return false;
        }
        const expected = 'sha256=' + crypto
            .createHmac('sha256', process.env.META_WEBHOOK_APP_SECRET || config.metaAppSecret)
            .update(rawBody)
            .digest('hex');
        // timingSafeEqual requires equal-length buffers
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expected);
        return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
    }

    parseWebhookEnvelope(payload) {
        if (!payload || payload.object !== 'page' || !Array.isArray(payload.entry)) return [];

        const events = [];
        for (const entry of payload.entry) {
            const pageId = entry.id;

            // Messaging events
            for (const evt of entry.messaging || []) {
                const msg = evt.message;
                if (!msg) continue;
                const isEcho = msg.is_echo === true;
                if (isEcho) continue;  // drop echoes (page's own outbound reflected back)

                events.push({
                    externalId: msg.mid || null,
                    senderExternalId: evt.sender?.id || null,
                    pageOrAccountId: pageId,
                    text: msg.text || null,
                    attachments: (msg.attachments || []).map(a => ({
                        type: a.type || 'file',
                        url: a.payload?.url,
                        payload: a.payload
                    })),
                    isEcho: false,
                    commentId: null,
                    postId: null,
                    occurredAt: evt.timestamp || Date.now(),
                    raw: evt
                });
            }

            // Comment events (feed changes) — emitted as a separate event type for Phase 4
            for (const change of entry.changes || []) {
                if (change.field === 'feed' && change.value?.item === 'comment') {
                    const v = change.value;
                    events.push({
                        externalId: v.comment_id || null,
                        senderExternalId: v.from?.id || null,
                        pageOrAccountId: pageId,
                        text: v.message || null,
                        attachments: [],
                        isEcho: false,
                        commentId: v.comment_id || null,
                        postId: v.post_id || null,
                        occurredAt: (v.created_time ? v.created_time * 1000 : Date.now()),
                        raw: change
                    });
                }
            }
        }
        return events;
    }

    async sendMessage({ channel, recipientId, normalizedMessage, decision }) {
        if (!decision || decision.allow !== true) {
            throw new Error('sendMessage: PolicyDecision missing or denied');
        }
        const token = channel.page_access_token_ct;
        if (!token) throw new Error('sendMessage: channel has no token');

        const body = {
            recipient: { id: recipientId },
            message: { text: normalizedMessage.text }
        };
        if (decision.augment?.message_tag) {
            body.messaging_type = 'MESSAGE_TAG';
            body.tag = decision.augment.message_tag;
        } else {
            body.messaging_type = 'RESPONSE';
        }

        try {
            const resp = await axios.post(
                `${GRAPH_BASE}/me/messages`,
                body,
                { params: { access_token: token } }
            );
            return { providerMessageId: resp.data.message_id || null };
        } catch (err) {
            throw metaError(err, 'sendMessage');
        }
    }

    async sendPrivateReplyToComment({ channel, commentId, normalizedMessage }) {
        const token = channel.page_access_token_ct;
        if (!token) throw new Error('sendPrivateReplyToComment: channel has no token');
        try {
            const resp = await axios.post(
                `${GRAPH_BASE}/${commentId}/private_replies`,
                { message: normalizedMessage.text },
                { params: { access_token: token } }
            );
            return { providerMessageId: resp.data.id || null };
        } catch (err) {
            throw metaError(err, 'sendPrivateReplyToComment');
        }
    }

    async sendPublicCommentReply({ channel, commentId, text }) {
        const token = channel.page_access_token_ct;
        if (!token) throw new Error('sendPublicCommentReply: channel has no token');
        try {
            const resp = await axios.post(
                `${GRAPH_BASE}/${commentId}/comments`,
                { message: text },
                { params: { access_token: token } }
            );
            return { commentId: resp.data.id || null };
        } catch (err) {
            throw metaError(err, 'sendPublicCommentReply');
        }
    }

    async ping({ channel }) {
        const token = channel.page_access_token_ct;
        if (!token) return { ok: false, latencyMs: 0 };
        const start = Date.now();
        try {
            await axios.get(`${GRAPH_BASE}/${channel.meta_asset_id}`, {
                params: { fields: 'id', access_token: token }
            });
            return { ok: true, latencyMs: Date.now() - start };
        } catch (err) {
            return { ok: false, latencyMs: Date.now() - start };
        }
    }
}

module.exports = MetaMessengerProvider;
