'use strict';

const cacheService = require('./cache.service');
const geminiCache = require('../modules/ai/gemini-cache.service');

const SETTINGS_GENERATION_KEY = 'settings:generation';
const MERCHANT_KNOWLEDGE_CACHE_KEY = 'knowledge:summary';
const AI_KNOWLEDGE_CACHE_KEY = 'knowledge:ai-summary';
const RETRY_DELAYS_MS = [1000, 5000, 15000, 60000, 240000];
const INVALIDATION_OPERATIONS = Object.freeze([
    'merchantKnowledge',
    'aiKnowledge',
    'generation',
    'gemini',
]);
const pendingInvalidations = new Map();

/**
 * Read the current settings generation. A missing key is the initial
 * generation; an actual cache failure returns null so callers can bypass
 * potentially stale process-local entries.
 */
const getShopSettingsGeneration = async (shopId) => {
    try {
        const getGeneration = typeof cacheService.getForShopStrict === 'function'
            ? cacheService.getForShopStrict.bind(cacheService)
            : cacheService.getForShop;
        if (typeof getGeneration !== 'function') return null;
        const value = await getGeneration(shopId, SETTINGS_GENERATION_KEY);
        if (value === null || value === undefined) return 0;
        const generation = Number(value);
        return Number.isSafeInteger(generation) && generation >= 0 ? generation : null;
    } catch (_) {
        return null;
    }
};

const operationHandlers = (shopId) => ({
    merchantKnowledge: () => (typeof cacheService.deleteForShopStrict === 'function'
        ? cacheService.deleteForShopStrict(shopId, MERCHANT_KNOWLEDGE_CACHE_KEY)
        : cacheService.deleteForShop?.(shopId, MERCHANT_KNOWLEDGE_CACHE_KEY)),
    aiKnowledge: () => (typeof cacheService.deleteForShopStrict === 'function'
        ? cacheService.deleteForShopStrict(shopId, AI_KNOWLEDGE_CACHE_KEY)
        : cacheService.deleteForShop?.(shopId, AI_KNOWLEDGE_CACHE_KEY)),
    generation: () => (typeof cacheService.incrementForShopStrict === 'function'
        ? cacheService.incrementForShopStrict(shopId, SETTINGS_GENERATION_KEY)
        : cacheService.incrementForShop?.(shopId, SETTINGS_GENERATION_KEY)),
    gemini: () => geminiCache.invalidate(shopId),
});

const operationSucceeded = (operation, result) => {
    // Legacy mocks and no-op invalidators return undefined on success. The
    // strict generation path always returns a positive integer; zero is the
    // failure sentinel from the legacy fallback implementation.
    if (operation === 'generation' && typeof result === 'number') return result > 0;
    return result !== false;
};

const flushInvalidation = async (shopId, state) => {
    const handlers = operationHandlers(shopId);
    const results = await Promise.all(INVALIDATION_OPERATIONS
        .filter((operation) => state.pending.has(operation))
        .map(async (operation) => {
            try {
                const result = await handlers[operation]();
                return { operation, success: operationSucceeded(operation, result) };
            } catch (_) {
                return { operation, success: false };
            }
        }));

    results.forEach(({ operation, success }) => {
        if (success) state.pending.delete(operation);
    });
};

const scheduleInvalidationRetry = (shopId, state) => {
    if (state.timer || state.pending.size === 0) return;
    const delay = RETRY_DELAYS_MS[Math.min(state.attempt, RETRY_DELAYS_MS.length - 1)];
    state.attempt += 1;
    state.timer = setTimeout(async () => {
        state.timer = null;
        await flushInvalidation(shopId, state);
        if (state.pending.size > 0) {
            scheduleInvalidationRetry(shopId, state);
        } else if (pendingInvalidations.get(shopId) === state) {
            pendingInvalidations.delete(shopId);
        }
    }, delay);
    state.timer.unref?.();
};

const invalidateShopSettingsCaches = async (shopId) => {
    if (!shopId) return;

    const state = pendingInvalidations.get(shopId) || {
        pending: new Set(),
        attempt: 0,
        timer: null,
    };
    pendingInvalidations.set(shopId, state);
    if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
    }
    INVALIDATION_OPERATIONS.forEach((operation) => state.pending.add(operation));

    await flushInvalidation(shopId, state);
    if (state.pending.size > 0) {
        scheduleInvalidationRetry(shopId, state);
    } else {
        pendingInvalidations.delete(shopId);
    }
};

module.exports = {
    SETTINGS_GENERATION_KEY,
    MERCHANT_KNOWLEDGE_CACHE_KEY,
    AI_KNOWLEDGE_CACHE_KEY,
    getShopSettingsGeneration,
    invalidateShopSettingsCaches,
};
