'use strict';

// Canonical two-role model for Growth OS internal users.
//
// SUPER_ADMIN  — full Growth Workspace + Admin Control Plane + growth-user
//                management. Legacy FOUNDER rows resolve here.
// GROWTH_USER  — full Growth Workspace (prospects, follow-ups, notes,
//                sources, analytics) + limited read-only merchant insight.
//                Legacy BUSINESS_EXECUTIVE / MARKETER / CUSTOMER_SUCCESS /
//                READ_ONLY_ANALYST rows resolve here. The legacy GROWTH_MANAGER
//                rows also resolve here but keep their historical MFA
//                assurance requirement (see growth-os.middleware).
//
// Legacy role strings remain part of the physical enum because historical
// growth_os_user_roles rows still carry them; they are never grantable.
// Permission names exist only for implemented routes — speculative
// permissions (campaigns/tasks/customer-health/trials/retention/config/team)
// were removed because no route, service, or UI consumed them.

const GROWTH_OS_CANONICAL_ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  GROWTH_USER: 'GROWTH_USER',
});

const LEGACY_GROWTH_OS_ROLES = Object.freeze({
  FOUNDER: 'FOUNDER',
  GROWTH_MANAGER: 'GROWTH_MANAGER',
  BUSINESS_EXECUTIVE: 'BUSINESS_EXECUTIVE',
  MARKETER: 'MARKETER',
  CUSTOMER_SUCCESS: 'CUSTOMER_SUCCESS',
  READ_ONLY_ANALYST: 'READ_ONLY_ANALYST',
});

const GROWTH_OS_ROLES = Object.freeze({
  ...GROWTH_OS_CANONICAL_ROLES,
  ...LEGACY_GROWTH_OS_ROLES,
});

const ROLE_ALIASES = Object.freeze({
  [LEGACY_GROWTH_OS_ROLES.FOUNDER]: GROWTH_OS_CANONICAL_ROLES.SUPER_ADMIN,
  [LEGACY_GROWTH_OS_ROLES.GROWTH_MANAGER]: GROWTH_OS_CANONICAL_ROLES.GROWTH_USER,
  [LEGACY_GROWTH_OS_ROLES.BUSINESS_EXECUTIVE]: GROWTH_OS_CANONICAL_ROLES.GROWTH_USER,
  [LEGACY_GROWTH_OS_ROLES.MARKETER]: GROWTH_OS_CANONICAL_ROLES.GROWTH_USER,
  [LEGACY_GROWTH_OS_ROLES.CUSTOMER_SUCCESS]: GROWTH_OS_CANONICAL_ROLES.GROWTH_USER,
  [LEGACY_GROWTH_OS_ROLES.READ_ONLY_ANALYST]: GROWTH_OS_CANONICAL_ROLES.GROWTH_USER,
});

// Roles whose raw value requires the server-issued MFA claim. This includes
// the legacy FOUNDER/GROWTH_MANAGER strings so existing accounts never get a
// capability or assurance downgrade (or upgrade) from aliasing.
const MFA_REQUIRED_ROLES = Object.freeze(new Set([
  GROWTH_OS_CANONICAL_ROLES.SUPER_ADMIN,
  LEGACY_GROWTH_OS_ROLES.FOUNDER,
  LEGACY_GROWTH_OS_ROLES.GROWTH_MANAGER,
]));

const GROWTH_WORKSPACE_PERMISSIONS = Object.freeze([
  'growth_os.session.read',
  'growth_os.home.read',
  'growth_os.prospects.read_all',
  'growth_os.prospects.manage_all',
  'growth_os.prospects.read_assigned',
  'growth_os.prospects.update_assigned',
  'growth_os.prospects.read_source_scope',
  'growth_os.reports.read_all',
  'growth_os.followups.manage',
  'growth_os.notes.manage',
  'growth_os.search.read',
  'growth_os.merchants.read_insight',
]);

const ADMIN_PERMISSIONS = Object.freeze([
  'growth_os.roles.manage',
  'growth_os.admin.merchants.read',
  'growth_os.admin.merchants.mutate',
  'growth_os.admin.users.read',
  'growth_os.admin.users.manage',
  'growth_os.admin.operations.read',
  'growth_os.admin.audit.read',
]);

const PERMISSIONS_BY_ROLE = Object.freeze({
  [GROWTH_OS_CANONICAL_ROLES.SUPER_ADMIN]: Object.freeze([
    ...GROWTH_WORKSPACE_PERMISSIONS,
    ...ADMIN_PERMISSIONS,
  ]),
  [GROWTH_OS_CANONICAL_ROLES.GROWTH_USER]: Object.freeze([
    ...GROWTH_WORKSPACE_PERMISSIONS,
  ]),
});

const ROLE_PRIORITY = Object.freeze({
  [GROWTH_OS_CANONICAL_ROLES.SUPER_ADMIN]: 100,
  [LEGACY_GROWTH_OS_ROLES.FOUNDER]: 100,
  [LEGACY_GROWTH_OS_ROLES.GROWTH_MANAGER]: 80,
  [GROWTH_OS_CANONICAL_ROLES.GROWTH_USER]: 50,
  [LEGACY_GROWTH_OS_ROLES.BUSINESS_EXECUTIVE]: 50,
  [LEGACY_GROWTH_OS_ROLES.MARKETER]: 45,
  [LEGACY_GROWTH_OS_ROLES.CUSTOMER_SUCCESS]: 45,
  [LEGACY_GROWTH_OS_ROLES.READ_ONLY_ANALYST]: 10,
});

function isGrowthOsRole(role) {
  return Object.prototype.hasOwnProperty.call(GROWTH_OS_ROLES, role);
}

function isGrantableGrowthOsRole(role) {
  return Object.prototype.hasOwnProperty.call(GROWTH_OS_CANONICAL_ROLES, role);
}

function resolveCanonicalRole(role) {
  if (!isGrowthOsRole(role)) return null;
  return ROLE_ALIASES[role] || role;
}

function isLegacyGrowthOsRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_ALIASES, role);
}

function getRolePriority(role) {
  return ROLE_PRIORITY[role] || 0;
}

function getPermissionsForRole(role) {
  const canonical = resolveCanonicalRole(role);
  if (!canonical) return [];
  return [...PERMISSIONS_BY_ROLE[canonical]];
}

function hasPermission(role, permission) {
  return getPermissionsForRole(role).includes(permission);
}

module.exports = {
  GROWTH_OS_ROLES,
  GROWTH_OS_CANONICAL_ROLES,
  LEGACY_GROWTH_OS_ROLES,
  ROLE_ALIASES,
  MFA_REQUIRED_ROLES,
  PERMISSIONS_BY_ROLE,
  isGrowthOsRole,
  isGrantableGrowthOsRole,
  isLegacyGrowthOsRole,
  resolveCanonicalRole,
  getRolePriority,
  getPermissionsForRole,
  hasPermission,
};
