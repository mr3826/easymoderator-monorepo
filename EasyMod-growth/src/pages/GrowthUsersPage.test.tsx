import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, growthUsersApi, type GrowthUserRow } from '@/api/client';
import { GrowthUsersPage } from './GrowthUsersPage';

const reportApiError = vi.fn(() => false);
vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError }),
}));

const adminUser: GrowthUserRow = {
  userId: 'user-admin',
  email: 'ada@easymod.test',
  displayName: 'Ada Mensah',
  role: 'SUPER_ADMIN',
  legacyRole: 'FOUNDER',
  status: 'active',
  mfaEnabled: true,
  grantedAt: '2026-05-01T00:00:00.000Z',
  revokedAt: null,
  lastLoginAt: '2026-09-12T07:45:00.000Z',
};

const growthUser: GrowthUserRow = {
  userId: 'user-growth',
  email: 'kwame@easymod.test',
  displayName: 'Kwame Boateng',
  role: 'GROWTH_USER',
  legacyRole: 'MARKETER',
  status: 'suspended',
  mfaEnabled: false,
  grantedAt: '2026-06-15T00:00:00.000Z',
  revokedAt: null,
  lastLoginAt: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/growth-users']}>
      <GrowthUsersPage />
    </MemoryRouter>,
  );
}

async function renderWithUsers(users: GrowthUserRow[]) {
  vi.spyOn(growthUsersApi, 'list').mockResolvedValue(users);
  renderPage();
  if (users.length > 0) {
    await screen.findByText(users[0].email || 'user-email');
  }
}

describe('GrowthUsersPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('renders role badges, legacy hints, status, and per-row actions', async () => {
    await renderWithUsers([adminUser, growthUser]);

    expect(screen.getByText('Ada Mensah')).toBeInTheDocument();
    expect(screen.getByText('SUPER ADMIN')).toBeInTheDocument();
    expect(screen.getByText('legacy: FOUNDER')).toBeInTheDocument();
    expect(screen.getByText('GROWTH USER')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Revoke access' })).toHaveLength(2);
  });

  it('creates a user and shows the one-time initial password exactly once', async () => {
    const user = userEvent.setup();
    const create = vi.spyOn(growthUsersApi, 'create').mockResolvedValue({
      user: { userId: 'user-new', email: 'new@easymod.test', displayName: 'New Person', role: 'GROWTH_USER', status: 'active' },
      initialPassword: 'Zk9-pass-secret-42',
      temporaryPasswordExpiresAt: '2026-09-15T12:00:00.000Z',
    });
    vi.spyOn(growthUsersApi, 'list').mockResolvedValue([adminUser]);
    renderPage();
    await screen.findByText('Ada Mensah');

    await user.click(screen.getByText('Add a Growth OS user'));
    await user.type(screen.getByLabelText('Email'), 'new@easymod.test');
    await user.type(screen.getByLabelText('Display name'), 'New Person');
    await user.click(screen.getByLabelText('Growth user'));
    await user.type(screen.getByLabelText('Reason (required, max 200 chars)'), 'Onboarding new marketer');
    await user.click(screen.getByRole('button', { name: 'Create user' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      email: 'new@easymod.test',
      fullName: 'New Person',
      role: 'GROWTH_USER',
      reason: 'Onboarding new marketer',
    }));
    const reveal = document.querySelector('.password-reveal');
    expect(reveal).not.toBeNull();
    expect(reveal).toHaveTextContent('Zk9-pass-secret-42');
    expect(screen.getByText(/This password is shown once, expires/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done — I copied the password' }));
    expect(document.querySelector('.password-reveal')).toBeNull();
    expect(screen.queryByText('Zk9-pass-secret-42')).not.toBeInTheDocument();
  });

  it('surfaces the server guard message when suspending is rejected with 409', async () => {
    const user = userEvent.setup();
    vi.spyOn(growthUsersApi, 'list').mockResolvedValue([adminUser]);
    const setStatus = vi.spyOn(growthUsersApi, 'setStatus').mockRejectedValue(
      new ApiError('You cannot suspend the last active Super Admin.', 409),
    );
    renderPage();
    await screen.findByText('Ada Mensah');

    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    await user.type(screen.getByLabelText('Reason for this action (required, max 200 chars)'), 'Offboarding check');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(setStatus).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm suspend' }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('user-admin', {
      active: false,
      reason: 'Offboarding check',
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You cannot suspend the last active Super Admin.',
    );
  });

  it('shows an error state with retry when the user list fails', async () => {
    vi.spyOn(growthUsersApi, 'list').mockRejectedValue(
      new ApiError('User admin directory is unavailable.', 500),
    );
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('User admin directory is unavailable.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows an empty state when no users match the search', async () => {
    vi.spyOn(growthUsersApi, 'list').mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('No Growth OS users match this search.')).toBeInTheDocument();
  });

  it('matches the user search contract and caps the query at 120 characters', async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(growthUsersApi, 'list').mockResolvedValue([adminUser]);
    renderPage();
    await screen.findByText('Ada Mensah');

    const search = screen.getByLabelText('Search users');
    expect(search).toHaveAttribute('placeholder', 'Name or email');
    expect(search).toHaveAttribute('maxLength', '120');

    await user.type(search, 'x'.repeat(130));
    await user.click(screen.getByRole('button', { name: 'Apply search' }));

    await waitFor(() => expect(list).toHaveBeenLastCalledWith('x'.repeat(120)));
  });
});
