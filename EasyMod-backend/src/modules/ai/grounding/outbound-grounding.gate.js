'use strict';

/**
 * Outbound grounding gate — EasyModerator's final authority over what reaches Meta.
 *
 * Runs on EVERY candidate reply, whatever produced it: gemini-lite, gemini-pro,
 * the OpenAI fallback, the response cache, the FAQ tier, or a future provider.
 * Provider selection happens strictly inside this boundary, so a model swap can
 * never remove the guarantees.
 *
 * The gate is deterministic and calls no model. A model cannot be asked to grade
 * its own truthfulness — that is the property the incident depended on.
 *
 * Checks, in order of severity:
 *   1. candidate is a usable string            → MODEL_OUTPUT_INVALID
 *   2. catalog could not be read               → RETRIEVAL_FAILED
 *   3. asserts availability of something absent → PRODUCT_NOT_FOUND
 *   4. states a figure no source supports       → UNSUPPORTED_PRICE_CLAIM
 *   5. contains a URL no evidence authorises    → UNSUPPORTED_URL_CLAIM
 *   6. answers an UNKNOWN attribute as if known → PRODUCT_ATTRIBUTE_UNKNOWN
 *
 * A failed check never lets the candidate through in edited form; it is replaced
 * wholesale by a written reply that is true by construction.
 */

const {
    ProductEvidenceStatus,
    FactState,
    MediaStatus,
    GroundingDecision,
    ReasonCode,
    emptyEvidence,
} = require('./grounding.contract');
const {
    productNotFoundReply,
    productImageUnavailableReply,
    productImageNoProductReply,
    retrievalFailedReply,
    knowledgeNotFoundReply,
} = require('./grounding-prompt');
const { ATTRIBUTE_VOCABULARY, ATTRIBUTE_LABELS, identifyingTerms } = require('./product-evidence.service');

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Normalise a numeric string for comparison: Bengali digits → ASCII, drop separators. */
const normaliseNumber = (raw) => String(raw)
    .replace(/[০-৯]/g, (d) => String(BENGALI_DIGITS.indexOf(d)))
    .replace(/[,\s]/g, '')
    .replace(/\.0+$/, '');

/** Currency-adjacent figures only — "2-3 din" is a lead time, not a price claim. */
const PRICE_CLAIM_PATTERN =
    /(?:৳|tk\.?|taka|টাকা|bdt)\s*([\d০-৯][\d০-৯,]*(?:\.\d+)?)|([\d০-৯][\d০-৯,]*(?:\.\d+)?)\s*(?:৳|tk\b|taka|টাকা|bdt)/gi;
const FOREIGN_CURRENCY_SYMBOLS = String.raw`[$€£₹¥￥₩₽₺₪₴₦₱฿₫]`;
const FOREIGN_CURRENCY_CODES = String.raw`usd|eur|gbp|inr|jpy|cny|krw|aed|sar|cad|aud|chf|sgd|myr|thb|idr|pkr|npr|lkr|qar|kwd|omr|bhd|twd|hkd|vnd|php|rub|try|zar|nzd|sek|nok|dkk|brl|mxn|egp|kzt|rs\.?`;
const FOREIGN_CURRENCY_AMOUNT = String.raw`[\d০-৯][\d০-৯,]*(?:\.\d+)?`;
const FOREIGN_CURRENCY_CLAIM_PATTERN = new RegExp(
    String.raw`(?:${FOREIGN_CURRENCY_SYMBOLS}\s*(${FOREIGN_CURRENCY_AMOUNT})|(${FOREIGN_CURRENCY_AMOUNT})\s*${FOREIGN_CURRENCY_SYMBOLS}|\b(?:${FOREIGN_CURRENCY_CODES})\s*(${FOREIGN_CURRENCY_AMOUNT})|(${FOREIGN_CURRENCY_AMOUNT})\s*\b(?:${FOREIGN_CURRENCY_CODES}))`,
    'gi',
);
const UNKNOWN_CURRENCY_CODE_CLAIM_PATTERN = /(?<![A-Za-z])(?!(?:BDT|XXL|XXS)\b)[A-Z]{3}\s*([\d০-৯][\d০-৯,]*(?:\.\d+)?)|([\d০-৯][\d০-৯,]*(?:\.\d+)?)\s*(?!(?:BDT|XXL|XXS)\b)[A-Z]{3}(?![A-Za-z])/g;
const UNKNOWN_CURRENCY_CODE_CLAIM_MARKER = /^(?:(?<![A-Za-z])(?!(?:BDT|XXL|XXS)\b)[A-Z]{3}\s*[\d০-৯][\d০-৯,]*(?:\.\d+)?|[\d০-৯][\d০-৯,]*(?:\.\d+)?\s*(?!(?:BDT|XXL|XXS)\b)[A-Z]{3}(?![A-Za-z]))$/;
const FOREIGN_CURRENCY_MARKER = new RegExp(
    String.raw`${FOREIGN_CURRENCY_SYMBOLS}|\b(?:${FOREIGN_CURRENCY_CODES})\b`,
    'i',
);
const isForeignCurrencyClaim = (text) => FOREIGN_CURRENCY_MARKER.test(String(text || ''))
    || UNKNOWN_CURRENCY_CODE_CLAIM_MARKER.test(String(text || '').trim());
const BARE_AMOUNT_PATTERN = /(?<![\d০-৯])([\d০-৯][\d০-৯,]*(?:\.\d+)?)(?![\d০-৯])/g;

const amountFromMatch = (match) => match?.[1] || match?.[2] || match?.[3] || match?.[4]
    || String(match?.[0] || '').match(/[\d০-৯][\d০-৯,]*(?:\.\d+)?/)?.[0]
    || null;

const POLICY_FEE_LABEL = /\b(?:delivery|shipping|courier|return|exchange|service)\b(?:(?![.!?;,\n]).){0,40}\b(?:fees?|charges?|costs?|rates?)\b|\b(?:fees?|charges?|costs?|rates?)\s+(?:for\s+)?(?:delivery|shipping|courier|return|exchange|service)\b|(?:ডেলিভারি|কুরিয়ার|কুরিয়ার|রিটার্ন|এক্সচেঞ্জ|সার্ভিস)(?:(?![।.!?;,\n]).){0,24}(?:ফি|চার্জ|খরচ|রেট)/i;

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;

/** Every URL appearing in a block of authoritative merchant text. */
const extractUrls = (text) => (typeof text === 'string'
    ? [...text.matchAll(URL_PATTERN)].map(m => m[0].replace(/[.,);]+$/, '').replace(/\/+$/, ''))
    : []);

/** Affirmative availability, EN / Banglish / Bengali. */
const AVAILABILITY_ASSERTION =
    /\b(?:we have|in stock|is available|are available|yes we|ache|achhe|ase|paben|peye jaben)\b|আছে|স্টকে|পাবেন/i;
const DELIVERY_TERMS = /\b(?:delivery|deliver|shipping|ship|courier|dispatch|rider)\b|ডেলিভারি|কুরিয়ার|কুরিয়ার|পাঠানো|পৌঁছে/i;
const DELIVERY_ASSERTION = /\b(?:we\s+(?:can|will|do)\s+(?:deliver|ship)|delivery\s+(?:is\s+)?available|nationwide\s+delivery|will\s+arrive|can\s+arrive|ships?\s+to)\b|ডেলিভারি\s*(?:হবে|পাবেন|দেওয়া হয়|দেওয়া হয়)/i;
const DELIVERY_NEGATIVE_ASSERTION = /\b(?:delivery|shipping|courier)\s+(?:is\s+)?(?:not\s+available|unavailable|not\s+supported|not\s+offered|not\s+possible)|\bwe\s+(?:cannot|can't|won't|do\s+not|don't)\s+(?:deliver|ship)\b|ডেলিভারি\s*(?:হবে না|পাবেন না|দেওয়া হয় না|দেওয়া হয় না)/i;
const COMMITMENT_TIMELINE = /(?:(?<![\p{L}\p{N}])[0-9০-৯]{1,2}\s*(?:[-–]\s*[0-9০-৯]{1,2}\s*)?(?:(?:(?:business|working)\s+)?(?:minutes?|hours?|days?|weeks?)|মিনিট|ঘণ্টা|ঘন্টা|দিন(?:ে)?|সপ্তাহ(?:ে)?)(?![\p{L}\p{N}])|\b(?:today|tomorrow|same[- ]day|next day|within 24 hours|one day|two days|three days)\b|আজ|আগামীকাল|২৪\s*ঘণ্টা|এক\s*দিন|দুই\s*দিন|তিন\s*দিন)/giu;
const ORDER_CONFIRMATION_CLAIM = /\b(?:order\s+(?:is\s+)?(?:confirmed|placed|created|received|processing)|(?:confirmed|placed)\s+(?:your\s+)?order|we\s+(?:have\s+)?(?:confirmed|placed)\s+your\s+order)\b|অর্ডার\s*(?:কনফার্ম|নিশ্চিত|হয়ে গেছে|হয়ে গেছে)/i;
const PAYMENT_CONFIRMATION_CLAIM = /\b(?:payment\s+(?:was\s+)?(?:received|verified|confirmed|successful)|paid\s+successfully|transaction\s*(?:id|trxid)\s*(?:is\s*)?(?:verified|confirmed)|we\s+received\s+(?:your\s+)?(?:payment|money)|money\s+received)\b|পেমেন্ট\s*(?:পেয়েছি|পেয়েছি|ভেরিফাই|নিশ্চিত)|টাকা\s*(?:পেয়েছি|পেয়েছি)/i;
const PAYMENT_METHOD_PATTERNS = Object.freeze({
    cod: /\b(?:cash\s+on\s+delivery|cod)\b|ক্যাশ\s*অন\s*ডেলিভারি/i,
    bkash: /\bb\s?cash\b|\bbkash\b|বিকাশ/i,
    nagad: /\bnagad\b|নগদ/i,
    rocket: /\brocket\b|রকেট/i,
    card: /\b(?:credit|debit|bank)?\s*card\b|\b(?:visa|mastercard|amex|american\s+express)\b|কার্ড/i,
    online: /\bonline\b|অনলাইন/i,
    advance: /\badvance\b|অগ্রিম/i,
    paypal: /\bpaypal\b/i,
    bank_transfer: /\b(?:bank|wire)\s+transfer\b|ব্যাংক\s*ট্রান্সফার/i,
    upi: /\bupi\b/i,
    google_pay: /\bgoogle\s+pay\b/i,
    cryptocurrency: /\b(?:crypto(?:currency)?|bitcoin|ethereum)\b/i,
});
const PAYMENT_METHOD_ASSERTION = /\b(?:payment|pay|paid|accept|accepted|take|takes|transfer|send|advance|cash|cod|transaction|use|via|by|available|option|method|support|supports)\b|পেমেন্ট|টাকা|গ্রহণ|পাঠান|দেন|দিতে|পাবেন/i;
const PAYMENT_METHOD_CLAIM_CONTEXT = /\b(?:accept|accepted|support|supports)\b|\btakes?\s+[A-Za-z][A-Za-z-]*|\b(?:pay|payment)\s+(?:by|via|with|using|through)\b|(?:পেমেন্ট|টাকা)\s*(?:করুন|দিন|দেন|পাঠান|গ্রহণ|দিতে|নিন)|(?:গ্রহণ|নিন|দেন|পাঠান)\s*.{0,12}(?:পেমেন্ট|টাকা)/i;
const PAYMENT_SEMANTIC_CONTEXT = /\b(?:payment|payments|pay|paid|transaction|cash|cod|advance|mfs)\b|পেমেন্ট|টাকা|লেনদেন/i;
const NON_PAYMENT_ACCEPTANCE_CONTEXT = /\b(?:returns?|exchanges?|refunds?|replacements?|cancellations?|orders?|bookings?)\b/i;
const PAYMENT_METHOD_ROUTE_TARGET = /\b(?:via|through|using|by)\s+(?:(?:a|an|the)\s+)?([A-Za-z][A-Za-z-]*)/gi;
const PAYMENT_METHOD_ACCEPTANCE_ROUTE_TARGET = /\b(?:orders?|bookings?|returns?|exchanges?|refunds?|replacements?|cancellations?)\s+(?:with|to)\s+(?:(?:a|an|the|our|local)\s+)?([A-Za-z][A-Za-z-]*)/gi;
const PAYMENT_METHOD_ACCEPTANCE_FOR_TARGET = /\b(?:accept|accepts|accepted|support|supports|take|takes)\s+([A-Za-z][A-Za-z-]*)\s+for\s+(?:returns?|exchanges?|refunds?|replacements?|cancellations?|orders?|bookings?)\b/gi;
const NON_PAYMENT_ROUTE_TARGETS = new Set([
    'mail', 'post', 'courier', 'delivery', 'pickup', 'pick-up', 'collection', 'store', 'shop', 'warehouse', 'branch', 'address', 'counter',
    'customer', 'customers', 'merchant', 'seller', 'carrier', 'rider', 'ups', 'dhl', 'fedex', 'usps',
    'pathao', 'steadfast', 'redx', 'ecourier', 'sundarban', 'end', 'beginning', 'start', 'middle',
    'request', 'requests', 'appointment', 'appointments', 'default', 'day', 'week', 'month', 'year',
    'today', 'tomorrow', 'tonight', 'next', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'saturday', 'sunday',
]);
const NON_PAYMENT_ACCEPTANCE_ROUTE_TARGETS = new Set([
    'confirmation', 'confirmations', 'reference', 'references', 'reservation', 'reservations',
    'notice', 'notices', 'date', 'dates', 'time', 'times', 'guest', 'guests', 'detail', 'details',
    'receipt', 'receipts', 'tag', 'tags', 'packaging', 'package',
]);
const NON_PAYMENT_ROUTE_MODIFIERS = new Set(['our', 'local', 'nearby', 'preferred', 'designated']);
const isNonPaymentRoute = (route) => {
    if (NON_PAYMENT_ROUTE_TARGETS.has(route.target)) return true;
    const routeWords = route.claim.match(/[A-Za-z]+(?:-[A-Za-z]+)*/g)?.map(word => word.toLowerCase()) || [];
    let targetIndex = 0;
    while (targetIndex < routeWords.length && NON_PAYMENT_ROUTE_MODIFIERS.has(routeWords[targetIndex])) {
        targetIndex += 1;
    }
    if (targetIndex > 0 && NON_PAYMENT_ROUTE_TARGETS.has(routeWords[targetIndex])) return true;
    if (!route.acceptanceItem) return false;
    return NON_PAYMENT_ACCEPTANCE_ROUTE_TARGETS.has(route.target)
        || /\b(?:free|express|standard|same[- ]day|next[- ]day|local)\s+(?:delivery|shipping|courier|pickup|pick-up)\b/i.test(route.claim)
        || /\boriginal\s+(?:packaging|package|tags?)\b/i.test(route.claim);
};
const PAYMENT_METHOD_NEGATION = /\b(?:not|no|never|cannot|can't|won't|doesn't|does\s+not|do\s+not|don't|isn't|aren't|unavailable|unsupported|set\s+up)\b|নেই|না/i;
const PAYMENT_DESTINATION_CONTEXT = /\b(?:payment|pay|paid|transfer|send|advance|cash|cod|transaction|money|bkash|nagad|rocket|card|online|mfs)\b|পেমেন্ট|টাকা|লেনদেন|বিকাশ|নগদ|রকেট|কার্ড/i;
const RETURN_PAYMENT_PHONE_DESTINATION = /\b(?:returns?|refunds?)\s+to\s+(?:(?:(?:our|the)\s+)?(?:phone(?:\s+number)?|number)\s*[:#-]?\s*)?(?=[+0-9০-৯])/i;
const BANGLADESH_PHONE_PATTERN = /(?<![0-9০-৯])(?:\+|00)?[8৮][8৮][0০][\s().-]*[1১](?:[\s().-]*[0-9০-৯]){9}(?![0-9০-৯])|(?<![0-9০-৯])(?:[0০])?[1১](?:[\s().-]*[0-9০-৯]){9}(?![0-9০-৯])/g;
const normalizePaymentPhone = (value) => {
    const digits = String(value || '')
        .replace(/[০-৯]/g, digit => String(digit.charCodeAt(0) - 0x09e6))
        .replace(/\D/g, '');
    if (digits.startsWith('00880')) return `0${digits.slice(5)}`;
    if (digits.startsWith('880')) return `0${digits.slice(3)}`;
    return digits;
};
const paymentPhoneNumbers = (text) => [...String(text || '').matchAll(BANGLADESH_PHONE_PATTERN)]
    .map(match => normalizePaymentPhone(match[0]))
    .filter(Boolean);

/** Any phrasing that admits the value is not known. */
const UNAVAILABILITY_MARKER =
    /\b(?:unknown|not available|unavailable|no information|not recorded|not listed|don'?t have|do not have|can'?t confirm|cannot confirm|not sure|not confirmed|nei|nai|jana nei|ullekh nei)\b|নেই|জানা\s*নেই|তথ্য\s*নেই|উল্লেখ\s*নেই/i;

const splitClaimClauses = (text, includeConjunctions = true) => {
    const separators = includeConjunctions
        ? /[,;.!?\n।]+|\b(?:but|however|and)\b|\s+(?:কিন্তু|এবং)\s+/gi
        : /[.!?\n।]+/g;
    return String(text || '').split(separators).map(value => value.trim()).filter(Boolean);
};

const claimClauseAt = (text, index) => {
    const prefix = String(text || '').slice(0, index);
    const suffix = String(text || '').slice(index);
    const left = [...prefix.matchAll(/[,;.!?\n।]+|\b(?:but|however|and)\b|\s+(?:কিন্তু|এবং)\s+/gi)].at(-1);
    const right = suffix.match(/[,;.!?\n।]+|\b(?:but|however|and)\b|\s+(?:কিন্তু|এবং)\s+/i);
    const start = left ? left.index + left[0].length : 0;
    const end = right ? index + right.index : String(text || '').length;
    return String(text || '').slice(start, end).trim();
};

const CLAIM_IDENTITY_FILLERS = new Set([
    'bdt', 'tk', 'rs', 'taka', 'takar', 'item', 'items', 'product', 'products',
    'option', 'options', 'variant', 'variants', 'one', 'ones', 'not', 'no', 'yes',
    'out', 'sold', 'unavailable', 'costs', 'price', 'only', 'just', 'at',
    'fee', 'fees', 'charge', 'charges', 'cost', 'rate', 'rates', 'shipping', 'courier',
    'delivery', 'return', 'exchange', 'service', 'inside', 'within', 'outside', 'in',
    'the', 'and', 'of', 'for', 'to', 'is', 'are', 'was', 'were', 'will', 'would',
    'could', 'can', 'should', 'be', 'with', 'including', 'extra', 'selling', 'listed',
    'priced', 'sells', 'retails', 'marked', 'goes', 'sale', 'available',
]);

const claimIdentityTerms = (text) => identifyingTerms(String(text || '')
    .replace(/[0-9০-৯৳$€£₹,]+/g, ' '))
    .filter(term => !CLAIM_IDENTITY_FILLERS.has(term));

const productIdentityTerms = (product) => identifyingTerms([
    product?.name,
    product?.nameBn,
    ...(product?.matchedTerms || []),
    product?.facts?.brand?.state === FactState.KNOWN ? product.facts.brand.value : null,
    product?.facts?.category?.state === FactState.KNOWN ? product.facts.category.value : null,
    ...(product?.facts?.variants || []).flatMap(variant => [variant.optionValue, variant.optionName]),
].filter(Boolean).join(' '));

const productsMatchingClaimIdentity = (clause, products) => {
    const terms = claimIdentityTerms(clause);
    if (!terms.length) return { terms, products: [] };
    const matches = products.filter(product => {
        const knownTerms = new Set(productIdentityTerms(product));
        return terms.every(term => knownTerms.has(term));
    });
    return { terms, products: matches };
};

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const removeKnownProductNames = (clause, products) => {
    const matchedProducts = productsMatchingClaimIdentity(clause, products).products;
    const productNames = new Set(matchedProducts.flatMap(product => [
        product?.name,
        product?.nameBn,
        ...(product?.matchedTerms || []),
    ].filter(value => typeof value === 'string' && value.trim())));
    return [...productNames]
        .sort((a, b) => b.length - a.length)
        .reduce((text, name) => text.replace(
            new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'giu'),
            ' ',
        ),
        String(clause || ''));
};

const unrecognizedAcceptedPaymentItems = (text) => {
    const value = String(text || '');
    const action = /\b(?:accept|accepted|support|supports|take|takes)\b\s+([^.!?;\n।]+)/i.exec(value);
    if (!action) return [];
    const actionVerb = /^(?:take|takes)\b/i.exec(action[0])?.[0];
    const actionContext = value.slice(0, action.index).trimEnd();
    if (actionVerb && /\b(?:delivery|shipping|transit|processing)\s*$/i.test(actionContext)) return [];
    return action[1]
        .split(/\b(?:and|or)\b|[,/&]/i)
        .map(item => item.trim())
        .filter(item => item
            && !NON_PAYMENT_ACCEPTANCE_CONTEXT.test(item)
            && !Object.values(PAYMENT_METHOD_PATTERNS).some(pattern => pattern.test(item))
            && item.replace(/\b(?:only|also|payment|payments|method|methods|option|options|via|through|using|by|with|the|our|a|an|to|of|is|are)\b/gi, ' ')
                .replace(/\b\d+\b/g, ' ')
                .trim());
};

const productsForProductClaim = (clause, evidence) => {
    const products = (evidence.verifiedProducts || [])
        .filter(product => product && evidence.shopId && String(product.shopId) === String(evidence.shopId));
    const identity = productsMatchingClaimIdentity(clause, products);
    if (identity.terms.length) {
        return { products: identity.products, ambiguous: identity.products.length !== 1 };
    }
    return { products, ambiguous: products.length !== 1 };
};

const hasRecentProductContext = (text, amountIndex, evidence) => {
    const products = (evidence?.verifiedProducts || [])
        .filter(product => product && evidence.shopId && String(product.shopId) === String(evidence.shopId));
    if (!products.length) return false;
    const recentText = String(text || '').slice(Math.max(0, amountIndex - 240), amountIndex);
    return splitClaimClauses(recentText, true).slice(-4).some(clause => {
        const identity = productsMatchingClaimIdentity(clause, products);
        return identity.terms.length > 0 && identity.products.length > 0;
    });
};

const hasProductPricePredicate = (clause, amountIndex) => {
    const prefix = clause.slice(0, amountIndex);
    const predicate = /(?:\b(?:is|are|was|were)\b(?:\s+\b(?:only|just)\b)?|\b(?:will|would|could|can|should)\s+be\b(?:\s+\b(?:only|just)\b)?|\b(?:on\s+sale\s+for|available\s+for|selling?\s+for|sold\s+for|listed\s+(?:for|at)|priced\s+(?:for|at)|only|just|at|goes?\s+for|sells?\s+for|retails?\s+at|marked\s+at)\b)\s*$/i
        .exec(prefix);
    if (!predicate) return false;
    return claimIdentityTerms(prefix.slice(0, predicate.index)).length > 0;
};

const hasClaimSubjectBeforeAmount = (clause, amountIndex) => {
    let prefix = clause.slice(0, amountIndex);
    prefix = prefix.replace(new RegExp(LOCATION_SCOPE_PATTERN.source, 'gi'), ' ');
    prefix = prefix.replace(/\b[a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}\s+te\b/gi, ' ');
    return claimIdentityTerms(prefix).length > 0;
};

const feeAmountMatches = (text) => {
    const source = String(text || '');
    const matches = [
        ...source.matchAll(PRICE_CLAIM_PATTERN),
        ...source.matchAll(FOREIGN_CURRENCY_CLAIM_PATTERN),
        ...source.matchAll(UNKNOWN_CURRENCY_CODE_CLAIM_PATTERN),
    ];
    const occupied = matches.map(match => [match.index, match.index + match[0].length]);
    for (const match of source.matchAll(BARE_AMOUNT_PATTERN)) {
        const start = match.index;
        const end = start + match[0].length;
        if (occupied.some(([occupiedStart, occupiedEnd]) => start < occupiedEnd && end > occupiedStart)) continue;
        const clause = claimClauseAt(source, start);
        if (!POLICY_FEE_LABEL.test(clause)) continue;
        matches.push(match);
    }
    return matches.sort((a, b) => a.index - b.index);
};

const feeLabelFollowsAmount = (text, match) => {
    const clause = claimClauseAt(text, match.index);
    const clauseOffset = String(text || '').indexOf(clause, Math.max(0, match.index - clause.length));
    const relativeIndex = clauseOffset >= 0 ? match.index - clauseOffset : match.index;
    const amountEnd = relativeIndex + match[0].length;
    const afterAmount = clause.slice(amountEnd, amountEnd + 80);
    const feeLabel = new RegExp(POLICY_FEE_LABEL.source, 'i').exec(afterAmount);
    if (!feeLabel) return false;
    // In an explicit pair such as "price ৳60 + ৳60 delivery fee", the first
    // product amount is followed by a second amount before the fee label. Do
    // not let that later label make the product amount look dual-sourced.
    return !feeAmountMatches(afterAmount).some(nextAmount => nextAmount.index < feeLabel.index);
};

const isPolicyFeePriceClaim = (text, match, evidence = null) => {
    const clause = claimClauseAt(text, match.index);
    const clauseOffset = String(text || '').indexOf(clause, Math.max(0, match.index - clause.length));
    const relativeIndex = clauseOffset >= 0 ? match.index - clauseOffset : match.index;
    const amountEnd = relativeIndex + match[0].length;
    const beforeStart = Math.max(0, relativeIndex - 80);
    const afterEnd = Math.min(clause.length, amountEnd + 80);
    const beforeLabels = [...clause.slice(beforeStart, relativeIndex)
        .matchAll(new RegExp(POLICY_FEE_LABEL.source, 'gi'))];
    const afterLabel = new RegExp(POLICY_FEE_LABEL.source, 'i')
        .exec(clause.slice(amountEnd, afterEnd));
    const beforeLabel = beforeLabels.at(-1);
    const feeLabel = beforeLabel
        ? { start: beforeStart + beforeLabel.index, end: beforeStart + beforeLabel.index + beforeLabel[0].length }
        : afterLabel
            ? { start: amountEnd + afterLabel.index, end: amountEnd + afterLabel.index + afterLabel[0].length }
            : null;
    if (!feeLabel) return false;

    const separateSupportedProductPrice = feeLabel.start >= amountEnd
        && hasSupportedProductPriceConnector(text, match, evidence);

    // A delivery or service fee label cannot convert a separate product
    // price/cost assertion into a policy amount.
    if (/\b(?:prices?|priced)\b|(?:দাম|মূল্য)/i.test(clause) && !separateSupportedProductPrice) return false;
    const productCostBeforeFee = [...clause.matchAll(/\b(?:costs?|costing)\b/gi)]
        .some(costMatch => costMatch.index < feeLabel.start);
    if (productCostBeforeFee && !separateSupportedProductPrice) return false;

    // A fee label after the amount is not enough when the clause already
    // predicates that amount of a named product ("Jacket is only ৳60 with
    // delivery fee").
    if (feeLabel.start >= amountEnd && (
        hasProductPricePredicate(clause, relativeIndex)
        || hasClaimSubjectBeforeAmount(clause, relativeIndex)
        || hasRecentProductContext(text, match.index, evidence)
    ) && !separateSupportedProductPrice) return false;
    return true;
};

const productPriceClaimSupported = (candidate, match, evidence, amount) => {
    const products = (evidence.verifiedProducts || [])
        .filter(product => product && evidence.shopId && String(product.shopId) === String(evidence.shopId));
    const nearbyClaim = claimClauseAt(candidate, match.index).toLocaleLowerCase();
    const containsVariantToken = (token) => {
        const value = String(token || '').trim().toLocaleLowerCase();
        if (!value) return false;
        if (value.length > 2) return nearbyClaim.includes(value);
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(nearbyClaim);
    };
    const matchingProducts = products.filter(product => {
        const variants = product.facts?.variants || [];
        const namedVariant = variants.find(variant => {
            const variantValue = String(variant.optionValue || '').trim().toLocaleLowerCase();
            const optionName = String(variant.optionName || '').trim().toLocaleLowerCase();
            return containsVariantToken(variantValue)
                && (!optionName || optionName === 'variant' || nearbyClaim.includes(optionName));
        });
        if (namedVariant) {
            return namedVariant.price?.state === FactState.KNOWN
                && normaliseNumber(namedVariant.price.value) === amount;
        }
        const hasVariantQualifier = /\b(?:size|sizes|color|colour)\b|সাইজ|রং/i.test(nearbyClaim);
        if (hasVariantQualifier) return false;
        const parentPriceIsUnambiguous = product.facts?.price?.state === FactState.KNOWN
            && (!variants.length || variants.every(variant =>
                variant.price?.state === FactState.KNOWN
                && normaliseNumber(variant.price.value) === normaliseNumber(product.facts.price.value)));
        return parentPriceIsUnambiguous && normaliseNumber(product.facts.price.value) === amount;
    });
    if (!matchingProducts.length) return false;

    const identity = productsMatchingClaimIdentity(nearbyClaim, products);
    if (identity.terms.length) {
        return identity.products.length === 1 && matchingProducts.includes(identity.products[0]);
    }
    if (products.length === 1) return true;

    // A preceding explicit catalog name can anchor a terse amount across
    // adjacent clauses, while an unlabelled amount stays ambiguous.
    const prefix = candidate.slice(0, match.index).toLocaleLowerCase();
    const recentProduct = products
        .flatMap(product => [product.name, product.nameBn]
            .filter(Boolean)
            .map(name => ({ product, position: prefix.lastIndexOf(String(name).toLocaleLowerCase()) })))
        .filter(entry => entry.position >= 0)
        .sort((a, b) => b.position - a.position)[0];
    return Boolean(recentProduct && matchingProducts.includes(recentProduct.product));
};

const hasSupportedProductPriceConnector = (text, feeMatch, evidence) => {
    if (!evidence?.verifiedProducts?.length) return false;
    const prefix = String(text || '').slice(0, feeMatch.index);
    const earlierPrices = [...prefix.matchAll(PRICE_CLAIM_PATTERN)].reverse();
    return earlierPrices.some(priceMatch => {
        const connector = String(text || '').slice(priceMatch.index + priceMatch[0].length, feeMatch.index);
        if (!/^\s*(?:\+|plus|and)\s*$/i.test(connector)) return false;
        const value = normaliseNumber(priceMatch[1] || priceMatch[2]);
        return productPriceClaimSupported(text, priceMatch, evidence, value);
    });
};

const LOCATION_SCOPE_END = String.raw`(?:delivery|shipping|courier|return|exchange|service|fees?|charges?|costs?|rates?|price|prices|is|are|was|were|will|would|could|can|should|for|at|on|taka|tk|bdt)`;
const LOCATION_SCOPE_PATTERN = new RegExp(
    String.raw`\b(inside|within|in|outside|out of)\s+(?:the\s+)?([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,3}?)(?=\s+(?:${LOCATION_SCOPE_END}\b|[৳$€£₹0-9০-৯])|[,;.!?।]|$)`,
    'gi',
);

const normalizeLocation = (value) => String(value || '')
    .toLocaleLowerCase()
    .replace(/\b(?:city|area|region|district|metropolitan)\b/g, ' ')
    .replace(/([\u0980-\u09ff]+?)(?:এর|র|ে|তে|য়|য়)$/u, '$1')
    .replace(/[^a-z0-9\u0980-\u09ff\s-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractLocationScopes = (text) => {
    const scopes = [];
    for (const match of String(text || '').matchAll(LOCATION_SCOPE_PATTERN)) {
        const direction = /^(?:outside|out of)$/i.test(match[1]) ? 'outside' : 'inside';
        const location = normalizeLocation(match[2]);
        if (location) scopes.push({ direction, location });
    }

    // Banglish answers commonly use "Dhaka te" without an English direction.
    for (const match of String(text || '').matchAll(/\b([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})\s+te\b/gi)) {
        const location = normalizeLocation(match[1]);
        if (location) scopes.push({ direction: null, location });
    }

    // Bengali location scopes such as "ঢাকার ভিতরে" and "চট্টগ্রামের বাইরে".
    const banglaScope = /([\u0980-\u09ff]+(?:\s+[\u0980-\u09ff]+){0,2}?)(?:এর|ে|র|তে|য়|য়ে)?\s*(ভিতরে|ভেতরে|মধ্যে|বাইরে)/giu;
    for (const match of String(text || '').matchAll(banglaScope)) {
        const direction = match[2] === 'বাইরে' ? 'outside' : 'inside';
        const location = normalizeLocation(match[1]);
        if (location) scopes.push({ direction, location });
    }

    // A named city without inside/outside wording is still an explicit scope.
    for (const match of String(text || '').matchAll(/\b(dhaka|chittagong|chattogram|sylhet|rajshahi|khulna|barisal|rangpur|mymensingh|bangladesh)\b/gi)) {
        scopes.push({ direction: null, location: normalizeLocation(match[1]) });
    }
    const banglaPlaces = /(?<![\u0980-\u09ff])(ঢাকা|চট্টগ্রাম|চিটাগং|সিলেট|রাজশাহী|খুলনা|বরিশাল|রংপুর|ময়মনসিংহ|ময়মনসিংহ|বাংলাদেশ)(?:র|এর|ে|তে|য়|য়)?/giu;
    for (const match of String(text || '').matchAll(banglaPlaces)) {
        scopes.push({ direction: null, location: normalizeLocation(match[1]) });
    }

    const unique = [...new Map(scopes.map(scope => [`${scope.direction || ''}:${scope.location}`, scope])).values()];
    const directedLocations = new Set(unique.filter(scope => scope.direction).map(scope => scope.location));
    return unique.filter(scope => scope.direction || !directedLocations.has(scope.location));
};

const FEE_TYPE_PATTERNS = [
    { type: 'delivery', pattern: /\b(?:delivery|shipping|courier)\b|ডেলিভারি|কুরিয়ার|কুরিয়ার/i },
    { type: 'return', pattern: /\breturn\b|রিটার্ন/i },
    { type: 'exchange', pattern: /\bexchange\b|এক্সচেঞ্জ/i },
    { type: 'service', pattern: /\bservice\b|সার্ভিস/i },
];

const feeTypeForClaim = (text) => {
    const types = FEE_TYPE_PATTERNS
        .filter(({ pattern }) => pattern.test(String(text || '')))
        .map(({ type }) => type);
    if (types.length > 1) return null;
    return types[0] || 'general';
};

const LOCATION_RESTRICTION_MARKER = /\b(?:inside|within|outside|out of|in)\b|\b[a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2}\s+te\b|\b(?:dhaka|chittagong|chattogram|sylhet|rajshahi|khulna|barisal|rangpur|mymensingh|bangladesh)\b|(?:ভিতরে|ভেতরে|মধ্যে|বাইরে|এলাকায়|এলাকায়|জেলায়|জেলায়|ঢাকা|চট্টগ্রাম|চিটাগং|সিলেট|রাজশাহী|খুলনা|বরিশাল|রংপুর|ময়মনসিংহ|ময়মনসিংহ|বাংলাদেশ)/i;

const hasLocationRestriction = (text, scopes = extractLocationScopes(text)) =>
    scopes.length > 0 || LOCATION_RESTRICTION_MARKER.test(String(text || ''));

const policyPriceClaims = (evidence) => {
    const supported = [];
    const text = String(evidence.policyText || '');
    for (const sentence of splitClaimClauses(text, true)) {
        for (const match of feeAmountMatches(sentence)) {
            if (isForeignCurrencyClaim(match[0])) continue;
            if (isPolicyFeePriceClaim(sentence, match)) {
                const clause = claimClauseAt(sentence, match.index);
                supported.push({
                    amount: normaliseNumber(amountFromMatch(match)),
                    feeType: feeTypeForClaim(clause),
                    locationScopes: extractLocationScopes(clause),
                    locationScopeRequired: hasLocationRestriction(clause),
                });
            }
        }
    }
    return supported;
};

const policyFeeAmountSupported = (amount, clause, policyClaims) => {
    const candidateFeeType = feeTypeForClaim(clause);
    if (!candidateFeeType) return false;
    const matchingAmount = policyClaims.filter(claim =>
        claim.amount === amount && claim.feeType === candidateFeeType);
    if (matchingAmount.some(claim => !claim.locationScopeRequired)) return true;

    const candidateScopes = extractLocationScopes(clause);
    if (!candidateScopes.length) return false;

    return matchingAmount.some(claim => claim.locationScopes.some(policyScope =>
        candidateScopes.some(candidateScope => {
            if (candidateScope.location !== policyScope.location) return false;
            if (candidateScope.direction && candidateScope.direction !== policyScope.direction) return false;

            // If policy distinguishes inside/outside rates for the same place,
            // the reply must preserve that direction as well.
            if (!candidateScope.direction) {
                const conflictingDirections = new Set(policyClaims
                    .filter(other => other.locationScopes.some(scope => scope.location === policyScope.location))
                    .flatMap(other => other.locationScopes.map(scope => scope.direction).filter(Boolean)));
                if (conflictingDirections.size > 1) return false;
            }
            return true;
        })),
    );
};

// Keep the existing diagnostic helper's return shape for callers that inspect
// supported policy amounts without needing the richer scope attribution.
const policyPriceAmounts = (evidence) => new Set(policyPriceClaims(evidence).map(claim => claim.amount));

/** Figures are matched to their source category, never to unrelated numbers. */
const unsupportedPriceClaims = (candidate, evidence) => {
    const policyPrices = policyPriceClaims(evidence);
    const offending = [];
    for (const match of feeAmountMatches(candidate)) {
        const raw = amountFromMatch(match);
        if (!raw) continue;
        const value = normaliseNumber(raw);
        if (isForeignCurrencyClaim(match[0])) {
            offending.push(value);
            continue;
        }
        const clause = claimClauseAt(candidate, match.index);
        const clauseOffset = String(candidate || '').indexOf(clause, Math.max(0, match.index - clause.length));
        const relativeIndex = clauseOffset >= 0 ? match.index - clauseOffset : match.index;
        const productPriceSupported = productPriceClaimSupported(candidate, match, evidence, value);
        const feePriceSupported = policyFeeAmountSupported(value, clause, policyPrices);
        const amountHasProductContext = hasProductPricePredicate(clause, relativeIndex)
            || hasClaimSubjectBeforeAmount(clause, relativeIndex)
            || hasRecentProductContext(candidate, match.index, evidence);
        const ambiguouslyDualSourced = feeLabelFollowsAmount(candidate, match)
            && amountHasProductContext
            && !hasSupportedProductPriceConnector(candidate, match, evidence)
            && productPriceSupported
            && feePriceSupported;
        const supported = !ambiguouslyDualSourced && (isPolicyFeePriceClaim(candidate, match, evidence)
            ? feePriceSupported
            : productPriceSupported);
        if (!supported) offending.push(value);
    }
    return offending;
};

/** URLs the candidate states that no evidence authorises. */
const unsupportedUrls = (candidate, evidence) => {
    const allowed = new Set((evidence.allowedUrls || []).map(u => u.replace(/\/+$/, '')));
    const offending = [];
    for (const match of candidate.matchAll(URL_PATTERN)) {
        const url = match[0].replace(/[.,);]+$/, '').replace(/\/+$/, '');
        if (!allowed.has(url)) offending.push(url);
    }
    return offending;
};

/** Attributes the customer asked about that the catalog records as UNKNOWN. */
const unknownAskedAttributes = (evidence) => {
    if (!evidence.verifiedProducts.length) return [];
    return (evidence.askedAttributes || []).filter(attribute =>
        evidence.verifiedProducts.every(p => p.facts?.[attribute]?.state !== FactState.KNOWN));
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const materialValueAppears = (text) => (ATTRIBUTE_VOCABULARY.material || [])
    .filter(value => !(ATTRIBUTE_LABELS.material || []).includes(value))
    .some((value) => {
        const escaped = escapeRegex(value);
        const pattern = /^[a-z0-9-]+$/i.test(value)
            ? new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu')
            : null;
        return pattern ? pattern.test(text) : text.includes(value);
    });

const isUnverifiedMaterialAssertion = (text) => {
    const normalized = String(text || '').toLowerCase();
    if (!materialValueAppears(normalized) || UNAVAILABILITY_MARKER.test(normalized)) return false;
    return /\b(?:material|fabric|kapor|kapod|pure|made\s+(?:from|of)|consists?\s+of|composed\s+of|is|are|it|this|that|eta|eita|otar|tar)\b|উপাদান|কাপড়|কাপড়|শিফন|সিল্ক|সুতি|জর্জেট|মসলিন|জামদানি/i
        .test(normalized);
};

const MATERIAL_ASSERTION_QUALIFIER = '(?:pure|100\\s*%|১০০\\s*%|শতভাগ|খাঁটি|খাটি|বিশুদ্ধ)';
const MATERIAL_TITLE_LINK = new RegExp(
    `^\\s*(?:(?:is|are|হলো|হয়|হয়)\\s+)?(?:(?:${MATERIAL_ASSERTION_QUALIFIER})\\s+|made\\s+(?:from|of)\\s+|composed\\s+of\\s+|consists?\\s+of\\s+)*$`,
    'iu',
);
const MATERIAL_TITLE_VALUES = (ATTRIBUTE_VOCABULARY.material || [])
    .filter(value => !(ATTRIBUTE_LABELS.material || []).includes(value))
    .map(escapeRegex)
    .sort((left, right) => right.length - left.length)
    .join('|');
const MATERIAL_ASSERTION_PREFIX_WITHOUT_VALUE = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${MATERIAL_ASSERTION_QUALIFIER}|made\\s+(?:from|of)|composed\\s+of|consists?\\s+of)\\s*$`,
    'iu',
);
const MATERIAL_VALUE_AT_TITLE_START = new RegExp(`^\\s*(?:${MATERIAL_TITLE_VALUES})(?=\\s|$)`, 'iu');
const MATERIAL_MODIFIER_BEFORE_TITLE = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:(?:${MATERIAL_ASSERTION_QUALIFIER})\\s+|made\\s+(?:from|of)\\s+|composed\\s+of\\s+|consists?\\s+of\\s+)?(?:${MATERIAL_TITLE_VALUES})(?:\\s+(?:fabric|material))?$`,
    'iu',
);

const materialModifierBeforeSubject = (text) => MATERIAL_MODIFIER_BEFORE_TITLE.test(String(text || '').trim());
const materialAssertionCrossesTitleBoundary = (prefix, subjectTitle) => (
    MATERIAL_ASSERTION_PREFIX_WITHOUT_VALUE.test(String(prefix || ''))
    && MATERIAL_VALUE_AT_TITLE_START.test(String(subjectTitle || ''))
);

const productNameMatches = (clause, products) => {
    const matches = [];
    for (const product of products || []) {
        for (const name of [product.name, product.nameBn]) {
            const normalizedName = typeof name === 'string' ? name.trim() : '';
            if (!normalizedName) continue;
            const words = normalizedName.split(/\s+/).map(escapeRegex).join('\\s+');
            const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'giu');
            for (const match of clause.matchAll(pattern)) {
                matches.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    product,
                });
            }
        }
    }

    // Preserve every product sharing an exact span, then prefer the longest
    // exact title when one name contains another ("Chiffon Kurti" / "Kurti").
    const orderedMatches = matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const grouped = [];
    for (const match of orderedMatches) {
        const sameSpan = grouped.find(item => item.start === match.start && item.end === match.end);
        if (sameSpan) {
            if (!sameSpan.products.includes(match.product)) sameSpan.products.push(match.product);
        } else {
            grouped.push({ start: match.start, end: match.end, products: [match.product] });
        }
    }

    // Prefer the longest exact title when one product name contains another,
    // independent of catalog order.
    const selected = [];
    for (const match of grouped) {
        if (selected.some(existing => match.start < existing.end && existing.start < match.end)) continue;
        selected.push(match);
    }
    return selected;
};

/**
 * Product names can contain a material word without making that word a
 * merchant-recorded material fact. Inspect each named product's adjacent claim
 * text independently so a known product earlier in the clause cannot hide an
 * unverified assertion about a later product.
 */
const assertsUnverifiedMaterial = (candidate, evidence) => {
    const unverifiedProducts = (evidence.verifiedProducts || [])
        .filter(product => product.facts?.material?.state !== FactState.KNOWN);
    if (!unverifiedProducts.length) return false;

    return splitClaimClauses(candidate).some((clause) => {
        const names = productNameMatches(clause, evidence.verifiedProducts);
        if (!names.length) return isUnverifiedMaterialAssertion(clause);

        return names.some((subject, index) => {
            const subjectProducts = subject.products || [];
            if (subjectProducts.length && subjectProducts.every(product => product.facts?.material?.state === FactState.KNOWN)) {
                return false;
            }

            const previous = names[index - 1];
            const next = names[index + 1];
            // Only a material phrase directly adjacent to a later title can
            // describe that subject; unrelated earlier text stays with the
            // preceding product.
            const prefixBeforeSubject = index === 0
                ? clause.slice(0, subject.start)
                : clause.slice(previous?.end || 0, subject.start);
            const hasUnverifiedLeadingMaterial = index === 0
                ? isUnverifiedMaterialAssertion(prefixBeforeSubject)
                : materialModifierBeforeSubject(prefixBeforeSubject);
            const subjectTitle = clause.slice(subject.start, subject.end);
            const hasBoundarySplitMaterialAssertion = materialAssertionCrossesTitleBoundary(prefixBeforeSubject, subjectTitle);
            let after = clause.slice(subject.end, next?.start ?? clause.length);
            if (next && MATERIAL_TITLE_LINK.test(after)) {
                after = `${after} ${clause.slice(next.start, next.end)}`;
            }

            return hasUnverifiedLeadingMaterial || hasBoundarySplitMaterialAssertion || isUnverifiedMaterialAssertion(after);
        });
    });
};

const variantValueAppears = (candidate, value) => {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) return false;
    const escaped = normalizedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(candidate);
};

const AVAILABILITY_POSITIVE = /\b(?:available|in stock|we have|stocked|ache|achhe|ase|paben|peye jaben)\b|আছে|স্টকে|পাবেন/i;
const AVAILABILITY_NEGATIVE = /\b(?:out of stock|sold out|no stock|not in stock|stock unavailable|unavailable|not available|isn't available|aren't available|nei|nai)\b|স্টক\s*(?:নেই|নাই|শেষ)|নেই|নাই/i;
const AVAILABILITY_WORD = /\b(?:available|availability|stock|stocked|in stock|out of stock|sold out|unavailable|ache|achhe|ase|nei|nai)\b|আছে|স্টকে|স্টক|নেই|নাই/i;
const OPTION_LABEL = /\b(?:size|sizes|color|colour)\b|সাইজ|রং/i;
const IGNORED_OPTION_WORDS = new Set(['is', 'are', 'in', 'out', 'available', 'unavailable', 'stock', 'the', 'size', 'sizes', 'color', 'colour']);

const availabilityAssertion = (clause) => {
    if (!AVAILABILITY_WORD.test(clause)) return null;
    const negative = AVAILABILITY_NEGATIVE.test(clause);
    const positive = !negative && AVAILABILITY_POSITIVE.test(clause);
    if (!negative && !positive) return null;
    return negative ? 'OUT_OF_STOCK' : 'IN_STOCK';
};

const mentionedOptionValues = (clause, requested = []) => {
    const values = [];
    const text = String(clause || '');
    const sizeLabel = /\b(?:size|sizes)\b|সাইজ/i.test(text);
    const colorLabel = /\b(?:color|colour)\b|রং/i.test(text);
    const useSize = sizeLabel || (!colorLabel && requested.some(value => ['size', 'sizes'].includes(value)));
    const useColor = colorLabel || (!sizeLabel && requested.some(value => ['color', 'colour'].includes(value)));
    if (useSize || (!sizeLabel && !colorLabel && !requested.length)) {
        const patterns = [
            /\b(?:size|sizes)\s*[:=-]?\s*([\p{L}\p{N}-]+)|([\p{L}\p{N}-]+)\s+(?:size|sizes)\b|(?:সাইজ)\s*[:=-]?\s*([\p{L}\p{N}-]+)/giu,
            /(?:^|[^\p{L}\p{N}])(XS|S|M|L|XL|XXL|XXXL|\d{1,3})(?=$|[^\p{L}\p{N}])/giu,
        ];
        for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
            values.push((match[1] || match[2] || match[3]).trim());
        }
    }
    if (useColor || (!sizeLabel && !colorLabel && !requested.length)) {
        const pattern = /\b(?:color|colour)\s*[:=-]?\s*([\p{L}\p{N}-]+)|([\p{L}\p{N}-]+)\s+(?:color|colour)\b|(?:রং)\s*[:=-]?\s*([\p{L}\p{N}-]+)|(?:^|[^\p{L}\p{N}])(black|white|red|blue|green|yellow|pink|purple|navy|maroon|olive|brown|grey|gray|beige|cream|orange|teal|burgundy|charcoal|কালো|সাদা|লাল|নীল|সবুজ)(?=$|[^\p{L}\p{N}])/giu;
        for (const match of text.matchAll(pattern)) {
            values.push((match[1] || match[2] || match[3] || match[4]).trim());
        }
    }
    return [...new Set(values.filter(value => !IGNORED_OPTION_WORDS.has(value.toLowerCase())).map(value => value.toLowerCase()))];
};

const isVariantOption = (variant, option) => {
    const name = String(variant?.optionName || '').toLowerCase();
    return option === 'size'
        ? /^(?:size|sizes|সাইজ)$/.test(name)
        : /^(?:color|colour|রং)$/.test(name);
};

const variantsForClause = (clause, evidence) => {
    const variants = (evidence.verifiedProducts || []).flatMap(product =>
        (product.facts?.variants || []).map(variant => ({ product, variant })));
    const requested = (evidence.askedAttributes || []).filter(value => ['size', 'sizes', 'color', 'colour'].includes(value));
    const optionValues = mentionedOptionValues(clause, requested);
    const optionLabel = /\b(?:size|sizes)\b|սাইজ/i.test(clause) ? 'size'
        : /\b(?:color|colour)\b|রং/i.test(clause) ? 'color' : null;
    const relevant = variants.filter(({ variant }) => {
        if (optionLabel) return isVariantOption(variant, optionLabel);
        if (requested.length) return requested.some(value => isVariantOption(variant, value === 'sizes' ? 'size' : value === 'colour' ? 'color' : value));
        return true;
    });
    const exact = relevant.filter(({ variant }) => variantValueAppears(clause, variant.optionValue));
    const labeled = OPTION_LABEL.test(clause);
    const explicitUnknown = optionValues.filter(value => !exact.some(({ variant }) =>
        String(variant.optionValue || '').toLowerCase() === value));
    if (labeled && !optionValues.length) {
        return { applicable: true, matching: relevant, explicitUnknown: [] };
    }
    return {
        applicable: exact.length > 0 || (labeled && optionValues.length > 0) || (requested.length > 0 && optionValues.length > 0),
        matching: exact,
        explicitUnknown,
    };
};

const variantsWithWrongAvailability = (clause, expected, evidence) => {
    const scoped = variantsForClause(clause, evidence);
    if (!scoped.applicable) return [];
    if (scoped.explicitUnknown.length) return scoped.explicitUnknown;
    if (!scoped.matching.length) return ['unspecified'];
    const wrong = scoped.matching.filter(({ variant }) =>
        variant.availability?.state !== FactState.KNOWN || variant.availability.value !== expected);
    return wrong.map(({ variant }) => String(variant.optionValue || 'unspecified'));
};

const isMaterialUncertaintyClause = (clause, evidence) => {
    if (!evidence.askedAttributes?.includes('material') || !UNAVAILABILITY_MARKER.test(clause)) return false;
    if (/\b(?:stock|availability|available|in stock|out of stock)\b|স্টক/i.test(clause)) return false;
    return (ATTRIBUTE_VOCABULARY.material || []).some(value =>
        String(clause).toLowerCase().includes(String(value).toLowerCase()));
};

/** Reject availability claims that do not match the exact catalog option. */
const unsupportedVariantClaims = (candidate, evidence) => {
    if (!evidence.verifiedProducts?.length) return [];
    const violations = [];
    for (const clause of splitClaimClauses(candidate)) {
        const expected = availabilityAssertion(clause);
        if (!expected || DELIVERY_TERMS.test(clause)) continue;
        if (isMaterialUncertaintyClause(clause, evidence)) continue;
        if (/\b(?:material|fabric|photo|picture|image)\b/i.test(clause) && !OPTION_LABEL.test(clause)) continue;
        const claimProducts = productsForProductClaim(clause, evidence);
        if (claimProducts.ambiguous) {
            violations.push('unsupported_product_identity');
            continue;
        }
        const scoped = variantsForClause(clause, { ...evidence, verifiedProducts: claimProducts.products });
        if (!scoped.applicable) continue;
        violations.push(...variantsWithWrongAvailability(clause, expected, { ...evidence, verifiedProducts: claimProducts.products })
            .map(value => `unsourced_variant_availability:${value}`));
    }
    return [...new Set(violations)];
};

const policySentences = (evidence) => String(evidence.policyText || '')
    .split(/[.!?\n।]+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

const timelineTokens = (text) => [...String(text || '').matchAll(COMMITMENT_TIMELINE)]
    .map(match => normaliseNumber(match[0].toLowerCase().replace(/\s+/g, ' ')));

const isNegativePolicyClaim = (text) => UNAVAILABILITY_MARKER.test(String(text || ''))
    || /\b(?:no|not|never|cannot|can't|won't|will not|doesn't|does not)\b|(?:হবে না|পাবেন না|নেই)/i.test(String(text || ''));

const isUniversalDeliveryPolicy = (text) => /\b(?:nationwide|throughout|across all|anywhere|all areas|everywhere|in bangladesh)\b|সারা বাংলাদেশ|সারা দেশে|দেশজুড়ে|দেশজুড়ে|সব এলাকায়|সব এলাকায়/i.test(String(text || ''));

const explicitLocationDirection = (text) => {
    const value = String(text || '');
    const outside = /\b(?:outside|out of)\b|বাইরে/i.test(value);
    const inside = /\b(?:inside|within)\b|ভিতরে|ভেতরে|মধ্যে/i.test(value);
    if (outside === inside) return null;
    return outside ? 'outside' : 'inside';
};

const PAYMENT_METHOD_POLICY_MARKER = '--- SHOP PAYMENT & DELIVERY';
const unsupportedPaymentMethodClaims = (candidate, evidence) => {
    const policyText = String(evidence.policyText || '');
    const markerIndex = policyText.indexOf(PAYMENT_METHOD_POLICY_MARKER);
    const liveContext = markerIndex >= 0 ? policyText.slice(markerIndex) : '';
    const acceptedLine = liveContext.split(/\r?\n/).find(line => /^\s*Accepted payment:/i.test(line));
    const acceptedPolicy = acceptedLine || (markerIndex < 0 ? policyText : '');
    const supported = new Set(Object.entries(PAYMENT_METHOD_PATTERNS)
        .filter(([, pattern]) => pattern.test(acceptedPolicy))
        .map(([method]) => method));
    const configuredNumbers = new Set(paymentPhoneNumbers(acceptedLine || ''));
    const violations = [];
    const clauses = String(candidate || '')
        .split(/[.!?;\n।]+|\b(?:but|however|while)\b/gi)
        .map(clause => clause.trim())
        .filter(Boolean);

    for (const clause of clauses) {
        const productEvidence = Array.isArray(evidence.verifiedProducts) ? evidence.verifiedProducts : [];
        const matchingProducts = productsMatchingClaimIdentity(clause, productEvidence).products;
        const hasProductIdentity = matchingProducts.length > 0;
        const paymentClaim = removeKnownProductNames(clause, productEvidence);
        const hasExplicitPaymentContext = PAYMENT_SEMANTIC_CONTEXT.test(paymentClaim);
        const hasPaymentMethodAction = PAYMENT_METHOD_CLAIM_CONTEXT.test(paymentClaim);
        const hasKnownPaymentMethod = Object.values(PAYMENT_METHOD_PATTERNS)
            .some(pattern => pattern.test(paymentClaim));
        const routeMatches = [
            ...[...paymentClaim.matchAll(PAYMENT_METHOD_ROUTE_TARGET)]
                .map(match => ({ match, targetOffset: match[0].lastIndexOf(match[1]) })),
            ...[...paymentClaim.matchAll(PAYMENT_METHOD_ACCEPTANCE_ROUTE_TARGET)]
                .map(match => ({ match, targetOffset: match[0].lastIndexOf(match[1]) })),
            ...[...paymentClaim.matchAll(PAYMENT_METHOD_ACCEPTANCE_FOR_TARGET)]
                .map(match => ({ match, targetOffset: match[0].indexOf(match[1]) })),
        ];
        const routeClaims = routeMatches
            .map(({ match, targetOffset }) => {
                const target = match[1].toLowerCase();
                const start = match.index + targetOffset;
                const tail = paymentClaim.slice(start);
                const delimiter = /\b(?:and|or|but|however|while)\b|[,;.!?]/i.exec(tail);
                return {
                    target,
                    claim: delimiter ? tail.slice(0, delimiter.index).trim() : tail.trim(),
                    acceptanceItem: /^(?:orders?|bookings?|returns?|exchanges?|refunds?|replacements?|cancellations?)\s+(?:with|to)\b/i.test(match[0])
                        || /^(?:accept|accepts|accepted|support|supports|take|takes)\b/i.test(match[0]),
                };
            })
            .filter(route => !isNonPaymentRoute(route));
        const hasPaymentMethodRoute = routeClaims.length > 0;
        const unrecognizedPaymentRoutes = routeClaims.filter(route =>
            !Object.values(PAYMENT_METHOD_PATTERNS).some(pattern => pattern.test(route.claim)));
        const unrecognizedPaymentItems = unrecognizedAcceptedPaymentItems(paymentClaim);
        const candidatePhoneNumbers = paymentPhoneNumbers(clause);
        const hasReturnPaymentPhoneDestination = RETURN_PAYMENT_PHONE_DESTINATION.test(paymentClaim);
        const hasPaymentDestination = candidatePhoneNumbers.length > 0
            && (PAYMENT_DESTINATION_CONTEXT.test(paymentClaim)
                || hasKnownPaymentMethod
                || hasPaymentMethodRoute
                || hasReturnPaymentPhoneDestination);
        if (NON_PAYMENT_ACCEPTANCE_CONTEXT.test(paymentClaim)
            && !hasExplicitPaymentContext
            && !hasKnownPaymentMethod
            && !hasPaymentMethodRoute
            && !hasPaymentDestination) continue;
        if (hasProductIdentity && !hasExplicitPaymentContext && !hasPaymentMethodAction) continue;
        if (!PAYMENT_METHOD_ASSERTION.test(paymentClaim) && !hasPaymentMethodAction) continue;
        if (hasPaymentDestination) {
            for (const phone of candidatePhoneNumbers) {
                if (!configuredNumbers.has(phone)) violations.push('unsupported_payment_destination');
            }
        }
        const negative = PAYMENT_METHOD_NEGATION.test(paymentClaim);
        for (const [method, pattern] of Object.entries(PAYMENT_METHOD_PATTERNS)) {
            if (!pattern.test(paymentClaim)) continue;
            if (negative ? supported.has(method) : !supported.has(method)) {
                violations.push(`unsupported_payment_method:${method}`);
            }
        }
        if (hasPaymentMethodAction
            && !Object.values(PAYMENT_METHOD_PATTERNS).some(pattern => pattern.test(paymentClaim))) {
            violations.push('unsupported_payment_method:unknown');
        }
        if (unrecognizedPaymentRoutes.length || unrecognizedPaymentItems.length) {
            violations.push('unsupported_payment_method:unknown');
        }
    }
    return [...new Set(violations)];
};

const deliveryTimelineScopeMatches = (candidateClause, policySentence, allPolicySentences) => {
    const policyScopes = extractLocationScopes(policySentence);
    const policyIsUniversal = isUniversalDeliveryPolicy(policySentence);
    const policyCoversBangladesh = policyScopes.some(scope =>
        scope.location === 'bangladesh' && scope.direction === 'inside');
    const policyScopeRequired = hasLocationRestriction(policySentence)
        && !policyIsUniversal
        && !policyCoversBangladesh;
    if (policyScopeRequired && !policyScopes.length) return false;
    if (!policyScopes.length || policyIsUniversal || policyCoversBangladesh) return true;

    const candidateScopes = extractLocationScopes(candidateClause);
    if (!candidateScopes.length) return false;
    const allScopes = allPolicySentences.flatMap(extractLocationScopes);
    return policyScopes.some(policyScope => candidateScopes.some(candidateScope => {
        if (candidateScope.location !== policyScope.location) return false;
        const candidateDirection = candidateScope.direction || explicitLocationDirection(candidateClause);
        const policyDirection = policyScope.direction || explicitLocationDirection(policySentence);
        if (candidateDirection && policyDirection && candidateDirection !== policyDirection) return false;
        if (candidateDirection === 'outside' && !policyDirection) return false;
        if (!candidateScope.direction) {
            const directions = new Set(allScopes
                .filter(scope => scope.location === policyScope.location)
                .map(scope => scope.direction)
                .filter(Boolean));
            if (directions.size > 1) return false;
        }
        return true;
    }));
};

const unsupportedStockClaim = (candidate, evidence) => {
    if (!evidence.verifiedProducts.length) return false;
    for (const clause of splitClaimClauses(candidate)) {
        const expected = availabilityAssertion(clause);
        if (!expected || DELIVERY_TERMS.test(clause)) continue;
        if (isMaterialUncertaintyClause(clause, evidence)) continue;
        if (/\b(?:material|fabric|photo|picture|image)\b|ছবি/i.test(clause) && !OPTION_LABEL.test(clause)) continue;
        const claimProducts = productsForProductClaim(clause, evidence);
        if (claimProducts.ambiguous) return true;
        const scopedEvidence = { ...evidence, verifiedProducts: claimProducts.products };
        if (variantsForClause(clause, scopedEvidence).applicable) continue;
        const states = claimProducts.products
            .map(product => product.facts?.stock)
            .filter(Boolean);
        if (!states.length || states.some(fact => fact.state !== FactState.KNOWN)) return true;
        const values = new Set(states.map(fact => fact.value === 'DISCONTINUED' ? 'OUT_OF_STOCK' : fact.value));
        if (values.size !== 1 || !values.has(expected)) return true;
    }
    return false;
};

const unsupportedDomainClaims = (candidate, evidence) => {
    const violations = [];
    if (ORDER_CONFIRMATION_CLAIM.test(candidate)) violations.push('model_order_confirmation_claim');
    if (PAYMENT_CONFIRMATION_CLAIM.test(candidate)) violations.push('model_payment_confirmation_claim');
    violations.push(...unsupportedPaymentMethodClaims(candidate, evidence));

    for (const clause of splitClaimClauses(candidate)) {
        if (!DELIVERY_TERMS.test(clause)) continue;
        const candidateTimelines = timelineTokens(clause);
        const sentences = policySentences(evidence).filter(sentence => DELIVERY_TERMS.test(sentence));
        if (candidateTimelines.length) {
            const supported = sentences.some(sentence => {
                if (isNegativePolicyClaim(sentence) !== isNegativePolicyClaim(clause)) return false;
                const sourceTimelines = timelineTokens(sentence);
                return candidateTimelines.every(token => sourceTimelines.includes(token))
                    && deliveryTimelineScopeMatches(clause, sentence, sentences);
            });
            if (!supported) violations.push('unsupported_delivery_timeline');
        } else if (DELIVERY_ASSERTION.test(clause) || DELIVERY_NEGATIVE_ASSERTION.test(clause)) {
            const candidateIsNegative = isNegativePolicyClaim(clause);
            const supported = sentences.some(sentence =>
                isNegativePolicyClaim(sentence) === candidateIsNegative
                && deliveryTimelineScopeMatches(clause, sentence, sentences));
            if (!supported) violations.push('unsupported_delivery_commitment');
        }
    }
    return violations;
};

/**
 * A written reply for the failure at hand. Never assembled from model output —
 * that is the whole point — and never states a fact the evidence lacks.
 */
const buildSafeFallback = (evidence, language, reasonCode) => {
    switch (reasonCode) {
        case ReasonCode.RETRIEVAL_FAILED:
            return retrievalFailedReply(language);

        case ReasonCode.PRODUCT_IMAGE_UNAVAILABLE:
            return productImageUnavailableReply(language, evidence.verifiedProducts[0]?.name);

        case ReasonCode.PRODUCT_ATTRIBUTE_UNKNOWN: {
            const product = evidence.verifiedProducts[0];
            const attributes = [...new Set([
                ...unknownAskedAttributes(evidence),
                ...(evidence.askedAttributes || []).filter(attribute => ['size', 'color'].includes(attribute)),
            ])].join(', ');
            // Known facts are still delivered — guardrails must not make the
            // assistant useless (see the real-product regression test).
            const variants = product.facts.variants || [];
            const parentPriceIsUnambiguous = product.facts.price.state === FactState.KNOWN
                && (!variants.length || variants.every(variant =>
                    variant.price?.state === FactState.KNOWN
                    && normaliseNumber(variant.price.value) === normaliseNumber(product.facts.price.value)));
            const known = parentPriceIsUnambiguous
                ? `${product.name} — ৳${product.facts.price.value}. `
                : `${product.name}. `;
            return language === 'bn'
                ? `${known}তবে ${attributes} সম্পর্কে তথ্য আমাদের ক্যাটালগে নেই, তাই নিশ্চিত করে বলতে পারছি না।`
                : language === 'en'
                    ? `${known}I don't have the ${attributes} information recorded for it, so I can't confirm that.`
                    : `${known}Tobe ${attributes} er info amader catalog e record kora nei, tai confirm kore bolte parchi na.`;
        }

        case ReasonCode.UNSUPPORTED_DOMAIN_CLAIM:
            return knowledgeNotFoundReply(language);

        case ReasonCode.PRODUCT_NOT_FOUND:
        default:
            if (evidence.mediaStatus === MediaStatus.NO_PRODUCT) {
                return productImageNoProductReply(language);
            }
            return productNotFoundReply(language);
    }
};

/**
 * Decide whether a candidate reply may be sent.
 *
 * @param {object} params
 * @param {string} params.candidate  - text produced by the model (or cache/FAQ tier)
 * @param {import('./grounding.contract').GroundingEvidence} [params.evidence]
 * @param {string} [params.language] - 'bn' | 'en' | 'mixed'
 * @param {object[]} [params.attachments] - proposed outbound attachments
 * @returns {{ decision: string, reasonCode: string, text: string|null,
 *             attachments: object[], violations: string[] }}
 */
const evaluateCandidate = ({
    candidate,
    evidence = emptyEvidence(),
    language = 'mixed',
    attachments = [],
    modelGenerated = true,
}) => {
    const violations = [];

    const deny = (reasonCode, fallbackEvidence = evidence) => ({
        decision: GroundingDecision.SAFE_FALLBACK,
        reasonCode,
        text: buildSafeFallback(fallbackEvidence, language, reasonCode),
        // A rejected candidate forfeits its media too: the attachment was chosen
        // to accompany a claim we have just refused to make.
        attachments: [],
        violations,
    });

    // 1. Usable output at all.
    if (typeof candidate !== 'string' || !candidate.trim()) {
        violations.push('empty_or_non_string_candidate');
        if (evidence.productStatus === ProductEvidenceStatus.NONE) {
            // Nothing was asked that we can truthfully answer with a written
            // reply — stay silent and let the worker hand off to a human.
            return {
                decision: GroundingDecision.SUPPRESS,
                reasonCode: ReasonCode.MODEL_OUTPUT_INVALID,
                text: null,
                attachments: [],
                violations,
            };
        }
        return deny(ReasonCode.MODEL_OUTPUT_INVALID);
    }

    // Media provenance is enforced for every reply, model-authored or not: only
    // the image belonging to the verified product of THIS shop may go out.
    const allowedAttachments = attachments.filter(a =>
        a && a.url
        && evidence.mediaStatus === MediaStatus.AVAILABLE
        && a.url === evidence.mediaUrl
        && (!a.productId || a.productId === evidence.mediaProductId));
    if (allowedAttachments.length !== attachments.length) {
        violations.push('attachment_provenance_rejected');
    }

    // EasyModerator-authored text states facts we computed ourselves. Validating
    // it against the retrieval evidence would reject correct order totals and the
    // deterministic not-found copy this very module wrote.
    if (!modelGenerated) {
        return {
            decision: GroundingDecision.SEND,
            reasonCode: ReasonCode.GROUNDED,
            text: candidate,
            attachments: allowedAttachments,
            violations,
        };
    }

    // 2. Truth unknown — never let an outage become an answer.
    if (evidence.productStatus === ProductEvidenceStatus.RETRIEVAL_FAILED) {
        violations.push('catalog_unreadable');
        return deny(ReasonCode.RETRIEVAL_FAILED);
    }

    // 3. Availability asserted for something this catalog does not contain.
    //    Backstop for paths that skip deterministic generation (response cache,
    //    FAQ tier): the normal NOT_FOUND turn never reaches a model at all.
    if (evidence.productStatus === ProductEvidenceStatus.NOT_FOUND) {
        const mentionsMissingTerm = (evidence.unmatchedTerms || [])
            .some(term => candidate.toLowerCase().includes(term));
        if (mentionsMissingTerm && AVAILABILITY_ASSERTION.test(candidate)) {
            violations.push('availability_asserted_for_absent_product');
            return deny(ReasonCode.PRODUCT_NOT_FOUND);
        }
    }

    if (unsupportedStockClaim(candidate, evidence)) {
        violations.push('unsupported_stock_claim');
        return deny(ReasonCode.UNSUPPORTED_DOMAIN_CLAIM);
    }

    const domainViolations = unsupportedDomainClaims(candidate, evidence);
    if (domainViolations.length) {
        violations.push(...domainViolations);
        return deny(ReasonCode.UNSUPPORTED_DOMAIN_CLAIM);
    }

    // 4. Figures must come from a source.
    const badPrices = unsupportedPriceClaims(candidate, evidence);
    if (badPrices.length) {
        violations.push(`unsupported_price:${badPrices.join(',')}`);
        return deny(evidence.productStatus === ProductEvidenceStatus.NOT_FOUND
            ? ReasonCode.PRODUCT_NOT_FOUND
            : ReasonCode.UNSUPPORTED_PRICE_CLAIM);
    }

    // 5. URLs must be provenance-checked media. Catches the Page link offered as
    //    a substitute for a product photo, and any fabricated media URL.
    const badUrls = unsupportedUrls(candidate, evidence);
    if (badUrls.length) {
        violations.push(`unsupported_url:${badUrls.length}`);
        return deny(evidence.mediaStatus === MediaStatus.NO_PRODUCT
            ? ReasonCode.PRODUCT_NOT_FOUND
            : ReasonCode.UNSUPPORTED_URL_CLAIM);
    }

    // 6. An UNKNOWN attribute must be answered as unknown. This is a positive
    //    requirement rather than an attempt to enumerate every way a model could
    //    fabricate a fabric name — the reply must actually admit it does not know.
    const unknownAsked = unknownAskedAttributes(evidence);
    if (assertsUnverifiedMaterial(candidate, evidence) && !unknownAsked.includes('material')) {
        unknownAsked.push('material');
    }
    if (unknownAsked.length) {
        const unsupportedUnknown = unknownAsked.some(attribute =>
            (ATTRIBUTE_VOCABULARY[attribute] || []).some(word =>
                splitClaimClauses(candidate).some(clause =>
                    clause.toLowerCase().includes(word)
                    && !UNAVAILABILITY_MARKER.test(clause))));
        if (unsupportedUnknown) {
            violations.push(`attribute_asserted_but_unknown:${unknownAsked.join(',')}`);
            const fallbackEvidence = unknownAsked.includes('material')
                && !(evidence.askedAttributes || []).includes('material')
                ? { ...evidence, askedAttributes: [...(evidence.askedAttributes || []), 'material'] }
                : evidence;
            return deny(ReasonCode.PRODUCT_ATTRIBUTE_UNKNOWN, fallbackEvidence);
        }
    }

    const badVariantClaims = unsupportedVariantClaims(candidate, evidence);
    if (badVariantClaims.length) {
        violations.push(...badVariantClaims);
        return deny(ReasonCode.PRODUCT_ATTRIBUTE_UNKNOWN);
    }

    return {
        decision: GroundingDecision.SEND,
        reasonCode: ReasonCode.GROUNDED,
        text: candidate,
        attachments: allowedAttachments,
        violations,
    };
};

module.exports = {
    evaluateCandidate,
    extractUrls,
    buildSafeFallback,
    unsupportedPriceClaims,
    unsupportedUrls,
    unknownAskedAttributes,
    unsupportedVariantClaims,
    unsupportedStockClaim,
    unsupportedDomainClaims,
    policyPriceAmounts,
    normaliseNumber,
};
