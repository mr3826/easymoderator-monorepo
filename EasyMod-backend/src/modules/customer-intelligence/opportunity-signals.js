'use strict';

/**
 * Sales-opportunity signal extraction and qualification — pure functions.
 *
 * Signals come from the existing deterministic Stage-2 classifier
 * (ai/intent/stage2-rules.js, Bangla/Banglish/English, negation-aware) and
 * from order-session facts. There is no LLM call and no numeric score: an
 * opportunity is explained by named reason codes (ADR-0006).
 */

const stage2 = require('../ai/intent/stage2-rules');

const DETECTOR_VERSION = 'opportunity-detector/1.0.0';

const STRENGTH = Object.freeze({ STRONG: 'STRONG', MEDIUM: 'MEDIUM', WEAK: 'WEAK' });

const INTENT_SIGNALS = Object.freeze({
    PURCHASE_INTENT_START: { code: 'PURCHASE_INTENT', strength: STRENGTH.STRONG },
    ORDER_SESSION_CHECKOUT: { code: 'CHECKOUT_CONFIRM_ATTEMPT', strength: STRENGTH.STRONG },
    CART_EDIT_OR_ADD_MORE: { code: 'CART_ACTIVITY', strength: STRENGTH.STRONG },
    PRODUCT_AVAILABILITY: { code: 'ASKED_AVAILABILITY', strength: STRENGTH.MEDIUM },
    PRODUCT_ATTRIBUTE: { code: 'ASKED_VARIANT', strength: STRENGTH.MEDIUM },
    DELIVERY_CHARGE: { code: 'ASKED_DELIVERY_CHARGE', strength: STRENGTH.MEDIUM },
    DELIVERY_POLICY: { code: 'ASKED_DELIVERY', strength: STRENGTH.MEDIUM },
    PAYMENT_METHODS: { code: 'ASKED_PAYMENT_METHOD', strength: STRENGTH.MEDIUM },
    PRODUCT_INQUIRY: { code: 'PRODUCT_QUESTION', strength: STRENGTH.WEAK },
    PRODUCT_PHOTO_LOOKUP: { code: 'SENT_PRODUCT_PHOTO', strength: STRENGTH.WEAK },
});

// The customer explicitly declined or asked not to be contacted.
const SUPPRESSING_INTENTS = new Set(['ORDER_SESSION_CANCEL', 'STOP_OPT_OUT']);

const MAX_STORED_SIGNALS = 10;

const metadataOf = (message) => {
    const raw = message?.metadata;
    if (raw && typeof raw === 'object') return raw;
    if (typeof raw === 'string') {
        try { return JSON.parse(raw) || {}; } catch (_) { return {}; }
    }
    return {};
};

const iso = (value) => (value ? new Date(value).toISOString() : null);

/**
 * Classify one inbound customer message.
 * @returns {{kind:'signal', signal:object} | {kind:'suppress', intentId:string, at:string} | null}
 */
function classifyMessage(message, classify = stage2.classify) {
    const metadata = metadataOf(message);
    const text = String(message?.content || '');
    const hasImage = metadata.message_type === 'image';
    const proposal = classify(text, {
        hasAttachment: hasImage,
        // Historical classification cannot know whether a checkout session was
        // active at that moment; order-session facts cover checkout instead.
        activeSession: false,
    });
    const at = iso(message?.created_at || message?.createdAt);
    if (!proposal || !proposal.intentId) return null;
    if (SUPPRESSING_INTENTS.has(proposal.intentId)) {
        return { kind: 'suppress', intentId: proposal.intentId, at };
    }
    const mapped = INTENT_SIGNALS[proposal.intentId];
    if (!mapped) return null;
    return {
        kind: 'signal',
        signal: {
            code: mapped.code,
            strength: mapped.strength,
            source: 'MESSAGE',
            intent_id: proposal.intentId,
            rule: proposal.matchedRule || null,
            message_id: message?.id || null,
            ...(proposal.slots?.attribute ? { attribute: proposal.slots.attribute } : {}),
            at,
        },
    };
}

/** A checkout that collected a cart but never produced an order. */
function sessionSignal(session) {
    if (!session || session.created_order_id) return null;
    if (!['ACTIVE', 'ABANDONED'].includes(session.status)) return null;
    let stepData = session.step_data;
    if (typeof stepData === 'string') {
        try { stepData = JSON.parse(stepData); } catch (_) { stepData = {}; }
    }
    const cart = Array.isArray(stepData?.cart) && stepData.cart.length
        ? stepData.cart
        : (session.product_info?.id ? [{ product_id: session.product_info.id, name: session.product_info.name }] : []);
    if (!cart.length) return null;
    const products = cart
        .filter((item) => item && item.product_id)
        .slice(0, 5)
        .map((item) => ({ product_id: item.product_id, name: item.name || null, quantity: item.quantity || 1 }));
    return {
        code: 'CHECKOUT_STARTED',
        strength: STRENGTH.STRONG,
        source: 'ORDER_SESSION',
        order_session_id: session.id,
        checkout_step: session.current_step || null,
        at: iso(session.last_activity_at || session.updated_at || session.updatedAt),
        products,
    };
}

/**
 * Decide whether the collected signals are worth a merchant's attention.
 * HIGH:   any strong signal (explicit purchase intent, cart/checkout activity).
 * MEDIUM: at least two distinct reason codes, one of them medium strength
 *         (e.g. asked availability AND delivery charge).
 * Otherwise nothing — a single price question is not an opportunity.
 */
function assess(signals = []) {
    if (!signals.length) return { qualifies: false, strength: null, reasons: [] };
    const codes = [...new Set(signals.map((s) => s.code))];
    const hasStrong = signals.some((s) => s.strength === STRENGTH.STRONG);
    const hasMedium = signals.some((s) => s.strength === STRENGTH.MEDIUM);
    if (hasStrong) return { qualifies: true, strength: 'HIGH', reasons: codes };
    if (hasMedium && codes.length >= 2) return { qualifies: true, strength: 'MEDIUM', reasons: codes };
    return { qualifies: false, strength: null, reasons: codes };
}

/**
 * Turn a customer's messages (oldest first) and sessions into the signal set
 * newer than `cursor`. A suppressing message after the last positive signal
 * (explicit cancel / STOP) means the customer declined: no opportunity.
 */
function collectSignals({ messages = [], sessions = [], cursor = null }, classify = stage2.classify) {
    const cursorMs = cursor ? new Date(cursor).getTime() : 0;
    const signals = [];
    let lastPositiveMs = 0;
    let lastSuppressMs = 0;
    for (const message of messages) {
        const result = classifyMessage(message, classify);
        if (!result) continue;
        const atMs = result.kind === 'signal' ? new Date(result.signal.at).getTime() : new Date(result.at).getTime();
        if (!Number.isFinite(atMs) || atMs <= cursorMs) continue;
        if (result.kind === 'suppress') {
            lastSuppressMs = Math.max(lastSuppressMs, atMs);
        } else {
            signals.push(result.signal);
            lastPositiveMs = Math.max(lastPositiveMs, atMs);
        }
    }
    for (const session of sessions) {
        const signal = sessionSignal(session);
        if (!signal) continue;
        const atMs = new Date(signal.at).getTime();
        if (!Number.isFinite(atMs) || atMs <= cursorMs) continue;
        signals.push(signal);
        lastPositiveMs = Math.max(lastPositiveMs, atMs);
    }
    const declined = lastSuppressMs > 0 && lastSuppressMs >= lastPositiveMs;
    signals.sort((a, b) => new Date(a.at) - new Date(b.at));
    return { signals, declined };
}

/** Merge new signals into stored ones: dedupe by message/session, keep newest N. */
function mergeSignals(existing = [], incoming = []) {
    const key = (s) => `${s.source}:${s.message_id || s.order_session_id || s.at}:${s.code}`;
    const byKey = new Map();
    for (const s of [...existing, ...incoming]) byKey.set(key(s), s);
    return [...byKey.values()]
        .sort((a, b) => new Date(a.at) - new Date(b.at))
        .slice(-MAX_STORED_SIGNALS);
}

function productRefsFrom(signals = []) {
    const refs = new Map();
    for (const signal of signals) {
        for (const product of signal.products || []) {
            if (product.product_id && !refs.has(product.product_id)) refs.set(product.product_id, product);
        }
    }
    return [...refs.values()].slice(0, 5);
}

module.exports = {
    DETECTOR_VERSION,
    STRENGTH,
    INTENT_SIGNALS,
    SUPPRESSING_INTENTS,
    MAX_STORED_SIGNALS,
    classifyMessage,
    sessionSignal,
    assess,
    collectSignals,
    mergeSignals,
    productRefsFrom,
};
