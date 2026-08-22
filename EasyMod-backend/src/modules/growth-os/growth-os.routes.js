'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { authenticate } = require('../../middleware/auth.middleware');
const validate = require('../../middleware/validate.middleware');
const { AppError } = require('../../utils/AppError');
const { requireGrowthOsAccess } = require('./growth-os.middleware');
const { hasProspectReadAccess } = require('./growth-os.prospect.scope');
const ctrl = require('./growth-os.controller');
const roleCtrl = require('./growth-os.roles.controller');
const prospectCtrl = require('./growth-os.prospect.controller');
const prospectValidator = require('./growth-os.prospect.validator');

const router = express.Router();

const prospectMutationPermissions = [
  'growth_os.prospects.manage_all',
  'growth_os.prospects.update_assigned',
];

function validateProspect(schema) {
  const middleware = validate(schema);
  return (req, res, next) => middleware(req, res, (error) => {
    if (error instanceof AppError && error.code === 'INTERNAL_ERROR') {
      error.code = 'GROWTH_OS_PROSPECT_INVALID_INPUT';
      error.status = 400;
    }
    next(error);
  });
}

function buildRateLimitStore(prefix) {
  try {
    const { rateLimitRedis } = require('../../config/redis');
    if (rateLimitRedis && rateLimitRedis._isMemoryFallback !== true
      && typeof rateLimitRedis.call === 'function') {
      return new RedisStore({
        prefix,
        sendCommand: (...args) => rateLimitRedis.call(...args),
      });
    }
  } catch (_error) {
    // Express's unit-process MemoryStore is the safe fallback.
  }
  return undefined;
}

const prospectLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildRateLimitStore('rl:growth-os:prospects:'),
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many Growth OS prospect lookups. Please try again later.',
  },
});

router.use(authenticate, requireGrowthOsAccess());
router.get('/session', ctrl.getSession);
router.post('/roles', requireGrowthOsAccess('growth_os.roles.manage'), roleCtrl.grantRole);
router.delete('/roles/:userId', requireGrowthOsAccess('growth_os.roles.manage'), roleCtrl.revokeRole);

router.get(
  '/prospects',
  requireGrowthOsAccess(hasProspectReadAccess),
  validateProspect(prospectValidator.listProspects),
  prospectCtrl.listProspects,
);

router.post(
  '/prospects',
  requireGrowthOsAccess('growth_os.prospects.manage_all'),
  validateProspect(prospectValidator.createProspect),
  prospectCtrl.createProspect,
);

router.get(
  '/prospects/duplicate-check',
  prospectLookupLimiter,
  requireGrowthOsAccess(hasProspectReadAccess),
  validateProspect(prospectValidator.duplicateCheck),
  prospectCtrl.checkDuplicates,
);

router.get(
  '/prospects/:id',
  requireGrowthOsAccess(hasProspectReadAccess),
  validateProspect(prospectValidator.idParams),
  prospectCtrl.getProspect,
);

router.patch(
  '/prospects/:id',
  requireGrowthOsAccess(prospectMutationPermissions),
  validateProspect(prospectValidator.updateProspect),
  prospectCtrl.updateProspect,
);

router.post(
  '/prospects/:id/status',
  requireGrowthOsAccess(prospectMutationPermissions),
  validateProspect(prospectValidator.transitionProspect),
  prospectCtrl.transitionProspect,
);

router.post(
  '/prospects/:id/assign',
  requireGrowthOsAccess('growth_os.prospects.manage_all'),
  validateProspect(prospectValidator.assignProspect),
  prospectCtrl.assignProspect,
);

router.post(
  '/prospects/:id/link',
  requireGrowthOsAccess('growth_os.prospects.manage_all'),
  validateProspect(prospectValidator.linkProspect),
  prospectCtrl.linkProspect,
);

router.get(
  '/prospects/:id/linkage-suggestions',
  prospectLookupLimiter,
  requireGrowthOsAccess('growth_os.prospects.manage_all'),
  validateProspect(prospectValidator.linkageSuggestions),
  prospectCtrl.linkageSuggestions,
);

router.post(
  '/prospects/:id/merge',
  requireGrowthOsAccess('growth_os.prospects.manage_all'),
  validateProspect(prospectValidator.mergeProspect),
  prospectCtrl.mergeProspect,
);

module.exports = router;
