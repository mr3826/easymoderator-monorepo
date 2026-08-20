import type { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { usePermission, type PermissionInput } from '@/auth/usePermission';
import { AccessDeniedPage } from '@/pages/AccessDeniedPage';

interface RequirePermissionProps {
  permission: PermissionInput;
  children?: ReactNode;
}

export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const allowed = usePermission(permission);

  if (!allowed) return <AccessDeniedPage />;
  return children ?? <Outlet />;
}
