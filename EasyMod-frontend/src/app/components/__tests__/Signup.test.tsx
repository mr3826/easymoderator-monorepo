import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Signup from '../Signup';

const mockSignup = vi.fn();

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ signup: mockSignup }),
}));

vi.mock('@/app/lib/funnel', () => ({
  trackFunnelEvent: vi.fn(),
}));

function renderSignup() {
  return render(
    <MemoryRouter>
      <Signup />
    </MemoryRouter>,
  );
}

async function fillValidFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Full Name'), 'Consent Test User');
  await user.type(screen.getByLabelText('Email Address'), 'consent-test@example.com');
  await user.type(screen.getByLabelText(/Mobile Number/i), '01712345678');
  await user.type(screen.getByLabelText('Password'), 'ValidPass123!');
}

describe('Signup terms consent', () => {
  beforeEach(() => {
    mockSignup.mockReset();
    mockSignup.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with a disabled submit button and visible consent guidance', () => {
    renderSignup();

    expect(screen.getByRole('button', { name: /create account and start setup/i })).toBeDisabled();
    expect(screen.getByText(/accept the terms & conditions to create your account/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', expect.stringContaining('/privacy-policy'));
    expect(screen.getByRole('link', { name: /terms of service/i })).toHaveAttribute('href', expect.stringContaining('/terms'));
  });

  it('does not submit or enter a pending state when consent is missing', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderSignup();
    await fillValidFields(user);

    const submit = screen.getByRole('button', { name: /create account and start setup/i });
    const form = submit.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/accept the terms/i);
    });
    expect(mockSignup).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /create account and start setup/i })).not.toHaveTextContent(/creating account/i);
    expect(consoleError).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox', { name: /privacy policy/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('enables consented signup and sends exactly one consented request', async () => {
    const user = userEvent.setup();
    let resolveSignup!: () => void;
    mockSignup.mockImplementation(() => new Promise<void>((resolve) => {
      resolveSignup = resolve;
    }));
    renderSignup();
    await fillValidFields(user);

    const terms = screen.getByRole('checkbox', { name: /privacy policy/i });
    const submit = screen.getByRole('button', { name: /create account and start setup/i });
    expect(submit).toBeDisabled();
    await user.click(terms);
    expect(submit).toBeEnabled();

    const firstSubmit = user.click(submit);
    await waitFor(() => expect(mockSignup).toHaveBeenCalledTimes(1));
    expect(submit).toBeDisabled();
    expect(screen.getByText(/creating account/i)).toBeInTheDocument();

    await user.click(submit);
    expect(mockSignup).toHaveBeenCalledTimes(1);
    expect(mockSignup).toHaveBeenCalledWith({
      email: 'consent-test@example.com',
      password: 'ValidPass123!',
      full_name: 'Consent Test User',
      phone: '01712345678',
      accepted_terms: true,
    });

    resolveSignup();
    await firstSubmit;
  });

  it('re-enables the button and presents a normal error after signup failure', async () => {
    const user = userEvent.setup();
    mockSignup.mockRejectedValue(new Error('Email is already registered'));
    renderSignup();
    await fillValidFields(user);
    await user.click(screen.getByRole('checkbox', { name: /privacy policy/i }));
    const submit = screen.getByRole('button', { name: /create account and start setup/i });

    await user.click(submit);

    await waitFor(() => expect(screen.getByText('Email is already registered')).toBeInTheDocument());
    expect(submit).toBeEnabled();
  });

  it('ignores duplicate programmatic submissions while signup is pending', async () => {
    const user = userEvent.setup();
    let resolveSignup!: () => void;
    mockSignup.mockImplementation(() => new Promise<void>((resolve) => {
      resolveSignup = resolve;
    }));
    renderSignup();
    await fillValidFields(user);
    await user.click(screen.getByRole('checkbox', { name: /privacy policy/i }));

    const submit = screen.getByRole('button', { name: /create account and start setup/i });
    const form = submit.closest('form');
    expect(form).not.toBeNull();
    form!.requestSubmit();
    form!.requestSubmit();

    await waitFor(() => expect(mockSignup).toHaveBeenCalledTimes(1));
    expect(submit).toBeDisabled();
    resolveSignup();
    await waitFor(() => expect(submit).toBeEnabled());
  });
});
