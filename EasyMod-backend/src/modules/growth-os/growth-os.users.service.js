'use strict';

// Growth OS user management (SUPER_ADMIN-only surface, §21).
//
// Reuses the canonical users table plus growth_os_user_roles — no parallel
// identity records. "Invite + create" returns a one-time initial password
// in the create/reset responses only; passwords are never audited or logged.

const crypto = require('crypto');
const { validate: isUuid } = require('uuid');
const { Op } = require('sequelize');
const { AppError } = require('../../utils/AppError');
const {
  isGrantableGrowthOsRole,
  resolveCanonicalRole,
} = require('./growth-os.permissions');
const roles = require('./growth-os.roles.service');
const { getTemporaryPasswordExpiry } = require('../auth/temporary-password');
const { invalidateUserSessions } = require('../auth/session-invalidation.service');
const { redactSecretiveValues } = require('./growth-os.audit-sanitizer');

function badRequest(message, code) {
  throw new AppError(message, 400, code);
}

function assertUuid(value, fieldName) {
  if (!isUuid(String(value || ''))) {
    throw new AppError(`${fieldName} must be a valid user id.`, 400, 'GROWTH_OS_INVALID_USER_ID');
  }
}

function normalizeReason(reason) {
  const normalized = typeof reason === 'string' ? reason.trim() : '';
  if (!normalized || normalized.length > 200) {
    badRequest('reason is required and must be 200 characters or fewer.', 'GROWTH_OS_INVALID_REASON');
  }
  return redactSecretiveValues(normalized);
}

function generateTempPassword() {
  // ~180 bits of entropy, URL-safe. Returned to the calling Super Admin once.
  return crypto.randomBytes(24).toString('base64url');
}

async function writeUserAdminAudit({
  actorUserId, targetUserId, action, oldValues, newValues, reason, ipAddress, userAgent,
}, transaction) {
  try {
    const { AuditLog } = require('../entities');
    await AuditLog.create({
      user_id: actorUserId,
      shop_id: null,
      action,
      resource_type: 'GROWTH_OS_USER_ADMIN',
      resource_id: targetUserId,
      old_values: redactSecretiveValues(oldValues || null),
      new_values: redactSecretiveValues(newValues || null),
      metadata: redactSecretiveValues({ source: 'growth_os_user_admin', reason, target_user_id: targetUserId }),
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

async function listGrowthUsers({ search = '' } = {}) {
  const { GrowthOsUserRole, User, Session } = require('../entities');
  const roleRows = await GrowthOsUserRole.findAll({
    include: [{
      model: User,
      as: 'user',
      required: true,
      attributes: ['id', 'email', 'full_name', 'settings'],
      ...(search
        ? { where: { [Op.or]: [
          { email: { [Op.iLike]: `%${search}%` } },
          { full_name: { [Op.iLike]: `%${search}%` } },
        ] } }
        : {}),
    }],
    // Newest grant per state first: active rows outrank terminal rows.
    order: [
      [sequelizeLiteralIsActive(), 'DESC'],
      ['granted_at', 'DESC'],
    ],
    limit: 500,
  });

  // One entry per user: prefer the current active row; otherwise show the
  // most recent historical row with its final status.
  const byUser = new Map();
  for (const row of roleRows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, row);
  }

  const users = [];
  for (const row of byUser.values()) {
    const isActiveRow = Boolean(row.is_active && !row.revoked_at);
    const rawRole = row.role;
    const status = isActiveRow ? 'active' : (row.revoked_at ? 'revoked' : 'suspended');
    let lastLoginAt = null;
    try {
      lastLoginAt = await Session.max('last_activity_at', {
        where: { user_id: row.user_id },
      });
    } catch (_error) {
      // last-login is best-effort display metadata, never access control.
    }
    users.push({
      userId: row.user_id,
      email: row.user?.email || null,
      displayName: row.user?.full_name || null,
      role: resolveCanonicalRole(rawRole),
      legacyRole: rawRole === resolveCanonicalRole(rawRole) ? null : rawRole,
      status,
      mfaEnabled: Boolean(row.user?.settings?.totp_enabled),
      grantedAt: row.granted_at,
      revokedAt: row.revoked_at || null,
      lastLoginAt: lastLoginAt || null,
    });
  }
  users.sort((a, b) => (a.role === b.role ? 0 : a.role === 'SUPER_ADMIN' ? -1 : 1));
  return users;
}

function sequelizeLiteralIsActive() {
  const { literal } = require('sequelize');
  // 'active first' ordering without a raw string column injection surface.
  return literal(
    'CASE WHEN "GrowthOsUserRole"."is_active" AND "GrowthOsUserRole"."revoked_at" IS NULL THEN 1 ELSE 0 END',
  );
}

async function createGrowthUser({
  actorUserId, email, fullName, role, reason, ipAddress, userAgent,
}) {
  assertUuid(actorUserId, 'actorUserId');
  if (!isGrantableGrowthOsRole(role)) {
    badRequest('role must be SUPER_ADMIN or GROWTH_USER.', 'GROWTH_OS_INVALID_ROLE');
  }
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    badRequest('A valid email address is required.', 'GROWTH_OS_INVALID_EMAIL');
  }
  const normalizedReason = normalizeReason(reason);
  const displayName = typeof fullName === 'string' ? fullName.trim().slice(0, 255) : '';
  if (!displayName) badRequest('fullName is required.', 'GROWTH_OS_INVALID_NAME');

  const { sequelize } = require('../../utils/database/database-setup');
  const { User, GrowthOsUserRole } = require('../entities');
  const { hashPassword } = require('../../utils/password.util');

  const tempPassword = generateTempPassword();
  const hashedPassword = await hashPassword(tempPassword);
  const temporaryPasswordExpiresAt = getTemporaryPasswordExpiry();

  let created;
  try {
    created = await sequelize.transaction(async (transaction) => {
      const existing = await User.findOne({
        attributes: ['id'],
        where: { email: normalizedEmail },
        transaction,
      });
      if (existing) {
        throw new AppError(
          'A user with this email already exists. Use role assignment for existing accounts.',
          409,
          'GROWTH_OS_USER_EMAIL_TAKEN',
        );
      }

      const user = await User.create({
        email: normalizedEmail,
        password: hashedPassword,
        full_name: displayName,
        phone: null,
        must_change_password: true,
        temporary_password_expires_at: temporaryPasswordExpiresAt,
        settings: { internal_growth_user: true },
      }, { transaction });

      const roleRow = await GrowthOsUserRole.create({
        user_id: user.id,
        role,
        is_active: true,
        granted_by: actorUserId,
        granted_at: new Date(),
        revoked_by: null,
        revoked_at: null,
        metadata: { source: 'growth_os_user_admin' },
      }, { transaction });

      await writeUserAdminAudit({
        actorUserId,
        targetUserId: user.id,
        action: 'growth_os:user_created',
        oldValues: null,
        newValues: { email: normalizedEmail, full_name: displayName, role },
        reason: normalizedReason,
        ipAddress,
        userAgent,
      }, transaction);

      return { user, roleRow };
    });
  } catch (error) {
    if (error?.name === 'SequelizeUniqueConstraintError') {
      throw new AppError('A user with this email already exists.', 409, 'GROWTH_OS_USER_EMAIL_TAKEN');
    }
    throw error;
  }

  return {
    user: {
      userId: created.user.id,
      email: created.user.email,
      displayName: created.user.full_name,
      role: resolveCanonicalRole(created.roleRow.role),
      status: 'active',
    },
    // One-time credential delivery channel; never persisted in plaintext.
    initialPassword: tempPassword,
    temporaryPasswordExpiresAt: temporaryPasswordExpiresAt.toISOString(),
  };
}

async function changeGrowthUserRole({
  actorUserId, targetUserId, role, reason, ipAddress, userAgent,
}) {
  assertUuid(actorUserId, 'actorUserId');
  assertUuid(targetUserId, 'targetUserId');
  if (!isGrantableGrowthOsRole(role)) {
    badRequest('role must be SUPER_ADMIN or GROWTH_USER.', 'GROWTH_OS_INVALID_ROLE');
  }
  // roles.changeRole writes the in-transaction, reason-bearing GROWTH_OS_ROLE
  // audit row itself; a second user-admin row would only duplicate it.
  return roles.changeRole({
    actorUserId, targetUserId, role, reason: normalizeReason(reason), ipAddress, userAgent,
  });
}

async function setGrowthUserStatus({
  actorUserId, targetUserId, active, reason, ipAddress, userAgent,
}) {
  assertUuid(targetUserId, 'targetUserId');
  // roles.setActiveStatus owns the transactional, audited status change.
  return roles.setActiveStatus({
    actorUserId, targetUserId, active, reason: normalizeReason(reason), ipAddress, userAgent,
  });
}

async function revokeGrowthUserAccess({
  actorUserId, targetUserId, reason, ipAddress, userAgent,
}) {
  assertUuid(targetUserId, 'targetUserId');
  // roles.revokeRole owns the transactional audit, the last-Super-Admin
  // guard, role-cache invalidation, and internal session invalidation.
  return roles.revokeRole({
    actorUserId, targetUserId, reason: normalizeReason(reason), ipAddress, userAgent,
  });
}

async function resetGrowthUserPassword({
  actorUserId, targetUserId, reason, ipAddress, userAgent,
}) {
  assertUuid(actorUserId, 'actorUserId');
  assertUuid(targetUserId, 'targetUserId');
  const normalizedReason = normalizeReason(reason);
  const { sequelize } = require('../../utils/database/database-setup');
  const { User, GrowthOsUserRole } = require('../entities');
  const { hashPassword } = require('../../utils/password.util');

  const tempPassword = generateTempPassword();
  const hashedPassword = await hashPassword(tempPassword);
  const temporaryPasswordExpiresAt = getTemporaryPasswordExpiry();
  const reset = await sequelize.transaction(async (transaction) => {
    const target = await User.findByPk(targetUserId, {
      attributes: ['id', 'email'],
      transaction,
      lock: transaction.LOCK?.UPDATE,
    });
    if (!target) {
      throw new AppError('Growth OS user was not found.', 404, 'GROWTH_OS_USER_NOT_FOUND');
    }

    const internalRole = await GrowthOsUserRole.findOne({
      attributes: ['id', 'role', 'is_active', 'revoked_at'],
      where: { user_id: targetUserId, revoked_at: { [Op.is]: null } },
      transaction,
      lock: transaction.LOCK?.UPDATE,
    });
    if (!internalRole) {
      throw new AppError('The target account has no Growth OS access.', 404, 'GROWTH_OS_NOT_INTERNAL_USER');
    }

    // Accidental self-lockout prevention: the password of the only active
    // Super Admin cannot be reset until a second Super Admin exists.
    const targetActiveRole = await GrowthOsUserRole.findOne({
      attributes: ['role'],
      where: { user_id: targetUserId, is_active: true, revoked_at: { [Op.is]: null } },
      transaction,
    });
    if (targetActiveRole && roles.isSuperAdminRoleValue(targetActiveRole.role)) {
      const superAdmins = await GrowthOsUserRole.count({
        where: {
          role: { [Op.in]: roles.SUPER_ADMIN_ROLE_VALUES },
          is_active: true,
          revoked_at: { [Op.is]: null },
        },
        transaction,
      });
      if (superAdmins <= 1) {
        throw new AppError(
          'The password of the only active Super Admin cannot be reset. Ensure another Super Admin exists first.',
          409,
          'GROWTH_OS_LAST_SUPER_ADMIN',
        );
      }
    }

    await target.update({
      password: hashedPassword,
      must_change_password: true,
      temporary_password_expires_at: temporaryPasswordExpiresAt,
    }, { transaction });
    await writeUserAdminAudit({
      actorUserId,
      targetUserId,
      action: 'growth_os:user_password_reset',
      oldValues: null,
      newValues: { password_changed: true },
      reason: normalizedReason,
      ipAddress,
      userAgent,
    }, transaction);
    await invalidateUserSessions(targetUserId, { transaction });
    return { userId: target.id, email: target.email };
  });
  return {
    ...reset,
    initialPassword: tempPassword,
    temporaryPasswordExpiresAt: temporaryPasswordExpiresAt.toISOString(),
  };
}

async function revokeGrowthUserSessions({
  actorUserId, targetUserId, reason, ipAddress, userAgent,
}) {
  assertUuid(targetUserId, 'targetUserId');
  const normalizedReason = normalizeReason(reason);
  const { sequelize } = require('../../utils/database/database-setup');
  const { User, GrowthOsUserRole } = require('../entities');
  return sequelize.transaction(async (transaction) => {
    const target = await User.findByPk(targetUserId, {
      attributes: ['id'],
      transaction,
      lock: transaction.LOCK?.UPDATE,
    });
    if (!target) {
      throw new AppError('Growth OS user was not found.', 404, 'GROWTH_OS_USER_NOT_FOUND');
    }

    const internalRole = await GrowthOsUserRole.findOne({
      attributes: ['id'],
      where: { user_id: targetUserId, revoked_at: { [Op.is]: null } },
      transaction,
      lock: transaction.LOCK?.UPDATE,
    });
    if (!internalRole) {
      throw new AppError('The target account has no Growth OS access.', 404, 'GROWTH_OS_NOT_INTERNAL_USER');
    }

    await writeUserAdminAudit({
      actorUserId,
      targetUserId,
      action: 'growth_os:user_sessions_revoked',
      oldValues: null,
      newValues: null,
      reason: normalizedReason,
      ipAddress,
      userAgent,
    }, transaction);
    await invalidateUserSessions(targetUserId, { transaction });
    return { sessionsRevoked: true };
  });
}

module.exports = {
  listGrowthUsers,
  createGrowthUser,
  changeGrowthUserRole,
  setGrowthUserStatus,
  revokeGrowthUserAccess,
  resetGrowthUserPassword,
  revokeGrowthUserSessions,
};
