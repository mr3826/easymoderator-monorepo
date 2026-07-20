/**
 * MetaMessengerProvider
 *
 * Concrete ChannelProvider for Facebook Messenger.
 * Talks to the Meta Graph API on behalf of a connected Page.
 *
 * All outbound sends MUST receive a PolicyDecision with allow=true.
 * The provider can attach decision.augment.message_tag only if a future
 * policy-approved template/tag path supplies it. Legacy Messenger tags are
 * blocked by policy for the BD launch.
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
    'pages_manage_metadata'
];

const WEBHOOK_FIELDS = [
    'messages'
];

const GRANULAR_PAGE_SCOPES = [
    'pages_messaging',
    'pages_manage_metadata',
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

function intersectSets(sets) {
    if (!sets.length) return null;
    const [first, ...rest] = sets;
    return new Set([...first].filter((id) => rest.every((set) => set.has(id))));
}

function selectedPageIdsFromDebugToken(debugData) {
    const granularScopes = Array.isArray(debugData?.granular_scopes)
        ? debugData.granular_scopes
        : [];
    const targetedScopeSets = GRANULAR_PAGE_SCOPES
        .map((scope) => granularScopes.find((entry) => entry?.scope === scope))
        .map((entry) => Array.isArray(entry?.target_ids)
            ? new Set(entry.target_ids.map(String))
            : null)
        .filter(Boolean);

    return intersectSets(targetedScopeSets);
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

    async getSelectedPageIds({ userToken }) {
        const appId = config.metaAppId || process.env.META_APP_ID;
        const appSecret = config.metaAppSecret || process.env.META_APP_SECRET;
        const appAccessToken = `${appId}|${appSecret}`;
        try {
            const resp = await axios.get(`${GRAPH_BASE}/debug_token`, {
                params: {
                    input_token: userToken,
                    access_token: appAccessToken,
                },
            });
            const selectedPageIds = selectedPageIdsFromDebugToken(resp.data?.data || {});
            if (!selectedPageIds) {
                logger.warn('debugTokenGranularScopes missing Page target IDs; returning no connectable Pages');
                return new Set();
            }
            return selectedPageIds;
        } catch (err) {
            throw metaError(err, 'debugTokenGranularScopes');
        }
    }

    async listManagedAssets({ userToken }) {
        const PAGE_FIELDS =
            'id,name,category,access_token,' +
            'picture{data{url}},' +
            'tasks';

        // /me/accounts is the only discovery edge used in the Messenger-only
        // launch. Do not query Business Portfolio edges here: that requires the
        // removed business_management permission and expands App Review scope.
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

        const selectedPageIds = meAccountsRaw.length
            ? await this.getSelectedPageIds({ userToken })
            : null;
        const visiblePages = selectedPageIds
            ? meAccountsRaw.filter((p) => selectedPageIds.has(String(p.id)))
            : meAccountsRaw;

        const result = visiblePages.map(p => ({
            id: p.id,
            name: p.name,
            category: p.category || null,
            pictureUrl: p.picture?.data?.url || p.picture?.url || null,
        }));

        logger.info('metaAssetsListed', {
            source_me_accounts: meAccountsRaw.length,
            source_owned_pages: 0,
            source_client_pages: 0,
            portfolioAttempted: false,
            portfolioError: null,
            selected_target_ids: selectedPageIds ? selectedPageIds.size : null,
            filtered_unselected_pages: selectedPageIds ? meAccountsRaw.length - visiblePages.length : 0,
            deduped: result.length,
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
            const requiredFields = this.webhookFields();
            return {
                ok: apps.length > 0 && requiredFields.every(field => fields.includes(field)),
                fields
            };
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
            .createHmac('sha256', process.env.META_APP_SECRET || config.metaAppSecret)
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

            // Page feed/comment changes are intentionally ignored for launch.
            // EasyModerator only handles customer-initiated Messenger DMs.
        }
        return events;
    }

    async sendMessage({ channel, recipientId, normalizedMessage, decision }) {
        if (!decision || decision.allow !== true) {
            throw new Error('sendMessage: PolicyDecision missing or denied');
        }
        const token = channel.page_access_token_ct;
        if (!token) throw new Error('sendMessage: channel has no token');

        const attachments = Array.isArray(normalizedMessage.attachments)
            ? normalizedMessage.attachments.filter(a => a?.url)
            : [];
        const bodies = [];
        if (normalizedMessage.text?.trim()) {
            bodies.push({
                recipient: { id: recipientId },
                message: { text: normalizedMessage.text.trim() }
            });
        }
        for (const attachment of attachments) {
            const type = attachment.type === 'image' ? 'image' : 'file';
            bodies.push({
                recipient: { id: recipientId },
                message: {
                    attachment: {
                        type,
                        payload: {
                            url: attachment.url,
                            is_reusable: true,
                        }
                    }
                }
            });
        }
        if (bodies.length === 0) {
            throw new Error('sendMessage: text or attachment is required');
        }
        for (const body of bodies) {
            if (decision.augment?.message_tag) {
                body.messaging_type = 'MESSAGE_TAG';
                body.tag = decision.augment.message_tag;
            } else {
                body.messaging_type = 'RESPONSE';
            }
        }

        try {
            const providerMessageIds = [];
            for (const body of bodies) {
                const resp = await axios.post(
                    `${GRAPH_BASE}/me/messages`,
                    body,
                    { params: { access_token: token } }
                );
                providerMessageIds.push(resp.data.message_id || null);
            }
            return {
                providerMessageId: providerMessageIds[providerMessageIds.length - 1] || null,
                providerMessageIds,
            };
        } catch (err) {
            throw metaError(err, 'sendMessage');
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
module.exports._private = { selectedPageIdsFromDebugToken };
