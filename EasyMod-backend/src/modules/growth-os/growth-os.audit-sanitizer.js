'use strict';

const SENSITIVE_KEY = /(password|token|secret|api[_-]?key|access[_-]?key|private[_-]?key|authorization|cookie|credential|otp|totp|contact[_-]?email|contact[_-]?phone|normalized[_-]?email|normalized[_-]?phone)/i;
const SENSITIVE_ASSIGNMENT = /(["']?)([a-z0-9_-]*(?:password|token|secret|key|otp|totp|authorization|cookie|credential)s?)\1\s*([:=])\s*(?:"[^"]*"|'[^']*'|[^,\s;]+)/gi;
const URL_KEY = /(?:page[_-]?url|source[_-]?url|redirect[_-]?uri|callback[_-]?url)/i;

function redactSensitiveUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (_error) {
    return null;
  }
}

function redactSensitiveText(value) {
  const withoutBearer = value.replace(/\bauthorization\s*[:=]\s*bearer\s+[^,\s;]+/gi, 'Authorization: [redacted]');
  return withoutBearer.replace(
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
      redacted[key] = URL_KEY.test(key)
        ? redactSensitiveUrl(child)
        : SENSITIVE_KEY.test(key)
          ? '[redacted]'
          : redactSecretiveValues(child, depth + 1);
    }
    return redacted;
  }
  return value;
}

module.exports = { redactSecretiveValues, redactSensitiveUrl };
