/**
 * draftMode rule
 *
 * Settings.automation_mode === 'DRAFT' — the AI generated reply should be
 * persisted to the conversation thread but NOT delivered to Meta. The reply
 * sits as a suggestion that the human agent reviews/edits/sends.
 *
 * Also handles 'AI_SUGGEST_ONLY' and 'MANUAL' — both block delivery without
 * being "errors". The worker reads the deny reason and skips the send while
 * still storing the AI output.
 */

'use strict';

const NON_DELIVERING_MODES = new Set(['DRAFT', 'AI_SUGGEST_ONLY', 'MANUAL']);

module.exports = {
    name: 'draftMode',

    async evaluate(_message, ctx) {
        // Absent settings mean "not configured yet" — hold the reply rather than
        // auto-sending it. Fail-safe, matching DEFAULT_AI_SETTINGS.
        const mode = ctx.settings?.automation_mode || 'DRAFT';
        if (NON_DELIVERING_MODES.has(mode)) {
            return { allow: false, reason: 'DRAFT_MODE', augment: { automation_mode: mode } };
        }
        return { allow: true, reason: 'AI_ACTIVE' };
    },
};

module.exports.NON_DELIVERING_MODES = NON_DELIVERING_MODES;
