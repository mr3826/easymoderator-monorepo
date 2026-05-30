const { fn, col } = require('sequelize');
const { Shop } = require('../entities');
const Referral = require('./referral.entity');
const subscriptionService = require('../subscription/subscription.service');
const { createLogger } = require('../../utils/structured-logger');

// ── Reward config ──────────────────────────────────────────────────────────
// Both sides earn bonus conversations the moment a referred shop signs up.
const REFERRER_REWARD = 50; // conversations the inviter earns per activated shop
const REFERRED_REWARD = 50; // conversations the new shop starts with as a welcome

const logger = createLogger('referral-service');

/**
 * Normalize a referral code: trim + uppercase (shop unique_codes are uppercase).
 */
const normalizeCode = (code) => (typeof code === 'string' ? code.trim().toUpperCase() : '');

/**
 * Record a referral at signup and reward BOTH shops.
 *
 * Idempotent per referred shop (unique constraint on referred_shop_id). Safe to
 * call non-fatally from the signup flow — any error is swallowed by the caller.
 *
 * @param {Object} args
 * @param {string} args.code            - Referral code entered at signup (referrer unique_code)
 * @param {string} args.referredShopId  - Newly created shop UUID
 * @param {string} [args.referredUserId]- Newly created user UUID
 * @returns {Promise<Referral|null>} the referral row, or null if not applied
 */
const recordReferral = async ({ code, referredShopId, referredUserId }) => {
  const normalized = normalizeCode(code);
  if (!normalized || !referredShopId) return null;

  // Resolve the referrer shop by its unique_code
  const referrerShop = await Shop.findOne({ where: { unique_code: normalized } });
  if (!referrerShop) {
    logger.warn('Referral code did not match any shop', { code: normalized });
    return null;
  }

  // A shop cannot refer itself
  if (referrerShop.id === referredShopId) return null;

  // Guard against duplicate referral for the same new shop
  const existing = await Referral.findOne({ where: { referred_shop_id: referredShopId } });
  if (existing) return existing;

  const referral = await Referral.create({
    referrer_shop_id: referrerShop.id,
    referred_shop_id: referredShopId,
    referred_user_id: referredUserId || null,
    code: normalized,
    status: 'rewarded',
    referrer_reward: REFERRER_REWARD,
    referred_reward: REFERRED_REWARD,
    rewarded_at: new Date()
  });

  // Reward both sides — non-fatal if a subscription row is missing
  await subscriptionService
    .grantBonusConversations(referrerShop.id, REFERRER_REWARD, 'referral_reward')
    .catch((e) => logger.error('Failed to reward referrer', { error: e.message }));
  await subscriptionService
    .grantBonusConversations(referredShopId, REFERRED_REWARD, 'referral_welcome')
    .catch((e) => logger.error('Failed to reward referred shop', { error: e.message }));

  logger.info('Referral recorded and rewarded', {
    referrerShopId: referrerShop.id,
    referredShopId,
    code: normalized
  });

  return referral;
};

/**
 * Get a shop's referral dashboard data: its shareable code + lifetime stats.
 *
 * @param {string} shopId
 * @returns {Promise<{ code: string|null, total_referrals: number, conversations_earned: number }>}
 */
const getReferralStats = async (shopId) => {
  const shop = await Shop.findByPk(shopId, { attributes: ['id', 'unique_code'] });
  if (!shop) return { code: null, total_referrals: 0, conversations_earned: 0 };

  const stats = await Referral.findOne({
    where: { referrer_shop_id: shopId },
    attributes: [
      [fn('COUNT', col('id')), 'total_referrals'],
      [fn('COALESCE', fn('SUM', col('referrer_reward')), 0), 'conversations_earned']
    ],
    raw: true
  });

  return {
    code: shop.unique_code,
    total_referrals: parseInt(stats?.total_referrals, 10) || 0,
    conversations_earned: parseInt(stats?.conversations_earned, 10) || 0
  };
};

/**
 * Validate a referral code without consuming it (for the signup screen's
 * "invited by" confirmation). Returns the referrer shop name if valid.
 *
 * @param {string} code
 * @returns {Promise<{ valid: boolean, shop_name: string|null }>}
 */
const lookupCode = async (code) => {
  const normalized = normalizeCode(code);
  if (!normalized) return { valid: false, shop_name: null };

  const shop = await Shop.findOne({
    where: { unique_code: normalized },
    attributes: ['id', 'shop_name', 'name']
  });
  if (!shop) return { valid: false, shop_name: null };

  return { valid: true, shop_name: shop.shop_name || shop.name || null };
};

module.exports = {
  recordReferral,
  getReferralStats,
  lookupCode
};

module.exports.REWARDS = { REFERRER_REWARD, REFERRED_REWARD };
