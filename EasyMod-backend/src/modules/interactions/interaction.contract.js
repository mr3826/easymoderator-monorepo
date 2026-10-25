'use strict';

/**
 * Interaction contract v1 (Pilot+ P+02)
 * ─────────────────────────────────────
 * Channel-neutral registry of structured customer choices. Mirrors the
 * discipline of ai/contracts/intent.contract.js: closed sets, versioned,
 * validated — the LLM NEVER authors options or operations. Titles come only
 * from this table (Meta limits: <= 13 quick replies, title <= 20 chars,
 * payload <= 1000 chars — enforced here so no caller can violate policy).
 *
 * A quick-reply payload is an OPAQUE REFERENCE:
 *     p1:<interaction-uuid>:<option-id>
 * It carries zero authority; interactions.service re-loads the row and checks
 * shop/customer/channel/conversation scope, expiry, status and the bound
 * business-context version before doing anything.
 */

const CONTRACT_VERSION = 'interaction/1.0.0';

const MAX_QUICK_REPLIES = 13;
const MAX_TITLE_CHARS = 20;
const MAX_PAYLOAD_CHARS = 1000;

const KINDS = Object.freeze({
    CLARIFY_NEEDS: 'CLARIFY_NEEDS',
    CHECKOUT_DECISION: 'CHECKOUT_DECISION',
    HUMAN_SUPPORT: 'HUMAN_SUPPORT',
    CHECKOUT_RESUME: 'CHECKOUT_RESUME',
});

const TTL_MS = Object.freeze({
    CLARIFY_NEEDS: 30 * 60 * 1000,
    CHECKOUT_DECISION: 24 * 60 * 60 * 1000, // bounded anyway by session expiry + version
    HUMAN_SUPPORT: 24 * 60 * 60 * 1000,
    CHECKOUT_RESUME: 24 * 60 * 60 * 1000,
});

/**
 * Operations: the ONLY things a tap can express. Each maps to a canonical
 * customer-typed equivalent executed by the EXISTING authoritative code path
 * (bridge / step machine / handoff). None invents business facts: a confirm
 * tap re-enters the same gate + material revalidation as a typed "yes".
 */
const OPERATIONS = Object.freeze({
    'delivery.info': { kind: KINDS.CLARIFY_NEEDS, titles: { bn: 'ডেলিভারি তথ্য', en: 'Delivery info' } },
    'support.human': { kind: KINDS.CLARIFY_NEEDS, titles: { bn: 'মানুষকে দিন', en: 'Talk to a person' } },
    'checkout.review': { kind: KINDS.CHECKOUT_DECISION, titles: { bn: 'আবার দেখুন', en: 'Review order' } },
    'checkout.change': { kind: KINDS.CHECKOUT_DECISION, titles: { bn: 'পরিবর্তন', en: 'Change something' } },
    'checkout.cancel': { kind: KINDS.CHECKOUT_DECISION, titles: { bn: 'বাতিল করুন', en: 'Cancel checkout' } },
    'checkout.confirm': { kind: KINDS.CHECKOUT_DECISION, titles: { bn: 'নিশ্চিত করুন', en: 'Confirm order' }, requiresBound: 'order_session' },
    'support.wait': { kind: KINDS.HUMAN_SUPPORT, titles: { bn: 'অপেক্ষা করব', en: 'Wait for a person' } },
    'support.continue': { kind: KINDS.HUMAN_SUPPORT, titles: { bn: 'AI-এর সাথেই', en: 'Continue now' } },
    'checkout.resume': { kind: KINDS.CHECKOUT_RESUME, titles: { bn: 'অর্ডার চালান', en: 'Continue order' } },
    'checkout.later': { kind: KINDS.CHECKOUT_RESUME, titles: { bn: 'পরে করব', en: 'Later' } },
});

const KIND_OPERATIONS = Object.freeze({
    [KINDS.CLARIFY_NEEDS]: ['delivery.info', 'support.human'],
    [KINDS.CHECKOUT_DECISION]: ['checkout.review', 'checkout.change', 'checkout.cancel', 'checkout.confirm'],
    [KINDS.HUMAN_SUPPORT]: ['support.wait', 'support.continue'],
    [KINDS.CHECKOUT_RESUME]: ['checkout.resume', 'checkout.later'],
});

const STATUSES = Object.freeze(['GENERATED', 'SENT', 'EXECUTING', 'CONSUMED', 'SUPERSEDED', 'EXPIRED', 'VOID']);
const LIVE_STATUSES = Object.freeze(['GENERATED', 'SENT', 'EXECUTING']);

const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildPayload(interactionId, optionId) {
    const payload = `p1:${interactionId}:${optionId}`;
    if (payload.length > MAX_PAYLOAD_CHARS) throw new Error('interaction payload exceeds Meta limit');
    return payload;
}

/** Strict parse — unknown shape is NOT an interaction (free text). */
function parsePayload(payload) {
    if (typeof payload !== 'string' || !payload.startsWith('p1:')) return null;
    const parts = payload.split(':');
    if (parts.length !== 3) return null;
    const [, id, optionId] = parts;
    if (!uuidShape.test(id)) return null;
    if (!OPERATIONS[optionId]) return null;
    return { interactionId: id, optionId };
}

function titleFor(operationId, language) {
    const op = OPERATIONS[operationId];
    if (!op) return null;
    const title = (language === 'en' ? op.titles.en : op.titles.bn) || op.titles.en;
    return title.length <= MAX_TITLE_CHARS ? title : title.slice(0, MAX_TITLE_CHARS);
}

/** Options snapshot for a kind in a language (bounded, registry-only). */
function optionsForKind(kind, language, { boundSession = false } = {}) {
    const ids = KIND_OPERATIONS[kind] || [];
    const options = [];
    for (const operationId of ids) {
        const op = OPERATIONS[operationId];
        if (op.requiresBound === 'order_session' && !boundSession) continue;
        const title = titleFor(operationId, language);
        if (!title) continue;
        options.push({ option_id: operationId, operation_id: operationId, title });
        if (options.length >= MAX_QUICK_REPLIES) break;
    }
    return options;
}

function validateOptions(options) {
    if (!Array.isArray(options) || options.length === 0 || options.length > MAX_QUICK_REPLIES) return false;
    return options.every((o) => o
        && typeof o.option_id === 'string'
        && OPERATIONS[o.option_id]
        && typeof o.title === 'string'
        && o.title.length > 0
        && o.title.length <= MAX_TITLE_CHARS);
}

module.exports = {
    CONTRACT_VERSION,
    KINDS,
    OPERATIONS,
    KIND_OPERATIONS,
    STATUSES,
    LIVE_STATUSES,
    TTL_MS,
    MAX_QUICK_REPLIES,
    MAX_TITLE_CHARS,
    MAX_PAYLOAD_CHARS,
    buildPayload,
    parsePayload,
    titleFor,
    optionsForKind,
    validateOptions,
};
