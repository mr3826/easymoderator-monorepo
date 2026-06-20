/**
 * MetaInstagramProvider
 *
 * Concrete ChannelProvider for Instagram DMs.
 *
 * Instagram messaging works through the parent Facebook Page:
 *   - OAuth is granted on the FB Page that the IG Business Account is linked to
 *   - The Page Access Token is what sends messages (IG uses Page token under the hood)
 *   - meta_asset_id stored is the IG Business Account ID
 *   - linked_fb_page_id stored is the parent Page (needed for webhook subscription)
 */

'use strict';

const axios = require('axios');
const crypto = require('crypto');
const ChannelProvider = require('../ChannelProvider');
const config = require('../../../config/config');
const { AppError } = require('../../../utils/AppError');
const { createLogger } = require('../../../utils/structured-logger');

const logger = createLogger('MetaInstagramProvider');

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

const DEFAULT_SCOPES = [
    'pages_show_list',
    'instagram_basic',
    'instagram_manage_messages',
    'instagram_manage_comments',
    'pages_read_engagement',
    'pages_manage_metadata',
    'pages_manage_posts'
];

// These are sent as the PARENT PAGE's `subscribed_apps` subscribed_fields (IG
// webhooks ride the linked Facebook Page). They MUST be valid *page-object*
// fields: Meta rejects the ENTIRE subscribe call if any value isn't one — e.g.
// `comments`/`live_comments` are Instagram-OBJECT fields and are INVALID here
// (the live error was `... } - got "comments"`), which silently left every IG
// channel un-subscribed (no inbound DMs/comments ever delivered).
//
// Actual IG message/comment delivery is governed by the app-level `instagram`
// webhook object subscription (App Dashboard → Webhooks → instagram), NOT by
// these page fields. We mirror the Messenger provider's valid page set so that
// when a Page is connected for BOTH FB and IG, whichever subscribes last does
// not clobber the other's fields.
const WEBHOOK_FIELDS = [
    'messages',
    'messaging_postbacks',
    'messaging_optins',
    'message_deliveries',
    'message_reads',
    'feed'
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

class MetaInstagramProvider extends ChannelProvider {

    get platform() { return 'instagram'; }

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
            const resp = await axios.get(`${GRAPH_BASE}/me/accounts`, {
                params: {
                    fields: 'id,name,category,picture{url},instagram_business_account{id,name,username,profile_picture_url}',
                    access_token: userToken,
                    appsecret_proof: appsecretProof(userToken)
                }
            });
            const pages = resp.data?.data || [];
            // Filter to pages that have a linked IG Business Account, then return the IG account as the "asset"
            return pages
                .filter(p => p.instagram_business_account?.id)
                .map(p => ({
                    id: p.instagram_business_account.id,
                    name: p.instagram_business_account.name || p.instagram_business_account.username,
                    category: 'instagram',
                    pictureUrl: p.instagram_business_account.profile_picture_url || p.picture?.data?.url || null,
                    linkedFbPageId: p.id,
                    fbPageName: p.name,
                    instagramUsername: p.instagram_business_account.username
                }));
        } catch (err) {
            throw metaError(err, 'listManagedAssets');
        }
    }

    async getAssetAccessToken({ assetId, userToken }) {
        // For IG, assetId is the IG Business Account ID. We need the parent Page's access token.
        // Caller is expected to also know linked_fb_page_id; lookup if not provided.
        try {
            // Find which Page owns this IG business account
            const pagesResp = await axios.get(`${GRAPH_BASE}/me/accounts`, {
                params: {
                    fields: 'id,instagram_business_account{id}',
                    access_token: userToken,
                    appsecret_proof: appsecretProof(userToken)
                }
            });
            const parentPage = (pagesResp.data?.data || []).find(
                p => p.instagram_business_account?.id === assetId
            );
            if (!parentPage) throw new AppError(`IG account ${assetId} not linked to any managed page`, 404);

            // Get the parent Page's access token
            const tokenResp = await axios.get(`${GRAPH_BASE}/${parentPage.id}`, {
                params: {
                    fields: 'access_token',
                    access_token: userToken,
                    appsecret_proof: appsecretProof(userToken)
                }
            });

            return {
                token: tokenResp.data.access_token,
                expiresAt: null,
                linkedFbPageId: parentPage.id
            };
        } catch (err) {
            if (err instanceof AppError) throw err;
            throw metaError(err, 'getAssetAccessToken');
        }
    }

    async refreshAssetToken({ channel }) {
        const currentToken = channel.page_access_token_ct;
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
        return;  // Meta auto-revokes on user-side deauth
    }

    webhookFields() {
        return [...WEBHOOK_FIELDS];
    }

    async subscribeWebhook({ channel }) {
        // IG webhooks come through the parent Page's subscribed_apps endpoint
        const subscribeTargetId = channel.linked_fb_page_id || channel.meta_asset_id;
        const token = channel.page_access_token_ct;
        if (!token) throw new Error('subscribeWebhook: channel has no token');
        try {
            await axios.post(
                `${GRAPH_BASE}/${subscribeTargetId}/subscribed_apps`,
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
        const subscribeTargetId = channel.linked_fb_page_id || channel.meta_asset_id;
        const token = channel.page_access_token_ct;
        if (!token) return;
        try {
            await axios.delete(
                `${GRAPH_BASE}/${subscribeTargetId}/subscribed_apps`,
                { params: { access_token: token } }
            );
        } catch (err) {
            logger.warn('unsubscribeWebhook failed', { error: err.message, channelId: channel.id });
        }
    }

    async verifyWebhookSubscription({ channel }) {
        const token = channel.page_access_token_ct;
        const targetId = channel.linked_fb_page_id || channel.meta_asset_id;
        if (!token) return { ok: false, fields: [] };
        try {
            const resp = await axios.get(`${GRAPH_BASE}/${targetId}/subscribed_apps`, {
                params: { access_token: token }
            });
            const apps = resp.data?.data || [];
            const fields = apps.flatMap(a => a.subscribed_fields || []);
            return { ok: apps.length > 0 && fields.includes('messages'), fields };
        } catch (err) {
            logger.warn('verifyWebhookSubscription failed', { error: err.message, channelId: channel.id, targetId });
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
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expected);
        return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
    }

    parseWebhookEnvelope(payload) {
        if (!payload || payload.object !== 'instagram' || !Array.isArray(payload.entry)) return [];

        const events = [];
        for (const entry of payload.entry) {
            const igAccountId = entry.id;

            // Messaging events
            for (const evt of entry.messaging || []) {
                const msg = evt.message;
                if (!msg) continue;
                const isEcho = msg.is_echo === true;
                if (isEcho) continue;

                events.push({
                    externalId: msg.mid || null,
                    senderExternalId: evt.sender?.id || null,
                    pageOrAccountId: igAccountId,
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

            // Comment events
            for (const change of entry.changes || []) {
                if (change.field === 'comments') {
                    const v = change.value;
                    events.push({
                        externalId: v?.id || null,
                        senderExternalId: v?.from?.id || null,
                        pageOrAccountId: igAccountId,
                        text: v?.text || null,
                        attachments: [],
                        isEcho: false,
                        commentId: v?.id || null,
                        postId: v?.media?.id || null,
                        occurredAt: Date.now(),
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
                `${GRAPH_BASE}/${commentId}/replies`,
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

module.exports = MetaInstagramProvider;
