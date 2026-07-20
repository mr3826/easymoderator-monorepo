'use strict';

/**
 * Redis-backed OAuth state store (15-min TTL). Replaces the per-process Map so
 * OAuth initiate/callback survive landing on different backend instances.
 * Falls back to an in-memory Map only when Redis is the dev memory-fallback.
 */

const { cacheRedis } = require('../../config/redis');

const TTL_SECONDS = 15 * 60;
const PREFIX = 'oauth:state:';

const useRedis = cacheRedis && cacheRedis._isMemoryFallback !== true;

// Dev-only fallback (single process). TTL enforced lazily on read.
const _mem = new Map();

async function put(key, payload) {
    const value = JSON.stringify(payload);
    if (useRedis) {
        await cacheRedis.set(PREFIX + key, value, 'EX', TTL_SECONDS);
    } else {
        _mem.set(key, { value, expiresAt: Date.now() + TTL_SECONDS * 1000 });
    }
}

async function get(key) {
    if (useRedis) {
        const raw = await cacheRedis.get(PREFIX + key);
        if (raw == null) return null;
        try { return JSON.parse(raw); } catch { return null; }
    }
    const entry = _mem.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        _mem.delete(key);
        return null;
    }
    try { return JSON.parse(entry.value); } catch { return null; }
}

async function take(key) {
    if (useRedis) {
        const raw = await cacheRedis.get(PREFIX + key);
        if (raw == null) return null;
        // Single-use: must delete after reading. If del rejects (Redis degraded),
        // we deliberately let the error propagate rather than swallow it — a
        // surviving key could be replayed, so the OAuth flow should fail loudly.
        await cacheRedis.del(PREFIX + key);
        try { return JSON.parse(raw); } catch { return null; }
    }
    const entry = _mem.get(key);
    if (!entry) return null;
    _mem.delete(key); // single-use: remove unconditionally, then check it was still valid
    if (Date.now() > entry.expiresAt) return null;
    try { return JSON.parse(entry.value); } catch { return null; }
}

module.exports = { put, get, take, TTL_SECONDS };
