'use strict';

/**
 * Prompt injection sanitizer.
 * Strips or neutralizes customer message fragments that attempt to hijack the AI system prompt.
 * Mirrors the pattern from src/middleware/xss-sanitize.middleware.js.
 *
 * These patterns are common jailbreak/injection vectors seen in e-commerce chatbot deployments.
 * Matched segments are replaced with a safe placeholder so the message is still parseable.
 */
const INJECTION_PATTERNS = [
    /ignore\s+(all\s+|previous\s+|above\s+)?instructions?/gi,
    /forget\s+(all\s+|previous\s+|your\s+)?instructions?/gi,
    /you\s+are\s+now\s+/gi,
    /act\s+as\s+(a\s+|an\s+)?/gi,
    /pretend\s+(you\s+are|to\s+be)\s+/gi,
    /jailbreak/gi,
    /system\s*prompt/gi,
    /\bDAN\b/g, // "Do Anything Now" jailbreak token
    /<\s*system\s*>/gi,
    /---+\s*(system|assistant|user)\s*---+/gi
];

const REPLACEMENT = '[removed]';

/**
 * Sanitize a customer message before it enters the AI pipeline.
 * Returns the cleaned message string.
 * @param {string} message
 * @returns {string}
 */
function sanitize(message) {
    if (typeof message !== 'string' || !message) return message;
    let cleaned = message;
    for (const pattern of INJECTION_PATTERNS) {
        cleaned = cleaned.replace(pattern, REPLACEMENT);
    }
    return cleaned;
}

/**
 * Returns true if the message contained injection patterns (useful for logging).
 * @param {string} original
 * @param {string} sanitized
 * @returns {boolean}
 */
function wasInjectionAttempt(original, sanitized) {
    return original !== sanitized;
}

module.exports = { sanitize, wasInjectionAttempt };
