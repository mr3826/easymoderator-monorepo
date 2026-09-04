'use strict';

const {
    MESSAGE_DELIVERY_STATES,
    SUGGESTION_VISIBILITY,
    normalizeDeliveryState,
    isProviderConfirmed,
    isTranscriptMessage,
    isReviewableSuggestion,
    deriveMessageSendIdempotencyKey,
} = require('../message-lifecycle');

describe('message lifecycle projection', () => {
    it('treats a draft candidate as unsent and reviewable', () => {
        const draft = {
            sender: 'ai',
            content: 'draft',
            delivery_state: MESSAGE_DELIVERY_STATES.DRAFT_READY,
            metadata: { suggestion_visibility: SUGGESTION_VISIBILITY.VISIBLE_DRAFT_REVIEW },
        };

        expect(normalizeDeliveryState(draft)).toBe('DRAFT_READY');
        expect(isProviderConfirmed(draft)).toBe(false);
        expect(isTranscriptMessage(draft)).toBe(false);
        expect(isReviewableSuggestion(draft)).toBe(true);
    });

    it('requires provider confirmation before an AI row is transcript-visible', () => {
        const sent = {
            sender: 'ai',
            delivery_state: 'SENT',
            provider_message_id: 'mid-1',
            metadata: {},
        };

        expect(isProviderConfirmed(sent)).toBe(true);
        expect(isTranscriptMessage(sent)).toBe(true);
    });

    it('keeps idempotency keys stable per candidate and scoped by tenant', () => {
        const base = { shopId: 'shop-a', conversationId: 'conversation-a', messageId: 'message-a' };
        expect(deriveMessageSendIdempotencyKey(base)).toBe(deriveMessageSendIdempotencyKey(base));
        expect(deriveMessageSendIdempotencyKey(base)).not.toBe(
            deriveMessageSendIdempotencyKey({ ...base, shopId: 'shop-b' }),
        );
    });
});
