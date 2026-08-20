'use strict';

const { AppError } = require('../../utils/AppError');
const config = require('../../config/config');
const { cacheRedis } = require('../../config/redis');
const cacheService = require('../../utils/cache.service');
const repository = require('./growth-os.repository');
const { getPermissionsForRole, hasPermission } = require('./growth-os.permissions');

const ROLE_CACHE_TTL_SECONDS = 60;
const REDIS_PROBE_TIMEOUT_MS = 1000;
const MFA_REQUIRED_ROLES = new Set(['FOUNDER', 'GROWTH_MANAGER']);

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
  const cached = await cacheService.getStrict(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached === 'NONE'
      ? null
      : { role: cached, permissions: getPermissionsForRole(cached) };
  }

  const roleRecord = await repository.findActiveRoleForUser(userId);
  const role = roleRecord?.role || null;
  await cacheService.setStrict(cacheKey, role || 'NONE', ROLE_CACHE_TTL_SECONDS);

  return role ? { role, permissions: getPermissionsForRole(role) } : null;
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
      const requiredPermissions = Array.isArray(requiredPermission)
        ? requiredPermission
        : [requiredPermission];
      const hasRequiredPermission = requiredPermissions.some((permission) => (
        hasPermission(access?.role, permission)
      ));
      if (!access || !hasRequiredPermission) {
        throw new AppError('Forbidden: Growth OS access required.', 403, 'GROWTH_OS_FORBIDDEN');
      }

      // Growth roles are global internal roles. Require an authentication
      // assurance claim for the roles that can view or mutate broad operating
      // data; merchant/frontend claims are never accepted here.
      if (MFA_REQUIRED_ROLES.has(access.role) && req.user.mfaVerified !== true) {
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
