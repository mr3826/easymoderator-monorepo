'use strict';

const {
    ACTIVE,
    CONTRACT_VERSION,
    INTENTS,
    INTENT_REGISTRY_HASH,
    INTENT_REGISTRY_VERSION,
    RESERVED,
    createIntentRecord,
    normalizeIntentId,
    resolveDomain,
} = require('../contracts/intent.contract');

describe('intent registry contract', () => {
    test('contains the launch taxonomy and excludes reserved intents from active routing', () => {
        const active = Object.values(INTENTS).filter(value => value.status === ACTIVE);
        const reserved = Object.values(INTENTS).filter(value => value.status === RESERVED);
        expect(active).toHaveLength(22);
        expect(reserved).toHaveLength(6);
        expect(INTENT_REGISTRY_VERSION).toBe('1.0.0');
        expect(INTENT_REGISTRY_HASH).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    test('uses only domains known by the agent task contract', () => {
        for (const definition of Object.values(INTENTS)) {
            for (const domain of definition.domains || [definition.domain]) {
                expect(['PRODUCT', 'ORDER', 'KNOWLEDGE', 'COMMERCE_OPS', 'SUPPORT']).toContain(domain);
            }
        }
    });

    test.each([
        ['size', { intentId: 'PRODUCT_ATTRIBUTE', slots: { attribute: 'size' } }],
        ['color', { intentId: 'PRODUCT_ATTRIBUTE', slots: { attribute: 'color' } }],
        ['material', { intentId: 'PRODUCT_ATTRIBUTE', slots: { attribute: 'material' } }],
    ])('product %s queries use PRODUCT_ATTRIBUTE', (_label, input) => {
        const record = createIntentRecord({
            ...input,
            slots: { productReference: 'p-1', ...input.slots },
            confidence: 0.9,
            source: 'RULE',
            traceId: 'trace-1',
        });
        expect(record.intentId).toBe('PRODUCT_ATTRIBUTE');
        expect(record.domain).toBe('PRODUCT');
    });

    test.each(['MODIFICATION', 'RETURN', 'COMPLAINT', 'DELAY'])('post-purchase reason %s is a support intent', (reason) => {
        const record = createIntentRecord({
            intentId: 'ORDER_POST_PURCHASE_REQUEST',
            slots: { reason },
            confidence: 0.9,
            source: 'RULE',
            traceId: 'trace-1',
        });
        expect(record.domain).toBe('SUPPORT');
    });

    test('applies the static versus live delivery and payment tie-break', () => {
        for (const intentId of ['DELIVERY_POLICY', 'DELIVERY_CHARGE', 'PAYMENT_POLICY']) {
            expect(resolveDomain(intentId, { requiresLiveLookup: false })).toBe('KNOWLEDGE');
            expect(resolveDomain(intentId, { requiresLiveLookup: true })).toBe('COMMERCE_OPS');
        }
        expect(resolveDomain('PAYMENT_METHODS', { requiresLiveLookup: true })).toBe('KNOWLEDGE');
    });

    test('negated or reserved classifier output cannot become an active route', () => {
        expect(normalizeIntentId('PRODUCT_COMPARE')).toBe('GENERAL_CHAT_OR_UNKNOWN');
        expect(normalizeIntentId('not-a-registry-id')).toBe('GENERAL_CHAT_OR_UNKNOWN');
        expect(normalizeIntentId('not-a-registry-id', { fallbackIntentId: 'HUMAN_HANDOFF_REQUEST' }))
            .toBe('HUMAN_HANDOFF_REQUEST');
    });

    test('creates and validates the normative intent record shape', () => {
        expect(createIntentRecord({
            contractVersion: CONTRACT_VERSION,
            intentId: 'PRODUCT_ATTRIBUTE',
            intentVersion: 1,
            domain: 'PRODUCT',
            slots: { attribute: 'material', productReference: 'p-1' },
            confidence: 0.94,
            source: 'CLASSIFIER',
            evidenceIds: ['ev-123'],
            traceId: 'trace-123',
            createdAt: '2026-08-22T00:00:00.000Z',
        })).toEqual({
            contractVersion: '1.0',
            intentId: 'PRODUCT_ATTRIBUTE',
            intentVersion: 1,
            domain: 'PRODUCT',
            slots: { attribute: 'material', productReference: 'p-1' },
            confidence: 0.94,
            source: 'CLASSIFIER',
            evidenceIds: ['ev-123'],
            traceId: 'trace-123',
            createdAt: '2026-08-22T00:00:00.000Z',
        });
    });

    test('rejects unknown records, invalid source, and invalid confidence', () => {
        expect(() => createIntentRecord({ intentId: 'invented', confidence: 1, source: 'RULE', traceId: 't' }))
            .toThrow(/Unknown intent/);
        expect(() => createIntentRecord({ intentId: 'GREETING', confidence: 1, source: 'MODEL', traceId: 't' }))
            .toThrow(/Unsupported intent source/);
        expect(() => createIntentRecord({ intentId: 'GREETING', confidence: 2, source: 'RULE', traceId: 't' }))
            .toThrow(/between 0 and 1/);
        expect(() => createIntentRecord({ intentId: 'PRODUCT_ATTRIBUTE', domain: 'ORDER', slots: { attribute: 'size' }, confidence: 1, source: 'RULE', traceId: 't' }))
            .toThrow(/domain does not match/);
        expect(() => createIntentRecord({ intentId: 'PRODUCT_ATTRIBUTE', domain: 'PRODUCT', slots: { productReference: 'p-1' }, confidence: 1, source: 'RULE', traceId: 't' }))
            .toThrow(/Missing required intent slot: attribute/);
    });
});
