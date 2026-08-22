import { useGrowthAuth } from '@/auth/GrowthAuthProvider';

export type PermissionInput = string | readonly string[];

export const PROSPECT_READ_PERMISSIONS = [
  'growth_os.prospects.read_all',
  'growth_os.prospects.read_assigned',
  'growth_os.prospects.read_source_scope',
] as const;

export function usePermission(permission: PermissionInput): boolean {
  const { session } = useGrowthAuth();
  if (!session) return false;

  const requestedPermissions = Array.isArray(permission) ? permission : [permission];
  return requestedPermissions.some((requested) => session.permissions.includes(requested));
}
