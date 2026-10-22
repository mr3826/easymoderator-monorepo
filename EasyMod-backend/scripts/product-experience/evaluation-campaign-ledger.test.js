'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createEvaluationCampaignLedger } = require('./evaluation-campaign-ledger');

const roots = [];
const createPath = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'em-v13-campaign-'));
    roots.push(root);
    return path.join(root, 'campaign.json');
};
afterEach(() => {
    for (const root of roots.splice(0)) {
        if (path.dirname(root) !== os.tmpdir()) throw new Error('Refusing to remove an unexpected test directory.');
        fs.rmSync(root, { recursive: true, force: true });
    }
});

const makeLedger = (ledgerPath, overrides = {}) => createEvaluationCampaignLedger({
    ledgerPath,
    campaignId: 'v13-test-campaign',
    ceilingUsd: 1,
    maxRequests: 4,
    maxVisionRequests: 1,
    ...overrides,
});
const call = (callId, reservedUsd, overrides = {}) => ({
    callId, model: 'gemini-3.1-flash-lite', vision: false, retrySequence: 0,
    inputTokenUpperBound: 100, maxOutputTokens: 32, status: 'pending',
    reservedUsd, estimatedProviderChargeUsd: null, ...overrides,
});

describe('persistent cumulative evaluation campaign ledger', () => {
    test('shares reserved budget across separate stage instances and rejects over-cap work', () => {
        const ledgerPath = createPath();
        const baseline = makeLedger(ledgerPath);
        baseline.record('baseline-real', { calls: [call('call-1', 0.7)] });
        expect(baseline.remainingUsd()).toBeCloseTo(0.3, 8);

        const candidate = makeLedger(ledgerPath);
        expect(() => candidate.record('candidate-real', { calls: [call('call-1', 0.31)] }))
            .toThrow(expect.objectContaining({ code: 'SPEND_LIMIT' }));
        candidate.record('candidate-real', { calls: [call('call-1', 0.2)] });
        expect(candidate.snapshot()).toMatchObject({
            requestCount: 2, reservedWorstCaseUsd: 0.9, providerInvoice: 'NOT_AVAILABLE',
            calls: expect.arrayContaining([
                expect.objectContaining({ stage: 'baseline-real', reservedUsd: 0.7 }),
                expect.objectContaining({ stage: 'candidate-real', reservedUsd: 0.2 }),
            ]),
        });
    });

    test('updates an existing call without double-counting its reservation', () => {
        const ledger = makeLedger(createPath());
        ledger.record('judge', { calls: [call('call-1', 0.25)] });
        ledger.record('judge', { calls: [call('call-1', 0.25, {
            status: 'provider_reported', inputTokens: 50, outputTokens: 8,
            estimatedProviderChargeUsd: 0.000025, latencyMs: 400,
        })] });
        expect(ledger.snapshot()).toMatchObject({
            requestCount: 1, reservedWorstCaseUsd: 0.25, estimatedProviderChargeUsd: 0.000025,
            unpricedRequestCount: 0,
            calls: [expect.objectContaining({ status: 'provider_reported', latencyMs: 400 })],
        });
    });

    test('counts the same local call id from distinct probe attempts separately', () => {
        const ledger = makeLedger(createPath(), { maxRequests: 2, maxVisionRequests: 2 });
        ledger.record('gemini-pro-photo-only-run-a-attempt-a', {
            calls: [call('call-1', 0.25, { vision: true })],
        });
        ledger.record('gemini-pro-photo-only-run-a-attempt-b', {
            calls: [call('call-1', 0.25, { vision: true })],
        });

        expect(ledger.snapshot()).toMatchObject({
            requestCount: 2,
            visionRequestCount: 2,
            reservedWorstCaseUsd: 0.5,
            calls: expect.arrayContaining([
                expect.objectContaining({ stage: 'gemini-pro-photo-only-run-a-attempt-a', callId: 'call-1' }),
                expect.objectContaining({ stage: 'gemini-pro-photo-only-run-a-attempt-b', callId: 'call-1' }),
            ]),
        });
    });

    test('enforces total campaign request and genuine-vision caps', () => {
        const ledgerPath = createPath();
        const ledger = makeLedger(ledgerPath, { maxRequests: 1, maxVisionRequests: 0 });
        expect(() => ledger.record('vision', { calls: [call('call-1', 0.1, { vision: true })] }))
            .toThrow(expect.objectContaining({ code: 'VISION_LIMIT' }));
        ledger.record('text', { calls: [call('call-1', 0.1)] });
        expect(() => ledger.record('next', { calls: [call('call-1', 0.1)] }))
            .toThrow(expect.objectContaining({ code: 'REQUEST_LIMIT' }));
    });

    test('refuses to reuse a ledger for a different campaign or cap', () => {
        const ledgerPath = createPath();
        makeLedger(ledgerPath).record('baseline', { calls: [call('call-1', 0.1)] });
        expect(() => makeLedger(ledgerPath, { campaignId: 'other-campaign' }).snapshot())
            .toThrow(expect.objectContaining({ code: 'LEDGER_IDENTITY_MISMATCH' }));
    });

    test('allows a bounded monotonic request-cap increase without resetting campaign history', () => {
        const ledgerPath = createPath();
        makeLedger(ledgerPath).record('baseline', { calls: [call('call-1', 0.1)] });
        const expanded = makeLedger(ledgerPath, { maxRequests: 5 });
        expanded.record('candidate-final', { calls: [call('call-2', 0.2)] });
        expect(expanded.snapshot()).toMatchObject({
            requestCount: 2, maxRequests: 5,
            calls: expect.arrayContaining([
                expect.objectContaining({ stage: 'baseline', callId: 'call-1' }),
                expect.objectContaining({ stage: 'candidate-final', callId: 'call-2' }),
            ]),
        });
        expect(() => makeLedger(ledgerPath).snapshot())
            .toThrow(expect.objectContaining({ code: 'LEDGER_IDENTITY_MISMATCH' }));
    });

    test('cannot exceed the campaign spend, request, or vision hard caps', () => {
        const ledgerPath = createPath();
        expect(() => makeLedger(ledgerPath, { ceilingUsd: 2.01 }).snapshot())
            .toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
        expect(() => makeLedger(ledgerPath, { maxRequests: 257 }).snapshot())
            .toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
        expect(() => makeLedger(ledgerPath, { maxVisionRequests: 13 }).snapshot())
            .toThrow(expect.objectContaining({ code: 'INVALID_CONFIG' }));
    });
});
