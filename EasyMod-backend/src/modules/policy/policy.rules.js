/**
 * Policy rule registry — ordered pipeline of outbound rules.
 *
 * Order matters:
 *   1. consentRequired      — hard-deny if no per-channel consent
 *   2. messengerOptedOut    — hard-deny if legacy global opt-out flag set
 *   3. twentyFourHourWindow — sets augment.within_window (informational)
 *   4. templateRequired     — hard-deny outside-window Messenger sends until approved template path exists
 *   5. contentSanitizer     — may transform message (no deny)
 *   6. businessHours        — soft-deny → SUGGEST_ONLY when AI_ACTIVE + outside hours
 *   7. rateLimit            — soft-deny → retryAfterMs when at 170/hr cap
 *   8. draftMode            — soft-deny when automation_mode ∈ {DRAFT, AI_SUGGEST_ONLY, MANUAL}
 *
 * Hard vs soft deny matters only for the worker — both write a deny row.
 * Engine short-circuits on the FIRST deny (no further rule runs once denied).
 */

'use strict';

module.exports = [
    require('./rules/consentRequired.rule'),
    require('./rules/messengerOptedOut.rule'),
    require('./rules/twentyFourHourWindow.rule'),
    require('./rules/templateRequired.rule'),
    require('./rules/contentSanitizer.rule'),
    require('./rules/businessHours.rule'),
    require('./rules/rateLimit.rule'),
    require('./rules/draftMode.rule'),
];
