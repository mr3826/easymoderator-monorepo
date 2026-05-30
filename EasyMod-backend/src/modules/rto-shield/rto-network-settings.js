/**
 * RTO Network (shared fraud-shield) settings helper.
 *
 * Stores per-shop participation/consent for the cross-shop fraud network under
 * shop.settings.rto_network — same pattern as shop.settings.bd (see shop-bd-settings.js).
 *
 * Privacy framing (see acquisition audit + meta-policy): the network shares only a
 * normalized phone number's *delivery outcome history* (a courier-style return record),
 * never message content or other PII. Participation is opt-out per shop:
 *
 * Schema — shop.settings.rto_network:
 * {
 *   contribute: boolean   // this shop's delivery outcomes feed the shared network aggregate
 *   enforce:    boolean   // this shop's order flow honors global/network signals (not just its own list)
 * }
 *
 * Defaults are ON (the network is only useful at scale), but a shop can opt out of either side.
 */

const { Shop } = require('../shop/shop.entity');
const { AppError } = require('../../utils/AppError');

const DEFAULT_NETWORK_SETTINGS = {
  contribute: true,
  enforce: true
};

/**
 * Get RTO-network settings for a shop, merged with defaults.
 * @param {string} shopId
 * @returns {Promise<{contribute:boolean, enforce:boolean}>}
 */
const getNetworkSettings = async (shopId) => {
  const shop = await Shop.findByPk(shopId, { attributes: ['id', 'settings'] });
  if (!shop) return { ...DEFAULT_NETWORK_SETTINGS };
  return { ...DEFAULT_NETWORK_SETTINGS, ...(shop.settings?.rto_network || {}) };
};

/**
 * Update RTO-network settings (partial; preserves other settings keys).
 * @param {string} shopId
 * @param {{contribute?:boolean, enforce?:boolean}} updates
 * @returns {Promise<{contribute:boolean, enforce:boolean}>}
 */
const updateNetworkSettings = async (shopId, updates) => {
  const shop = await Shop.findByPk(shopId);
  if (!shop) throw new AppError('Shop not found', 404);

  const clean = {};
  if (typeof updates.contribute === 'boolean') clean.contribute = updates.contribute;
  if (typeof updates.enforce === 'boolean') clean.enforce = updates.enforce;

  const currentSettings = shop.settings || {};
  const currentNetwork = currentSettings.rto_network || {};
  const newNetwork = { ...DEFAULT_NETWORK_SETTINGS, ...currentNetwork, ...clean };

  await shop.update({ settings: { ...currentSettings, rto_network: newNetwork } });
  return newNetwork;
};

module.exports = { getNetworkSettings, updateNetworkSettings, DEFAULT_NETWORK_SETTINGS };
