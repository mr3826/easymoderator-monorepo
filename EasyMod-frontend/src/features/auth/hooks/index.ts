/**
 * Auth hooks
 *
 * Re-exports the canonical useAuth from AuthProvider so every import path
 * (`@/features/auth/hooks` or `@/features/auth/AuthProvider`) resolves to the
 * same context instance. The previous TanStack Query-based implementation here
 * only returned { user, isLoading } and dropped currentShop / allShops, which
 * broke UsersPage and any other component that depended on the shop context.
 */
export { useAuth } from '../AuthProvider';
import { useAuth } from '../AuthProvider';

/**
 * Require auth - redirect if not authenticated
 */
export function useRequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();

  return {
    isAuthenticated,
    isLoading,
  };
}
