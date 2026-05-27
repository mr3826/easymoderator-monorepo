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

    async listManagedAssets({ userToken }) {
        try {
            // Fetch all pages the user manages, following pagination cursors.
            // Without limit=100, Meta uses a server-side default (often 10–25) that
            // silently truncates merchants who manage many pages — producing an empty
            // or partial picker. We follow `paging.next` until exhausted.
            const fields = 'id,name,category,picture{url},instagram_business_account{id,name,username}';
            const allRaw = [];

            let url = `${GRAPH_BASE}/me/accounts`;
            let params = {
                fields,
                limit: 100,
                access_token: userToken,
                appsecret_proof: appsecretProof(userToken),
            };

            while (url) {
                const resp = await axios.get(url, { params });
                const batch = resp.data?.data || [];
                allRaw.push(...batch);

                // Follow cursor-based pagination if Meta signals more pages exist.
                const next = resp.data?.paging?.next;
                if (next && batch.length > 0) {
                    // The `next` URL already contains all params (including access_token
                    // and appsecret_proof), so pass it as-is without extra params.
                    url = next;
                    params = {};
                } else {
                    url = null;
                }
            }

            return allRaw.map(p => ({
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
        } catch (err) {
            throw metaError(err, 'listManagedAssets');
        }
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
