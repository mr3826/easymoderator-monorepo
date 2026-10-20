import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  window.sessionStorage.removeItem('growth-os.workspace-context.v1');
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
  it('shows the action-first Sales queue navigation for GROWTH_USER', () => {
    renderShell(WORKSPACE_PERMISSIONS);

    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'My Work' })).toHaveAttribute('href', '/my-work');
    expect(screen.getByRole('link', { name: 'Prospects' })).toHaveAttribute('href', '/prospects');
    expect(screen.getByRole('link', { name: 'Pipeline' })).toHaveAttribute('href', '/pipeline');
    expect(screen.getByRole('link', { name: 'Follow-ups' })).toHaveAttribute('href', '/follow-ups');
    expect(screen.getByRole('link', { name: 'Growth Performance' })).toHaveAttribute('href', '/performance');
    expect(screen.getByRole('link', { name: 'Merchants' })).toHaveAttribute('href', '/merchants');
  });

  it('never renders Super Admin navigation or the context switcher for GROWTH_USER', () => {
    renderShell(WORKSPACE_PERMISSIONS);

    // Not merely disabled — absent, per the navigation contract.
    expect(screen.queryByRole('link', { name: 'Operations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Growth Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Access Control' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Workspace context' })).not.toBeInTheDocument();
    expect(screen.queryByText('Platform')).not.toBeInTheDocument();
    expect(screen.queryByText('System')).not.toBeInTheDocument();
  });

  it('removes Quick Add, standalone Sources, and sidebar Search destinations', () => {
    renderShell(WORKSPACE_PERMISSIONS);

    expect(screen.queryByRole('link', { name: 'Quick Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sources' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Analytics' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Search$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Global internal search' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add prospect/ })).toHaveAttribute('href', '/prospects/new');
  });

  it('renders the Admin Control context by default for SUPER_ADMIN with the switcher', () => {
    renderShell(SUPER_ADMIN_PERMISSIONS);

    expect(screen.getByRole('group', { name: 'Workspace context' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Admin Control' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'Attention' })).toHaveAttribute('href', '/admin');
    expect(screen.getByRole('link', { name: 'Operations' })).toHaveAttribute('href', '/operations');
    expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('href', '/audit');
    expect(screen.getByRole('link', { name: 'Growth Users' })).toHaveAttribute('href', '/growth-users');
    expect(screen.getByRole('link', { name: 'Access Control' })).toHaveAttribute('href', '/access-control');
    expect(screen.getByText('Team & Access')).toBeInTheDocument();
  });

  it('switching the context to Sales & Growth shows the sales navigation and hides Add prospect in Admin', async () => {
    renderShell(SUPER_ADMIN_PERMISSIONS);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sales & Growth' }));

    expect(screen.getByRole('button', { name: 'Sales & Growth' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'My Work' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Growth Performance' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Growth Users' })).not.toBeInTheDocument();
  });

  it('hides navigation entries when the session has no route permissions', () => {
    renderShell(['growth_os.session.read']);

    expect(screen.queryByRole('link', { name: 'Prospects' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Merchants' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Today' })).not.toBeInTheDocument();
  });

  it('exposes read-only prospect and pipeline surfaces for an assigned reader', () => {
    renderShell([
      'growth_os.session.read',
      'growth_os.prospects.read_assigned',
      'growth_os.prospects.update_assigned',
    ]);

    expect(screen.getByRole('link', { name: 'Prospects' })).toHaveAttribute('href', '/prospects');
    expect(screen.queryByRole('link', { name: 'Today' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My Work' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pipeline' })).toHaveAttribute('href', '/pipeline');
    expect(screen.queryByRole('link', { name: 'Follow-ups' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sources' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Analytics' })).not.toBeInTheDocument();
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

  it('a stored admin context never survives into a GROWTH_USER session', () => {
    window.sessionStorage.setItem('growth-os.workspace-context.v1', 'admin');
    renderShell(WORKSPACE_PERMISSIONS);

    expect(screen.queryByRole('group', { name: 'Workspace context' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/');
    window.sessionStorage.removeItem('growth-os.workspace-context.v1');
  });
});
