/**
 * RouteGuards and Protected Page Wrappers
 * 
 * Higher-order components for protecting entire pages/routes
 * Redirects to login or dashboard if user lacks permissions
 */

import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks';
import { useUserPermissions } from '@/shared/lib/rbac/useUserPermissions';
import { UserRole } from '@/shared/lib/rbac/types';

interface RouteGuardProps {
  children: ReactNode;
  requiredRole?: UserRole | UserRole[];
  requiredAction?: string;
  requiredResource?: string;
  redirectTo?: string;
}

/**
 * HOC to protect a page route
 * Redirects to dashboard (or custom path) if user lacks permission
 * 
 * Usage:
 *   export default withRouteGuard(AdminPage, {
 *     requiredRole: UserRole.ADMIN,
 *     redirectTo: '/dashboard'
 *   });
 * 
 * Or with permission action:
 *   export default withRouteGuard(ReportsPage, {
 *     requiredAction: 'read',
 *     requiredResource: 'reports'
 *   });
 */
export function withRouteGuard(
  WrappedComponent: React.ComponentType<any>,
  options: Omit<RouteGuardProps, 'children'> = {}
) {
  return function ProtectedRoute(props: any) {
    const { user, isLoading } = useAuth();
    const { hasRole, can } = useUserPermissions();
    const navigate = useNavigate();

    const {
      requiredRole,
      requiredAction,
      requiredResource,
      redirectTo = '/app',
    } = options;

    // Still loading auth
    if (isLoading) {
      return <LoadingScreen />;
    }

    // Not authenticated
    if (!user) {
      navigate('/signin');
      return null;
    }

    // Check role if specified
    if (requiredRole) {
      const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
      const hasRequiredRole = roles.some((role) => hasRole(role));

      if (!hasRequiredRole) {
        navigate(redirectTo);
        return <UnauthorizedScreen />;
      }
    }

    // Check permission if specified
    if (requiredAction && requiredResource) {
      if (!can(requiredAction, requiredResource)) {
        navigate(redirectTo);
        return <UnauthorizedScreen />;
      }
    }

    // All checks passed, render component
    return <WrappedComponent {...props} />;
  };
}

/**
 * AdminGate component version - direct wrapper, not HOC
 * 
 * Usage:
 *   <AdminRoute>
 *     <AdminPanel />
 *   </AdminRoute>
 */
export function AdminRoute({
  children,
  redirectTo = '/app',
}: {
  children: ReactNode;
  redirectTo?: string;
}): ReactNode {
  const { user, isLoading } = useAuth();
  const { hasRole } = useUserPermissions();
  const navigate = useNavigate();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    navigate('/signin');
    return null;
  }

  if (!hasRole(UserRole.ADMIN)) {
    navigate(redirectTo);
    return <UnauthorizedScreen />;
  }

  return children;
}

/**
 * ModeratorRoute - admins + moderators
 */
export function ModeratorRoute({
  children,
  redirectTo = '/app',
}: {
  children: ReactNode;
  redirectTo?: string;
}): ReactNode {
  const { user, isLoading } = useAuth();
  const { canModerate } = useUserPermissions();
  const navigate = useNavigate();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    navigate('/signin');
    return null;
  }

  if (!canModerate()) {
    navigate(redirectTo);
    return <UnauthorizedScreen />;
  }

  return children;
}

/**
 * PermissionRoute - generic permission check
 */
export function PermissionRoute({
  action,
  resource,
  children,
  redirectTo = '/app',
}: {
  action: string;
  resource: string;
  children: ReactNode;
  redirectTo?: string;
}): ReactNode {
  const { user, isLoading } = useAuth();
  const { can } = useUserPermissions();
  const navigate = useNavigate();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    navigate('/signin');
    return null;
  }

  if (!can(action, resource)) {
    navigate(redirectTo);
    return <UnauthorizedScreen />;
  }

  return children;
}

/**
 * UI Components
 */

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="animate-spin">
        <div className="h-12 w-12 border-4 border-gray-300 border-t-blue-600 rounded-full" />
      </div>
    </div>
  );
}

function UnauthorizedScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">403</h1>
        <p className="text-xl text-gray-600 mb-6">Unauthorized</p>
        <p className="text-gray-500 mb-8">You don't have permission to access this page.</p>
        <button
          onClick={() => navigate('/app')}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
}

export { UnauthorizedScreen, LoadingScreen };
