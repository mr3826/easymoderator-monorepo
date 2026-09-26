'use strict';

const { AppError } = require('../../utils/AppError');
const config = require('../../config/config');
const { cacheRedis } = require('../../config/redis');
const cacheService = require('../../utils/cache.service');
const repository = require('./growth-os.repository');
const {
  getPermissionsForRole,
  hasPermission,
  resolveCanonicalRole,
  MFA_REQUIRED_ROLES,
} = require('./growth-os.permissions');

const ROLE_CACHE_TTL_SECONDS = 60;
const REDIS_PROBE_TIMEOUT_MS = 1000;

async function assertGrowthOsRuntimeReady() {
  // Growth authorization may not silently fall back to a process-local cache
  // in a deployed environment. A stale allow on one instance could survive a
  // role revocation on another instance while Redis is unavailable.
  if (config.env === 'development') return;
  if (!cacheRedis || cacheRedis._isMemoryFallback === true) {
    throw new AppError(
      'Growth OS authorization cache is temporarily unavailable.',
      503,
      'GROWTH_OS_REDIS_UNAVAILABLE',
    );
  }

  if (cacheRedis.status !== 'ready') {
    let timeoutId;
    try {
      if (typeof cacheRedis.ping !== 'function') throw new Error('Redis probe unavailable');
      const probe = Promise.resolve().then(() => cacheRedis.ping());
      const timeout = new Promise((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Redis probe timed out')), REDIS_PROBE_TIMEOUT_MS);
        timeoutId.unref?.();
      });
      await Promise.race([probe, timeout]);
    } catch (_error) {
      throw new AppError(
        'Growth OS authorization cache is temporarily unavailable.',
        503,
        'GROWTH_OS_REDIS_UNAVAILABLE',
      );
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  if (cacheRedis.status !== 'ready') {
    throw new AppError(
      'Growth OS authorization cache is temporarily unavailable.',
      503,
      'GROWTH_OS_REDIS_UNAVAILABLE',
    );
  }
}

async function resolveGrowthOsAccess(userId) {
  if (!userId) return null;

  await assertGrowthOsRuntimeReady();

  const cacheKey = `growth-os:user:${userId}:role`;
  const readRoleCache = config.env === 'development' ? cacheService.get : cacheService.getStrict;
  const writeRoleCache = config.env === 'development' ? cacheService.set : cacheService.setStrict;
  const cached = await readRoleCache.call(cacheService, cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached === 'NONE' ? null : buildAccess(cached);
  }

  const roleRecord = await repository.findActiveRoleForUser(userId);
  const role = roleRecord?.role || null;
  await writeRoleCache.call(cacheService, cacheKey, role || 'NONE', ROLE_CACHE_TTL_SECONDS);

  return role ? buildAccess(role) : null;
}

function buildAccess(rawRole) {
  const canonical = resolveCanonicalRole(rawRole);
  if (!canonical) return null;
  return {
    role: canonical,
    rawRole,
    permissions: getPermissionsForRole(rawRole),
  };
}

function getInitialBootstrapState(user) {
  if (user?.bootstrapOperator !== true) return null;
  return user.mfaVerified === true ? 'pending' : 'mfa-required';
}

function requireGrowthOsAccess(requiredPermission = 'growth_os.session.read') {
  return async (req, _res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new AppError('Authentication required.', 401, 'AUTH_REQUIRED');
      }

      if (!config.growthOsEnabled) {
        throw new AppError('Growth OS is temporarily unavailable.', 503, 'GROWTH_OS_DISABLED');
      }

      const access = await resolveGrowthOsAccess(userId);
      const permissionRole = access?.rawRole || access?.role;
      const hasRequiredPermission = typeof requiredPermission === 'function'
        ? requiredPermission(access)
        : (Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission])
          .some((permission) => hasPermission(permissionRole, permission));
      if (!access || !hasRequiredPermission) {
        if (!access) {
          const bootstrapState = getInitialBootstrapState(req.user);
          if (bootstrapState === 'password-change-required') {
            throw new AppError(
              'The initial Growth OS administrator must complete password rotation first.',
              403,
              'GROWTH_OS_BOOTSTRAP_PASSWORD_CHANGE_REQUIRED',
            );
          }
          if (bootstrapState === 'mfa-required') {
            throw new AppError(
              'The initial Growth OS administrator must enroll MFA first.',
              403,
              'GROWTH_OS_BOOTSTRAP_MFA_REQUIRED',
            );
          }
          if (bootstrapState === 'pending') {
            throw new AppError(
              'The initial Growth OS administrator is ready for the audited role grant.',
              403,
              'GROWTH_OS_BOOTSTRAP_PENDING',
            );
          }
        }
        throw new AppError('Forbidden: Growth OS access required.', 403, 'GROWTH_OS_FORBIDDEN');
      }

      // Internal Growth identities are global and must never carry a merchant
      // shop session. Merchant context is authorized by the merchant stack,
      // not by Growth OS role permissions.
      if (req.user.shopId) {
        throw new AppError(
          'Growth OS requests cannot carry merchant shop context.',
          403,
          'GROWTH_OS_MERCHANT_CONTEXT_FORBIDDEN',
        );
      }

      // Growth roles are global internal roles. Require an authentication
      // assurance claim for the roles that can view or mutate broad operating
      // data; merchant/frontend claims are never accepted here. The raw
      // (possibly legacy) role is checked too so alias mapping never becomes
      // an MFA-assurance downgrade.
      const requiresMfa = MFA_REQUIRED_ROLES.has(access.role)
        || MFA_REQUIRED_ROLES.has(access.rawRole);
      if (requiresMfa && req.user.mfaVerified !== true) {
        throw new AppError(
          'Multi-factor authentication is required for this Growth OS role.',
          403,
          'GROWTH_OS_MFA_REQUIRED',
        );
      }

      req.growthOs = access;
      next();
    } catch (err) {
      next(err instanceof AppError
        ? err
        : new AppError(
          'Growth OS authorization service is temporarily unavailable.',
          503,
          'GROWTH_OS_AUTHZ_UNAVAILABLE',
        ));
    }
  };
}

module.exports = {
  resolveGrowthOsAccess,
  requireGrowthOsAccess,
};
