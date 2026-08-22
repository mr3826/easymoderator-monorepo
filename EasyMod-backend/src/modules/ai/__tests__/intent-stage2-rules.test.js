'use strict';

const {
    PENDING_BANGLA_LANGUAGE_QA_LITERALS,
    classify,
    hasPurchaseIntent,
    isNegatedMutation,
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
        expect(result.matchedRule).toMatch(/^1\.1\.0:/);
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

    test.each([
        ['confirm order yes', 'ORDER_SESSION_CHECKOUT'],
        ['yes confirm this order', 'ORDER_SESSION_CHECKOUT'],
        ['checkout now', 'ORDER_SESSION_CHECKOUT'],
        ['order ta confirm korun', 'ORDER_SESSION_CHECKOUT'],
        ['ঠিক আছে অর্ডার কনফার্ম', 'ORDER_SESSION_CHECKOUT'],
        ['I confirm', 'ORDER_SESSION_CHECKOUT'],
        ['yes go ahead', 'ORDER_SESSION_CHECKOUT'],
        ['checkout order', 'ORDER_SESSION_CHECKOUT'],
        ['add one more shirt', 'CART_EDIT_OR_ADD_MORE'],
        ['cart e aro ekta dao', 'CART_EDIT_OR_ADD_MORE'],
        ['edit my preorder cart', 'CART_EDIT_OR_ADD_MORE'],
        ['quantity change korbo', 'CART_EDIT_OR_ADD_MORE'],
        ['cart theke eta bad dao', 'CART_EDIT_OR_ADD_MORE'],
        ['can I add another product', 'CART_EDIT_OR_ADD_MORE'],
        ['do you have this item', 'PRODUCT_AVAILABILITY'],
        ['এই পণ্যটি কি আছে', 'PRODUCT_AVAILABILITY'],
        ['can I get this product', 'PRODUCT_AVAILABILITY'],
        ['available size ache', 'PRODUCT_AVAILABILITY'],
        ['নাই নাকি আছে', 'PRODUCT_AVAILABILITY'],
        ['এই শার্টটা স্টকে আছে?', 'PRODUCT_AVAILABILITY'],
        ['কোন সাইজ স্টকে আছে?', 'PRODUCT_AVAILABILITY'],
        ['স্টক আছে?', 'PRODUCT_AVAILABILITY'],
        ['do you have cotton saree', 'PRODUCT_INQUIRY'],
        ['saree collection dekhাও', 'PRODUCT_INQUIRY'],
        ['cotton jamdani saree', 'PRODUCT_INQUIRY'],
        ['I need an agent', 'HUMAN_HANDOFF_REQUEST'],
        ['let me speak with someone', 'HUMAN_HANDOFF_REQUEST'],
        ['shop team help me', 'HUMAN_HANDOFF_REQUEST'],
        ['my order is delayed', 'ORDER_POST_PURCHASE_REQUEST'],
        ['modify the order after purchase', 'ORDER_POST_PURCHASE_REQUEST'],
        ['how are you', 'GENERAL_CHAT_OR_UNKNOWN'],
        ['ভালো আছেন?', 'GENERAL_CHAT_OR_UNKNOWN'],
        ['maybe confirm this?', 'GENERAL_CHAT_OR_UNKNOWN'],
        ["I don't want to confirm order", 'GENERAL_CHAT_OR_UNKNOWN'],
        ['do not checkout now', 'GENERAL_CHAT_OR_UNKNOWN'],
        ['confirm order but change address', 'GENERAL_CHAT_OR_UNKNOWN'],
        ["don't add another product", 'GENERAL_CHAT_OR_UNKNOWN'],
        ['confirm order no!', 'GENERAL_CHAT_OR_UNKNOWN'],
        ['checkout korbo na', 'GENERAL_CHAT_OR_UNKNOWN'],
        ['add another product na', 'GENERAL_CHAT_OR_UNKNOWN'],
        ['change quantity to two na', 'GENERAL_CHAT_OR_UNKNOWN'],
        ['অর্ডার কনফার্ম না!', 'GENERAL_CHAT_OR_UNKNOWN'],
        ['do not cancel order', 'GENERAL_CHAT_OR_UNKNOWN'],
        ['ঠিক আছে', 'GENERAL_CHAT_OR_UNKNOWN'],
    ])('covers the C3 boundary fixture %s', (text, intentId) => {
        expect(classify(text, { language: 'mixed', activeSession: true }).intentId).toBe(intentId);
    });

    test('does not turn an initial product order phrase into checkout', () => {
        expect(classify('confirm order for this item').intentId).toBe('PURCHASE_INTENT_START');
    });

    test.each([
        ['cancel checkout', 'ORDER_SESSION_CANCEL'],
        ['human hair wig price?', 'PRODUCT_INQUIRY'],
        ['complaint policy?', 'FAQ_KNOWLEDGE_QUESTION'],
        ['I want to change my order before purchase', 'PRODUCT_INQUIRY'],
        ['cotton and silk saree', 'PRODUCT_INQUIRY'],
    ])('rejects a contextual false positive for %s', (text, intentId) => {
        expect(classify(text, { language: 'en' }).intentId).toBe(intentId);
    });

    test('records availability variants without confusing them with attributes', () => {
        expect(classify('এই শার্টটা স্টকে আছে?', { language: 'bn' }).slots).toEqual({
            productReference: 'এই শার্টটা স্টকে আছে?',
        });
        expect(classify('কোন সাইজ স্টকে আছে?', { language: 'bn' }).slots).toEqual({
            productReference: null,
            variant: 'size',
        });
    });

    test.each([
        "I don't want to confirm order",
        'do not checkout now',
        'cancel checkout',
        "don't add another product",
        'checkout korbo na',
        'confirm order no',
    ])('marks refusal or cancellation as a negated mutation: %s', (text) => {
        expect(isNegatedMutation(text)).toBe(true);
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
