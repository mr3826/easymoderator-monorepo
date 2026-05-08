/**
 * PermissionGate Component
 * 
 * Conditionally renders children based on user permissions
 * Used to hide/disable buttons, sections, etc. within a page
 * 
 * Usage:
 *   <PermissionGate action="delete" resource="products">
 *     <button onClick={deleteProduct}>Delete</button>
 *   </PermissionGate>
 * 
 *   <PermissionGate action="write" resource="settings" fallback={<p>Upgrade to manage settings</p>}>
 *     <SettingsPanel />
 *   </PermissionGate>
 */

import { ReactNode } from 'react';
import { useUserPermissions } from '@/shared/lib/rbac/useUserPermissions';
import { UserRole } from '@/shared/lib/rbac/types';

interface PermissionGateProps {
  /** Action to check (e.g., "read", "write", "delete", "manage") */
  action: string;

  /** Resource to check (e.g., "products", "orders", "settings") */
  resource: string;

  /** Content to render if user has permission */
  children: ReactNode;

  /** Content to render if user lacks permission (defaults to nothing) */
  fallback?: ReactNode;
}

/**
 * Check permission and conditionally render
 */
export function PermissionGate({
  action,
  resource,
  children,
  fallback,
}: PermissionGateProps): ReactNode {
  const { can } = useUserPermissions();

  if (can(action, resource)) {
    return children;
  }

  return fallback || null;
}

/**
 * Role-based gate (simpler for common cases)
 * 
 * Usage:
 *   <RoleGate role={UserRole.ADMIN}>
 *     <AdminPanel />
 *   </RoleGate>
 */
interface RoleGateProps {
  /** Required role */
  role: UserRole | UserRole[];

  /** Content to render if user has role */
  children: ReactNode;

  /** Content to render if user lacks role */
  fallback?: ReactNode;
}

export function RoleGate({ role, children, fallback }: RoleGateProps): ReactNode {
  const { hasRole } = useUserPermissions();

  const roles = Array.isArray(role) ? role : [role];
  const hasRequiredRole = roles.some((r) => hasRole(r));

  if (hasRequiredRole) {
    return children;
  }

  return fallback || null;
}

/**
 * Admin-only gate (common use case)
 */
export function AdminGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  return <RoleGate role={UserRole.ADMIN} fallback={fallback}>{children}</RoleGate>;
}

/**
 * Moderator+ gate (admins + moderators)
 */
export function ModeratorGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  const { canModerate } = useUserPermissions();

  if (canModerate()) {
    return children;
  }

  return fallback || null;
}

/**
 * Disable button if no permission (visual feedback)
 * 
 * Usage:
 *   <DisableIfNoPermission action="delete" resource="products">
 *     <button onClick={deleteProduct}>Delete</button>
 *   </DisableIfNoPermission>
 */
interface DisableIfNoPermissionProps {
  action: string;
  resource: string;
  children: React.ReactElement;
  tooltip?: string;
}

export function DisableIfNoPermission({
  action,
  resource,
  children,
  tooltip,
}: DisableIfNoPermissionProps): ReactNode {
  const { can } = useUserPermissions();

  const hasPermission = can(action, resource);

  if (!hasPermission) {
    return (
      <div title={tooltip || `You don't have permission to ${action} ${resource}`}>
        {React.cloneElement(children, {
          disabled: true,
          className: `${children.props.className || ''} opacity-50 cursor-not-allowed`,
        })}
      </div>
    );
  }

  return children;
}

// Import React at top if using React.cloneElement
import React from 'react';
