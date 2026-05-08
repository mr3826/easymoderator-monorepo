/**
 * useUserPermissions Hook
 * 
 * Provides role-based access control (RBAC) for the frontend
 * Checks both global role permissions and shop-level permissions
 * 
 * Usage:
 *   const { can, hasRole } = useUserPermissions();
 *   if (!can('read', 'orders')) return <Unauthorized />;
 *   if (!hasRole(UserRole.ADMIN)) return <RequiresAdmin />;
 */

import { useMemo } from 'react';
import { useAuth } from '@/features/auth/hooks';
import { useShopRole } from '@/shared/context/ShopContext';
import {
  UserRole,
  ShopRole,
  Permission,
  PERMISSION_MATRIX,
  SHOP_PERMISSION_MATRIX,
} from './types';

interface UserPermissionResult {
  /** Check if user can perform action on resource */
  can: (action: string, resource: string) => boolean;

  /** Check if user has specific role */
  hasRole: (role: UserRole) => boolean;

  /** Check if user has specific shop role */
  hasShopRole: (role: ShopRole) => boolean;

  /** Get all permissions for current user */
  getPermissions: () => Permission[];

  /** Check if user is admin */
  isAdmin: () => boolean;

  /** Check if user is moderator or higher */
  canModerate: () => boolean;

  /** Check if user can see analytics */
  canViewAnalytics: () => boolean;

  /** Check if user can manage team/users */
  canManageTeam: () => boolean;

  /** Check if user can manage settings */
  canManageSettings: () => boolean;

  /** Check if user can access admin panel */
  canAccessAdminPanel: () => boolean;
}

/**
 * Parse permission string format "action:resource"
 * Example: "read:orders", "write:products", "delete:users"
 */
function parsePermission(permission: string): [string, string] {
  const [action, resource] = permission.split(':');
  return [action, resource];
}

/**
 * Check if permission string matches action:resource
 * Supports wildcards: "read:*" matches any read action
 */
function permissionMatches(permission: Permission, action: string, resource: string): boolean {
  const [permAction, permResource] = parsePermission(permission);

  // Wildcard matching
  const actionMatch = permAction === '*' || permAction === action;
  const resourceMatch = permResource === '*' || permResource === resource;

  return actionMatch && resourceMatch;
}

export function useUserPermissions(): UserPermissionResult {
  const { user } = useAuth();
  const currentShopRole = useShopRole();

  // Compute effective permissions based on user role + shop role
  const effectivePermissions = useMemo(() => {
    if (!user) return [];

    // Start with global permissions from user role
    const globalPerms = PERMISSION_MATRIX[user.role as UserRole] || [];

    // Add shop-level permissions if user has a shop role
    const shopPerms = currentShopRole
      ? SHOP_PERMISSION_MATRIX[currentShopRole as ShopRole] || []
      : [];

    // Merge global and shop-scoped permissions to avoid dropping global capabilities
    // when a shop context is active.
    return Array.from(new Set([...globalPerms, ...shopPerms]));
  }, [user?.role, currentShopRole]);

  const can = (action: string, resource: string): boolean => {
    if (!user) return false;

    // Check if any permission matches
    return effectivePermissions.some((perm) => permissionMatches(perm, action, resource));
  };

  const hasRole = (role: UserRole): boolean => {
    if (!user) return false;
    return user.role === role;
  };

  const hasShopRole = (role: ShopRole): boolean => {
    if (!currentShopRole) return false;
    return currentShopRole === role;
  };

  const getPermissions = (): Permission[] => {
    return effectivePermissions;
  };

  const isAdmin = (): boolean => {
    return hasRole(UserRole.ADMIN);
  };

  const canModerate = (): boolean => {
    return hasRole(UserRole.ADMIN) || hasRole(UserRole.MODERATOR);
  };

  const canViewAnalytics = (): boolean => {
    return can('read', 'analytics') || can('read', 'reports');
  };

  const canManageTeam = (): boolean => {
    return can('manage', 'team');
  };

  const canManageSettings = (): boolean => {
    return can('write', 'settings');
  };

  const canAccessAdminPanel = (): boolean => {
    return can('access', 'admin_panel');
  };

  return {
    can,
    hasRole,
    hasShopRole,
    getPermissions,
    isAdmin,
    canModerate,
    canViewAnalytics,
    canManageTeam,
    canManageSettings,
    canAccessAdminPanel,
  };
}

/**
 * Higher-order check for auth guards
 * Throws error if user doesn't have permission (vs returning false)
 * Useful for route guards and API interceptors
 */
export function useRequirePermission(action: string, resource: string): void {
  const { can } = useUserPermissions();

  if (!can(action, resource)) {
    throw new Error(
      `User does not have permission to ${action}:${resource}`
    );
  }
}
