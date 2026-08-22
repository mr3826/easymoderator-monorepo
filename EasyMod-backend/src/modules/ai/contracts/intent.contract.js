'use strict';

const crypto = require('crypto');
const { CONTRACT_VERSION, DOMAINS } = require('./agent-task.contract');
const { canonicalJson } = require('./action.contract');

const INTENT_REGISTRY_VERSION = '1.0.0';
const ACTIVE = 'ACTIVE';
const RESERVED = 'RESERVED';
const DEPRECATED = 'DEPRECATED';
const INTENT_STATUSES = Object.freeze([ACTIVE, RESERVED, DEPRECATED]);
const INTENT_SOURCES = Object.freeze(['RULE', 'CLASSIFIER', 'LLM', 'HUMAN']);

const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
};

const intent = (domain, requiredSlots, status = ACTIVE) => ({
    domain,
    requiredSlots,
    status,
    version: 1,
});

const pairedIntent = (domains, requiredSlots, status = ACTIVE) => ({
    domains,
    requiredSlots,
    status,
    version: 1,
});

const INTENTS = deepFreeze({
    STOP_OPT_OUT: intent('SUPPORT', []),
    GREETING: intent('KNOWLEDGE', ['language']),
    GENERAL_CHAT_OR_UNKNOWN: intent('KNOWLEDGE', []),
    PRODUCT_INQUIRY: intent('PRODUCT', ['productReference']),
    PRODUCT_ATTRIBUTE: intent('PRODUCT', ['productReference', 'attribute']),
    PRODUCT_AVAILABILITY: intent('PRODUCT', ['productReference']),
    PRODUCT_PHOTO_LOOKUP: intent('PRODUCT', ['attachment']),
    FAQ_KNOWLEDGE_QUESTION: intent('KNOWLEDGE', ['questionTopic']),
    DELIVERY_POLICY: pairedIntent(['KNOWLEDGE', 'COMMERCE_OPS'], ['zoneOrLocation']),
    DELIVERY_CHARGE: pairedIntent(['KNOWLEDGE', 'COMMERCE_OPS'], ['destination']),
    PAYMENT_POLICY: pairedIntent(['KNOWLEDGE', 'COMMERCE_OPS'], ['paymentTopic']),
    PAYMENT_METHODS: intent('KNOWLEDGE', []),
    ORDER_STATUS_LOOKUP: intent('ORDER', ['orderReference']),
    PURCHASE_INTENT_START: intent('ORDER', ['productReference']),
    ORDER_SESSION_CHECKOUT: intent('ORDER', ['currentCheckoutSlot']),
    CART_EDIT_OR_ADD_MORE: intent('PRODUCT', ['productOrQuantityChange']),
    ORDER_SESSION_CANCEL: intent('ORDER', ['activeSession']),
    SELF_MFS_PAYMENT_VERIFICATION: intent('COMMERCE_OPS', ['screenshot', 'expectedAmount']),
    SENTIMENT_HANDOFF: intent('SUPPORT', ['sentiment']),
    ORDER_POST_PURCHASE_REQUEST: intent('SUPPORT', ['reason']),
    HUMAN_HANDOFF_REQUEST: intent('SUPPORT', []),
    LOW_CONFIDENCE_OR_GROUNDING_FAILURE: intent('SUPPORT', ['reasonCode']),

    PRODUCT_COMPARE: intent('PRODUCT', [], RESERVED),
    PRODUCT_RECOMMEND: intent('PRODUCT', [], RESERVED),
    PRODUCT_ALTERNATIVE: intent('PRODUCT', [], RESERVED),
    PRODUCT_BUNDLE: intent('PRODUCT', [], RESERVED),
    BROADCAST_OR_COLD_OUTREACH: intent('SUPPORT', [], RESERVED),
    ARBITRARY_TOOL_REQUEST: intent('SUPPORT', [], RESERVED),
});

const registryHash = `sha256:${crypto.createHash('sha256')
    .update(canonicalJson({ version: INTENT_REGISTRY_VERSION, intents: INTENTS }), 'utf8')
    .digest('hex')}`;

const requiredText = (value, field) => {
    if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} is required`);
    return value;
};

const getIntent = (intentId) => {
    const normalized = String(intentId || '').trim().toUpperCase();
    return { intentId: normalized, definition: INTENTS[normalized] };
};

const resolveDomain = (intentId, { requiresLiveLookup = false } = {}) => {
    const { intentId: normalized, definition } = getIntent(intentId);
    if (!definition) throw new TypeError(`Unknown intent: ${normalized || 'missing'}`);
    if (definition.domains) return definition.domains[requiresLiveLookup ? 1 : 0];
    return definition.domain;
};

/**
 * Normalize classifier output without allowing a new identifier to become a
 * route. Reserved and deprecated identifiers remain readable but cannot be
 * selected for active routing.
 */
const normalizeIntentId = (intentId, options = {}) => {
    const { fallbackIntentId, fallback } = typeof options === 'string'
        ? { fallbackIntentId: options }
        : options;
    const requestedFallback = fallbackIntentId || fallback;
    const fallbackId = requestedFallback === 'HUMAN_HANDOFF_REQUEST'
        ? 'HUMAN_HANDOFF_REQUEST'
        : 'GENERAL_CHAT_OR_UNKNOWN';
    const { intentId: normalized, definition } = getIntent(intentId);
    return definition?.status === ACTIVE ? normalized : fallbackId;
};

const createIntentRecord = (input = {}) => {
    const { intentId, definition: original } = getIntent(input.intentId);
    if (!original || ![ACTIVE, RESERVED, DEPRECATED].includes(original.status)) {
        throw new TypeError(`Unknown intent: ${input.intentId || 'missing'}`);
    }
    if (input.contractVersion !== undefined && input.contractVersion !== CONTRACT_VERSION) {
        throw new TypeError(`Unsupported intent contract: ${input.contractVersion}`);
    }
    const source = input.source;
    if (!INTENT_SOURCES.includes(source)) throw new TypeError(`Unsupported intent source: ${source}`);
    const confidence = Number(input.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new TypeError('intent confidence must be between 0 and 1');
    }
    const slots = input.slots || {};
    if (!slots || typeof slots !== 'object' || Array.isArray(slots)) throw new TypeError('intent slots must be an object');
    const evidenceIds = input.evidenceIds || [];
    if (!Array.isArray(evidenceIds) || evidenceIds.some(id => typeof id !== 'string' || !id)) {
        throw new TypeError('intent evidenceIds must be an array of non-empty strings');
    }
    const record = {
        contractVersion: CONTRACT_VERSION,
        intentId,
        intentVersion: input.intentVersion ?? original.version ?? 1,
        domain: input.domain || resolveDomain(intentId, { requiresLiveLookup: input.requiresLiveLookup }),
        slots,
        confidence,
        source,
        evidenceIds,
        traceId: requiredText(input.traceId, 'traceId'),
        createdAt: input.createdAt || new Date().toISOString(),
    };
    if (!Number.isInteger(record.intentVersion) || record.intentVersion < 1) {
        throw new TypeError('intentVersion must be a positive integer');
    }
    if (!DOMAINS.includes(record.domain)) throw new TypeError(`Unsupported intent domain: ${record.domain}`);
    const allowedDomains = original.domains || [original.domain];
    if (!allowedDomains.includes(record.domain)) {
        throw new TypeError(`Intent domain does not match registry: ${record.domain}`);
    }
    for (const requiredSlot of original.requiredSlots || []) {
        if (!Object.prototype.hasOwnProperty.call(slots, requiredSlot)) {
            throw new TypeError(`Missing required intent slot: ${requiredSlot}`);
        }
    }
    return record;
};

module.exports = {
    ACTIVE,
    ARBITRARY_TOOL_REQUEST: 'ARBITRARY_TOOL_REQUEST',
    CONTRACT_VERSION,
    DEPRECATED,
    INTENT_REGISTRY_HASH: registryHash,
    INTENT_REGISTRY_VERSION,
    INTENT_SOURCES,
    INTENT_STATUSES,
    INTENTS,
    REGISTRY_HASH: registryHash,
    RESERVED,
    createIntentRecord,
    normalizeIntentId,
    resolveDomain,
};
