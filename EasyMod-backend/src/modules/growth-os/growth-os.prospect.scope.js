'use strict';

const { Op } = require('sequelize');

function permissionsOf(access) {
  return new Set(Array.isArray(access?.permissions) ? access.permissions : []);
}

function resolveProspectScope(access, userId) {
  const permissions = permissionsOf(access);
  if (permissions.has('growth_os.prospects.manage_all')
    || permissions.has('growth_os.prospects.read_all')) {
    return {
      kind: 'all',
      where: {},
      redacted: false,
      canEdit: true,
      canChangeStatus: true,
    };
  }

  if (permissions.has('growth_os.prospects.read_assigned')
    && permissions.has('growth_os.prospects.update_assigned')) {
    return {
      kind: 'assigned',
      where: { owner_user_id: userId },
      redacted: false,
      canEdit: true,
      canChangeStatus: true,
    };
  }

  if (permissions.has('growth_os.prospects.read_source_scope')) {
    return {
      kind: 'source',
      where: {},
      redacted: true,
      canEdit: false,
      canChangeStatus: false,
    };
  }

  return {
    kind: 'none',
    where: { id: { [Op.is]: null } },
    redacted: false,
    canEdit: false,
    canChangeStatus: false,
  };
}

function canManageAll(access) {
  return permissionsOf(access).has('growth_os.prospects.manage_all');
}

function canRead(access) {
  const permissions = permissionsOf(access);
  return permissions.has('growth_os.prospects.manage_all')
    || permissions.has('growth_os.prospects.read_all')
    || (permissions.has('growth_os.prospects.read_assigned')
      && permissions.has('growth_os.prospects.update_assigned'))
    || permissions.has('growth_os.prospects.read_source_scope');
}

module.exports = {
  resolveProspectScope,
  canManageAll,
  canRead,
};
