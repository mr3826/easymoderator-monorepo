'use strict';

const GROWTH_OS_ROLES = Object.freeze({
  FOUNDER: 'FOUNDER',
  GROWTH_MANAGER: 'GROWTH_MANAGER',
  BUSINESS_EXECUTIVE: 'BUSINESS_EXECUTIVE',
  MARKETER: 'MARKETER',
  CUSTOMER_SUCCESS: 'CUSTOMER_SUCCESS',
  READ_ONLY_ANALYST: 'READ_ONLY_ANALYST',
});

const ROLE_PRIORITY = Object.freeze({
  [GROWTH_OS_ROLES.FOUNDER]: 100,
  [GROWTH_OS_ROLES.GROWTH_MANAGER]: 80,
  [GROWTH_OS_ROLES.BUSINESS_EXECUTIVE]: 50,
  [GROWTH_OS_ROLES.MARKETER]: 45,
  [GROWTH_OS_ROLES.CUSTOMER_SUCCESS]: 45,
  [GROWTH_OS_ROLES.READ_ONLY_ANALYST]: 10,
});

const PERMISSIONS_BY_ROLE = Object.freeze({
  [GROWTH_OS_ROLES.FOUNDER]: [
    'growth_os.session.read',
    'growth_os.roles.manage',
    'growth_os.config.manage',
    'growth_os.team.read_all',
    'growth_os.prospects.read_all',
    'growth_os.prospects.manage_all',
    'growth_os.reports.read_all',
  ],
  [GROWTH_OS_ROLES.GROWTH_MANAGER]: [
    'growth_os.session.read',
    'growth_os.team.read_all',
    'growth_os.prospects.read_all',
    'growth_os.prospects.manage_all',
    'growth_os.reports.read_team',
  ],
  [GROWTH_OS_ROLES.BUSINESS_EXECUTIVE]: [
    'growth_os.session.read',
    'growth_os.prospects.read_assigned',
    'growth_os.prospects.update_assigned',
    'growth_os.activities.create_assigned',
    'growth_os.tasks.manage_assigned',
  ],
  [GROWTH_OS_ROLES.MARKETER]: [
    'growth_os.session.read',
    'growth_os.sources.read',
    'growth_os.campaigns.manage',
    'growth_os.prospects.read_source_scope',
    'growth_os.reports.read_marketing',
  ],
  [GROWTH_OS_ROLES.CUSTOMER_SUCCESS]: [
    'growth_os.session.read',
    'growth_os.trials.read_assigned',
    'growth_os.customer_health.manage_assigned',
    'growth_os.retention_tasks.manage_assigned',
  ],
  [GROWTH_OS_ROLES.READ_ONLY_ANALYST]: [
    'growth_os.session.read',
    'growth_os.reports.read_aggregate',
  ],
});

function isGrowthOsRole(role) {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS_BY_ROLE, role);
}

function getRolePriority(role) {
  return ROLE_PRIORITY[role] || 0;
}

function getPermissionsForRole(role) {
  if (!isGrowthOsRole(role)) return [];
  return [...PERMISSIONS_BY_ROLE[role]];
}

function hasPermission(role, permission) {
  return getPermissionsForRole(role).includes(permission);
}

module.exports = {
  GROWTH_OS_ROLES,
  PERMISSIONS_BY_ROLE,
  isGrowthOsRole,
  getRolePriority,
  getPermissionsForRole,
  hasPermission,
};
