'use strict';

const fs = require('fs');

const EVENT_NAMES = new Set(['metaDiscoveryCanaryCompleted', 'metaDiscoveryCanaryFailed']);
const GRANULAR_SCOPE_NAMES = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'];
const ME_ACCOUNT_KEYS = ['status', 'httpStatus', 'pageCount', 'expectedPage', 'expectedPageToken', 'paginationCompleted'];
const HYDRATION_KEYS = ['status', 'httpStatus', 'expectedPageToken', 'expectedPageTasks'];

function pick(source, keys) {
    if (!source || typeof source !== 'object') return {};
    return Object.fromEntries(keys.filter((key) => Object.prototype.hasOwnProperty.call(source, key))
        .map((key) => [key, source[key]]));
}

function sanitizeDiagnostics(event) {
    const eventName = event.event || event.message;
    const diagnostics = {
        event: eventName,
        timestamp: event.timestamp,
        service: event.service,
        environment: event.environment,
        correlationId: event.correlationId,
        initiateRequestId: event.initiateRequestId,
        callbackRequestId: event.callbackRequestId,
        shopId: event.shopId,
        expectedPageId: event.expectedPageId,
        expiresAt: event.expiresAt,
        retentionExpiresAt: event.retentionExpiresAt,
        tokenValid: event.tokenValid,
        tokenAppIdMatches: event.tokenAppIdMatches,
        tokenExpirationStatus: event.tokenExpirationStatus,
        granularScopes: {},
        meAccounts: {},
        hydration: {},
        expectedPageTasks: Array.isArray(event.expectedPageTasks) ? event.expectedPageTasks : [],
        expectedPageEligible: event.expectedPageEligible,
        portfolioFallbackAttempted: event.portfolioFallbackAttempted,
        portfolioFallbackRecovered: event.portfolioFallbackRecovered,
        callbackPageCount: event.callbackPageCount,
        callbackConnectablePageCount: event.callbackConnectablePageCount,
        metaIdentityAvailable: event.metaIdentityAvailable,
        lastGraphError: event.lastGraphError ? pick(event.lastGraphError, ['stage', 'httpStatus', 'metaCode', 'metaSubcode']) : null,
        applicationErrorCode: event.applicationErrorCode,
    };

    for (const name of GRANULAR_SCOPE_NAMES) {
        diagnostics.granularScopes[name] = pick(event.granularScopes?.[name], ['granted', 'expectedPage']);
    }
    for (const name of ['rich', 'minimal']) {
        diagnostics.meAccounts[name] = pick(event.meAccounts?.[name], ME_ACCOUNT_KEYS);
        diagnostics.hydration[name] = pick(event.hydration?.[name], HYDRATION_KEYS);
    }
    return diagnostics;
}

function parseRecoveryLines(input, { shopId, pageId, from, to }) {
    const events = [];
    for (const line of String(input || '').split(/\r?\n/)) {
        const payload = line.startsWith('EVENT=') ? line.slice('EVENT='.length) : line;
        if (!payload.trim()) continue;
        let event;
        try {
            event = JSON.parse(payload);
        } catch {
            continue;
        }
        if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
        if (!EVENT_NAMES.has(event.event || event.message)) continue;
        if (String(event.shopId) !== String(shopId) || String(event.expectedPageId) !== String(pageId)) continue;
        if (String(event.timestamp) < from || String(event.timestamp) > to) continue;
        events.push(sanitizeDiagnostics(event));
    }
    return events;
}

function summarizeRecoveryOutput(input, scope) {
    const raw = String(input || '');
    const events = parseRecoveryLines(raw, scope);
    const hasDiscoveryError = /^CONTAINER_DISCOVERY_ERROR=/m.test(raw);
    const logReadErrorCount = (raw.match(/^LOG_READ_ERROR=/gm) || []).length;
    const logFilterErrorCount = (raw.match(/^LOG_FILTER_ERROR=/gm) || []).length;
    const containerInspectErrorCount = (raw.match(/^CONTAINER_INSPECT_ERROR=/gm) || []).length;
    const originalContainerAvailable = /^ORIGINAL_CONTAINER_AVAILABLE=YES$/m.test(raw)
        ? true
        : /^ORIGINAL_CONTAINER_AVAILABLE=NO$/m.test(raw) ? false : null;
    const hasExtractionErrors = hasDiscoveryError || logReadErrorCount > 0 || logFilterErrorCount > 0 || containerInspectErrorCount > 0;
    let extractionStatus = 'NO_MATCHES';
    if (hasDiscoveryError) extractionStatus = 'ERROR';
    else if (hasExtractionErrors) extractionStatus = 'PARTIAL';
    else if (events.length > 0) extractionStatus = 'RECOVERED';
    else if (originalContainerAvailable === false) extractionStatus = 'NO_CONTAINER';

    return {
        ...scope,
        extractionStatus,
        originalContainerAvailable,
        containerInfoCount: (raw.match(/^CONTAINER_INFO=/gm) || []).length,
        logReadErrorCount,
        logFilterErrorCount,
        containerInspectErrorCount,
        eventCount: events.length,
        events,
    };
}

function parseArgs(argv) {
    const args = {};
    for (const value of argv) {
        const match = /^--([^=]+)=(.*)$/.exec(value);
        if (match) args[match[1]] = match[2];
    }
    if (!args.shop || !args.page || !args.from || !args.to) {
        throw new Error('shop, page, from, and to are required');
    }
    const fromMs = Date.parse(args.from);
    const toMs = Date.parse(args.to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs || toMs - fromMs > 24 * 60 * 60 * 1000) {
        throw new Error('recovery window must be valid, ordered, and no longer than 24 hours');
    }
    return { shopId: args.shop, pageId: args.page, from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}

if (require.main === module) {
    try {
        const scope = parseArgs(process.argv.slice(2));
        process.stdout.write(`${JSON.stringify(summarizeRecoveryOutput(fs.readFileSync(0, 'utf8'), scope))}\n`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 2;
    }
}

module.exports = { parseArgs, parseRecoveryLines, sanitizeDiagnostics, summarizeRecoveryOutput };
