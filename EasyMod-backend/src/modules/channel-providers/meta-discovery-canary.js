'use strict';

const crypto = require('crypto');
const { normalizePageTasks } = require('./meta-page-eligibility');

const MAX_WINDOW_MS = 60 * 60 * 1000;
const PAGE_ID_PATTERN = /^\d{1,32}$/;
const SHOP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
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

function safeShopId(value) {
    const candidate = typeof value === 'string' ? value.trim() : '';
    return SHOP_ID_PATTERN.test(candidate) ? candidate : null;
}

function parseUtcExpiry(value) {
    const candidate = typeof value === 'string' ? value.trim() : '';
    const match = candidate.match(UTC_TIMESTAMP_PATTERN);
    if (!match) return null;

    const [, year, month, day, hour, minute, second, fraction = ''] = match;
    const milliseconds = Number((fraction + '000').slice(0, 3));
    const parsed = Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        milliseconds,
    );
    if (!Number.isFinite(parsed)) return null;

    const parsedDate = new Date(parsed);
    return parsedDate.getUTCFullYear() === Number(year)
        && parsedDate.getUTCMonth() === Number(month) - 1
        && parsedDate.getUTCDate() === Number(day)
        && parsedDate.getUTCHours() === Number(hour)
        && parsedDate.getUTCMinutes() === Number(minute)
        && parsedDate.getUTCSeconds() === Number(second)
        ? parsed
        : null;
}

function validateCanaryEnvironment(env = process.env, now = Date.now()) {
    const enabled = env.META_DISCOVERY_CANARY_ENABLED === 'true';
    const errors = [];
    const rawEnabled = env.META_DISCOVERY_CANARY_ENABLED;

    if (rawEnabled !== undefined && rawEnabled !== '' && rawEnabled !== 'true' && rawEnabled !== 'false') {
        errors.push('META_DISCOVERY_CANARY_ENABLED must be exactly "true" or "false"');
    }
    if (!enabled) return errors;

    if (!safeShopId(env.META_DISCOVERY_CANARY_SHOP_ID)) {
        errors.push('META_DISCOVERY_CANARY_SHOP_ID must be a non-empty safe shop identifier');
    }
    if (!safePageId(env.META_DISCOVERY_CANARY_PAGE_ID)) {
        errors.push('META_DISCOVERY_CANARY_PAGE_ID must be a numeric Meta Page ID');
    }

    const expiresAtMs = parseUtcExpiry(env.META_DISCOVERY_CANARY_EXPIRES_AT);
    if (expiresAtMs === null) {
        errors.push('META_DISCOVERY_CANARY_EXPIRES_AT must be a UTC ISO-8601 timestamp');
    } else {
        const remainingMs = expiresAtMs - now;
        if (remainingMs <= 0) errors.push('META_DISCOVERY_CANARY_EXPIRES_AT must be in the future');
        if (remainingMs > MAX_WINDOW_MS) errors.push('META_DISCOVERY_CANARY_EXPIRES_AT must be no more than one hour away');
    }

    return errors;
}

function assertValidCanaryEnvironment(env = process.env, now = Date.now()) {
    const errors = validateCanaryEnvironment(env, now);
    if (errors.length) {
        const error = new Error(`Invalid Meta discovery canary configuration: ${errors.join('; ')}`);
        error.code = 'INVALID_META_DISCOVERY_CANARY_CONFIG';
        error.details = { errors };
        throw error;
    }
    return true;
}

function readCanaryConfig(env = process.env, now = Date.now()) {
    const enabled = env.META_DISCOVERY_CANARY_ENABLED === 'true';
    const shopId = safeShopId(env.META_DISCOVERY_CANARY_SHOP_ID) || '';
    const expectedPageId = safePageId(env.META_DISCOVERY_CANARY_PAGE_ID);
    const expiresAtMs = parseUtcExpiry(env.META_DISCOVERY_CANARY_EXPIRES_AT);
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
        pageGrantMode: 'UNKNOWN',
        operationalGrantMode: 'UNKNOWN',
        messagingGrantMode: 'UNKNOWN',
        metadataGrantMode: 'UNKNOWN',
        showListGranted: 'UNKNOWN',
        granularScopes: {
            pages_show_list: { granted: 'UNKNOWN', expectedPage: 'UNKNOWN', mode: 'UNKNOWN' },
            pages_messaging: { granted: 'UNKNOWN', expectedPage: 'UNKNOWN', mode: 'UNKNOWN' },
            pages_manage_metadata: { granted: 'UNKNOWN', expectedPage: 'UNKNOWN', mode: 'UNKNOWN' },
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
        expectedPageEligibilitySource: 'UNKNOWN',
        portfolioFallbackAttempted: 0,
        portfolioFallbackRecovered: 0,
        callbackPageCount: 0,
        callbackConnectablePageCount: 0,
        meAccountsPageCount: 0,
        authorizedPageCount: 0,
        pageTokenAvailableCount: 0,
        connectablePageCount: 0,
        discoveryFailureReason: null,
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
    validateCanaryEnvironment,
    assertValidCanaryEnvironment,
    readCanaryConfig,
    createCanaryAttempt,
    resumeCanaryAttempt,
    createDiagnostics,
    recordGraphError,
    sanitizeTasks,
    snapshotDiagnostics,
};
