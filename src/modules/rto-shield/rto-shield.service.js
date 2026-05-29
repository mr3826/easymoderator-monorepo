const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const RtoBlacklist = require('./rto-blacklist.entity');
const CustomerDeliveryStats = require('./customer-delivery-stats.entity');
const { normalizePhone, validatePhone } = require('../../utils/validators/phone.validator');

// Auto-flag threshold: ≥3 attempts AND ≥40% RTO rate
const AUTO_FLAG_MIN_ATTEMPTS = 3;
const AUTO_FLAG_RTO_RATE = 0.4;

// Thin wrapper — shared validator covers +88/88/01 prefix variants
const isValidBdPhone = (phone) => validatePhone(phone, 'BD_MOBILE_STRICT');

class RtoShieldService {
  /**
   * Check if a phone number is flagged.
   * Checks both tenant-specific and global blacklist entries.
   * @returns {{ flagged: boolean, reason: string|null, risk_score: number, entry: object|null }}
   */
  static async checkPhone(phone, shopId) {
    const normalized = normalizePhone(phone);
    if (!normalized || !isValidBdPhone(normalized)) {
      return { flagged: false, reason: null, risk_score: 0, entry: null };
    }

    const entry = await RtoBlacklist.findOne({
      where: {
        phone: normalized,
        [Op.or]: [
          { is_global: true },
          { shop_id: shopId }
        ]
      },
      order: [['risk_score', 'DESC']] // Return highest risk entry
    });

    if (!entry) {
      return { flagged: false, reason: null, risk_score: 0, entry: null };
    }

    return {
      flagged: entry.risk_score >= 70,
      reason: entry.reason,
      risk_score: entry.risk_score,
      entry: entry.toJSON()
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

    // Upsert: if phone + shop_id combo exists, update it
    const existing = await RtoBlacklist.findOne({
      where: {
        phone: normalized,
        shop_id: shop_id || null
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
