const referralService = require('./referral.service');

const resolveShopId = (req) => req.shop?.id || req.user?.shopId;

/**
 * GET /api/referral/me
 * Returns the authenticated shop's referral code, share stats, and reward config.
 */
const getMyReferral = async (req, res, next) => {
  try {
    const shopId = resolveShopId(req);
    const stats = await referralService.getReferralStats(shopId);
    res.status(200).json({
      success: true,
      data: {
        ...stats,
        rewards: referralService.REWARDS
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/referral/validate?code=ABC123
 * Public-ish (still authed): confirm a code resolves to a real shop for the
 * signup "invited by" hint. Does not consume the code.
 */
const validateCode = async (req, res, next) => {
  try {
    const result = await referralService.lookupCode(req.query.code);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMyReferral,
  validateCode
};
