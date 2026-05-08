/**
 * Guard Components and Utilities
 * 
 * Centralized exports for RBAC guards, route protection, and permission checks
 */

// Permission Gates (UI element level)
export { PermissionGate, RoleGate, AdminGate, ModeratorGate, DisableIfNoPermission } from './PermissionGate';

// Route Guards (page level)
export {
  withRouteGuard,
  AdminRoute,
  ModeratorRoute,
  PermissionRoute,
  UnauthorizedScreen,
  LoadingScreen,
} from './RouteGuards';
