'use strict';

const rules = require('../order-confidence.rules');

const { DECISIONS } = rules;
const CONFIG = { high_value_cod_threshold: 10000, address_min_length: 15 };

const baseOrder = (overrides = {}) => ({
    id: 'o-1',
    customer_id: 'c-1',
    customer_phone: '01711111111',
    delivery_address: 'House 12, Road 5, Dhanmondi, Dhaka',
    total: '1250.00',
    payment_status: 'pending',
    payment_method: 'cod',
    order_status: 'confirmed',
    items: [{ product_id: 'p-1', quantity: 1 }],
    ...overrides,
});
const clean = { delivered: 0, returned: 0, cancelled: 0, total: 0 };
const clear = { tier: 'clear', risk_score: 0, entry: null, network: null };
const evaluate = (overrides = {}) => rules.evaluate({
    order: baseOrder(overrides.order),
    history: overrides.history === undefined ? clean : overrides.history,
    recentActiveOrders: overrides.recentActiveOrders || [],
    rtoShield: overrides.rtoShield === undefined ? clear : overrides.rtoShield,
}, CONFIG);
const codes = (result) => result.reasons.map((r) => r.code);

describe('decision rules', () => {
    test('a complete, confirmed, first-time COD order is READY with informational context only', () => {
        const result = evaluate();
        expect(result.decision).toBe(DECISIONS.READY);
        expect(result.bookable).toBe(true);
        expect(result.reasons.every((r) => r.severity === 'INFO')).toBe(true);
        expect(codes(result)).toContain('NEW_CUSTOMER');
        expect(result.rules_version).toBe('order-confidence/1.0.0');
    });

    test.each([
        ['RTO Shield verify tier', { rtoShield: { tier: 'verify', risk_score: 55, entry: null, network: { shops_reported: 3, total_attempts: 6, rto_rate: 0.5 } } }, 'RTO_SHIELD_VERIFY'],
        ['one prior return with no delivery', { history: { delivered: 0, returned: 1, cancelled: 0, total: 1 } }, 'PRIOR_RETURN'],
        ['a duplicate order within 24h', { recentActiveOrders: [{ id: 'o-0', order_number: 'ORD-1' }] }, 'POSSIBLE_DUPLICATE_ORDER'],
        ['an invalid phone', { order: { customer_phone: '12345' } }, 'PHONE_INVALID'],
        ['a short address', { order: { delivery_address: 'Mirpur 10' } }, 'ADDRESS_TOO_SHORT'],
        ['a draft order', { order: { order_status: 'draft' } }, 'ORDER_NOT_CONFIRMED'],
        ['a high-value first COD order', { order: { total: 15000 } }, 'HIGH_VALUE_FIRST_COD'],
        ['history lookup failed', { history: null }, 'INPUT_UNAVAILABLE'],
        ['RTO Shield lookup failed', { rtoShield: null }, 'INPUT_UNAVAILABLE'],
    ])('%s → VERIFY', (_label, overrides, code) => {
        const result = evaluate(overrides);
        expect(result.decision).toBe(DECISIONS.VERIFY);
        expect(codes(result)).toContain(code);
    });

    test.each([
        ['RTO Shield block tier (shop list)', { rtoShield: { tier: 'block', risk_score: 80, entry: { is_global: false }, network: null } }, 'RTO_SHIELD_BLOCK'],
        ['repeated returns', { history: { delivered: 1, returned: 2, cancelled: 0, total: 3 } }, 'REPEATED_RETURNS'],
    ])('%s → MANUAL_REVIEW', (_label, overrides, code) => {
        const result = evaluate(overrides);
        expect(result.decision).toBe(DECISIONS.MANUAL_REVIEW);
        expect(codes(result)).toContain(code);
        expect(result.bookable).toBe(true);
    });

    test('a cancelled order is MANUAL_REVIEW and not bookable at all', () => {
        const result = evaluate({ order: { order_status: 'cancelled' } });
        expect(result.decision).toBe(DECISIONS.MANUAL_REVIEW);
        expect(result.bookable).toBe(false);
        expect(codes(result)).toContain('ORDER_CANCELLED');
    });

    test('a prepaid order skips the high-value COD rule and says so', () => {
        const result = evaluate({ order: { total: 20000, payment_status: 'paid' } });
        expect(result.decision).toBe(DECISIONS.READY);
        expect(codes(result)).toEqual(expect.arrayContaining(['PREPAID']));
        expect(codes(result)).not.toContain('HIGH_VALUE_FIRST_COD');
    });

    test('a customer with a delivery is not a "first" COD even when the order is large', () => {
        const result = evaluate({ order: { total: 15000 }, history: { delivered: 1, returned: 0, cancelled: 0, total: 1 } });
        expect(codes(result)).not.toContain('HIGH_VALUE_FIRST_COD');
        expect(codes(result)).toContain('DELIVERY_HISTORY');
    });

    test('rules are monotonic: good history never removes a verification reason', () => {
        const result = evaluate({
            order: { delivery_address: 'Mirpur' },
            history: { delivered: 9, returned: 0, cancelled: 0, total: 9 },
        });
        expect(result.decision).toBe(DECISIONS.VERIFY);
        expect(codes(result)).toContain('ADDRESS_TOO_SHORT');
    });

    test('MANUAL_REVIEW outranks VERIFY when both apply', () => {
        const result = evaluate({
            order: { delivery_address: 'Mirpur' },
            history: { delivered: 0, returned: 3, cancelled: 0, total: 3 },
        });
        expect(result.decision).toBe(DECISIONS.MANUAL_REVIEW);
    });

    test('evidence carries no phone, address or name', () => {
        const result = evaluate({
            order: { customer_phone: '12345', delivery_address: 'Mirpur', customer_name: 'Rahim' },
            recentActiveOrders: [{ id: 'o-0', order_number: 'ORD-1' }],
            rtoShield: { tier: 'verify', risk_score: 55, entry: null, network: null },
        });
        const serialized = JSON.stringify(result);
        for (const pii of ['12345', 'Mirpur', 'mirpur', 'Rahim', '01711111111']) {
            expect(serialized).not.toContain(pii);
        }
    });
});

describe('fingerprint', () => {
    test('is stable across stored representations of the same facts', () => {
        const a = rules.fingerprint(baseOrder({ customer_phone: '+8801711111111', total: 1250 }));
        const b = rules.fingerprint(baseOrder({ customer_phone: '01711111111', total: '1250.00' }));
        const c = rules.fingerprint(baseOrder({ delivery_address: '  house 12,  road 5, dhanmondi, dhaka ' }));
        expect(a).toBe(b);
        expect(a).toBe(c);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
    });

    test('does not change when a draft is confirmed', () => {
        expect(rules.fingerprint(baseOrder({ order_status: 'draft' })))
            .toBe(rules.fingerprint(baseOrder({ order_status: 'confirmed' })));
    });

    test.each([
        ['address', { delivery_address: 'House 99, Road 1, Uttara, Dhaka' }],
        ['phone', { customer_phone: '01899999999' }],
        ['total', { total: 1300 }],
        ['payment status', { payment_status: 'paid' }],
        ['items', { items: [{ product_id: 'p-1', quantity: 2 }] }],
        ['customer', { customer_id: 'c-2' }],
    ])('changes when the %s changes', (_label, overrides) => {
        expect(rules.fingerprint(baseOrder(overrides))).not.toBe(rules.fingerprint(baseOrder()));
    });
});

describe('effectiveState', () => {
    const row = (overrides) => ({
        decision: DECISIONS.VERIFY,
        input_fingerprint: 'fp-1',
        resolution: null,
        resolution_level: null,
        resolution_fingerprint: null,
        ...overrides,
    });

    test('READY decisions are ready', () => {
        expect(rules.effectiveState(row({ decision: DECISIONS.READY }))).toMatchObject({ state: DECISIONS.READY, resolved: false });
    });

    test('an unresolved VERIFY stays VERIFY', () => {
        expect(rules.effectiveState(row())).toMatchObject({ state: DECISIONS.VERIFY, resolved: false });
    });

    test('a verification for the same facts clears VERIFY', () => {
        expect(rules.effectiveState(row({ resolution: 'VERIFIED', resolution_level: 'VERIFY', resolution_fingerprint: 'fp-1' })))
            .toMatchObject({ state: DECISIONS.READY, resolved: true });
    });

    test('a verification does NOT clear a MANUAL_REVIEW decision', () => {
        expect(rules.effectiveState(row({
            decision: DECISIONS.MANUAL_REVIEW, resolution: 'VERIFIED', resolution_level: 'VERIFY', resolution_fingerprint: 'fp-1',
        }))).toMatchObject({ state: DECISIONS.MANUAL_REVIEW, resolved: false });
    });

    test('an approval clears MANUAL_REVIEW and VERIFY', () => {
        for (const decision of [DECISIONS.MANUAL_REVIEW, DECISIONS.VERIFY]) {
            expect(rules.effectiveState(row({
                decision, resolution: 'APPROVED', resolution_level: 'MANUAL_REVIEW', resolution_fingerprint: 'fp-1',
            }))).toMatchObject({ state: DECISIONS.READY, resolved: true });
        }
    });

    test('a resolution made for different order facts is stale and does not apply', () => {
        expect(rules.effectiveState(
            row({ resolution: 'APPROVED', resolution_level: 'MANUAL_REVIEW', resolution_fingerprint: 'fp-old' }),
            { currentFingerprint: 'fp-1' },
        )).toMatchObject({ state: DECISIONS.VERIFY, resolved: false, stale: true });
    });
});
