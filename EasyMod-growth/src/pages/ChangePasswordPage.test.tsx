import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangePasswordPage } from './ChangePasswordPage';

const authState = vi.hoisted(() => ({
  status: 'password-change-required' as const,
  session: null,
  error: null,
  twoFactorRequired: false,
  temporaryPasswordExpiresAt: '2026-09-15T12:00:00.000Z',
  changePassword: vi.fn(),
}));

vi.mock('@/auth/GrowthAuthProvider', () => ({
  useGrowthAuth: () => authState,
}));

describe('ChangePasswordPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('requires a strong new password and submits the temporary credential', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChangePasswordPage />
      </MemoryRouter>,
    );

    expect(screen.getByText(/temporary password by/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Temporary password'), 'temporary-password');
    await user.type(screen.getByLabelText('New password'), 'weak-password');
    await user.type(screen.getByLabelText('Confirm new password'), 'weak-password');
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/uppercase/i);
    expect(authState.changePassword).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('New password'));
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('New password'), 'New-password-123!');
    await user.type(screen.getByLabelText('Confirm new password'), 'New-password-123!');
    await user.click(screen.getByRole('button', { name: 'Save password' }));

    expect(authState.changePassword).toHaveBeenCalledWith('temporary-password', 'New-password-123!');
  });
});
