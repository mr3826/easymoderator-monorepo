'use strict';

/**
 * P+03 shared action vocabulary (web inbox + future mobile M-008 alignment).
 * Buckets encode OPERATIONAL RISK order, never arbitrary urgency; every reason
 * maps to an authoritative stored fact (no persisted task copies — the queue
 * is recomputed per request so completed items can never resurface stale).
 */

const ACTION_BUCKETS = Object.freeze({
    NEEDS_HUMAN: 1,
    COMMITTED_WITHOUT_ACK: 2,
    CUSTOMER_BLOCKED: 3,
    DRAFT_RECOVERY: 4,
    PURCHASE_OPPORTUNITY: 5,
    KNOWLEDGE_GAP: 6,
});

const ACTION_REASONS = Object.freeze({
    HITL_REQUIRED: 'HITL_REQUIRED',
    HANDOFF_SUSPENDED_CHECKOUT: 'HANDOFF_SUSPENDED_CHECKOUT',
    SEND_FAILED_AFTER_MUTATION: 'SEND_FAILED_AFTER_MUTATION',
    SEND_NEEDS_RECONCILIATION: 'SEND_NEEDS_RECONCILIATION',
    CHECKOUT_WAITING_CUSTOMER: 'CHECKOUT_WAITING_CUSTOMER',
    DRAFT_AWAITING_REVIEW: 'DRAFT_AWAITING_REVIEW',
    HELD_MESSAGE: 'HELD_MESSAGE',
    OPPORTUNITY_OPEN: 'OPPORTUNITY_OPEN',
    KNOWLEDGE_GAP_OPEN: 'KNOWLEDGE_GAP_OPEN',
});

// Stored failure facts meaning "a business event happened that the customer
// may not have received": failed AI sends, mutation-without-send candidates,
// and outbox rows that need reconciliation.
const RECONCILIATION_DELIVERY_STATES = Object.freeze(['FAILED']);
const RECOVERY_DELIVERY_STATES = Object.freeze(['DRAFT_READY', 'HELD']);
const OUTBOX_RECONCILIATION_STATUS = 'NEEDS_RECONCILIATION';

const NEXT_ACTION = Object.freeze({
    OPEN_CONVERSATION: 'open_conversation',
    REVIEW_DRAFT: 'review_draft',
    RECONCILE_SEND: 'reconcile_send',
    RESUME_CHECKOUT: 'resume_checkout',
    REVIEW_OPPORTUNITY: 'review_opportunity',
    REVIEW_KNOWLEDGE_GAP: 'review_knowledge_gap',
});

const BUCKET_ORDER = [
    ACTION_BUCKETS.NEEDS_HUMAN,
    ACTION_BUCKETS.COMMITTED_WITHOUT_ACK,
    ACTION_BUCKETS.CUSTOMER_BLOCKED,
    ACTION_BUCKETS.DRAFT_RECOVERY,
    ACTION_BUCKETS.PURCHASE_OPPORTUNITY,
    ACTION_BUCKETS.KNOWLEDGE_GAP,
];

function compareItems(a, b) {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    // oldest actionable fact first within a bucket (attention age)
    return new Date(a.since) - new Date(b.since);
}

module.exports = {
    ACTION_BUCKETS,
    ACTION_REASONS,
    RECONCILIATION_DELIVERY_STATES,
    RECOVERY_DELIVERY_STATES,
    OUTBOX_RECONCILIATION_STATUS,
    NEXT_ACTION,
    BUCKET_ORDER,
    compareItems,
};
