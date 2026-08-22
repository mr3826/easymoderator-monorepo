import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePermission } from '@/auth/usePermission';
import { GrowthShell } from './GrowthShell';

vi.mock('@/auth/usePermission', () => ({
  PROSPECT_READ_PERMISSIONS: ['growth_os.prospects.read_all'],
  usePermission: vi.fn(),
}));

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => ({
    session: {
      displayName: 'Growth User',
      role: 'MARKETER',
      permissions: [],
    },
    error: null,
    logout: vi.fn(),
  }),
}));

const permissionMock = vi.mocked(usePermission);

describe('GrowthShell', () => {
  afterEach(() => vi.clearAllMocks());

  it('hides the prospects navigation item without a prospect read permission', () => {
    permissionMock.mockReturnValue(false);

    render(
      <MemoryRouter>
        <GrowthShell />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: 'Prospects' })).not.toBeInTheDocument();
  });

  it('shows the prospects navigation item when the role can read prospects', () => {
    permissionMock.mockReturnValue(true);

    render(
      <MemoryRouter>
        <GrowthShell />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Prospects' })).toHaveAttribute('href', '/prospects');
  });
});
