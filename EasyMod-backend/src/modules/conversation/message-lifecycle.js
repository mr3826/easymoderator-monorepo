'use strict';

const crypto = require('crypto');

const MESSAGE_DELIVERY_STATES = Object.freeze({
    GENERATING: 'GENERATING',
    DRAFT_READY: 'DRAFT_READY',
    SEND_PENDING: 'SEND_PENDING',
    SENT: 'SENT',
    DELIVERED: 'DELIVERED',
    FAILED: 'FAILED',
    HELD: 'HELD',
    DISMISSED: 'DISMISSED',
});

const SUGGESTION_VISIBILITY = Object.freeze({
    HIDDEN_AUTO_PROCESSING: 'HIDDEN_AUTO_PROCESSING',
    VISIBLE_DRAFT_REVIEW: 'VISIBLE_DRAFT_REVIEW',
    VISIBLE_HITL_REVIEW: 'VISIBLE_HITL_REVIEW',
    VISIBLE_MERCHANT_REQUESTED: 'VISIBLE_MERCHANT_REQUESTED',
    HIDDEN_SENT: 'HIDDEN_SENT',
    HIDDEN_DISMISSED: 'HIDDEN_DISMISSED',
});

const stateValues = new Set(Object.values(MESSAGE_DELIVERY_STATES));

function metadataFor(message) {
    if (typeof message?.metadata === 'string') {
        try {
            const parsed = JSON.parse(message.metadata);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_) {
            return {};
        }
    }
    return message?.metadata && typeof message.metadata === 'object'
        ? message.metadata
        : {};
}

/**
 * Resolve the persisted lifecycle while accepting pre-hotfix metadata rows.
 * New writes always populate the first-class delivery_state column.
 */
function normalizeDeliveryState(message) {
    const metadata = metadataFor(message);
    const explicit = message?.delivery_state || metadata.delivery_state;
    if (stateValues.has(explicit)) return explicit;
    if (metadata.delivered === true) return MESSAGE_DELIVERY_STATES.SENT;
    if (metadata.delivery_status === 'pending') return MESSAGE_DELIVERY_STATES.SEND_PENDING;
    if (metadata.delivered === false) {
        return metadata.held_reason === 'draft_mode'
            ? MESSAGE_DELIVERY_STATES.DRAFT_READY
            : MESSAGE_DELIVERY_STATES.HELD;
    }
    return null;
}

function providerMessageIdFor(message) {
    return message?.provider_message_id || metadataFor(message).provider_message_id || null;
}

function isProviderConfirmed(message) {
    const state = normalizeDeliveryState(message);
    return (state === MESSAGE_DELIVERY_STATES.SENT || state === MESSAGE_DELIVERY_STATES.DELIVERED)
        && (Boolean(providerMessageIdFor(message)) || metadataFor(message).provider_send_confirmed === true);
}

function isUnsentAiMessage(message) {
    return message?.sender === 'ai' && !isProviderConfirmed(message);
}

function isTranscriptMessage(message) {
    return message?.sender !== 'ai' || isProviderConfirmed(message);
}

function isReviewableSuggestion(message) {
    if (!isUnsentAiMessage(message)) return false;
    const metadata = metadataFor(message);
    const state = normalizeDeliveryState(message);
    if (state === MESSAGE_DELIVERY_STATES.DISMISSED) return false;
    if (metadata.suggestion_visibility === SUGGESTION_VISIBILITY.HIDDEN_DISMISSED) return false;
    if (state === MESSAGE_DELIVERY_STATES.GENERATING || state === MESSAGE_DELIVERY_STATES.SEND_PENDING) return false;
    return [
        SUGGESTION_VISIBILITY.VISIBLE_DRAFT_REVIEW,
        SUGGESTION_VISIBILITY.VISIBLE_HITL_REVIEW,
        SUGGESTION_VISIBILITY.VISIBLE_MERCHANT_REQUESTED,
    ].includes(metadata.suggestion_visibility)
        || state === MESSAGE_DELIVERY_STATES.DRAFT_READY
        || (state === MESSAGE_DELIVERY_STATES.HELD
            && ['low_confidence', 'human_active', 'ai_paused', 'channel_disconnected', 'mode_changed', 'policy_blocked']
                .includes(metadata.held_reason))
        || (state === null && metadata.delivered === false && [
            'draft_mode',
            'low_confidence',
            'human_active',
            'ai_paused',
            'channel_disconnected',
            'mode_changed',
            'policy_blocked',
        ].includes(metadata.held_reason));
}

function deriveMessageSendIdempotencyKey({ shopId, conversationId, messageId }) {
    const input = [shopId, conversationId, messageId].map((part) => String(part || '')).join('|');
    return crypto.createHash('sha256').update(`easymod:inbox-send:${input}`).digest('hex');
}

function deriveAutomaticSendIdempotencyKey({ shopId, conversationId, turnId }) {
    const input = [shopId, conversationId, turnId].map((part) => String(part || '')).join('|');
    return crypto.createHash('sha256').update(`easymod:inbox-auto-send:${input}`).digest('hex');
}

function deriveEscalationSendIdempotencyKey({ shopId, conversationId }) {
    const input = [shopId, conversationId].map((part) => String(part || '')).join('|');
    return crypto.createHash('sha256').update(`easymod:inbox-handoff:${input}`).digest('hex');
}

module.exports = {
    MESSAGE_DELIVERY_STATES,
    SUGGESTION_VISIBILITY,
    normalizeDeliveryState,
    providerMessageIdFor,
    isProviderConfirmed,
    isUnsentAiMessage,
    isTranscriptMessage,
    isReviewableSuggestion,
    deriveMessageSendIdempotencyKey,
    deriveAutomaticSendIdempotencyKey,
    deriveEscalationSendIdempotencyKey,
};
