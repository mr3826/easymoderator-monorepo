/**
 * draftMode rule
 *
 * Settings.automation_mode === 'DRAFT' — the AI generated reply should be
 * persisted to the conversation thread but NOT delivered to Meta. The reply
 * sits as a suggestion that the human agent reviews/edits/sends.
 *
 * Also handles 'AI_SUGGEST_ONLY', 'HUMAN_ACTIVE', and 'MANUAL' — all block delivery without
 * being "errors". The worker reads the deny reason and skips the send while
 * still storing the AI output.
 */

'use strict';

const {
    AI_REPLY_MODES,
    normalizeAiReplyMode,
    isNonDeliveringMode,
} = require('../../shop/ai-reply-mode');

module.exports = {
    name: 'draftMode',

    async evaluate(message, ctx) {
        // Human sends are explicit authorization and are independent of the AI
        // delivery mode.
        if (message?.senderRole === 'agent') {
            return { allow: true, reason: 'HUMAN_AGENT_SEND' };
        }

        // Transactional/system notifications (order confirmations, etc.) are not
        // AI-drafted replies and are independent of the AI delivery mode.
        if (ctx.messageType === 'transactional' || message?.messageType === 'transactional') {
            return { allow: true, reason: 'TRANSACTIONAL_NOTIFICATION' };
        }

        // Absent settings mean "not configured yet" — hold the reply rather than
        // auto-sending it. Fail-safe for automatic callers.
        const mode = normalizeAiReplyMode(ctx.settings?.automation_mode || AI_REPLY_MODES.DRAFT);

        if (isNonDeliveringMode(mode)) {
            return { allow: false, reason: 'DRAFT_MODE', augment: { automation_mode: mode } };
        }
        return { allow: true, reason: AI_REPLY_MODES.AUTO };
    },
};
