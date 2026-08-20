'use strict';

const { Op } = require('sequelize');
const { validate: isUuid } = require('uuid');
const cacheService = require('../../utils/cache.service');
const { AppError } = require('../../utils/AppError');
const { GROWTH_OS_ROLES, isGrowthOsRole } = require('./growth-os.permissions');

const ROLE_CACHE_TTL_SECONDS = 60;
const MAX_REASON_LENGTH = 200;

function assertUuid(value, fieldName) {
  if (!isUuid(String(value || ''))) {
    throw new AppError(`${fieldName} must be a valid user id.`, 400, 'GROWTH_OS_INVALID_USER_ID');
  }
}

function normalizeReason(reason) {
  const normalized = typeof reason === 'string' ? reason.trim() : '';
  if (!normalized || normalized.length > MAX_REASON_LENGTH) {
    throw new AppError(
      `reason is required and must be ${MAX_REASON_LENGTH} characters or fewer.`,
      400,
      'GROWTH_OS_INVALID_REASON',
    );
  }
  return normalized;
}

function roleCacheKey(userId) {
  return `growth-os:user:${userId}:role`;
}

async function invalidateRoleCache(userId, transaction) {
  try {
    const deleted = await cacheService.delete(roleCacheKey(userId));
    if (deleted !== true) {
      throw new Error('role cache deletion was not confirmed');
    }
  } catch (_error) {
    // The cache is part of the authorization decision. Roll the role change
    // back when it cannot be invalidated, so a stale allow cannot survive a
    // successful mutation.
    throw new AppError(
      'Growth OS authorization cache is temporarily unavailable.',
      503,
      'GROWTH_OS_AUTHZ_CACHE_UNAVAILABLE',
      { transaction: Boolean(transaction) },
    );
  }
}

async function writeAudit({ actorUserId, roleRecord, oldValues, newValues, reason, action, ipAddress, userAgent }, transaction) {
  try {
    // Keep database/model loading lazy. The Growth authorization unit suite
    // exercises denial paths without requiring a local SQLite native binding.
    const { AuditLog } = require('../entities');
    await AuditLog.create({
      user_id: actorUserId,
      shop_id: null,
      action,
      resource_type: 'GROWTH_OS_ROLE',
      resource_id: roleRecord.id,
      old_values: oldValues,
      new_values: newValues,
      metadata: {
        source: 'growth_os_role_admin',
        reason,
        target_user_id: roleRecord.user_id,
      },
      ip_address: ipAddress || null,
      user_agent: userAgent || null,
    }, { transaction });
  } catch (_error) {
    throw new AppError(
      'Growth OS audit service is temporarily unavailable.',
      503,
      'GROWTH_OS_AUDIT_UNAVAILABLE',
    );
  }
}

function safeRole(roleRecord) {
  return {
    id: roleRecord.id,
    userId: roleRecord.user_id,
    role: roleRecord.role,
    grantedAt: roleRecord.granted_at,
    revokedAt: roleRecord.revoked_at || null,
  };
}

async function grantRole({ actorUserId, targetUserId, role, reason, ipAddress, userAgent }) {
  assertUuid(actorUserId, 'actorUserId');
  assertUuid(targetUserId, 'targetUserId');
  if (!isGrowthOsRole(role)) {
    throw new AppError('role is not a valid Growth OS role.', 400, 'GROWTH_OS_INVALID_ROLE');
  }
  const normalizedReason = normalizeReason(reason);
  const { sequelize } = require('../../utils/database/database-setup');
  const { GrowthOsUserRole, User } = require('../entities');

  return sequelize.transaction(async (transaction) => {
    const target = await User.findByPk(targetUserId, {
      attributes: ['id'],
      transaction,
    });
    if (!target) {
      throw new AppError('Growth OS role target was not found.', 404, 'GROWTH_OS_ROLE_TARGET_NOT_FOUND');
    }

    const existing = await GrowthOsUserRole.findOne({
      where: {
        user_id: targetUserId,
        is_active: true,
        revoked_at: { [Op.is]: null },
      },
      transaction,
      lock: transaction.LOCK?.UPDATE,
    });
    if (existing) {
      throw new AppError('The target user already has an active Growth OS role.', 409, 'GROWTH_OS_ROLE_ALREADY_ASSIGNED');
    }

    const roleRecord = await GrowthOsUserRole.create({
      user_id: targetUserId,
      role,
      is_active: true,
      granted_by: actorUserId,
      granted_at: new Date(),
      revoked_by: null,
      revoked_at: null,
      metadata: { source: 'growth_os_role_admin' },
    }, { transaction });

    await writeAudit({
      actorUserId,
      roleRecord,
      oldValues: null,
      newValues: { user_id: targetUserId, role },
      reason: normalizedReason,
      action: 'growth_os:role_granted',
      ipAddress,
      userAgent,
    }, transaction);
    await invalidateRoleCache(targetUserId, transaction);

    return safeRole(roleRecord);
  });
}

async function revokeRole({ actorUserId, targetUserId, reason, ipAddress, userAgent }) {
  assertUuid(actorUserId, 'actorUserId');
  assertUuid(targetUserId, 'targetUserId');
  const normalizedReason = normalizeReason(reason);
  const { sequelize } = require('../../utils/database/database-setup');
  const { GrowthOsUserRole } = require('../entities');

  return sequelize.transaction(async (transaction) => {
    const roleRecord = await GrowthOsUserRole.findOne({
      where: {
        user_id: targetUserId,
        is_active: true,
        revoked_at: { [Op.is]: null },
      },
      transaction,
      lock: transaction.LOCK?.UPDATE,
    });
    if (!roleRecord) {
      throw new AppError('The target user has no active Growth OS role.', 404, 'GROWTH_OS_ROLE_NOT_FOUND');
    }

    if (roleRecord.role === GROWTH_OS_ROLES.FOUNDER) {
      // PostgreSQL rejects FOR UPDATE on aggregate queries. Lock the active
      // Founder rows first, then count the locked result inside this
      // transaction so concurrent revocations cannot remove the last Founder.
      const activeFounders = await GrowthOsUserRole.findAll({
        attributes: ['id'],
        where: {
          role: GROWTH_OS_ROLES.FOUNDER,
          is_active: true,
          revoked_at: { [Op.is]: null },
        },
        transaction,
        lock: transaction.LOCK?.UPDATE,
      });
      if (activeFounders.length <= 1) {
        throw new AppError('The last active Growth OS Founder cannot be revoked.', 409, 'GROWTH_OS_LAST_FOUNDER');
      }
    }

    const oldValues = { user_id: targetUserId, role: roleRecord.role };
    await roleRecord.update({
      is_active: false,
      revoked_by: actorUserId,
      revoked_at: new Date(),
    }, { transaction });

    await writeAudit({
      actorUserId,
      roleRecord,
      oldValues,
      newValues: { user_id: targetUserId, role: roleRecord.role, is_active: false },
      reason: normalizedReason,
      action: 'growth_os:role_revoked',
      ipAddress,
      userAgent,
    }, transaction);
    await invalidateRoleCache(targetUserId, transaction);

    return safeRole(roleRecord);
  });
}

module.exports = {
  grantRole,
  revokeRole,
  ROLE_CACHE_TTL_SECONDS,
};
