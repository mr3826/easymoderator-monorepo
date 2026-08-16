'use strict';

/**
 * Normalize URLs that may have been serialized into an env file.
 *
 * Error messages intentionally contain only the variable name. URL values can
 * contain credentials or query-string secrets and must never reach logs.
 */
const normalizeUrl = (value, { name, protocols, rootOnly = false }) => {
    let normalized = String(value ?? '').trim();
    if (!normalized) throw new Error(`${name} is required`);

    const quote = normalized[0];
    if (quote === '"' || quote === "'") {
        if (normalized.at(-1) !== quote) {
            throw new Error(`${name} has malformed surrounding quotes`);
        }
        normalized = normalized.slice(1, -1).trim();
    }

    if (!normalized || /\s/u.test(normalized)) {
        throw new Error(`${name} must not contain whitespace`);
    }

    let parsed;
    try {
        parsed = new URL(normalized);
    } catch (_) {
        throw new Error(`${name} must be a valid URL`);
    }

    if (!protocols.includes(parsed.protocol) || !parsed.hostname) {
        throw new Error(`${name} must use an allowed URL protocol and include a host`);
    }

    if (rootOnly && (
        parsed.pathname !== '/'
        || parsed.search
        || parsed.hash
        || parsed.username
        || parsed.password
    )) {
        throw new Error(`${name} must be a server-root URL`);
    }

    return rootOnly ? parsed.origin : parsed.toString();
};

const normalizeDatabaseUrl = (value) => normalizeUrl(value, {
    name: 'DATABASE_URL',
    protocols: ['postgres:', 'postgresql:'],
});

const normalizeQdrantUrl = (value) => normalizeUrl(value, {
    name: 'QDRANT_URL',
    protocols: ['http:', 'https:'],
    rootOnly: true,
});

module.exports = {
    normalizeDatabaseUrl,
    normalizeQdrantUrl,
    normalizeUrl,
};
