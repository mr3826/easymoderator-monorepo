const express = require('express');
const Joi = require('joi');
const { authenticate } = require('../../middleware/auth.middleware');
const { verifyShopAccess } = require('../../middleware/shop-access.middleware');
const ReferralController = require('./referral.controller');

const router = express.Router();

// Inline Joi validation helper (query only here)
const validateQuery = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.query, { abortEarly: false, allowUnknown: false });
  if (error) {
    return res.status(400).json({
      success: false,
      errors: error.details.map((d) => ({ field: d.path.join('.'), message: d.message }))
    });
  }
  req.query = value;
  next();
};

const codeQuerySchema = Joi.object({
  code: Joi.string().trim().max(20).required()
});

// Public — used by the signup screen to confirm an invite code before the user
// has an account. No data is mutated; only the referrer shop name is returned.
router.get('/validate', validateQuery(codeQuerySchema), ReferralController.validateCode);

// Authenticated — the shop's own referral dashboard.
router.get('/me', authenticate, verifyShopAccess, ReferralController.getMyReferral);

module.exports = router;
