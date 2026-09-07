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
const RESUME_BOUNDARY_METADATA_KEY = 'ai_resume_boundary_at';

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

function timestampStateFor(value) {
    if (value === undefined) return { present: false, valid: false, timestamp: null };
    let timestamp = null;
    if (value instanceof Date) {
        timestamp = value.getTime();
    } else if (typeof value === 'number') {
        timestamp = value;
    } else if (typeof value === 'string') {
        const normalized = value.trim();
        const isIsoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized);
        if (isIsoTimestamp) timestamp = Date.parse(normalized);
    }
    return {
        present: true,
        valid: Number.isFinite(timestamp) && timestamp > 0,
        timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null,
    };
}

function resumeBoundaryStateFor(conversation) {
    const metadata = metadataFor(conversation);
    const state = timestampStateFor(metadata[RESUME_BOUNDARY_METADATA_KEY]);
    return {
        ...state,
        present: Object.prototype.hasOwnProperty.call(metadata, RESUME_BOUNDARY_METADATA_KEY),
    };
}

function resumeBoundaryAtFor(conversation) {
    const state = resumeBoundaryStateFor(conversation);
    return state.valid ? state.timestamp : null;
}

function candidateStartedAtStateFor(message) {
    const metadata = metadataFor(message);
    const turnState = timestampStateFor(metadata.turn_started_at);
    if (turnState.present) return turnState;
    const createdAt = message?.created_at ?? message?.createdAt;
    return timestampStateFor(createdAt);
}

function candidateStartedAtFor(message) {
    return candidateStartedAtStateFor(message).timestamp;
}

function isBeforeResumeBoundary(message, boundaryAt) {
    const boundaryTimestamp = boundaryAt instanceof Date
        ? boundaryAt.getTime()
        : typeof boundaryAt === 'number'
            ? boundaryAt
            : Date.parse(String(boundaryAt || ''));
    const candidateTimestamp = candidateStartedAtFor(message);
    return Number.isFinite(boundaryTimestamp)
        && Number.isFinite(candidateTimestamp)
        && candidateTimestamp <= boundaryTimestamp;
}

/**
 * Resolve the persisted lifecycle while accepting pre-hotfix metadata rows.
 * New writes always populate the first-class delivery_state column.
 */
function normalizeDeliveryState(message) {
    const metadata = metadataFor(message);
    const explicit = message?.delivery_state || metadata.delivery_state;
    if (stateValues.has(explicit)) {
        if ([MESSAGE_DELIVERY_STATES.SENT, MESSAGE_DELIVERY_STATES.DELIVERED].includes(explicit)
            && !providerMessageIdFor(message)) {
            return MESSAGE_DELIVERY_STATES.HELD;
        }
        return explicit;
    }
    if (metadata.delivered === true) {
        return providerMessageIdFor(message)
            ? MESSAGE_DELIVERY_STATES.SENT
            : MESSAGE_DELIVERY_STATES.HELD;
    }
    if (metadata.delivery_status === 'pending') return MESSAGE_DELIVERY_STATES.SEND_PENDING;
    if (metadata.delivered === false) {
        return metadata.held_reason === 'draft_mode'
            ? MESSAGE_DELIVERY_STATES.DRAFT_READY
            : MESSAGE_DELIVERY_STATES.HELD;
    }
    return null;
}

function providerMessageIdFor(message) {
    const metadata = metadataFor(message);
    const raw = [message?.provider_message_id, metadata.provider_message_id]
        .find((value) => value !== null && value !== undefined && String(value).trim());
    return raw && String(raw).trim() ? String(raw).trim() : null;
}

function providerAcknowledgementId(result) {
    if (!result || result.sent === false || result.success === false || result.ok === false) return null;
    if (result.providerMessageId && String(result.providerMessageId).trim()) {
        return String(result.providerMessageId).trim();
    }
    const ids = Array.isArray(result.providerMessageIds) ? result.providerMessageIds : [];
    const lastId = ids[ids.length - 1];
    return lastId && String(lastId).trim() ? String(lastId).trim() : null;
}

function hasProviderAcknowledgement(result) {
    return Boolean(providerAcknowledgementId(result));
}

function isProviderConfirmed(message) {
    const state = normalizeDeliveryState(message);
    return (state === MESSAGE_DELIVERY_STATES.SENT || state === MESSAGE_DELIVERY_STATES.DELIVERED)
        && Boolean(providerMessageIdFor(message));
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
    if (state === MESSAGE_DELIVERY_STATES.FAILED || metadata.provider_send_attempted === true) return false;
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

function deriveEscalationSendIdempotencyKey({ shopId, conversationId, turnId = null }) {
    const inputParts = [shopId, conversationId];
    if (turnId) inputParts.push(turnId);
    const input = inputParts.map((part) => String(part || '')).join('|');
    return crypto.createHash('sha256').update(`easymod:inbox-handoff:${input}`).digest('hex');
}

module.exports = {
    MESSAGE_DELIVERY_STATES,
    SUGGESTION_VISIBILITY,
    RESUME_BOUNDARY_METADATA_KEY,
    timestampStateFor,
    resumeBoundaryStateFor,
    candidateStartedAtStateFor,
    normalizeDeliveryState,
    resumeBoundaryAtFor,
    candidateStartedAtFor,
    isBeforeResumeBoundary,
    providerMessageIdFor,
    providerAcknowledgementId,
    hasProviderAcknowledgement,
    isProviderConfirmed,
    isUnsentAiMessage,
    isTranscriptMessage,
    isReviewableSuggestion,
    deriveMessageSendIdempotencyKey,
    deriveAutomaticSendIdempotencyKey,
    deriveEscalationSendIdempotencyKey,
};
