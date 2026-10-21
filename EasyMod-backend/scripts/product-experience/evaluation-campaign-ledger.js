'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const USD_UNITS = 1_000_000_000;
const HARD_MAX_CEILING_USD = 2;
const HARD_MAX_REQUESTS = 256;
const HARD_MAX_VISION_REQUESTS = 12;
const finiteUsdUnits = value => Number.isFinite(value) && value >= 0
    ? Math.ceil(value * USD_UNITS) : null;
const usd = units => units / USD_UNITS;
const clone = value => JSON.parse(JSON.stringify(value));
const safeStage = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);

const fail = code => {
    const error = new Error(`Evaluation campaign ledger rejected the operation: ${code}.`);
    error.code = code;
    throw error;
};

const createEvaluationCampaignLedger = ({ ledgerPath, campaignId, ceilingUsd, maxRequests, maxVisionRequests }) => {
    if (typeof ledgerPath !== 'string' || !path.isAbsolute(ledgerPath)
        || typeof campaignId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(campaignId)
        || !Number.isFinite(ceilingUsd) || ceilingUsd <= 0 || ceilingUsd > HARD_MAX_CEILING_USD
        || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > HARD_MAX_REQUESTS
        || !Number.isSafeInteger(maxVisionRequests) || maxVisionRequests < 0 || maxVisionRequests > HARD_MAX_VISION_REQUESTS) {
        fail('INVALID_CONFIG');
    }
    const capUnits = finiteUsdUnits(ceilingUsd);
    if (!capUnits) fail('INVALID_CONFIG');
    const resolvedPath = path.resolve(ledgerPath);
    const lockPath = `${resolvedPath}.lock`;
    const initialState = () => ({
        schemaVersion: 1,
        campaignId,
        ceilingUsd: usd(capUnits),
        maxRequests,
        maxVisionRequests,
        reservedWorstCaseUsd: 0,
        estimatedProviderChargeUsd: 0,
        providerInvoice: 'NOT_AVAILABLE',
        requestCount: 0,
        visionRequestCount: 0,
        unpricedRequestCount: 0,
        calls: [],
        updatedAt: new Date().toISOString(),
    });

    const readState = () => {
        let state;
        try {
            state = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
        } catch (error) {
            if (error.code === 'ENOENT') return initialState();
            fail('LEDGER_UNREADABLE');
        }
        if (!state || state.schemaVersion !== 1 || state.campaignId !== campaignId
            || state.ceilingUsd !== usd(capUnits)
            || !Number.isSafeInteger(state.maxRequests) || state.maxRequests < state.requestCount || state.maxRequests > maxRequests
            || state.maxVisionRequests !== maxVisionRequests || !Array.isArray(state.calls)) {
            fail('LEDGER_IDENTITY_MISMATCH');
        }
        return state;
    };

    const writeState = state => {
        const directory = path.dirname(resolvedPath);
        fs.mkdirSync(directory, { recursive: true });
        const tempPath = `${resolvedPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
        try {
            fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            fs.renameSync(tempPath, resolvedPath);
        } catch (_) {
            try { fs.unlinkSync(tempPath); } catch (_) { }
            fail('LEDGER_WRITE_FAILED');
        }
    };

    const withLock = callback => {
        let descriptor;
        try {
            fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
            descriptor = fs.openSync(lockPath, 'wx', 0o600);
        } catch (error) {
            fail(error.code === 'EEXIST' ? 'LEDGER_BUSY' : 'LEDGER_LOCK_FAILED');
        }
        try {
            return callback();
        } finally {
            try { fs.closeSync(descriptor); } catch (_) { }
            try { fs.unlinkSync(lockPath); } catch (_) { }
        }
    };

    const record = (stage, snapshot) => {
        if (!safeStage(stage) || !snapshot || !Array.isArray(snapshot.calls)) fail('INVALID_SNAPSHOT');
        return withLock(() => {
            const state = readState();
            const calls = new Map(state.calls.map(call => [call.key, call]));
            for (const call of snapshot.calls) {
                if (typeof call.callId !== 'string' || !call.callId || !Number.isFinite(call.reservedUsd)) fail('INVALID_SNAPSHOT');
                const key = `${stage}/${call.callId}`;
                const existing = calls.get(key);
                if (!existing) {
                    if (calls.size >= maxRequests) fail('REQUEST_LIMIT');
                    if (call.vision && [...calls.values()].filter(item => item.vision).length >= maxVisionRequests) fail('VISION_LIMIT');
                    const nextReserved = [...calls.values()].reduce((sum, item) => sum + finiteUsdUnits(item.reservedUsd), 0)
                        + finiteUsdUnits(call.reservedUsd);
                    if (nextReserved > capUnits) fail('SPEND_LIMIT');
                }
                const estimate = Number.isFinite(call.estimatedProviderChargeUsd)
                    ? call.estimatedProviderChargeUsd
                    : Number.isFinite(call.providerReportedUsd) ? call.providerReportedUsd : null;
                calls.set(key, {
                    key,
                    stage,
                    callId: call.callId,
                    model: call.model,
                    vision: Boolean(call.vision),
                    retrySequence: call.retrySequence,
                    inputTokenUpperBound: call.inputTokenUpperBound,
                    maxOutputTokens: call.maxOutputTokens,
                    inputTokens: Number.isSafeInteger(call.inputTokens) ? call.inputTokens : null,
                    outputTokens: Number.isSafeInteger(call.outputTokens) ? call.outputTokens : null,
                    thinkingTokens: Number.isSafeInteger(call.thinkingTokens) ? call.thinkingTokens : null,
                    latencyMs: Number.isSafeInteger(call.latencyMs) ? call.latencyMs : null,
                    requestId: typeof call.requestId === 'string' ? call.requestId : null,
                    status: String(call.status || 'pending'),
                    reservedUsd: existing?.reservedUsd ?? call.reservedUsd,
                    estimatedProviderChargeUsd: estimate,
                    usageStatus: estimate === null ? 'UNKNOWN' : 'TOKEN_USAGE_ESTIMATE',
                });
            }
            const allCalls = [...calls.values()];
            const reservedUnits = allCalls.reduce((sum, call) => sum + finiteUsdUnits(call.reservedUsd), 0);
            const estimatedCalls = allCalls.filter(call => call.estimatedProviderChargeUsd !== null);
            const estimateUnits = estimatedCalls.reduce((sum, call) => sum + finiteUsdUnits(call.estimatedProviderChargeUsd), 0);
            const visionCalls = allCalls.filter(call => call.vision).length;
            if (reservedUnits > capUnits || allCalls.length > maxRequests || visionCalls > maxVisionRequests) fail('CAMPAIGN_LIMIT_EXCEEDED');
            const nextState = {
                schemaVersion: 1,
                campaignId,
                ceilingUsd: usd(capUnits),
                maxRequests,
                maxVisionRequests,
                reservedWorstCaseUsd: usd(reservedUnits),
                estimatedProviderChargeUsd: usd(estimateUnits),
                providerInvoice: 'NOT_AVAILABLE',
                requestCount: allCalls.length,
                visionRequestCount: visionCalls,
                unpricedRequestCount: allCalls.length - estimatedCalls.length,
                calls: allCalls.sort((a, b) => a.key.localeCompare(b.key)),
                updatedAt: new Date().toISOString(),
            };
            writeState(nextState);
            return clone(nextState);
        });
    };

    return Object.freeze({
        record,
        snapshot: () => clone(readState()),
        remainingUsd: () => {
            const state = readState();
            const reserved = finiteUsdUnits(state.reservedWorstCaseUsd) ?? 0;
            return usd(Math.max(0, capUnits - reserved));
        },
    });
};

module.exports = { createEvaluationCampaignLedger };
