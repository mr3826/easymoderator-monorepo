'use strict';

/**
 * Uses the REAL Stage-2 classifier (ai/intent/stage2-rules.js), not a stub:
 * the point is that Bangla, Banglish and English purchase intent, negation
 * and explicit cancel are recognised by the same rules the AI pipeline uses.
 */

const signals = require('../opportunity-signals');
const { contactability } = require('../contactability');

const msg = (id, content, minutesAgo, metadata = {}) => ({
    id,
    content,
    metadata,
    created_at: new Date(Date.parse('2026-09-27T10:00:00Z') - minutesAgo * 60000).toISOString(),
});

describe('classifyMessage (real Stage-2 rules)', () => {
    test.each([
        ['English purchase intent', 'I want to order this panjabi', 'PURCHASE_INTENT'],
        ['Banglish purchase intent', 'ami eta nibo', 'PURCHASE_INTENT'],
        ['Bengali purchase intent', 'আমি এটা কিনতে চাই', 'PURCHASE_INTENT'],
        ['availability', 'black panjabi ache?', 'ASKED_AVAILABILITY'],
        ['variant (size)', 'ei shirt er size ki?', 'ASKED_VARIANT'],
        ['delivery charge', 'delivery charge koto?', 'ASKED_DELIVERY_CHARGE'],
        ['COD / payment method', 'cash on delivery hobe?', 'ASKED_PAYMENT_METHOD'],
    ])('%s → %s', (_label, text, code) => {
        const result = signals.classifyMessage(msg('m1', text, 60));
        expect(result).toMatchObject({ kind: 'signal', signal: { code, message_id: 'm1', source: 'MESSAGE' } });
        expect(result.signal.rule).toMatch(/^1\.1\.0:/);
    });

    test('negated purchase is not a signal', () => {
        expect(signals.classifyMessage(msg('m1', 'order korbo na', 60))).toBeNull();
    });

    test('explicit cancel and STOP are suppressors, not signals', () => {
        expect(signals.classifyMessage(msg('m1', 'order cancel', 60))).toMatchObject({ kind: 'suppress', intentId: 'ORDER_SESSION_CANCEL' });
        expect(signals.classifyMessage(msg('m2', 'stop', 60))).toMatchObject({ kind: 'suppress', intentId: 'STOP_OPT_OUT' });
    });

    test('a product photo is a weak signal', () => {
        const result = signals.classifyMessage(msg('m1', '[Attachment]', 60, { message_type: 'image' }));
        expect(result).toMatchObject({ kind: 'signal', signal: { code: 'SENT_PRODUCT_PHOTO', strength: 'WEAK' } });
    });

    test('greetings and thanks are ignored', () => {
        expect(signals.classifyMessage(msg('m1', 'hello', 60))).toBeNull();
        expect(signals.classifyMessage(msg('m2', 'thanks', 60))).toBeNull();
    });
});

describe('assess — qualification without numeric scores', () => {
    const s = (code, strength) => ({ code, strength });

    test('any strong signal is HIGH', () => {
        expect(signals.assess([s('PURCHASE_INTENT', 'STRONG')])).toMatchObject({ qualifies: true, strength: 'HIGH' });
    });

    test('two distinct reasons with one medium are MEDIUM', () => {
        expect(signals.assess([s('ASKED_AVAILABILITY', 'MEDIUM'), s('ASKED_DELIVERY_CHARGE', 'MEDIUM')]))
            .toMatchObject({ qualifies: true, strength: 'MEDIUM', reasons: ['ASKED_AVAILABILITY', 'ASKED_DELIVERY_CHARGE'] });
        expect(signals.assess([s('ASKED_AVAILABILITY', 'MEDIUM'), s('PRODUCT_QUESTION', 'WEAK')]))
            .toMatchObject({ qualifies: true, strength: 'MEDIUM' });
    });

    test('a single price or availability question does not qualify', () => {
        expect(signals.assess([s('ASKED_AVAILABILITY', 'MEDIUM')]).qualifies).toBe(false);
        expect(signals.assess([s('ASKED_AVAILABILITY', 'MEDIUM'), s('ASKED_AVAILABILITY', 'MEDIUM')]).qualifies).toBe(false);
        expect(signals.assess([s('PRODUCT_QUESTION', 'WEAK'), s('SENT_PRODUCT_PHOTO', 'WEAK')]).qualifies).toBe(false);
    });
});

describe('collectSignals', () => {
    test('only signals newer than the cursor count', () => {
        const { signals: found } = signals.collectSignals({
            messages: [msg('old', 'I want to order', 300), msg('new', 'delivery charge koto?', 60)],
            cursor: new Date(Date.parse('2026-09-27T10:00:00Z') - 120 * 60000),
        });
        expect(found.map((x) => x.message_id)).toEqual(['new']);
    });

    test('a cancel after the last positive signal means the customer declined', () => {
        const result = signals.collectSignals({
            messages: [msg('a', 'I want to order', 90), msg('b', 'order cancel', 60)],
        });
        expect(result.declined).toBe(true);
    });

    test('renewed intent after a cancel is not declined', () => {
        const result = signals.collectSignals({
            messages: [msg('a', 'order cancel', 90), msg('b', 'I want to order', 60)],
        });
        expect(result.declined).toBe(false);
        expect(result.signals).toHaveLength(1);
    });

    test('an abandoned checkout with a cart is a strong session signal with product refs', () => {
        const session = {
            id: 'sess-1',
            status: 'ABANDONED',
            created_order_id: null,
            current_step: 'COLLECTING_ADDRESS',
            last_activity_at: '2026-09-27T09:00:00Z',
            step_data: { cart: [{ product_id: 'p-1', name: 'Black Panjabi', quantity: 2 }] },
        };
        const { signals: found } = signals.collectSignals({ sessions: [session] });
        expect(found).toEqual([expect.objectContaining({
            code: 'CHECKOUT_STARTED', strength: 'STRONG', checkout_step: 'COLLECTING_ADDRESS', order_session_id: 'sess-1',
        })]);
        expect(signals.productRefsFrom(found)).toEqual([{ product_id: 'p-1', name: 'Black Panjabi', quantity: 2 }]);
    });

    test('a completed or cancelled session is not a signal', () => {
        expect(signals.sessionSignal({ status: 'COMPLETED', step_data: { cart: [{ product_id: 'p' }] } })).toBeNull();
        expect(signals.sessionSignal({ status: 'CANCELLED', step_data: { cart: [{ product_id: 'p' }] } })).toBeNull();
        expect(signals.sessionSignal({ status: 'ACTIVE', created_order_id: 'o1', step_data: { cart: [{ product_id: 'p' }] } })).toBeNull();
        expect(signals.sessionSignal({ status: 'ACTIVE', step_data: { cart: [] } })).toBeNull();
    });
});

describe('mergeSignals', () => {
    test('re-merging the same message signals is idempotent and bounded', () => {
        const one = { source: 'MESSAGE', message_id: 'm1', code: 'PURCHASE_INTENT', at: '2026-09-27T09:00:00Z' };
        expect(signals.mergeSignals([one], [one])).toEqual([one]);
        const many = Array.from({ length: 25 }, (_, i) => ({
            source: 'MESSAGE', message_id: `m${i}`, code: 'ASKED_AVAILABILITY', at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
        }));
        const merged = signals.mergeSignals([], many);
        expect(merged).toHaveLength(signals.MAX_STORED_SIGNALS);
        expect(merged[merged.length - 1].message_id).toBe('m24');
    });

    test('stored signals never contain message text', () => {
        const result = signals.classifyMessage(msg('m1', 'I want to order, my number is 01711111111', 60));
        expect(JSON.stringify(result)).not.toContain('01711111111');
        expect(JSON.stringify(result)).not.toContain('my number');
    });
});

describe('contactability (advisory only)', () => {
    const now = new Date('2026-09-27T10:00:00Z');
    test('inside the 24h window', () => {
        expect(contactability({
            channel_type: 'messenger',
            messaging_consent: { facebook: { opted_in: true, last_inbound_at: '2026-09-27T01:00:00Z' } },
        }, now)).toMatchObject({ window_open: true, reason: 'WITHIN_24H_WINDOW', window_closes_at: '2026-09-28T01:00:00.000Z' });
    });
    test('outside the window', () => {
        expect(contactability({
            channel_type: 'messenger',
            messaging_consent: { facebook: { last_inbound_at: '2026-09-25T01:00:00Z' } },
        }, now)).toMatchObject({ window_open: false, reason: 'OUTSIDE_24H_WINDOW' });
    });
    test('opted out wins over a recent message', () => {
        expect(contactability({
            channel_type: 'messenger',
            messaging_consent: { facebook: { last_inbound_at: '2026-09-27T09:00:00Z', opted_out_at: '2026-09-27T09:30:00Z' } },
        }, now)).toMatchObject({ window_open: false, reason: 'OPTED_OUT' });
    });
    test('manual customers are not messageable channels', () => {
        expect(contactability({ channel_type: 'manual' }, now).reason).toBe('NOT_A_MESSAGING_CHANNEL');
    });
});
