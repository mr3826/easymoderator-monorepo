'use strict';

const { AppError } = require('../../utils/AppError');
const cacheService = require('../../utils/cache.service');
const repository = require('./growth-os.repository');
const { getPermissionsForRole, hasPermission } = require('./growth-os.permissions');

const ROLE_CACHE_TTL_SECONDS = 60;

async function resolveGrowthOsAccess(userId) {
  if (!userId) return null;

  const cacheKey = `growth-os:user:${userId}:role`;
  const cached = await cacheService.get(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached === 'NONE'
      ? null
      : { role: cached, permissions: getPermissionsForRole(cached) };
  }

  const roleRecord = await repository.findActiveRoleForUser(userId);
  const role = roleRecord?.role || null;
  await cacheService.set(cacheKey, role || 'NONE', ROLE_CACHE_TTL_SECONDS);

  return role ? { role, permissions: getPermissionsForRole(role) } : null;
}

function requireGrowthOsAccess(requiredPermission = 'growth_os.session.read') {
  return async (req, _res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new AppError('Authentication required.', 401, 'AUTH_REQUIRED');
      }

      const access = await resolveGrowthOsAccess(userId);
      if (!access || !hasPermission(access.role, requiredPermission)) {
        throw new AppError('Forbidden: Growth OS access required.', 403, 'GROWTH_OS_FORBIDDEN');
      }

      req.growthOs = access;
      next();
    } catch (err) {
      next(err instanceof AppError ? err : new AppError('Growth OS authorization failed.', 403, 'GROWTH_OS_AUTHZ_FAILED'));
    }
  };
}

module.exports = {
  resolveGrowthOsAccess,
  requireGrowthOsAccess,
};
