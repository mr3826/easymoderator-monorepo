'use strict';

/**
 * Decode values written by the historical renderer, which serialized every
 * value as JSON. Docker's --env-file parser can preserve those surrounding
 * quote characters, so the application must accept that legacy format while
 * the renderer transitions to Docker-native KEY=value lines.
 */
const decodeRenderedEnvValue = (value) => {
    const raw = String(value ?? '');
    const trimmed = raw.trim();
    if (trimmed.length < 2 || trimmed[0] !== '"' || trimmed.at(-1) !== '"') {
        return value;
    }

    try {
        const decoded = JSON.parse(trimmed);
        return typeof decoded === 'string' ? decoded : value;
    } catch (_) {
        // Leave malformed values untouched so the production validator fails
        // closed instead of silently repairing an unsafe configuration.
        return value;
    }
};

/**
 * Return a normalized copy of an environment object without logging values.
 * The caller may apply it to process.env before loading runtime config.
 */
const normalizeRenderedEnvironment = (environment = process.env) => Object.fromEntries(
    Object.entries(environment).map(([name, value]) => [name, decodeRenderedEnvValue(value)]),
);

/**
 * Serialize one value for Docker's KEY=value env-file syntax.
 * Newlines and NUL bytes are rejected to prevent line injection.
 */
const serializeRenderedEnvValue = (value, name = 'environment value') => {
    const normalized = String(value ?? '');
    if (/[\r\n\u0000]/u.test(normalized)) {
        throw new Error(`${name} cannot contain newlines or NUL bytes`);
    }
    return normalized;
};

module.exports = {
    decodeRenderedEnvValue,
    normalizeRenderedEnvironment,
    serializeRenderedEnvValue,
};
