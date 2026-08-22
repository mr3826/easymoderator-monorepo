'use strict';

const {
    PENDING_BANGLA_LANGUAGE_QA_LITERALS,
    classify,
    hasPurchaseIntent,
    isOrderCancel,
    isNegatedPurchase,
} = require('../intent/stage2-rules');

describe('Stage-2 deterministic intent rules', () => {
    test.each([
        ['ঢাকার বাইরে কত?', { staticConfigAvailable: true }, 'DELIVERY_CHARGE', 'KNOWLEDGE'],
        ['ঢাকার বাইরে কত?', { staticConfigAvailable: false }, 'DELIVERY_CHARGE', 'COMMERCE_OPS'],
        ['ঢাকার বাইরে কুরিয়ার দিয়ে এখন কত লাগবে?', { staticConfigAvailable: true }, 'DELIVERY_CHARGE', 'COMMERCE_OPS'],
        ['কি কি পেমেন্ট নেন?', {}, 'PAYMENT_METHODS', 'KNOWLEDGE'],
        ['আমার পেমেন্টটা গেছে?', {}, 'PAYMENT_POLICY', 'COMMERCE_OPS'],
        ['এই জামার সাইজ কি?', {}, 'PRODUCT_ATTRIBUTE', 'PRODUCT'],
        ['অর্ডারটা বদলাতে চাই', {}, 'ORDER_POST_PURCHASE_REQUEST', 'SUPPORT'],
    ])('classifies %s using the registry domain tie-break', (text, options, intentId, domain) => {
        const result = classify(text, options);
        expect(result.intentId).toBe(intentId);
        expect(result.domain).toBe(domain);
        expect(result.source).toBe('RULE');
        expect(result.matchedRule).toMatch(/^1\.0\.0:/);
    });

    test.each([
        ['অর্ডার করবো না', 'GENERAL_CHAT_OR_UNKNOWN'],
        ["I don't want to order", 'GENERAL_CHAT_OR_UNKNOWN'],
        ['na hoile', 'GENERAL_CHAT_OR_UNKNOWN'],
        ['order korbo', 'PURCHASE_INTENT_START'],
        ['nibo', 'PURCHASE_INTENT_START'],
    ])('handles purchase negation safely for %s', (text, expectedIntent) => {
        expect(classify(text).intentId).toBe(expectedIntent);
        if (expectedIntent === 'GENERAL_CHAT_OR_UNKNOWN') expect(isNegatedPurchase(text)).toBe(true);
    });

    test.each([
        ['stop', 'STOP_OPT_OUT'],
        ['আর মেসেজ চাই না', 'STOP_OPT_OUT'],
        ['talk to a real person', 'HUMAN_HANDOFF_REQUEST'],
        ['একজন মানুষের সাথে কথা বলুন', 'HUMAN_HANDOFF_REQUEST'],
        ['cancel order', 'ORDER_SESSION_CANCEL'],
        ['I want to return my order', 'ORDER_POST_PURCHASE_REQUEST'],
        ['is this shirt available?', 'PRODUCT_AVAILABILITY'],
        ['what is the size of this shirt?', 'PRODUCT_ATTRIBUTE'],
        ['hello', 'GREETING'],
    ])('emits a registry ID for %s', (text, intentId) => {
        expect(classify(text, { language: 'en' }).intentId).toBe(intentId);
    });

    test('extracts post-purchase reasons and attribute slots', () => {
        expect(classify('I need to complain about my order').slots).toEqual({ reason: 'COMPLAINT' });
        expect(classify('what color is this saree?').slots).toEqual({
            attribute: 'color',
            productReference: 'what color is this saree?',
        });
        expect(classify('what material is this shirt?').slots.attribute).toBe('material');
    });

    test('attachment classification is read-only photo lookup', () => {
        expect(classify('order korbo', { hasAttachment: true })).toEqual(expect.objectContaining({
            intentId: 'PRODUCT_PHOTO_LOOKUP',
            domain: 'PRODUCT',
            slots: expect.objectContaining({ attachment: true }),
        }));
    });

    test('payment evidence with an attachment stays in the self-MFS boundary', () => {
        expect(classify('bkash payment screenshot', { hasAttachment: true })).toEqual(expect.objectContaining({
            intentId: 'SELF_MFS_PAYMENT_VERIFICATION',
            domain: 'COMMERCE_OPS',
            slots: expect.objectContaining({ screenshot: true, expectedAmount: null }),
        }));
    });

    test('all new Bengali literals are explicitly marked pending language QA', () => {
        expect(PENDING_BANGLA_LANGUAGE_QA_LITERALS.length).toBeGreaterThan(0);
        expect(PENDING_BANGLA_LANGUAGE_QA_LITERALS).toContain('ঢাকার বাইরে কত');
    });
});

describe('pre-move order-flow characterization', () => {
    test.each([
        'nibo', 'order korbo', 'order dibo', 'kinte chai', 'I want to order this',
        'অর্ডার করব', 'নিব', 'কিনবো', 'Oder korbo', 'odar dibo', 'ordar korte chai',
        'Confirm korun', 'confirm koren', 'কনফার্ম করুন',
    ])('hasPurchaseIntent remains true for %s', (message) => {
        expect(hasPurchaseIntent(message)).toBe(true);
    });

    test.each([
        'ei saree tar dam koto?', 'just looking', 'do you have this in blue?',
        'amar order 123456 kothay?', 'delivery koto din lagbe?',
    ])('hasPurchaseIntent remains false for %s', (message) => {
        expect(hasPurchaseIntent(message)).toBe(false);
    });

    test.each(['cancel', 'cancel korbo', 'order cancel', 'অর্ডার বাতিল', 'বাতিল', "don't want this order"])('isOrderCancel remains true for %s', (message) => {
        expect(isOrderCancel(message)).toBe(true);
    });

    test.each(['লাগবে না', 'lagbe na', 'আর লাগবে না', 'ar lagbe na', 'no', 'না', 'no, confirm this', 'cancel blue shirt', 'হ্যাঁ', 'yes', 'John Doe', 'Mirpur 10'])('isOrderCancel remains false for %s', (message) => {
        expect(isOrderCancel(message)).toBe(false);
    });
});
