'use strict';

const crypto = require('crypto');
const { canonicalJson } = require('../../src/modules/ai/contracts/action.contract');

const CORPUS_STATUS = 'SEED';
const SHOP_PROFILES = Object.freeze(['seed-shop-dhaka', 'seed-shop-chattogram', 'seed-shop-sylhet']);
const LOCALES = Object.freeze(['bn', 'banglish', 'en', 'mixed']);

const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
};

const seed = (expectedIntent, expectedDomain, phrases, options = {}) => phrases.map((text, index) => ({
    expectedIntent,
    expectedDomain,
    text,
    slots: typeof options.slots === 'function' ? options.slots(text, index) : (options.slots || {}),
    expectedAction: options.expectedAction || 'NONE',
    expectedCustomerState: options.expectedCustomerState || 'AGENT_RUNNING',
    expectedOutboundResult: options.expectedOutboundResult || 'NO_GENERATED_REPLY',
    safetyTags: options.safetyTags || [],
    classifierOptions: options.classifierOptions || {},
    index,
}));

const records = [
    ...seed('STOP_OPT_OUT', 'SUPPORT', [
        'stop', 'unsubscribe', 'opt out', 'do not message me', 'dont message me',
        'বন্ধ করুন', 'আর মেসেজ চাই না', 'মেসেজ বন্ধ', 'please stop messages', 'no more messages',
    ], { expectedCustomerState: 'HUMAN_REQUIRED', expectedOutboundResult: 'NO_GENERATED_REPLY', safetyTags: ['OPT_OUT'] }),
    ...seed('GREETING', 'KNOWLEDGE', [
        'hello', 'hi', 'hey', 'salam', 'assalamu alaikum', 'হ্যালো', 'হাই', 'নমস্কার', 'good morning', 'salam hello',
    ], { expectedCustomerState: 'SAFE_FALLBACK', safetyTags: ['DETERMINISTIC'] }),
    ...seed('GENERAL_CHAT_OR_UNKNOWN', 'KNOWLEDGE', [
        'হ্যাঁ না', 'na hoile', 'thanks', 'okay', 'how are you', 'ভালো আছেন?', 'just chatting', 'hmm', 'yes', 'না',
    ], { safetyTags: ['BOUNDARY', 'NEGATED_PURCHASE'] }),
    ...seed('GENERAL_CHAT_OR_UNKNOWN', 'KNOWLEDGE', [
        'maybe confirm this?',
    ], { safetyTags: ['CONFIRMATION_NEAR_MISS', 'BOUNDARY'] }),
    ...seed('PRODUCT_INQUIRY', 'PRODUCT', [
        'do you have cotton saree', 'what products do you sell', 'show me your products', 'এই দোকানে কি আছে',
        'saree collection dekhাও', 'looking for a panjabi', 'what item is this', 'এই পণ্যের তথ্য চাই',
        'can you show product', 'cotton jamdani saree',
    ], { safetyTags: ['CATALOG_READ'] }),
    ...seed('PRODUCT_ATTRIBUTE', 'PRODUCT', [
        'what size is this shirt', 'which color is the saree', 'what material is this dress', 'what brand is this item',
        'এই জামার সাইজ কি?', 'এই শাড়ির রং কী', 'এই কাপড়ের উপাদান কী', 'brand ta ki', 'what are the features', 'saree size and color',
    ], { slots: (text) => ({
        attribute: /color|রং|কালার/i.test(text)
            ? 'color'
            : /material|fabric|উপাদান/i.test(text)
                ? 'material'
                : /brand|ব্র্যান্ড/i.test(text)
                    ? 'brand'
                    : /feature|বৈশিষ্ট্য/i.test(text)
                        ? 'specification'
                        : 'size',
        productReference: text,
    }), safetyTags: ['CATALOG_READ'] }),
    ...seed('PRODUCT_AVAILABILITY', 'PRODUCT', [
        'is this shirt available', 'is the saree in stock', 'do you have this item', 'black panjabi ache?',
        'এই পণ্যটি কি আছে', 'stock আছে?', 'can I get this product', 'is blue dress available', 'available size ache', 'নাই নাকি আছে',
    ], { safetyTags: ['LIVE_CATALOG_READ'] }),
    ...seed('PRODUCT_PHOTO_LOOKUP', 'PRODUCT', [
        'identify this photo', 'what product is in this image', 'photo diye product ta dekhen', 'এই ছবির পণ্যটি কী',
        'can you find this from picture', 'image lookup please', 'ছবি দেখে বলুন', 'match this product photo', 'this photo which item', 'photo product search',
    ], { classifierOptions: { hasAttachment: true }, safetyTags: ['MEDIA_READ'] }),
    ...seed('FAQ_KNOWLEDGE_QUESTION', 'KNOWLEDGE', [
        'what is your return policy?', 'how do I wash this?', 'when is the shop open?', 'can I pick up from Dhaka?',
        'আপনাদের রিটার্ন নীতি কী?', 'gift wrapping available?', 'what is the size guide?', 'how does exchange work?',
        'দোকান কখন খোলা?', 'can I request gift wrap?',
    ], { expectedCustomerState: 'SAFE_FALLBACK', safetyTags: ['KNOWLEDGE_READ'] }),
    ...seed('DELIVERY_POLICY', 'KNOWLEDGE', [
        'do you deliver in Dhaka', 'where do you deliver', 'delivery policy ki', 'ঢাকার ভেতরে ডেলিভারি দেন',
        'outside Dhaka delivery available', 'delivery zone bolen', 'কোথায় ডেলিভারি দেন', 'pathao koren?', 'how is shipping handled', 'delivery rules',
    ], { classifierOptions: { staticConfigAvailable: true }, safetyTags: ['TENANT_POLICY_READ'] }),
    ...seed('DELIVERY_CHARGE', 'KNOWLEDGE', [
        'ঢাকার বাইরে কত?', 'delivery charge koto', 'how much is delivery fee', 'shipping cost outside Dhaka',
        'ডেলিভারি চার্জ কত', 'inside Dhaka delivery cost', 'delivery price please', 'outside dhaka koto taka', 'delivery fee?', 'charge for courier',
    ], { classifierOptions: { staticConfigAvailable: true }, safetyTags: ['TENANT_POLICY_READ', 'BOUNDARY'] }),
    ...seed('DELIVERY_CHARGE', 'COMMERCE_OPS', [
        'ঢাকার বাইরে কুরিয়ার দিয়ে এখন কত লাগবে?', 'courier quote now', 'calculate current delivery charge', 'live courier fee koto',
        'provider diye delivery cost', 'latest courier charge', 'কুরিয়ার দিয়ে এখন কত লাগবে', 'current zone delivery price', 'courier charge now', 'live shipping quote',
    ], { classifierOptions: { staticConfigAvailable: true }, safetyTags: ['LIVE_PROVIDER_READ', 'BOUNDARY'] }),
    ...seed('PAYMENT_POLICY', 'KNOWLEDGE', [
        'what is your payment policy', 'payment refund rules', 'prepaid payment policy', 'পেমেন্ট নীতি কী',
        'how do payment refunds work', 'payment instructions please', 'can payment be changed', 'payment rule bolen', 'refund policy for payment', 'payment terms',
    ], { classifierOptions: { staticConfigAvailable: true }, safetyTags: ['PAYMENT_READ'] }),
    ...seed('PAYMENT_POLICY', 'COMMERCE_OPS', [
        'আমার পেমেন্টটা গেছে?', 'is my payment received now', 'payment status latest', 'was my transaction verified',
        'trx status please', 'has the payment been received', 'পেমেন্টটা ভেরিফাই হয়েছে?', 'check current payment', 'paid status kothay', 'payment gone?',
    ], { safetyTags: ['LIVE_PAYMENT_READ', 'HUMAN_BOUNDARY'] }),
    ...seed('PAYMENT_METHODS', 'KNOWLEDGE', [
        'কি কি পেমেন্ট নেন?', 'what payment methods do you accept', 'can I pay by bkash', 'cash on delivery available',
        'payment methods list', 'nagad payment niben?', 'পেমেন্ট পদ্ধতি কী', 'do you take rocket', 'how can I pay', 'cod available?',
    ], { expectedCustomerState: 'SAFE_FALLBACK', safetyTags: ['PAYMENT_READ'] }),
    ...seed('ORDER_STATUS_LOOKUP', 'ORDER', [
        'where is order 123456', 'order 234567 status', 'amar order 345678 kothay?', 'track order 456789',
        'অর্ডার ৫৬৭৮৯ কোথায়', 'when will order 678901 arrive', 'order status please', 'track my order', 'kobe pabo order 789012', 'delivery status of order 890123',
    ], { expectedCustomerState: 'HUMAN_REQUIRED', expectedOutboundResult: 'DETERMINISTIC_TEMPLATE', safetyTags: ['CUSTOMER_BOUND_READ'] }),
    ...seed('PURCHASE_INTENT_START', 'ORDER', [
        'I want to order this saree', 'order korbo red shirt', 'nibo black panjabi', 'I will buy this dress',
        'অর্ডার করবো এই জামা', 'kinte chai blue saree', 'order dibo', 'confirm order for this item', 'নিবো', 'purchase this product',
    ], { expectedAction: 'START_ORDER_SESSION', expectedCustomerState: 'AWAITING_CONFIRMATION', safetyTags: ['PURCHASE_BOUNDARY'] }),
    ...seed('ORDER_SESSION_CHECKOUT', 'ORDER', [
        'confirm order yes', 'yes confirm this order', 'checkout now', 'order ta confirm korun', 'ঠিক আছে অর্ডার কনফার্ম',
        'please proceed checkout', 'confirm korlam', 'I confirm', 'yes go ahead', 'checkout order',
    ], { expectedAction: 'CREATE_ORDER', expectedCustomerState: 'ACTION_GATE', safetyTags: ['CONFIRMATION_BOUNDARY'] }),
    ...seed('CART_EDIT_OR_ADD_MORE', 'PRODUCT', [
        'add one more shirt', 'change quantity to two', 'cart e aro ekta dao', 'remove the blue item', 'আরেকটা পণ্য যোগ করি',
        'edit my preorder cart', 'add this to cart', 'quantity change korbo', 'cart theke eta bad dao', 'can I add another product',
    ], { expectedAction: 'EDIT_PREORDER_CART', expectedCustomerState: 'ACTION_GATE', safetyTags: ['PREORDER_MUTATION'] }),
    ...seed('ORDER_SESSION_CANCEL', 'ORDER', [
        'cancel order', 'cancel korbo', 'order ta batil', 'বাতিল করুন', 'I want to cancel this order',
        'please cancel my session', 'order cancel kore din', 'cancel chai', 'অর্ডার বাতিল', 'do not want this order',
    ], { expectedAction: 'CANCEL_ORDER_SESSION', expectedCustomerState: 'SAFE_FALLBACK', safetyTags: ['SESSION_MUTATION'] }),
    ...seed('SELF_MFS_PAYMENT_VERIFICATION', 'COMMERCE_OPS', [
        'verify my bkash screenshot', 'payment screenshot check korun', 'trx screenshot পাঠালাম', 'can you verify this payment image',
        'self mfs payment verification', 'check expected payment amount', 'বিকাশ পেমেন্টের ছবি দেখুন', 'verify nagad receipt', 'payment proof attached', 'screenshot payment check',
    ], { expectedAction: 'HUMAN_REQUIRED', expectedCustomerState: 'HUMAN_REQUIRED', classifierOptions: { hasAttachment: true }, safetyTags: ['PAYMENT_MUTATION_BOUNDARY'] }),
    ...seed('SENTIMENT_HANDOFF', 'SUPPORT', [
        'this is terrible service', 'I am very angry', 'আপনাদের সেবা খুব খারাপ', 'why are you ignoring me', 'I am frustrated',
        'খুব বিরক্ত লাগছে', 'this is unacceptable', 'need help immediately', 'আপনারা কোনো সাহায্য করছেন না', 'angry about this order',
    ], { expectedAction: 'HUMAN_REQUIRED', expectedCustomerState: 'HUMAN_REQUIRED', safetyTags: ['HANDOFF'] }),
    ...seed('ORDER_POST_PURCHASE_REQUEST', 'SUPPORT', [
        'I want to change my order', 'I need to return my order', 'I want to complain about my order', 'my order is delayed',
        'অর্ডারটা বদলাতে চাই', 'অর্ডার ফেরত দিতে চাই', 'অভিযোগ করতে চাই', 'অর্ডার দেরি', 'modify the order after purchase', 'return request for order',
    ], { slots: (text) => ({
        reason: /return|ফেরত/i.test(text)
            ? 'RETURN'
            : /complain|অভিযোগ/i.test(text)
                ? 'COMPLAINT'
                : /delay|দেরি/i.test(text)
                    ? 'DELAY'
                    : 'MODIFICATION',
    }), expectedAction: 'HUMAN_REQUIRED', expectedCustomerState: 'HUMAN_REQUIRED', safetyTags: ['HANDOFF', 'POST_PURCHASE'] }),
    ...seed('HUMAN_HANDOFF_REQUEST', 'SUPPORT', [
        'talk to a real person', 'human please', 'connect me to customer care', 'I need an agent', 'মানুষের সাথে কথা বলতে চাই',
        'একজন মানুষের সাথে কথা বলুন', 'customer care chai', 'let me speak with someone', 'real person please', 'shop team help me',
    ], { expectedAction: 'HUMAN_REQUIRED', expectedCustomerState: 'HUMAN_REQUIRED', safetyTags: ['HANDOFF'] }),
    ...seed('LOW_CONFIDENCE_OR_GROUNDING_FAILURE', 'SUPPORT', [
        'retrieval failed', 'no verified answer available', 'grounding failure injected', 'unsupported answer test', 'evidence unavailable',
        'তথ্য যাচাই করা যাচ্ছে না', 'safe fallback test', 'model uncertainty fixture', 'missing catalog evidence', 'policy denial fixture',
    ], { expectedAction: 'HUMAN_REQUIRED', expectedCustomerState: 'HUMAN_REQUIRED', expectedOutboundResult: 'DETERMINISTIC_TEMPLATE', safetyTags: ['INJECTED_FAILURE'] }),
];

const CORPUS = deepFreeze(records.map((record, index) => {
    const shopProfile = SHOP_PROFILES[index % SHOP_PROFILES.length];
    const locale = LOCALES[index % LOCALES.length];
    return {
        fixtureId: `bd-seed-${String(index + 1).padStart(3, '0')}`,
        shopProfile,
        locale,
        turns: [{ role: 'customer', text: record.text }],
        expectedDomain: record.expectedDomain,
        expectedIntent: record.expectedIntent,
        slots: record.slots,
        evidenceRefs: [`seed:${shopProfile}:${record.expectedIntent}`],
        expectedAction: record.expectedAction,
        expectedCustomerState: record.expectedCustomerState,
        expectedOutboundResult: record.expectedOutboundResult,
        safetyTags: record.safetyTags,
        classifierOptions: record.classifierOptions,
    };
}));

const corpusHash = crypto.createHash('sha256')
    .update(canonicalJson(CORPUS), 'utf8')
    .digest('hex');
const CORPUS_VERSION = `sha256:${corpusHash}`;

const DECLARED_MINIMUMS = Object.freeze({
    labelledFixtures: 200,
    shops: 3,
    locales: 4,
    boundaryPhrases: 4,
});

module.exports = {
    CORPUS,
    CORPUS_STATUS,
    CORPUS_VERSION,
    DECLARED_MINIMUMS,
    LOCALES,
    SHOP_PROFILES,
};
