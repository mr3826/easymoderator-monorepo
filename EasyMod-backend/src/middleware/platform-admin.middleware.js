'use strict';

const { AppError } = require('../utils/AppError');
const cacheService = require('../utils/cache.service');
const { User } = require('../modules/entities');

const PLATFORM_ROLES = Object.freeze({
  SUPPORT_ADMIN: 'SUPPORT_ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
});

const ALL_ADMIN_ROLES = [PLATFORM_ROLES.SUPPORT_ADMIN, PLATFORM_ROLES.SUPER_ADMIN];
const ROLE_CACHE_TTL_SECONDS = 60;

/**
 * Resolve the caller's platform_role, cached 60s to avoid a SELECT per request.
 * Returns null for normal users. The cache stores the sentinel 'NONE' for a null
 * role so a revoked admin is locked out within the TTL even with a valid JWT.
 */
async function resolvePlatformRole(userId) {
  const cacheKey = `user:${userId}:platform_role`;
  const cached = await cacheService.get(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached === 'NONE' ? null : cached;
  }
  const user = await User.findByPk(userId, { attributes: ['platform_role'] });
  const role = user?.platform_role || null;
  await cacheService.set(cacheKey, role || 'NONE', ROLE_CACHE_TTL_SECONDS);
  return role;
}

/**
 * Guard: require the caller to hold one of `allowedRoles` (default: any admin).
 * Must run AFTER `authenticate` (needs req.user.userId).
 *
 * Usage:
 *   router.use(authenticate, requirePlatformAdmin());                     // reads
 *   router.patch('/x', requirePlatformAdmin(PLATFORM_ROLES.SUPER_ADMIN)); // mutations
 */
function requirePlatformAdmin(...allowedRoles) {
  const allowed = allowedRoles.length ? allowedRoles : ALL_ADMIN_ROLES;
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new AppError('Authentication required.', 401);
      }
      const role = await resolvePlatformRole(userId);
      if (!role || !allowed.includes(role)) {
        throw new AppError('Forbidden: platform admin access required.', 403);
      }
      req.platformRole = role;
      next();
    } catch (err) {
      next(err instanceof AppError ? err : new AppError('Authorization failed.', 403));
    }
  };
}

module.exports = { requirePlatformAdmin, resolvePlatformRole, PLATFORM_ROLES, ALL_ADMIN_ROLES };
