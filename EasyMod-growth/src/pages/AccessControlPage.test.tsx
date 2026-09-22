import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, growthUsersApi, type GrowthUserRow } from '@/api/client';
import { AccessControlPage } from './AccessControlPage';

const reportApiError = vi.fn(() => false);
vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({ reportApiError }),
}));

const users: GrowthUserRow[] = [
  {
    userId: 'user-1',
    email: 'ada@easymod.test',
    displayName: 'Ada Mensah',
    role: 'SUPER_ADMIN',
    legacyRole: null,
    status: 'active',
    mfaEnabled: true,
    grantedAt: '2026-05-01T00:00:00.000Z',
    revokedAt: null,
    lastLoginAt: null,
  },
  {
    userId: 'user-2',
    email: 'kwame@easymod.test',
    displayName: 'Kwame Boateng',
    role: 'GROWTH_USER',
    legacyRole: null,
    status: 'suspended',
    mfaEnabled: false,
    grantedAt: '2026-06-15T00:00:00.000Z',
    revokedAt: null,
    lastLoginAt: null,
  },
  {
    userId: 'user-3',
    email: 'efua@easymod.test',
    displayName: 'Efua Sarpong',
    role: 'GROWTH_USER',
    legacyRole: null,
    status: 'revoked',
    mfaEnabled: false,
    grantedAt: '2026-06-16T00:00:00.000Z',
    revokedAt: '2026-08-01T00:00:00.000Z',
    lastLoginAt: null,
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/access-control']}>
      <AccessControlPage />
    </MemoryRouter>,
  );
}

describe('AccessControlPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('explains the two-role model and shows read-only counts', async () => {
    vi.spyOn(growthUsersApi, 'list').mockResolvedValue(users);
    renderPage();

    expect(await screen.findByText('What each role can do')).toBeInTheDocument();
    expect(screen.getAllByText(/SUPER_ADMIN/).length).toBeGreaterThan(0);
    expect(screen.getByText(/GROWTH_USER/)).toBeInTheDocument();
    expect(screen.getByText(/no self-registration/i)).toBeInTheDocument();
    expect(screen.getByText(/last super admin/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Growth users page' })).toHaveAttribute('href', '/growth-users');

    await waitFor(() => {
      expect(screen.getByText('Access counts')).toBeInTheDocument();
    });
    const facts = document.querySelector('.detail-facts');
    expect(facts).not.toBeNull();
    expect(facts?.textContent).toContain('Total users3');
    expect(facts?.textContent).toContain('Super Admins1');
    expect(facts?.textContent).toContain('Growth users2');
    expect(facts?.textContent).toContain('Active1');
    expect(facts?.textContent).toContain('Suspended1');
    expect(facts?.textContent).toContain('Revoked1');
  });

  it('renders no controls that change policy', async () => {
    vi.spyOn(growthUsersApi, 'list').mockResolvedValue(users);
    renderPage();
    await screen.findByText('Access counts');

    expect(screen.queryByRole('button', { name: /suspend|revoke|role|password/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('shows an error state with retry when counts cannot load', async () => {
    vi.spyOn(growthUsersApi, 'list').mockRejectedValue(new ApiError('User admin directory is unavailable.', 503));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent('User admin directory is unavailable.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('handles an empty population without breaking counts', async () => {
    vi.spyOn(growthUsersApi, 'list').mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('No Growth OS users have been granted access yet.')).toBeInTheDocument();
    expect(document.querySelector('.detail-facts')?.textContent).toContain('Total users0');
  });
});
