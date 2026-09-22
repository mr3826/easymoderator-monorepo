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

const logger = createLogger('MetaPortfolioMessengerProvider');
const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v22.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function appsecretProof(token) {
    const secret = config.metaAppSecret || process.env.META_APP_SECRET;
    if (!secret || !token) return null;
    return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

function targetSet(debugData, scope) {
    const granularScopes = Array.isArray(debugData?.granular_scopes)
        ? debugData.granular_scopes
        : [];
    const entry = granularScopes.find((candidate) => candidate?.scope === scope);
    if (!Array.isArray(entry?.target_ids)) return new Set();
    return new Set(
        entry.target_ids
            .filter((id) => id !== null && id !== undefined && String(id).trim())
            .map(String),
    );
}

function intersect(left, right) {
    return new Set([...left].filter((id) => right.has(id)));
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
    async getStrictGrantedPageIds({ userToken }) {
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
            return intersect(
                targetSet(debugData, 'pages_messaging'),
                targetSet(debugData, 'pages_manage_metadata'),
            );
        } catch (err) {
            // The base provider has already completed its normal discovery. A
            // fallback diagnostic failure must never hide Pages that are valid
            // through /me/accounts.
            logger.warn('metaPortfolioGrantProbeFailed', {
                metaCode: err.response?.data?.error?.code || null,
                metaSubcode: err.response?.data?.error?.error_subcode || null,
            });
            return new Set();
        }
    }

    async hydrateStrictGrantedPage(pageId, userToken, pageCredentials) {
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

            // These normalized task values are an authorization projection for
            // the existing connectPage guard. They are not copied from Meta's
            // Page `tasks` field: the stronger proof here is (a) exact granular
            // targeting for pages_messaging + pages_manage_metadata and (b) a
            // Page access token returned for this exact Page ID.
            return {
                id: String(page.id),
                name: page.name || `Facebook Page ${page.id}`,
                category: null,
                pictureUrl: null,
                tasks: ['MESSAGING', 'MANAGE'],
                connectable: true,
                reason: null,
            };
        } catch (err) {
            logger.warn('metaPortfolioMinimalHydrationFailed', {
                pageId: String(pageId),
                metaCode: err.response?.data?.error?.code || null,
                metaSubcode: err.response?.data?.error?.error_subcode || null,
            });
            return null;
        }
    }

    async listManagedAssets({ userToken, pageCredentials }) {
        const baseAssets = await super.listManagedAssets({ userToken, pageCredentials });
        const strictGrantedPageIds = await this.getStrictGrantedPageIds({ userToken });
        if (!strictGrantedPageIds.size) return baseAssets;

        const byId = new Map(
            (Array.isArray(baseAssets) ? baseAssets : [])
                .filter((asset) => asset?.id !== null && asset?.id !== undefined)
                .map((asset) => [String(asset.id), asset]),
        );

        const fallbackIds = [...strictGrantedPageIds]
            .filter((pageId) => !byId.has(pageId) || byId.get(pageId)?.connectable !== true);
        if (!fallbackIds.length) return [...byId.values()];

        const hydrated = await Promise.all(
            fallbackIds.map((pageId) => this.hydrateStrictGrantedPage(pageId, userToken, pageCredentials)),
        );
        let recovered = 0;
        hydrated.forEach((asset) => {
            if (!asset) return;
            byId.set(String(asset.id), asset);
            recovered += 1;
        });

        logger.info('metaPortfolioPagesRecovered', {
            strict_granted_pages: strictGrantedPageIds.size,
            fallback_attempted: fallbackIds.length,
            fallback_recovered: recovered,
            total_pages: byId.size,
        });
        return [...byId.values()];
    }
}

module.exports = MetaPortfolioMessengerProvider;
