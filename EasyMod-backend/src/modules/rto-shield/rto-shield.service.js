const { v4: uuidv4 } = require('uuid');
const { Op, fn, col } = require('sequelize');
const RtoBlacklist = require('./rto-blacklist.entity');
const CustomerDeliveryStats = require('./customer-delivery-stats.entity');
const { normalizePhone, validatePhone } = require('../../utils/validators/phone.validator');

// Per-shop auto-flag threshold: ≥3 attempts AND ≥40% RTO rate (single shop's own list)
const AUTO_FLAG_MIN_ATTEMPTS = 3;
const AUTO_FLAG_RTO_RATE = 0.4;

// Network (cross-shop) auto-promotion threshold. A phone is promoted to a GLOBAL
// fraud signal only when MULTIPLE independent shops have bad outcomes — so no single
// shop can blacklist a customer for everyone. This is what makes the shield a network:
// it gets stronger as more shops join.
const NETWORK_MIN_SHOPS = 3;       // reported by at least this many distinct shops
const NETWORK_MIN_ATTEMPTS = 5;    // across at least this many total delivery attempts
const NETWORK_RTO_RATE = 0.5;      // and at least this aggregate RTO rate

// Risk tiers surfaced to the order flow / inbox.
const TIER_BLOCK = 'block';    // risk_score ≥ 70 → COD blocked at the order gate
const TIER_VERIFY = 'verify';  // 50–69, or a strong network signal → allow but verify manually
const TIER_CLEAR = 'clear';    // safe
const BLOCK_SCORE = 70;
const VERIFY_SCORE = 50;

// Sentinel reason marking a per-shop whitelist (appeal) override.
const WHITELIST_REASON = 'WHITELIST_APPEAL';

// Thin wrapper — shared validator covers +88/88/01 prefix variants
const isValidBdPhone = (phone) => validatePhone(phone, 'BD_MOBILE_STRICT');

/**
 * Map a numeric risk score (and optional network signal) to a tier.
 */
const classifyTier = (riskScore, network) => {
  if (riskScore >= BLOCK_SCORE) return TIER_BLOCK;
  if (riskScore >= VERIFY_SCORE) return TIER_VERIFY;
  // Even with no formal blacklist entry, a strong cross-shop signal warrants manual verification.
  if (network && network.shops_reported >= 2 && network.total_attempts >= NETWORK_MIN_ATTEMPTS
      && network.rto_rate >= NETWORK_RTO_RATE) {
    return TIER_VERIFY;
  }
  return TIER_CLEAR;
};

class RtoShieldService {
  /**
   * Cross-shop ("network") delivery signal for a phone, aggregated over every shop's
   * per-shop CustomerDeliveryStats. This is the network moat: a phone that burns many
   * shops carries a signal none of them could see alone. No PII beyond the phone is shared.
   * @returns {{ shops_reported:number, total_attempts:number, total_rtos:number, rto_rate:number }}
   */
  static async getNetworkStats(phone, requestingShopId = null) {
    const normalized = normalizePhone(phone);
    if (!normalized || !isValidBdPhone(normalized)) {
      return { shops_reported: 0, total_attempts: 0, total_rtos: 0, rto_rate: 0 };
    }

    // A tenant may only ask for a network signal for a phone already present
    // in that tenant's own delivery history. This keeps the cross-shop
    // aggregate useful for an active order while preventing arbitrary phone
    // number probing through the authenticated endpoint.
    if (requestingShopId) {
      const localRecord = await CustomerDeliveryStats.findOne({
        where: { phone: normalized, shop_id: requestingShopId },
        attributes: ['id'],
        raw: true,
      });
      if (!localRecord) {
        return { shops_reported: 0, total_attempts: 0, total_rtos: 0, rto_rate: 0 };
      }
    }

    const row = await CustomerDeliveryStats.findOne({
      where: { phone: normalized },
      attributes: [
        [fn('COUNT', fn('DISTINCT', col('shop_id'))), 'shops_reported'],
        [fn('COALESCE', fn('SUM', col('delivery_attempts')), 0), 'total_attempts'],
        [fn('COALESCE', fn('SUM', col('rto_count')), 0), 'total_rtos']
      ],
      raw: true
    });

    const shops = parseInt(row?.shops_reported, 10) || 0;
    const attempts = parseInt(row?.total_attempts, 10) || 0;
    const rtos = parseInt(row?.total_rtos, 10) || 0;
    return {
      shops_reported: shops,
      total_attempts: attempts,
      total_rtos: rtos,
      rto_rate: attempts > 0 ? rtos / attempts : 0
    };
  }

  /**
   * Check a phone against the per-shop + global blacklist AND the cross-shop network signal.
   * Backward compatible: still returns { flagged, reason, risk_score, entry }.
   * Adds { tier, network } for the order flow / inbox risk surface.
   *
   * @param {string} phone
   * @param {string} shopId
   * @param {object} [opts]
   * @param {boolean} [opts.enforceNetwork=true] - when false, ignore global/network signals
   *        (the shop has opted out of the shared network and relies only on its own list).
   */
  static async checkPhone(phone, shopId, opts = {}) {
    const enforceNetwork = opts.enforceNetwork !== false;
    const normalized = normalizePhone(phone);
    const empty = { flagged: false, reason: null, risk_score: 0, tier: TIER_CLEAR, entry: null, network: null };
    if (!normalized || !isValidBdPhone(normalized)) {
      return empty;
    }

    // Appeal/whitelist override: if this shop has explicitly cleared the customer, trust it.
    const whitelisted = await RtoBlacklist.findOne({
      where: { phone: normalized, shop_id: shopId, reason: WHITELIST_REASON }
    });
    if (whitelisted) {
      return { ...empty, network: enforceNetwork ? await RtoShieldService.getNetworkStats(normalized, shopId) : null };
    }

    // Blacklist entries: always the shop's own; global only when the shop enforces the network.
    const phoneFilter = enforceNetwork
      ? { [Op.or]: [{ is_global: true }, { shop_id: shopId }] }
      : { shop_id: shopId };

    const entry = await RtoBlacklist.findOne({
      where: { phone: normalized, reason: { [Op.ne]: WHITELIST_REASON }, ...phoneFilter },
      order: [['risk_score', 'DESC']] // Return highest risk entry
    });

    const network = enforceNetwork ? await RtoShieldService.getNetworkStats(normalized, shopId) : null;
    const riskScore = entry ? entry.risk_score : 0;
    const tier = classifyTier(riskScore, network);

    return {
      flagged: riskScore >= BLOCK_SCORE,
      reason: entry ? entry.reason : (tier === TIER_VERIFY ? 'Elevated cross-shop return history' : null),
      risk_score: riskScore,
      tier,
      entry: entry ? entry.toJSON() : null,
      network
    };
  }

  /**
   * Add a phone number to the blacklist.
   */
  static async addToBlacklist({ phone, reason, risk_score = 80, is_global = false, shop_id, added_by, notes }) {
    const normalized = normalizePhone(phone);
    if (!normalized || !isValidBdPhone(normalized)) {
      throw new Error(`Invalid Bangladeshi phone number: ${phone}`);
    }

    // Upsert: if phone + shop_id combo exists, update it.
    // Exclude whitelist (appeal) sentinels so an allow-override and a block can coexist.
    const existing = await RtoBlacklist.findOne({
      where: {
        phone: normalized,
        shop_id: shop_id || null,
        reason: { [Op.ne]: WHITELIST_REASON }
      }
    });

    if (existing) {
      await existing.update({ reason, risk_score, notes, added_by });
      return existing;
    }

    return await RtoBlacklist.create({
      id: uuidv4(),
      phone: normalized,
      reason,
      risk_score,
      is_global: Boolean(is_global),
      shop_id: shop_id || null,
      added_by: added_by || null,
      notes: notes || null
    });
  }

  /**
   * Remove an entry from the blacklist.
   * Tenants can only remove their own entries (not global ones).
   */
  static async removeFromBlacklist(id, shopId) {
    const entry = await RtoBlacklist.findOne({ where: { id } });
    if (!entry) throw new Error('Blacklist entry not found');
    if (entry.is_global) throw new Error('Cannot delete a global blacklist entry via shop API');
    if (entry.shop_id !== shopId) throw new Error('Access denied: entry belongs to a different shop');
    await entry.destroy();
    return { success: true, id };
  }

  /**
   * List blacklist entries for a shop (own + global).
   */
  static async listBlacklist({ shopId, page = 1, limit = 20, search }) {
    const offset = (page - 1) * limit;
    const where = {
      reason: { [Op.ne]: WHITELIST_REASON }, // hide appeal/whitelist sentinels from the blacklist view
      [Op.or]: [{ is_global: true }, { shop_id: shopId }]
    };

    if (search) {
      where[Op.and] = [{
        [Op.or]: [
          { phone: { [Op.like]: `%${search}%` } },
          { reason: { [Op.like]: `%${search}%` } }
        ]
      }];
    }

    const { count, rows } = await RtoBlacklist.findAndCountAll({
      where,
      order: [['risk_score', 'DESC'], ['created_at', 'DESC']],
      limit,
      offset
    });

    return {
      data: rows,
      pagination: { total: count, page, limit, total_pages: Math.ceil(count / limit) }
    };
  }

  /**
   * Record a delivery outcome and auto-update risk score when RTO rate crosses threshold.
   * Called by the delivery webhook handler for delivered / returned / failed_delivery statuses.
   * @param {string} phone - Customer phone (any BD format)
   * @param {string} shopId - Shop UUID
   * @param {boolean} isRto - true = failed/returned; false = successful delivery
   */
  static async trackDeliveryOutcome(phone, shopId, isRto) {
    const normalized = normalizePhone(phone);
    if (!normalized || !isValidBdPhone(normalized)) return;

    const [stats] = await CustomerDeliveryStats.findOrCreate({
      where: { phone: normalized, shop_id: shopId },
      defaults: { id: uuidv4(), phone: normalized, shop_id: shopId }
    });

    const updates = { delivery_attempts: stats.delivery_attempts + 1 };
    if (isRto) {
      updates.rto_count = stats.rto_count + 1;
      updates.last_rto_at = new Date();
    } else {
      updates.last_delivered_at = new Date();
    }
    await stats.update(updates);

    const newAttempts = updates.delivery_attempts;
    const newRtoCount = isRto ? updates.rto_count : stats.rto_count;
    const rtoRate = newRtoCount / newAttempts;

    if (newAttempts >= AUTO_FLAG_MIN_ATTEMPTS && rtoRate >= AUTO_FLAG_RTO_RATE) {
      const riskScore = Math.min(100, Math.round(rtoRate * 100));
      await RtoShieldService.addToBlacklist({
        phone: normalized,
        reason: `Auto-flagged: ${newRtoCount} RTOs out of ${newAttempts} deliveries`,
        risk_score: riskScore,
        is_global: false,
        shop_id: shopId
      });
    }

    // Cross-shop network promotion — only RTO outcomes can strengthen the shared signal.
    if (isRto) {
      try {
        require('../analytics/funnel-events.service')
          .recordFunnelEvent({
            event: 'first_rto_flag',
            shopId,
            onceKey: shopId,
            metadata: {
              delivery_attempts: newAttempts,
              rto_count: newRtoCount,
              risk_score: Math.min(100, Math.round(rtoRate * 100)),
            },
          })
          .catch(() => {});
      } catch (_) { /* funnel logging must never block RTO tracking */ }
      await RtoShieldService.evaluateNetworkPromotion(normalized).catch(() => {});
    }
  }

  /**
   * Evaluate the cross-shop aggregate for a phone and, when it clears the network
   * thresholds (≥N distinct shops, ≥M attempts, ≥rate), promote it to a GLOBAL fraud
   * signal visible to every shop. Idempotent: re-runs only refresh the existing global entry.
   */
  static async evaluateNetworkPromotion(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized || !isValidBdPhone(normalized)) return null;

    const network = await RtoShieldService.getNetworkStats(normalized);
    if (network.shops_reported < NETWORK_MIN_SHOPS
        || network.total_attempts < NETWORK_MIN_ATTEMPTS
        || network.rto_rate < NETWORK_RTO_RATE) {
      return null;
    }

    const riskScore = Math.min(100, Math.round(network.rto_rate * 100));
    const reason = `Network fraud signal: ${network.total_rtos} RTOs / ${network.total_attempts} deliveries across ${network.shops_reported} shops`;

    const existingGlobal = await RtoBlacklist.findOne({
      where: { phone: normalized, is_global: true }
    });
    if (existingGlobal) {
      // Never downgrade a manually-set high score; keep the higher of the two.
      await existingGlobal.update({ reason, risk_score: Math.max(existingGlobal.risk_score, riskScore) });
      return existingGlobal;
    }

    return RtoBlacklist.create({
      id: uuidv4(),
      phone: normalized,
      reason,
      risk_score: riskScore,
      is_global: true,
      shop_id: null,
      added_by: null,
      notes: 'Auto-promoted by cross-shop network aggregation'
    });
  }

  /**
   * Appeal / whitelist path: a shop vouches for a customer, overriding blacklist + network
   * signals for that shop only. Global entries remain (other shops still see the signal),
   * but this shop's order flow will treat the customer as clear. Upserts a sentinel entry.
   */
  static async whitelistPhone({ phone, shop_id, added_by, notes }) {
    const normalized = normalizePhone(phone);
    if (!normalized || !isValidBdPhone(normalized)) {
      throw new Error(`Invalid Bangladeshi phone number: ${phone}`);
    }
    if (!shop_id) throw new Error('shop_id is required to whitelist a customer');

    const existing = await RtoBlacklist.findOne({
      where: { phone: normalized, shop_id, reason: WHITELIST_REASON }
    });
    if (existing) {
      await existing.update({ notes: notes || existing.notes, added_by });
      return existing;
    }

    return RtoBlacklist.create({
      id: uuidv4(),
      phone: normalized,
      reason: WHITELIST_REASON,
      risk_score: 0,
      is_global: false,
      shop_id,
      added_by: added_by || null,
      notes: notes || 'Shop vouched for this customer (appeal)'
    });
  }

  /**
   * Bulk import phone numbers to the blacklist.
   */
  static async bulkImport(entries, shopId, addedBy) {
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const entry of entries) {
      try {
        await RtoShieldService.addToBlacklist({
          ...entry,
          shop_id: shopId,
          added_by: addedBy
        });
        imported++;
      } catch (err) {
        skipped++;
        errors.push({ phone: entry.phone, error: err.message });
      }
    }

    return { imported, skipped, errors };
  }
}

module.exports = RtoShieldService;
module.exports.THRESHOLDS = {
  AUTO_FLAG_MIN_ATTEMPTS,
  AUTO_FLAG_RTO_RATE,
  NETWORK_MIN_SHOPS,
  NETWORK_MIN_ATTEMPTS,
  NETWORK_RTO_RATE,
  BLOCK_SCORE,
  VERIFY_SCORE
};
module.exports.TIERS = { TIER_BLOCK, TIER_VERIFY, TIER_CLEAR };
module.exports.WHITELIST_REASON = WHITELIST_REASON;
