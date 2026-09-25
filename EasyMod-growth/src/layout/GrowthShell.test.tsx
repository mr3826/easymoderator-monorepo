import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { GrowthShell } from './GrowthShell';

const WORKSPACE_PERMISSIONS = [
  'growth_os.session.read',
  'growth_os.home.read',
  'growth_os.prospects.read_all',
  'growth_os.prospects.manage_all',
  'growth_os.followups.manage',
  'growth_os.reports.read_all',
  'growth_os.notes.manage',
  'growth_os.search.read',
  'growth_os.merchants.read_insight',
];

const SUPER_ADMIN_PERMISSIONS = [
  ...WORKSPACE_PERMISSIONS,
  'growth_os.roles.manage',
  'growth_os.admin.merchants.read',
  'growth_os.admin.merchants.mutate',
  'growth_os.admin.users.read',
  'growth_os.admin.users.manage',
  'growth_os.admin.operations.read',
  'growth_os.admin.audit.read',
];

function renderShell(permissions: string[]) {
  vi.mocked(useAuthSession).session = {
    displayName: 'Test User',
    role: permissions === SUPER_ADMIN_PERMISSIONS ? 'SUPER_ADMIN' : 'GROWTH_USER',
    legacyRole: null,
    permissions,
  };
  return render(
    <MemoryRouter>
      <GrowthShell />
    </MemoryRouter>,
  );
}

// Mutable module-level session used by the hoisted provider mock below.
const useAuthSession: { session: { displayName: string; role: string; legacyRole: string | null; permissions: string[] } | null } = {
  session: null,
};

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({
    session: useAuthSession.session,
    status: useAuthSession.session ? 'authenticated' : 'loading',
    error: null,
    logout: vi.fn(),
  }),
}));

describe('GrowthShell navigation', () => {
  it('shows the full Growth workspace and masked merchant insight for GROWTH_USER', () => {
    renderShell(WORKSPACE_PERMISSIONS);

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'My Work' })).toHaveAttribute('href', '/my-work');
    expect(screen.getByRole('link', { name: 'Prospects' })).toHaveAttribute('href', '/prospects');
    expect(screen.getByRole('link', { name: 'Pipeline' })).toHaveAttribute('href', '/pipeline');
    expect(screen.getByRole('link', { name: 'Follow-ups' })).toHaveAttribute('href', '/follow-ups');
    expect(screen.getByRole('link', { name: 'Sources' })).toHaveAttribute('href', '/sources');
    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/analytics');
    expect(screen.getByRole('link', { name: 'Merchants' })).toHaveAttribute('href', '/merchants');
  });

  it('never renders Super Admin navigation entries for GROWTH_USER', () => {
    renderShell(WORKSPACE_PERMISSIONS);

    // Not merely disabled — absent, per the navigation contract.
    expect(screen.queryByRole('link', { name: 'Operations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Growth Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Access Control' })).not.toBeInTheDocument();
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
    expect(screen.queryByText('System')).not.toBeInTheDocument();
  });

  it('renders Platform and System groups for SUPER_ADMIN', () => {
    renderShell(SUPER_ADMIN_PERMISSIONS);

    expect(screen.getByRole('link', { name: 'Operations' })).toHaveAttribute('href', '/operations');
    expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('href', '/audit');
    expect(screen.getByRole('link', { name: 'Growth Users' })).toHaveAttribute('href', '/growth-users');
    expect(screen.getByRole('link', { name: 'Access Control' })).toHaveAttribute('href', '/access-control');
  });

  it('hides navigation entries when the session has no route permissions', () => {
    renderShell(['growth_os.session.read']);

    expect(screen.queryByRole('link', { name: 'Prospects' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Merchants' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
  });

  it('only exposes the prospect surface for a legacy assigned-reader permission set', () => {
    renderShell([
      'growth_os.session.read',
      'growth_os.prospects.read_assigned',
      'growth_os.prospects.update_assigned',
    ]);

    expect(screen.getByRole('link', { name: 'Prospects' })).toHaveAttribute('href', '/prospects');
    expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My Work' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Pipeline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Follow-ups' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sources' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Analytics' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Search' })).not.toBeInTheDocument();
  });

  it('renders no navigation groups until the session resolves', () => {
    useAuthSession.session = null;
    render(
      <MemoryRouter>
        <GrowthShell />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
