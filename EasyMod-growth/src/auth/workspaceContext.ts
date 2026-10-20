export type WorkspaceContext = 'sales' | 'admin';

export const WORKSPACE_CONTEXT_STORAGE_KEY = 'growth-os.workspace-context.v1';

// Presence of any of these server-granted permissions means the effective
// session also owns the Admin Control workspace. This is UX grouping only —
// authorization always lives in `RequirePermission` guards and the server.
export const ADMIN_CONTEXT_PERMISSIONS = [
  'growth_os.admin.operations.read',
  'growth_os.admin.merchants.read',
  'growth_os.admin.merchants.mutate',
  'growth_os.admin.users.read',
  'growth_os.admin.users.manage',
  'growth_os.admin.audit.read',
  'growth_os.roles.manage',
] as const;

export function hasAdminContext(permissions: readonly string[]): boolean {
  return ADMIN_CONTEXT_PERMISSIONS.some((permission) => permissions.includes(permission));
}

function readStoredContext(): WorkspaceContext | null {
  try {
    const value = window.sessionStorage.getItem(WORKSPACE_CONTEXT_STORAGE_KEY);
    return value === 'sales' || value === 'admin' ? value : null;
  } catch (_error) {
    return null;
  }
}

/**
 * A legacy display alias or a stored preference never escalates access: an
 * admin context is only resolvable when the session's effective permissions
 * actually cover admin-side grants. Otherwise the context is always sales.
 */
export function resolveWorkspaceContext(permissions: readonly string[]): WorkspaceContext {
  if (!hasAdminContext(permissions)) return 'sales';
  const stored = readStoredContext();
  return stored ?? 'admin';
}

export function persistWorkspaceContext(context: WorkspaceContext): void {
  try {
    window.sessionStorage.setItem(WORKSPACE_CONTEXT_STORAGE_KEY, context);
  } catch (_error) {
    // Private mode or storage disabled: navigation still works per session load.
  }
}
