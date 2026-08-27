'use strict';

const cacheService = require('./cache.service');
const geminiCache = require('../modules/ai/gemini-cache.service');

const SETTINGS_GENERATION_KEY = 'settings:generation';
const MERCHANT_KNOWLEDGE_CACHE_KEY = 'knowledge:summary';
const AI_KNOWLEDGE_CACHE_KEY = 'knowledge:ai-summary';

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

const bestEffort = (operation) => {
    try {
        return Promise.resolve(operation()).catch(() => undefined);
    } catch (_) {
        return Promise.resolve();
    }
};

/**
 * Invalidate settings-derived caches after a successful write. Every operation
 * is best-effort so cache outages never turn a committed settings write into a
 * failed request.
 */
const invalidateShopSettingsCaches = async (shopId) => {
    await Promise.all([
        bestEffort(() => cacheService.deleteForShop?.(shopId, MERCHANT_KNOWLEDGE_CACHE_KEY)),
        bestEffort(() => cacheService.deleteForShop?.(shopId, AI_KNOWLEDGE_CACHE_KEY)),
        bestEffort(() => cacheService.incrementForShop?.(shopId, SETTINGS_GENERATION_KEY)),
        bestEffort(() => geminiCache.invalidate(shopId)),
    ]);
};

module.exports = {
    SETTINGS_GENERATION_KEY,
    MERCHANT_KNOWLEDGE_CACHE_KEY,
    AI_KNOWLEDGE_CACHE_KEY,
    getShopSettingsGeneration,
    invalidateShopSettingsCaches,
};
