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
 * Every Graph API call atomically reserves its rate-limit slot immediately
 * beforehand via rateLimit.rule's reserveSendSlot() — see the send loop
 * below — and releases it if the send itself fails, so a slot Meta never
 * actually consumed doesn't count against the window.
 */

'use strict';

const axios = require('axios');
const crypto = require('crypto');
const ChannelProvider = require('../ChannelProvider');
const config = require('../../../config/config');
const { AppError } = require('../../../utils/AppError');
const { createLogger } = require('../../../utils/structured-logger');
const { reserveSendSlot, releaseSendSlot } = require('../../policy/rules/rateLimit.rule');
const { evaluatePageEligibility } = require('../meta-page-eligibility');

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

const PAGE_FIELDS =
    'id,name,category,access_token,' +
    'picture{data{url}},' +
    'tasks';
const PAGE_HYDRATION_FIELDS =
    'id,name,category,picture{data{url}},tasks,access_token';
const PAGE_HYDRATION_CONCURRENCY = 5;

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

function requestSecrets(err) {
    const secretParamNames = new Set([
        'access_token',
        'input_token',
        'appsecret_proof',
        'client_secret',
        'fb_exchange_token',
    ]);
    const secrets = Object.entries(err?.config?.params || {})
        .filter(([name, value]) => secretParamNames.has(name) && typeof value === 'string' && value.length > 0)
        .map(([, value]) => value);
    try {
        const url = new URL(err?.config?.url || '');
        for (const name of secretParamNames) {
            const value = url.searchParams.get(name);
            if (value) secrets.push(value);
        }
    } catch (_) { /* URL is optional on mocked/non-Axios errors. */ }
    return [...new Set(secrets.flatMap((secret) => [secret, encodeURIComponent(secret)]))];
}

function redactRequestSecrets(value, err) {
    let safe = String(value || 'Unknown Meta API error');
    for (const secret of requestSecrets(err)) {
        safe = safe.split(secret).join('[REDACTED]');
    }
    return safe;
}

function metaError(err, context) {
    const msg = err.response?.data?.error?.message || err.message;
    const meta = err.response?.data?.error || {};
    const safeMsg = redactRequestSecrets(msg, err);
    logger.error(`${context} failed`, {
        metaCode: meta.code,
        metaSubcode: meta.error_subcode,
        metaMsg: safeMsg,
    });
    const appError = new AppError(`${context}: ${safeMsg}`, err.response?.status || 500);
    // Preserve an explicit application-level safety failure. A successful HTTP
    // response without Meta's message_id is not a transport/API error: it is an
    // unconfirmed delivery and must remain retry-visible to the caller.
    appError.code = err.code === 'PROVIDER_NO_ACK' ? err.code : 'META_API_ERROR';
    appError.details = {
        metaCode: meta.code || null,
        metaSubcode: meta.error_subcode || null,
        isTransient: meta.is_transient === true,
    };
    return appError;
}

function selectedPageIdsFromDebugToken(debugData) {
    const granularScopes = Array.isArray(debugData?.granular_scopes)
        ? debugData.granular_scopes
        : [];
    const messagingScope = granularScopes.find((entry) => entry?.scope === 'pages_messaging');
    if (!Array.isArray(messagingScope?.target_ids)) return new Set();

    return new Set(
        messagingScope.target_ids
            .filter((id) => id !== null && id !== undefined && String(id).trim())
            .map(String),
    );
}

function hasNonEmptyAccessToken(page) {
    return typeof page?.access_token === 'string' && page.access_token.trim().length > 0;
}

/**
 * Follow Graph cursors without reusing Meta's `paging.next` URL. Meta embeds
 * the user token in that URL, and using it would also drop the signed params
 * required when App Secret Proof is enabled.
 */
async function paginateGraphCollection(url, params) {
    const items = [];
    let after = params?.after ?? null;
    const seenCursors = new Set();

    while (true) {
        const response = await axios.get(url, {
            params: after !== null && after !== undefined && String(after).length > 0
                ? { ...params, after }
                : { ...params },
        });
        const batch = Array.isArray(response.data?.data) ? response.data.data : [];
        items.push(...batch);

        const nextAfter = response.data?.paging?.cursors?.after;
        if (nextAfter === null || nextAfter === undefined || String(nextAfter).length === 0) break;

        const cursor = String(nextAfter);
        if (cursor === String(after) || seenCursors.has(cursor)) break;
        seenCursors.add(cursor);
        after = nextAfter;
    }

    return items;
}

async function mapWithConcurrency(values, concurrency, mapper) {
    const results = new Array(values.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, values.length);

    const worker = async () => {
        while (true) {
            const index = nextIndex++;
            if (index >= values.length) return;
            results[index] = await mapper(values[index], index);
        }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
}

async function hydratePageById(pageId, userToken) {
    try {
        const response = await axios.get(`${GRAPH_BASE}/${encodeURIComponent(pageId)}`, {
            params: {
                fields: PAGE_HYDRATION_FIELDS,
                access_token: userToken,
                appsecret_proof: appsecretProof(userToken),
            },
        });
        const page = response.data;
        if (String(page?.id) !== String(pageId)) {
            logger.warn('metaPageHydrationRejected', { pageId, reason: 'ID_MISMATCH' });
            return { page: null, status: 'rejected' };
        }
        if (!hasNonEmptyAccessToken(page)) {
            logger.warn('metaPageHydrationRejected', { pageId, reason: 'ACCESS_TOKEN_MISSING' });
            return { page: null, status: 'rejected' };
        }
        return { page, status: 'succeeded' };
    } catch (err) {
        // Never serialize the Graph error or request config: either can contain
        // the user token or its appsecret_proof.
        logger.warn('metaPageHydrationFailed', {
            pageId,
            metaCode: err.response?.data?.error?.code || null,
            metaSubcode: err.response?.data?.error?.error_subcode || null,
        });
        return { page: null, status: 'failed' };
    }
}

class MetaMessengerProvider extends ChannelProvider {

    get platform() { return 'facebook'; }

    async buildAuthUrl({ state, scopes, redirectUri }) {
        // OAuth scope selection is provider-owned for the Messenger-only launch.
        // Keep the base provider contract's `scopes` argument, but never let a
        // caller broaden or narrow this exact consent request.
        const finalScopes = DEFAULT_SCOPES.join(',');
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
                    appsecret_proof: appsecretProof(appAccessToken),
                },
            });
            const selectedPageIds = selectedPageIdsFromDebugToken(resp.data?.data || {});
            if (!selectedPageIds.size) {
                logger.warn('debugTokenGranularScopes missing Page target IDs; returning no connectable Pages');
            }
            return selectedPageIds;
        } catch (err) {
            throw metaError(err, 'debugTokenGranularScopes');
        }
    }

    async listManagedAssets({ userToken }) {
        // The pages granted for Messenger are the authorization boundary. This
        // must run even when /me/accounts is empty so a Business Portfolio Page
        // can be recovered through its exact granted target ID.
        const selectedPageIds = await this.getSelectedPageIds({ userToken });

        // /me/accounts is the only discovery edge used in the Messenger-only
        // launch. Do not query Business Portfolio edges here: that requires the
        // removed business_management permission and expands App Review scope.
        const meAccountsRaw = [];
        try {
            meAccountsRaw.push(...await paginateGraphCollection(`${GRAPH_BASE}/me/accounts`, {
                fields: PAGE_FIELDS,
                limit: 100,
                access_token: userToken,
                appsecret_proof: appsecretProof(userToken),
            }));
        } catch (err) {
            throw metaError(err, 'listManagedAssets:me/accounts');
        }

        const meAccountsById = new Map();
        for (const page of meAccountsRaw) {
            const pageId = page?.id === null || page?.id === undefined ? '' : String(page.id);
            if (!pageId) continue;
            const current = meAccountsById.get(pageId);
            // Prefer a duplicate row that actually contains a Page token.
            if (!current || (!hasNonEmptyAccessToken(current) && hasNonEmptyAccessToken(page))) {
                meAccountsById.set(pageId, page);
            }
        }

        const pagesById = new Map();
        const targetsNeedingHydration = [...selectedPageIds]
            .filter((pageId) => !hasNonEmptyAccessToken(meAccountsById.get(pageId)));
        for (const [pageId, page] of meAccountsById) {
            if (selectedPageIds.has(pageId) && hasNonEmptyAccessToken(page)) {
                pagesById.set(pageId, { ...page, source: 'ME_ACCOUNTS' });
            }
        }

        const hydrationResults = await mapWithConcurrency(
            targetsNeedingHydration,
            PAGE_HYDRATION_CONCURRENCY,
            (pageId) => hydratePageById(pageId, userToken),
        );
        const hydrationStats = {
            attempted: targetsNeedingHydration.length,
            succeeded: 0,
            failed: 0,
            rejected: 0,
        };
        hydrationResults.forEach((hydration, index) => {
            if (hydration.status === 'succeeded') {
                hydrationStats.succeeded += 1;
                pagesById.set(targetsNeedingHydration[index], {
                    ...hydration.page,
                    source: 'GRANULAR_TARGET',
                });
            } else if (hydration.status === 'failed') {
                hydrationStats.failed += 1;
            } else {
                hydrationStats.rejected += 1;
            }
        });

        const visiblePages = [...pagesById.values()]
            .filter((page) => selectedPageIds.has(String(page.id)) && hasNonEmptyAccessToken(page));

        const result = visiblePages.map((p) => {
            const eligibility = evaluatePageEligibility(p.tasks);
            return {
                id: String(p.id),
                name: p.name,
                category: p.category || null,
                pictureUrl: p.picture?.data?.url || p.picture?.url || null,
                tasks: eligibility.tasks,
                connectable: eligibility.connectable,
                reason: eligibility.reason,
            };
        });

        logger.info('metaAssetsListed', {
            source_me_accounts: meAccountsRaw.length,
            source_owned_pages: 0,
            source_client_pages: 0,
            portfolioAttempted: false,
            portfolioError: null,
            source_granular_target: hydrationStats.succeeded,
            selected_target_ids: selectedPageIds.size,
            filtered_unselected_pages: meAccountsRaw.filter((page) => !selectedPageIds.has(String(page?.id))).length,
            hydration_attempted: hydrationStats.attempted,
            hydration_succeeded: hydrationStats.succeeded,
            hydration_failed: hydrationStats.failed,
            hydration_rejected: hydrationStats.rejected,
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
            const identities = await paginateGraphCollection(`${GRAPH_BASE}/${appScopedUserId}/ids_for_pages`, {
                fields: 'id,page',
                limit: 100,
                access_token: userToken,
                appsecret_proof: appsecretProof(userToken),
            });
            for (const item of identities) {
                const pageId = item?.page?.id || item?.page_id || item?.page?.data?.id;
                if (pageId && item?.id) {
                    pageScopedIdentities.push({
                        pageId: String(pageId),
                        pageScopedUserId: String(item.id),
                    });
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
            const resp = await axios.get(`${GRAPH_BASE}/${encodeURIComponent(assetId)}`, {
                params: {
                    fields: 'access_token',
                    access_token: userToken,
                    appsecret_proof: appsecretProof(userToken)
                }
            });
            const token = resp.data?.access_token;
            if (!hasNonEmptyAccessToken({ access_token: token })) {
                throw new AppError(
                    'Meta did not return a Page access token',
                    502,
                    'META_PAGE_ACCESS_TOKEN_MISSING',
                );
            }
            return { token, expiresAt: null };  // Page tokens are non-expiring
        } catch (err) {
            if (err instanceof AppError) throw err;
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
            logger.warn('unsubscribeWebhook failed', {
                channelId: channel.id,
                metaCode: err.response?.data?.error?.code || null,
                metaSubcode: err.response?.data?.error?.error_subcode || null,
            });
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
            logger.warn('verifyWebhookSubscription failed', {
                channelId: channel.id,
                targetId,
                metaCode: err.response?.data?.error?.code || null,
                metaSubcode: err.response?.data?.error?.error_subcode || null,
            });
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
                    inReplyToExternalId: msg.reply_to?.mid || null,
                    replyToIsSelfReply: msg.reply_to?.is_self_reply === true,
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
                const reservation = await reserveSendSlot(channel.meta_asset_id);
                if (!reservation.allowed) {
                    const rateLimitError = new Error('Meta send rate limit reached');
                    rateLimitError.code = 'META_RATE_LIMIT';
                    rateLimitError.retryAfterMs = reservation.retryAfterMs;
                    throw rateLimitError;
                }
                try {
                    const resp = await axios.post(
                        `${GRAPH_BASE}/me/messages`,
                        body,
                        {
                            params: { access_token: token, appsecret_proof: appsecretProof(token) },
                            timeout: 30_000,
                        }
                    );
                    const providerMessageId = resp.data?.message_id;
                    if (!providerMessageId) {
                        const error = new Error('Meta did not return a provider message ID');
                        error.code = 'PROVIDER_NO_ACK';
                        throw error;
                    }
                    providerMessageIds.push(String(providerMessageId));
                } catch (sendErr) {
                    await releaseSendSlot(channel.meta_asset_id, reservation.member);
                    throw sendErr;
                }
            }
            return {
                providerMessageId: providerMessageIds[providerMessageIds.length - 1] || null,
                providerMessageIds,
            };
        } catch (err) {
            if (err.code === 'META_RATE_LIMIT') {
                throw err;
            }
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
            await axios.get(`${GRAPH_BASE}/${encodeURIComponent(channel.meta_asset_id)}`, {
                params: { fields: 'id', access_token: token, appsecret_proof: appsecretProof(token) }
            });
            return { ok: true, latencyMs: Date.now() - start };
        } catch (err) {
            return { ok: false, latencyMs: Date.now() - start };
        }
    }
}

module.exports = MetaMessengerProvider;
module.exports._private = { selectedPageIdsFromDebugToken };
