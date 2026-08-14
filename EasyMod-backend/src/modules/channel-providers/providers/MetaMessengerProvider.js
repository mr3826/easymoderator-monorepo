/**
 * MetaMessengerProvider
 *
 * Concrete ChannelProvider for Facebook Messenger.
 * Talks to the Meta Graph API on behalf of a connected Page.
 *
 * All outbound sends MUST receive a PolicyDecision with allow=true.
 * When decision.augment.message_tag is set (twentyFourHourWindow rule, for
 * out-of-24h-window sends), it is put on the wire as the Send API `tag`.
 *
 * Every successful Graph API send also records itself into the
 * `meta:sends:{pageId}` ZSET that rateLimit.rule reads — see
 * recordSendForRateLimit() below.
 */

'use strict';

const axios = require('axios');
const crypto = require('crypto');
const ChannelProvider = require('../ChannelProvider');
const config = require('../../../config/config');
const { AppError } = require('../../../utils/AppError');
const { createLogger } = require('../../../utils/structured-logger');
const { cacheRedis } = require('../../../config/redis');
const { keyFor: rateLimitKeyFor } = require('../../policy/rules/rateLimit.rule');

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

// Meta accepts appsecret_proof on every Graph call and *requires* it once
// "Require App Secret Proof for Server API calls" is switched on in the App
// Dashboard. Send it everywhere — page-token calls included — so flipping that
// setting can never break the Send API or the webhook subscription mid-review.
// Returns null (which axios drops from the query string) when either input is
// missing, so a misconfigured test env degrades instead of throwing.
function appsecretProof(token) {
    const secret = config.metaAppSecret || process.env.META_APP_SECRET;
    if (!secret || !token) return null;
    return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

function metaError(err, context) {
    const msg = err.response?.data?.error?.message || err.message;
    const meta = err.response?.data?.error || {};
    logger.error(`${context} failed`, {
        metaCode: meta.code,
        metaSubcode: meta.error_subcode,
        metaMsg: msg,
    });
    const appError = new AppError(`${context}: ${msg}`, err.response?.status || 500);
    appError.code = 'META_API_ERROR';
    appError.details = {
        metaCode: meta.code || null,
        metaSubcode: meta.error_subcode || null,
        isTransient: meta.is_transient === true,
    };
    return appError;
}

// Write side of the send-rate limit: rateLimit.rule only ever reads this
// ZSET, so without this the check always sees zero sends. One ZADD per real
// Graph API call, scored by send time (ms epoch) — same key + scoring scheme
// rateLimit.rule prunes/zcards against. Best-effort: a Redis blip must never
// fail a send that Meta already accepted.
async function recordSendForRateLimit(pageId) {
    if (!pageId) return;
    try {
        await cacheRedis.zadd(rateLimitKeyFor(pageId), Date.now(), `${Date.now()}-${crypto.randomUUID()}`);
    } catch (err) {
        logger.warn('sendMessage: failed to record rate-limit send event', { error: err.message, pageId });
    }
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

    async buildAuthUrl({ state, scopes, redirectUri }) {
        const finalScopes = (scopes && scopes.length ? scopes : DEFAULT_SCOPES).join(',');
        const params = new URLSearchParams({
            client_id: config.metaAppId,
            redirect_uri: redirectUri || config.metaOAuthRedirectUri,
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

    async getOAuthIdentity({ userToken }) {
        let appScopedUserId;
        try {
            const me = await axios.get(`${GRAPH_BASE}/me`, {
                params: {
                    fields: 'id',
                    access_token: userToken,
                    appsecret_proof: appsecretProof(userToken),
                },
            });
            appScopedUserId = me.data?.id ? String(me.data.id) : null;
        } catch (err) {
            throw metaError(err, 'getOAuthIdentity:me');
        }

        if (!appScopedUserId) {
            throw new AppError(
                'Meta OAuth identity response did not include an app-scoped user ID',
                502,
                'META_IDENTITY_UNAVAILABLE',
            );
        }

        const pageScopedIdentities = [];
        try {
            let url = `${GRAPH_BASE}/${appScopedUserId}/ids_for_pages`;
            let params = {
                fields: 'id,page',
                limit: 100,
                access_token: userToken,
                appsecret_proof: appsecretProof(userToken),
            };
            while (url) {
                const response = await axios.get(url, { params });
                const batch = Array.isArray(response.data?.data) ? response.data.data : [];
                for (const item of batch) {
                    const pageId = item?.page?.id || item?.page_id || item?.page?.data?.id;
                    if (pageId && item?.id) {
                        pageScopedIdentities.push({
                            pageId: String(pageId),
                            pageScopedUserId: String(item.id),
                        });
                    }
                }
                const next = response.data?.paging?.next;
                if (next && batch.length > 0) {
                    url = next;
                    params = {};
                } else {
                    url = null;
                }
            }
        } catch (err) {
            // Meta does not expose this edge for every app/user combination.
            // Keep the verified app-scoped identity for deauthorization, but do
            // not invent a Page-scoped customer identity for deletion.
            logger.warn('getOAuthIdentity: ids_for_pages unavailable', {
                metaCode: err.response?.data?.error?.code,
            });
        }

        return { appScopedUserId, pageScopedIdentities };
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
                        appsecret_proof: appsecretProof(token),
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
        if (!token) return { ok: true, skipped: true };
        try {
            await axios.delete(
                `${GRAPH_BASE}/${channel.meta_asset_id}/subscribed_apps`,
                { params: { access_token: token, appsecret_proof: appsecretProof(token) } }
            );
            return { ok: true };
        } catch (err) {
            logger.warn('unsubscribeWebhook failed', { error: err.message, channelId: channel.id });
            return { ok: false, error: metaError(err, 'unsubscribeWebhook') };
        }
    }

    async verifyWebhookSubscription({ channel }) {
        const token = channel.page_access_token_ct;
        const targetId = channel.meta_asset_id;
        if (!token) return { ok: false, fields: [] };
        try {
            const resp = await axios.get(`${GRAPH_BASE}/${targetId}/subscribed_apps`, {
                params: { access_token: token, appsecret_proof: appsecretProof(token) }
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
                    { params: { access_token: token, appsecret_proof: appsecretProof(token) } }
                );
                providerMessageIds.push(resp.data.message_id || null);
                await recordSendForRateLimit(channel.meta_asset_id);
            }
            return {
                providerMessageId: providerMessageIds[providerMessageIds.length - 1] || null,
                providerMessageIds,
            };
        } catch (err) {
            const normalized = metaError(err, 'sendMessage');
            if ([102, 190].includes(Number(normalized.details?.metaCode))) {
                try {
                    await require('../meta-authorization-recovery.service')
                        .recoverInvalidToken(channel, normalized.details);
                } catch (recoveryError) {
                    logger.error('Invalid Meta token recovery failed', {
                        channelId: channel.id,
                        error: recoveryError.message,
                    });
                    // Do not convert the message into an unrecoverable job until
                    // the durable channel/token recovery transition succeeds.
                    normalized.code = 'META_AUTHORIZATION_RECOVERY_FAILED';
                    normalized.status = 503;
                    normalized.details = {
                        ...normalized.details,
                        recoveryPending: true,
                    };
                    throw normalized;
                }
                normalized.code = 'META_AUTHORIZATION_REQUIRED';
                normalized.status = 401;
            }
            throw normalized;
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
