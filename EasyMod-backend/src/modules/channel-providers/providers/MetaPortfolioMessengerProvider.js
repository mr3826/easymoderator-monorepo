'use strict';

/**
 * Scope-safe Facebook Page discovery hardening.
 *
 * Meta can omit Business Portfolio-owned Pages from /me/accounts even when
 * the user explicitly selected those Pages in the OAuth dialog. The base
 * provider already attempts a rich direct-Page hydration, but Meta can reject
 * that request when optional Page metadata/task fields are unavailable while
 * still allowing the documented Page-token lookup.
 *
 * This provider keeps the existing three-permission App Review surface. It
 * only falls back for Page IDs that the token debugger proves were granted to
 * BOTH pages_messaging and pages_manage_metadata, then asks Meta for the
 * minimal id/name/access_token fields. No Business Portfolio edge and no
 * business_management permission is used.
 */

const axios = require('axios');
const crypto = require('crypto');
const MetaMessengerProvider = require('./MetaMessengerProvider');
const config = require('../../../config/config');
const { createLogger } = require('../../../utils/structured-logger');
const { recordGraphError } = require('../meta-discovery-canary');
const {
    PAGE_GRANT_MODE,
    interpretPageGrants,
    intersectPageGrants,
    grantAllowsPage,
    createGrant,
} = require('../meta-page-grants');
const PAGE_TASK_AVAILABILITY = Object.freeze({ PRESENT: 'PRESENT', UNAVAILABLE: 'UNAVAILABLE' });

const logger = createLogger('MetaPortfolioMessengerProvider');
const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function appsecretProof(token) {
    const secret = config.metaAppSecret || process.env.META_APP_SECRET;
    if (!secret || !token) return null;
    return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

function canPreserveBaseAfterStrictProbeFailure(err) {
    const status = Number(err?.response?.status);
    const graphError = err?.response?.data?.error || {};
    if (graphError.is_transient === true || status === 429 || status >= 500) return true;
    if (err?.response) return false;
    return [
        'ECONNABORTED',
        'ECONNRESET',
        'ECONNREFUSED',
        'EHOSTUNREACH',
        'ETIMEDOUT',
        'EAI_AGAIN',
        'ENETUNREACH',
        'ENOTFOUND',
        'ERR_NETWORK',
    ].includes(err?.code);
}

function retainPageCredential(pageCredentials, page) {
    if (!pageCredentials || typeof pageCredentials !== 'object') return;
    if (page?.id === null || page?.id === undefined) return;
    if (typeof page.access_token !== 'string' || page.access_token.trim() === '') return;

    const pageId = String(page.id);
    pageCredentials[pageId] = {
        pageId,
        token: page.access_token,
        expiresAt: null,
    };
}

class MetaPortfolioMessengerProvider extends MetaMessengerProvider {
    async getStrictGrantedPageIds({ userToken, diagnostics = null }) {
        const appId = config.metaAppId || process.env.META_APP_ID;
        const appSecret = config.metaAppSecret || process.env.META_APP_SECRET;
        const appAccessToken = `${appId}|${appSecret}`;

        try {
            const response = await axios.get(`${GRAPH_BASE}/debug_token`, {
                params: {
                    input_token: userToken,
                    access_token: appAccessToken,
                    appsecret_proof: appsecretProof(appAccessToken),
                },
            });
            const debugData = response.data?.data || {};
            const pageGrants = interpretPageGrants(debugData, appId);
            const operationalPageGrant = intersectPageGrants(
                pageGrants.pages_messaging,
                pageGrants.pages_manage_metadata,
            );
            const strictPageGrant = intersectPageGrants(
                operationalPageGrant,
                pageGrants.pages_show_list,
            );
            if (diagnostics) {
                diagnostics.portfolioGrantMode = strictPageGrant.mode;
                diagnostics.portfolioOperationalGrantMode = operationalPageGrant.mode;
                diagnostics.portfolioMessagingGrantMode = pageGrants.pages_messaging.mode;
                diagnostics.portfolioMetadataGrantMode = pageGrants.pages_manage_metadata.mode;
            }
            return strictPageGrant;
        } catch (err) {
            if (diagnostics) recordGraphError(diagnostics, 'portfolio_strict_debug_token', err);
            // The base provider has already completed its normal discovery. A
            // fallback diagnostic failure must never hide Pages that are valid
            // through /me/accounts.
            logger.warn('metaPortfolioGrantProbeFailed', {
                metaCode: err.response?.data?.error?.code || null,
                metaSubcode: err.response?.data?.error?.error_subcode || null,
            });
            return createGrant(
                PAGE_GRANT_MODE.UNKNOWN,
                [],
                canPreserveBaseAfterStrictProbeFailure(err)
                    ? 'DEBUG_TOKEN_UNAVAILABLE'
                    : 'STRICT_PROBE_FAILED_CLOSED',
            );
        }
    }

    async hydrateStrictGrantedPage(pageId, userToken, pageCredentials, diagnostics = null) {
        try {
            const response = await axios.get(`${GRAPH_BASE}/${encodeURIComponent(pageId)}`, {
                params: {
                    fields: 'id,name,access_token',
                    access_token: userToken,
                    appsecret_proof: appsecretProof(userToken),
                },
            });
            const page = response.data || {};
            if (String(page.id || '') !== String(pageId)) return null;
            if (typeof page.access_token !== 'string' || page.access_token.trim() === '') return null;
            retainPageCredential(pageCredentials, page);
            if (diagnostics && String(pageId) === diagnostics.expectedPageId) {
                diagnostics.hydration.minimal.httpStatus = Number.isInteger(response.status) ? response.status : 200;
                diagnostics.hydration.minimal.status = 'PASS';
                diagnostics.hydration.minimal.expectedPageToken = 'YES';
            }

            // Tasks are unavailable in the minimal request. The provider
            // returns explicit provenance so connectPage can use the verified
            // granular permissions and exact Page token without fabricating a
            // Meta `tasks` response.
            return {
                id: String(page.id),
                name: page.name || `Facebook Page ${page.id}`,
                category: null,
                pictureUrl: null,
                tasks: [],
                connectable: true,
                reason: null,
                eligibilitySource: 'GRANULAR_PERMISSIONS',
                taskAvailability: PAGE_TASK_AVAILABILITY.UNAVAILABLE,
            };
        } catch (err) {
            if (diagnostics && String(pageId) === diagnostics.expectedPageId) {
                diagnostics.hydration.minimal.status = 'FAIL';
                recordGraphError(diagnostics, 'portfolio_minimal_hydration', err);
            }
            logger.warn('metaPortfolioMinimalHydrationFailed', {
                pageId: String(pageId),
                metaCode: err.response?.data?.error?.code || null,
                metaSubcode: err.response?.data?.error?.error_subcode || null,
            });
            return null;
        }
    }

    async listManagedAssets({ userToken, pageCredentials, diagnostics = null }) {
        const baseAssets = await super.listManagedAssets({ userToken, pageCredentials, diagnostics });
        const strictPageGrant = await this.getStrictGrantedPageIds({ userToken, diagnostics });
        // ALL is already bounded by the base provider's authorized
        // /me/accounts response. Only EXPLICIT grants can add exact IDs that
        // were omitted from that response through direct hydration.
        if (strictPageGrant.mode === PAGE_GRANT_MODE.UNKNOWN
            && strictPageGrant.reason === 'DEBUG_TOKEN_UNAVAILABLE') {
            return baseAssets;
        }
        if (strictPageGrant.mode === PAGE_GRANT_MODE.ALL) return baseAssets;
        if (strictPageGrant.mode !== PAGE_GRANT_MODE.EXPLICIT) return [];

        const byId = new Map(
            (Array.isArray(baseAssets) ? baseAssets : [])
                .filter((asset) => asset?.id !== null && asset?.id !== undefined)
                .filter((asset) => grantAllowsPage(strictPageGrant, asset.id))
                .map((asset) => [String(asset.id), asset]),
        );

        const fallbackIds = [...strictPageGrant.pageIds]
            .filter((pageId) => grantAllowsPage(strictPageGrant, pageId))
            .filter((pageId) => {
                const baseAsset = byId.get(pageId);
                if (!baseAsset) return true;
                if (baseAsset.connectable === true) return false;
                // A base result marked PRESENT is explicit eligibility
                // evidence, including an empty task array. Never replace an
                // explicit rejection with permission-only minimal hydration.
                return baseAsset.taskAvailability === PAGE_TASK_AVAILABILITY.UNAVAILABLE;
            });
        if (!fallbackIds.length) return [...byId.values()];

        if (diagnostics) diagnostics.portfolioFallbackAttempted = fallbackIds.length;

        const hydrated = await Promise.all(
            fallbackIds.map((pageId) => this.hydrateStrictGrantedPage(pageId, userToken, pageCredentials, diagnostics)),
        );
        let recovered = 0;
        hydrated.forEach((asset) => {
            if (!asset) return;
            byId.set(String(asset.id), asset);
            recovered += 1;
        });
        if (diagnostics) diagnostics.portfolioFallbackRecovered = recovered;

        logger.info('metaPortfolioPagesRecovered', {
            strict_granted_pages: strictPageGrant.pageIds.size,
            fallback_attempted: fallbackIds.length,
            fallback_recovered: recovered,
            total_pages: byId.size,
        });
        return [...byId.values()];
    }
}

module.exports = MetaPortfolioMessengerProvider;
