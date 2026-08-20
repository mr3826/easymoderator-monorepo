'use strict';

const { Op } = require('sequelize');
const { GrowthOsUserRole, User } = require('../entities');
const { getRolePriority, isGrowthOsRole } = require('./growth-os.permissions');

async function findActiveRoleForUser(userId, options = {}) {
  if (!userId) return null;

  const roles = await GrowthOsUserRole.findAll({
    where: {
      user_id: userId,
      is_active: true,
      revoked_at: { [Op.is]: null },
    },
    attributes: ['id', 'user_id', 'role', 'granted_at'],
    ...(options.transaction ? { transaction: options.transaction } : {}),
    ...(options.lock ? { lock: options.lock } : {}),
  });

  const validRoles = roles
    .filter((record) => isGrowthOsRole(record.role))
    .sort((a, b) => getRolePriority(b.role) - getRolePriority(a.role));

  return validRoles[0] || null;
}

async function findSafeUserProfile(userId) {
  if (!userId) return null;

  return User.findByPk(userId, {
    attributes: ['id', 'full_name', 'email'],
  });
}

module.exports = {
  findActiveRoleForUser,
  findSafeUserProfile,
};
