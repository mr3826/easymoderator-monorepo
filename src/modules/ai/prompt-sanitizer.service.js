'use strict';

/**
 * Input guard: BD F-commerce customers ask simple questions in 3-8 turns.
 * Real messages are short. If the input exceeds the character limit it's a bot,
 * a troll, or a copy-paste attack — not a customer buying a saree.
 */
const MAX_MESSAGE_LENGTH = 500;

function isTooLong(message) {
    return typeof message === 'string' && message.length > MAX_MESSAGE_LENGTH;
}

// ---------------------------------------------------------------------------
// PII scrubbing — applied to customer messages before sending to LLM.
// Replaces recognisable PII patterns with placeholders so phone numbers and
// email addresses are not stored in LLM provider logs unnecessarily.
// Only customer-authored text is scrubbed; shop knowledge/system prompts are not.
// ---------------------------------------------------------------------------

const PII_PATTERNS = [
    // BD mobile: 01XXXXXXXXX or +8801XXXXXXXXX (operator prefixes 3-9)
    { pattern: /(?:\+?880\s*)?0?(1[3-9]\d{8})\b/g, replace: '[PHONE]' },
    // Email addresses
    { pattern: /[\w.+\-]+@[\w\-]+\.[a-z]{2,}/gi, replace: '[EMAIL]' },
];

/**
 * Mask PII in customer-authored text before it is injected into an LLM prompt.
 * @param {string} text
 * @returns {string}
 */
function scrubPII(text) {
    if (!text || typeof text !== 'string') return text;
    return PII_PATTERNS.reduce((t, { pattern, replace }) => t.replace(pattern, replace), text);
}

module.exports = { isTooLong, MAX_MESSAGE_LENGTH, scrubPII };
