import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useIsPlatformAdmin } from '@/shared/lib/auth/useIsPlatformAdmin';

/**
 * Gates the /admin section to EasyModerator operators (SUPPORT_ADMIN | SUPER_ADMIN).
 * This is UX only — the backend requirePlatformAdmin guard is the real authority.
 */
export function PlatformAdminRoute({ children }: { children: ReactNode }) {
  const { loading, role } = useIsPlatformAdmin();
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-gray-500">Loading…</div>;
  }
  if (!role) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
