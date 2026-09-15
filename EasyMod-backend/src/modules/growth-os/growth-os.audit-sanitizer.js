'use strict';

const SENSITIVE_KEY = /(password|token|secret|api[_-]?key|access[_-]?key|private[_-]?key|authorization|cookie|credential|otp|totp)/i;
const SENSITIVE_ASSIGNMENT = /(["']?)([a-z0-9_-]*(?:password|token|secret|key|otp|totp|authorization|cookie|credential)s?)\1\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^,\s;]+)/gi;

function redactSensitiveText(value) {
  return value.replace(
    SENSITIVE_ASSIGNMENT,
    (_match, quote, key, separator) => `${quote}${key}${quote}${separator}[redacted]`,
  );
}

function redactSecretiveValues(value, depth = 0) {
  if (depth > 8) return '[redacted]';
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redactSecretiveValues(item, depth + 1));
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value;
    const redacted = {};
    for (const [key, child] of Object.entries(value)) {
      redacted[key] = SENSITIVE_KEY.test(key)
        ? '[redacted]'
        : redactSecretiveValues(child, depth + 1);
    }
    return redacted;
  }
  return value;
}

module.exports = { redactSecretiveValues };
