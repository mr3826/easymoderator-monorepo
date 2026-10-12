'use strict';

const crypto = require('crypto');
const { normalizePageTasks } = require('./meta-page-eligibility');

const MAX_WINDOW_MS = 60 * 60 * 1000;
const PAGE_ID_PATTERN = /^\d{1,32}$/;
const SAFE_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KNOWN_META_PAGE_TASKS = new Set([
    'MESSAGING',
    'CREATE_CONTENT',
    'MANAGE',
    'MODERATE',
    'ADVERTISE',
    'ANALYZE',
]);

function safeRequestId(value) {
    const candidate = typeof value === 'string' ? value.trim() : '';
    return SAFE_REQUEST_ID_PATTERN.test(candidate) ? candidate : null;
}

function safePageId(value) {
    const candidate = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    return PAGE_ID_PATTERN.test(candidate) ? candidate : null;
}

function readCanaryConfig(env = process.env, now = Date.now()) {
    const enabled = env.META_DISCOVERY_CANARY_ENABLED === 'true';
    const shopId = typeof env.META_DISCOVERY_CANARY_SHOP_ID === 'string'
        ? env.META_DISCOVERY_CANARY_SHOP_ID.trim()
        : '';
    const expectedPageId = safePageId(env.META_DISCOVERY_CANARY_PAGE_ID);
    const expiresAtMs = Date.parse(String(env.META_DISCOVERY_CANARY_EXPIRES_AT || ''));
    const remainingMs = Number.isFinite(expiresAtMs) ? expiresAtMs - now : null;
    const active = enabled
        && shopId.length > 0
        && expectedPageId !== null
        && remainingMs !== null
        && remainingMs > 0
        && remainingMs <= MAX_WINDOW_MS;

    return {
        active,
        shopId,
        expectedPageId,
        expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
        expiresAt: Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : null,
        remainingMs,
    };
}

function createCorrelationId() {
    return crypto.randomBytes(16).toString('hex');
}

function createCanaryAttempt({ authenticatedShopId, stateShopId, requestId, env = process.env, now = Date.now() }) {
    const config = readCanaryConfig(env, now);
    const shopMatches = String(authenticatedShopId || '') === config.shopId
        && String(stateShopId || '') === config.shopId;
    if (!config.active || !shopMatches) return null;

    return {
        correlationId: createCorrelationId(),
        shopId: config.shopId,
        expectedPageId: config.expectedPageId,
        createdAt: new Date(now).toISOString(),
        expiresAt: config.expiresAt,
        initiateRequestId: safeRequestId(requestId),
    };
}

function resumeCanaryAttempt({ authenticatedShopId, stateShopId, storedAttempt, requestId, env = process.env, now = Date.now() }) {
    const config = readCanaryConfig(env, now);
    const shopMatches = String(authenticatedShopId || '') === config.shopId
        && String(stateShopId || '') === config.shopId;
    const storedMatches = storedAttempt
        && typeof storedAttempt.correlationId === 'string'
        && storedAttempt.expectedPageId === config.expectedPageId
        && storedAttempt.expiresAt === config.expiresAt;
    if (!config.active || !shopMatches || !storedMatches) return null;

    return {
        correlationId: storedAttempt.correlationId,
        shopId: config.shopId,
        expectedPageId: config.expectedPageId,
        createdAt: storedAttempt.createdAt,
        expiresAt: config.expiresAt,
        initiateRequestId: safeRequestId(storedAttempt.initiateRequestId),
        callbackRequestId: safeRequestId(requestId),
    };
}

function createDiagnostics(attempt) {
    if (!attempt) return null;
    const createdAtMs = Date.parse(String(attempt.createdAt || ''));
    const retentionExpiresAt = new Date(
        (Number.isFinite(createdAtMs) ? createdAtMs : Date.now()) + 24 * 60 * 60 * 1000,
    ).toISOString();
    return {
        correlationId: attempt.correlationId,
        shopId: attempt.shopId,
        initiateRequestId: attempt.initiateRequestId,
        callbackRequestId: attempt.callbackRequestId || null,
        expectedPageId: attempt.expectedPageId,
        expiresAt: attempt.expiresAt,
        retentionExpiresAt,
        tokenValid: 'UNKNOWN',
        tokenAppIdMatches: 'UNKNOWN',
        tokenExpirationStatus: 'UNKNOWN',
        granularScopes: {
            pages_show_list: { granted: 'UNKNOWN', expectedPage: 'UNKNOWN' },
            pages_messaging: { granted: 'UNKNOWN', expectedPage: 'UNKNOWN' },
            pages_manage_metadata: { granted: 'UNKNOWN', expectedPage: 'UNKNOWN' },
        },
        meAccounts: {
            rich: { status: 'NOT_ATTEMPTED', httpStatus: null, pageCount: 0, expectedPage: 'UNKNOWN', expectedPageToken: 'UNKNOWN', paginationCompleted: 'UNKNOWN' },
            minimal: { status: 'NOT_ATTEMPTED', httpStatus: null, pageCount: 0, expectedPage: 'UNKNOWN', expectedPageToken: 'UNKNOWN', paginationCompleted: 'UNKNOWN' },
        },
        hydration: {
            rich: { status: 'NOT_ATTEMPTED', httpStatus: null, expectedPageToken: 'UNKNOWN', expectedPageTasks: [] },
            minimal: { status: 'NOT_ATTEMPTED', httpStatus: null, expectedPageToken: 'UNKNOWN' },
        },
        expectedPageTasks: [],
        expectedPageEligible: 'UNKNOWN',
        portfolioFallbackAttempted: 0,
        portfolioFallbackRecovered: 0,
        callbackPageCount: 0,
        callbackConnectablePageCount: 0,
        metaIdentityAvailable: 'UNKNOWN',
        lastGraphError: null,
        applicationErrorCode: null,
    };
}

function recordGraphError(diagnostics, stage, error) {
    if (!diagnostics) return;
    const graphError = error?.response?.data?.error || {};
    const status = Number(error?.response?.status);
    diagnostics.lastGraphError = {
        stage,
        httpStatus: Number.isInteger(status) ? status : null,
        metaCode: Number.isInteger(graphError.code) ? graphError.code : null,
        metaSubcode: Number.isInteger(graphError.error_subcode) ? graphError.error_subcode : null,
    };
}

function sanitizeTasks(tasks) {
    const normalized = normalizePageTasks(tasks) || [];
    return normalized.filter((task) => KNOWN_META_PAGE_TASKS.has(task)).slice(0, 32);
}

function snapshotDiagnostics(diagnostics) {
    if (!diagnostics) return null;
    return JSON.parse(JSON.stringify(diagnostics));
}

module.exports = {
    MAX_WINDOW_MS,
    readCanaryConfig,
    createCanaryAttempt,
    resumeCanaryAttempt,
    createDiagnostics,
    recordGraphError,
    sanitizeTasks,
    snapshotDiagnostics,
};
