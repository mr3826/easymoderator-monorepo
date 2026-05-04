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
// Prompt injection detection — catches common jailbreak and override patterns.
// Note: regex is a first-pass filter. Semantically sophisticated injections
// (e.g. encoded Unicode, indirect phrasing) require an LLM-based moderation
// layer — add OpenAI Moderation API or Claude Guard for production hardening.
// ---------------------------------------------------------------------------

const INJECTION_PATTERNS = [
    // Classic overrides
    /ignore\s+(all\s+)?previous\s+instructions?/i,
    /disregard\s+(all\s+)?previous\s+instructions?/i,
    /forget\s+(all\s+)?previous\s+instructions?/i,
    /you\s+are\s+now\s+(?:a\s+)?(?:dan|jailbreak|evil|unrestricted)/i,
    // System prompt leakage attempts
    /reveal\s+(your\s+)?(system\s+)?prompt/i,
    /print\s+(your\s+)?(system\s+)?instructions?/i,
    /what\s+(are|is)\s+your\s+(system\s+)?instructions?/i,
    // Role-play overrides
    /act\s+as\s+(?:if\s+you\s+(?:are|were)\s+)?(?:a\s+)?(?:human|person|different\s+ai|unrestricted)/i,
    /pretend\s+(?:you\s+are|to\s+be)\s+(?:a\s+)?(?:human|different|uncensored)/i,
    // Instruction injection via fake context
    /\[SYSTEM\]/i,
    /\[INST\]/i,
    /<\|system\|>/i,
    /<\|user\|>/i,
];

/**
 * Check input for prompt injection patterns.
 * @param {string} message
 * @returns {{ clean: boolean, detectedPattern: string|null }}
 */
function sanitize(message) {
    if (!message || typeof message !== 'string') {
        return { clean: true, detectedPattern: null };
    }

    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(message)) {
            return { clean: false, detectedPattern: pattern.source };
        }
    }

    return { clean: true, detectedPattern: null };
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

module.exports = { isTooLong, MAX_MESSAGE_LENGTH, scrubPII, sanitize };
