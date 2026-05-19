/**
 * contentSanitizer rule
 *
 * Strips PII patterns from outbound text. Per Meta policy and BD f-commerce
 * common sense, we never echo back credit card numbers, full national IDs, or
 * bKash PINs. Returns a transformed message if anything was redacted.
 *
 * Patterns (deliberately conservative to avoid mangling Bangla numerals or
 * order IDs):
 *   - Credit-card-shaped 13–19 digit sequences   → [redacted-card]
 *   - 10-digit BD NID                            → [redacted-nid]
 *   - 17-digit BD smart NID                      → [redacted-nid]
 *   - Sequences labeled "PIN: 1234"              → [redacted-pin]
 */

'use strict';

const CC_RE = /\b(?:\d[ -]?){13,19}\b/g;
const NID_10_RE = /\b\d{10}\b/g;
const NID_17_RE = /\b\d{17}\b/g;
const PIN_RE = /\b(pin|পিন)\s*[:=]\s*\d{3,8}\b/gi;

module.exports = {
    name: 'contentSanitizer',

    async evaluate(message, _ctx) {
        if (!message?.text || typeof message.text !== 'string') {
            return { allow: true, reason: 'NO_TEXT' };
        }

        let transformedText = message.text;
        let changed = false;

        const after1 = transformedText.replace(CC_RE, (match) => {
            // Heuristic: ignore strings that look like order IDs / phone numbers
            // (under 13 digits after stripping separators).
            const digits = match.replace(/\D/g, '');
            if (digits.length < 13) return match;
            changed = true;
            return '[redacted-card]';
        });
        transformedText = after1;

        if (NID_17_RE.test(transformedText)) {
            transformedText = transformedText.replace(NID_17_RE, '[redacted-nid]');
            changed = true;
        }
        if (NID_10_RE.test(transformedText)) {
            transformedText = transformedText.replace(NID_10_RE, '[redacted-nid]');
            changed = true;
        }
        if (PIN_RE.test(transformedText)) {
            transformedText = transformedText.replace(PIN_RE, '[redacted-pin]');
            changed = true;
        }

        if (!changed) return { allow: true, reason: 'CLEAN' };
        return {
            allow: true,
            reason: 'SANITIZED',
            transform: { ...message, text: transformedText },
        };
    },
};
