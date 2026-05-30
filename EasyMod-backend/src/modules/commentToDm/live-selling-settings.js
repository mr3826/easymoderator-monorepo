'use strict';

/**
 * Live-selling settings helper.
 *
 * Stores the per-shop "I'm live-selling now" toggle + optional custom intent
 * keywords under shop.settings.live_selling — same JSON-on-shop pattern as
 * shop.settings.rto_network (see rto-network-settings.js). No schema migration:
 * deploy-safe whether or not the DB is wiped.
 *
 * Schema — shop.settings.live_selling:
 * {
 *   enabled:         boolean    // capture purchase-intent live comments as orders
 *   intent_keywords: string[]   // extra shop-specific buy signals beyond built-ins
 * }
 *
 * Default is OFF: live-selling capture is an explicit mode a seller turns on
 * before going live, so normal comment-to-DM behavior is never altered silently.
 */

const Shop = require('../shop/shop.entity');
const { AppError } = require('../../utils/AppError');

const DEFAULT_LIVE_SELLING_SETTINGS = {
  enabled: false,
  intent_keywords: [],
};

/**
 * Get live-selling settings for a shop, merged with defaults.
 * @param {string} shopId
 * @returns {Promise<{enabled:boolean, intent_keywords:string[]}>}
 */
const getLiveSellingSettings = async (shopId) => {
  const shop = await Shop.findByPk(shopId, { attributes: ['id', 'settings'] });
  if (!shop) return { ...DEFAULT_LIVE_SELLING_SETTINGS };
  const stored = shop.settings?.live_selling || {};
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : false,
    intent_keywords: Array.isArray(stored.intent_keywords) ? stored.intent_keywords : [],
  };
};

/**
 * Update live-selling settings (partial; preserves other settings keys).
 * @param {string} shopId
 * @param {{enabled?:boolean, intent_keywords?:string[]}} updates
 * @returns {Promise<{enabled:boolean, intent_keywords:string[]}>}
 */
const updateLiveSellingSettings = async (shopId, updates) => {
  const shop = await Shop.findByPk(shopId);
  if (!shop) throw new AppError('Shop not found', 404);

  const clean = {};
  if (typeof updates.enabled === 'boolean') clean.enabled = updates.enabled;
  if (Array.isArray(updates.intent_keywords)) {
    clean.intent_keywords = updates.intent_keywords
      .filter((k) => typeof k === 'string' && k.trim())
      .map((k) => k.trim())
      .slice(0, 50); // guard against unbounded growth
  }

  const currentSettings = shop.settings || {};
  const currentLive = currentSettings.live_selling || {};
  const newLive = { ...DEFAULT_LIVE_SELLING_SETTINGS, ...currentLive, ...clean };

  await shop.update({ settings: { ...currentSettings, live_selling: newLive } });
  return newLive;
};

module.exports = { getLiveSellingSettings, updateLiveSellingSettings, DEFAULT_LIVE_SELLING_SETTINGS };
