/**
 * ProtectedRoute Component
 * 
 * Guards routes based on user role and permissions
 * Replaces unprotected Route in app router
 * 
 * Usage:
 *   <ProtectedRoute
 *     path="/admin"
 *     element={<AdminPanel />}
 *     requiredRole="ADMIN"
 *   />
 */

import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks';
import { useUserPermissions } from '@/shared/lib/rbac/useUserPermissions';
import { UserRole, Permission } from '@/shared/lib/rbac/types';

interface ProtectedRouteProps {
  /** Component to render if authorized */
  element: ReactNode;

  /** Required user role to access (optional - if not set, just requires authenticated)*/
  requiredRole?: UserRole;

  /** Required permission to access (format: "action:resource") */
  requiredPermission?: string;

  /** Fallback component if not authorized */
  fallback?: ReactNode;

  /** Route path (for logging/debugging) */
  path?: string;
}

export function ProtectedRoute({
  element,
  requiredRole,
  requiredPermission,
  fallback,
  path,
}: ProtectedRouteProps): ReactNode {
  const { user, isLoading } = useAuth();
  const { hasRole, can } = useUserPermissions();

  // Show loading while auth is being verified
  if (isLoading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  // Not authenticated - redirect to login
  if (!user) {
    return <Navigate to="/auth/signin" replace />;
  }

  // Check required role
  if (requiredRole && !hasRole(requiredRole)) {
    console.warn(
      `Access denied to ${path}: user role is ${user.role}, required ${requiredRole}`
    );

    if (fallback) {
      return fallback;
    }

    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-gray-600">You don't have permission to access this page.</p>
        <a href="/" className="text-blue-600 hover:underline">
          Return home
        </a>
      </div>
    );
  }

  // Check required permission
  if (requiredPermission) {
    const [action, resource] = requiredPermission.split(':');
    if (!can(action, resource)) {
      console.warn(
        `Access denied to ${path}: user lacks permission ${requiredPermission}`
      );

      if (fallback) {
        return fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center h-screen gap-4">
          <h1 className="text-2xl font-bold">Access Denied</h1>
          <p className="text-gray-600">You don't have permission to access this page.</p>
          <a href="/" className="text-blue-600 hover:underline">
            Return home
          </a>
        </div>
      );
    }
  }

  // All checks passed - render protected component
  return element;
}

/**
 * Admin-only route guard (common use case)
 */
export function AdminRoute({
  element,
  fallback,
}: {
  element: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  return (
    <ProtectedRoute
      element={element}
      requiredRole={UserRole.ADMIN}
      fallback={fallback}
      path="/admin"
    />
  );
}

/**
 * Moderator-only route guard (moderators + admins)
 */
export function ModeratorRoute({
  element,
  fallback,
}: {
  element: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  const { user, isLoading } = useAuth();
  const { isAdmin, canModerate } = useUserPermissions();

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/auth/signin" replace />;
  }

  if (!isAdmin() && !canModerate()) {
    if (fallback) return fallback;

    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <h1 className="text-2xl font-bold">Moderator Access Required</h1>
        <a href="/" className="text-blue-600 hover:underline">
          Return home
        </a>
      </div>
    );
  }

  return element;
}
