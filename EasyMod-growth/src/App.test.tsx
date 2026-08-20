import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const authState = vi.hoisted(() => ({
  permissions: [] as string[],
}));

vi.mock('@/auth/GrowthAuthProvider', () => ({
  GrowthAuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useGrowthAuth: () => ({
    status: 'authenticated',
    session: {
      internalUserId: 'growth-user',
      displayName: 'Growth User',
      role: 'MARKETER',
      permissions: authState.permissions,
    },
    error: null,
    twoFactorRequired: false,
    refreshSession: vi.fn(),
    signin: vi.fn(),
    verifyTwoFactor: vi.fn(),
    logout: vi.fn(),
    reportApiError: vi.fn(() => false),
  }),
}));

vi.mock('@/layout/GrowthShell', () => ({
  GrowthShell: () => <div><span>Growth shell</span><Outlet /></div>,
}));

vi.mock('@/pages/ProspectListPage', () => ({
  ProspectListPage: () => <div>Prospect list route</div>,
}));

vi.mock('@/pages/ProspectDetailPage', () => ({
  ProspectDetailPage: () => <div>Prospect detail route</div>,
}));

vi.mock('@/pages/ProspectFormPage', () => ({
  ProspectFormPage: () => <div>Prospect form route</div>,
}));

vi.mock('@/pages/DashboardPage', () => ({
  DashboardPage: () => <div>Dashboard route</div>,
}));

vi.mock('@/pages/AccessDeniedPage', () => ({
  AccessDeniedPage: () => <div>Access denied route</div>,
}));

vi.mock('@/pages/LoginPage', () => ({ LoginPage: () => <div>Login route</div> }));
vi.mock('@/pages/UnauthorizedPage', () => ({ UnauthorizedPage: () => <div>Unauthorized route</div> }));
vi.mock('@/pages/SessionExpiredPage', () => ({ SessionExpiredPage: () => <div>Session expired route</div> }));
vi.mock('@/pages/GrowthUnavailablePage', () => ({ GrowthUnavailablePage: () => <div>Unavailable route</div> }));
vi.mock('@/pages/NotFoundPage', () => ({ NotFoundPage: () => <div>Not found route</div> }));

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  return render(<App />);
}

describe('Growth prospect route permissions', () => {
  afterEach(() => {
    authState.permissions = [];
  });

  it('allows a read permission to reach the prospect list route', () => {
    authState.permissions = ['growth_os.prospects.read_source_scope'];

    renderAt('/prospects');

    expect(screen.getByText('Prospect list route')).toBeInTheDocument();
  });

  it('denies prospect routes without the server-mirrored read permission', () => {
    renderAt('/prospects');

    expect(screen.getByText('Access denied route')).toBeInTheDocument();
  });

  it('keeps prospect creation behind manage_all', () => {
    authState.permissions = ['growth_os.prospects.read_all'];

    renderAt('/prospects/new');

    expect(screen.getByText('Access denied route')).toBeInTheDocument();
  });
});
