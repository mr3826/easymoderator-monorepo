import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';
import { useAuth } from '@/auth/AuthProvider';
import LoginScreen from '@/app/login';

jest.mock('@/auth/AuthProvider', () => ({ useAuth: jest.fn() }));

const mockedUseAuth = jest.mocked(useAuth);

beforeEach(() => {
  mockedUseAuth.mockReturnValue({
    status: 'signedOut',
    user: null,
    signIn: jest.fn(),
    verifyTwoFactor: jest.fn(),
    cancelTwoFactor: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn(),
  });
});

it('renders a localized verification state for the explicit MFA handoff', async () => {
  const signIn = jest.fn().mockResolvedValue({ ok: false, requires2fa: true, tempToken: 'fake-temp-token' });
  mockedUseAuth.mockReturnValue({
    status: 'signedOut',
    user: null,
    signIn,
    verifyTwoFactor: jest.fn(),
    cancelTwoFactor: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn(),
  });

  render(<LoginScreen />);
  fireEvent.changeText(screen.getByTestId('login-email-input'), 'merchant@example.test');
  fireEvent.changeText(screen.getByTestId('login-password-input'), 'password');
  fireEvent.press(screen.getByTestId('login-submit'));

  await waitFor(() => {
    expect(screen.getByText(i18n.t('auth.twoFactor.title'))).toBeTruthy();
  });
  expect(signIn).toHaveBeenCalledWith('merchant@example.test', 'password');
  expect(screen.getByTestId('login-2fa-input').props.keyboardType).toBe('number-pad');
  expect(screen.getByTestId('login-2fa-input').props.maxLength).toBe(6);
});

it('sanitizes pasted input and verifies with the in-memory challenge token', async () => {
  const signIn = jest.fn().mockResolvedValue({ ok: false, requires2fa: true, tempToken: 'fake-temp-token' });
  const verifyTwoFactor = jest.fn().mockResolvedValue({ ok: true });
  mockedUseAuth.mockReturnValue({
    status: 'signedOut',
    user: null,
    signIn,
    verifyTwoFactor,
    cancelTwoFactor: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn(),
  });

  render(<LoginScreen />);
  fireEvent.changeText(screen.getByTestId('login-email-input'), 'merchant@example.test');
  fireEvent.changeText(screen.getByTestId('login-password-input'), 'password');
  fireEvent.press(screen.getByTestId('login-submit'));
  await screen.findByTestId('login-2fa-input');

  fireEvent.changeText(screen.getByTestId('login-2fa-input'), '12a345678');
  expect(screen.getByTestId('login-2fa-input').props.value).toBe('123456');
  fireEvent.press(screen.getByTestId('login-2fa-submit'));

  await waitFor(() => expect(verifyTwoFactor).toHaveBeenCalledWith('fake-temp-token', '123456'));
});

it('rejects an incomplete code locally without sending it to the backend', async () => {
  const signIn = jest.fn().mockResolvedValue({ ok: false, requires2fa: true, tempToken: 'fake-temp-token' });
  const verifyTwoFactor = jest.fn();
  mockedUseAuth.mockReturnValue({
    status: 'signedOut',
    user: null,
    signIn,
    verifyTwoFactor,
    cancelTwoFactor: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn(),
  });

  render(<LoginScreen />);
  fireEvent.changeText(screen.getByTestId('login-email-input'), 'merchant@example.test');
  fireEvent.changeText(screen.getByTestId('login-password-input'), 'password');
  fireEvent.press(screen.getByTestId('login-submit'));
  await screen.findByTestId('login-2fa-input');
  fireEvent.changeText(screen.getByTestId('login-2fa-input'), '12345');
  fireEvent.press(screen.getByTestId('login-2fa-submit'));

  expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t('auth.twoFactor.errors.codeRequired'));
  expect(verifyTwoFactor).not.toHaveBeenCalled();
});

it.each([
  ['invalidCode', 'validation', 'Invalid TOTP token'],
  ['replay', 'validation', 'TOTP token already used. Please wait for the next code.'],
  ['expired', 'unauthorized', 'Invalid or expired session. Please login again.'],
  ['rateLimited', 'rateLimited', 'Too many 2FA attempts. Please try again later.'],
] as const)('localizes the backend %s verification error', async (errorKey, kind, message) => {
  const signIn = jest.fn().mockResolvedValue({ ok: false, requires2fa: true, tempToken: 'fake-temp-token' });
  const verifyTwoFactor = jest.fn().mockResolvedValue({ ok: false, kind, message });
  mockedUseAuth.mockReturnValue({
    status: 'signedOut',
    user: null,
    signIn,
    verifyTwoFactor,
    cancelTwoFactor: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn(),
  });

  render(<LoginScreen />);
  fireEvent.changeText(screen.getByTestId('login-email-input'), 'merchant@example.test');
  fireEvent.changeText(screen.getByTestId('login-password-input'), 'password');
  fireEvent.press(screen.getByTestId('login-submit'));
  await screen.findByTestId('login-2fa-input');
  fireEvent.changeText(screen.getByTestId('login-2fa-input'), '123456');
  fireEvent.press(screen.getByTestId('login-2fa-submit'));

  expect(await screen.findByRole('alert')).toHaveTextContent(i18n.t(`auth.twoFactor.errors.${errorKey}`));
  if (errorKey !== 'rateLimited') {
    expect(screen.getByTestId('login-2fa-submit').props.disabled).toBe(true);
  }
});

it('cancels the challenge without navigating into the authenticated app', async () => {
  const signIn = jest.fn().mockResolvedValue({ ok: false, requires2fa: true, tempToken: 'fake-temp-token' });
  const cancelTwoFactor = jest.fn().mockResolvedValue(undefined);
  mockedUseAuth.mockReturnValue({
    status: 'signedOut',
    user: null,
    signIn,
    verifyTwoFactor: jest.fn(),
    cancelTwoFactor,
    logout: jest.fn(),
  });

  render(<LoginScreen />);
  fireEvent.changeText(screen.getByTestId('login-email-input'), 'merchant@example.test');
  fireEvent.changeText(screen.getByTestId('login-password-input'), 'password');
  fireEvent.press(screen.getByTestId('login-submit'));
  await screen.findByTestId('login-2fa-input');
  fireEvent.press(screen.getByTestId('login-2fa-cancel'));

  await waitFor(() => expect(screen.getByTestId('login-email-input')).toBeTruthy());
  expect(cancelTwoFactor).toHaveBeenCalledTimes(1);
});

it.each([
  [{ ok: false, kind: 'validation', message: 'Invalid TOTP token' }, 'invalidCode'],
  [{ ok: false, kind: 'unauthorized', message: 'Invalid or expired session. Please login again.' }, 'expired'],
  [{ ok: false, kind: 'rateLimited', message: 'Too many 2FA attempts.' }, 'rateLimited'],
] as const)('exposes a stable, locale-independent error identity for %j', async (outcome, code) => {
  const signIn = jest.fn().mockResolvedValue({ ok: false, requires2fa: true, tempToken: 'fake-temp-token' });
  mockedUseAuth.mockReturnValue({
    status: 'signedOut',
    user: null,
    signIn,
    verifyTwoFactor: jest.fn().mockResolvedValue(outcome),
    cancelTwoFactor: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn(),
  });

  render(<LoginScreen />);
  fireEvent.changeText(screen.getByTestId('login-email-input'), 'merchant@example.test');
  fireEvent.changeText(screen.getByTestId('login-password-input'), 'password');
  fireEvent.press(screen.getByTestId('login-submit'));
  fireEvent.changeText(await screen.findByTestId('login-2fa-input'), '123456');
  fireEvent.press(screen.getByTestId('login-2fa-submit'));

  const error = await screen.findByTestId(`login-2fa-error-${code}`);
  expect(error.props.children).toBe(i18n.t(`auth.twoFactor.errors.${code}`));
});

it('sends one sign-in request when the submit button is tapped twice before it re-renders', async () => {
  let resolveSignIn: (value: { ok: boolean; message?: string }) => void = () => undefined;
  const signIn = jest.fn(
    () => new Promise<{ ok: boolean; message?: string }>((resolve) => {
      resolveSignIn = resolve;
    }),
  );
  mockedUseAuth.mockReturnValue({
    status: 'signedOut',
    user: null,
    signIn,
    verifyTwoFactor: jest.fn(),
    cancelTwoFactor: jest.fn().mockResolvedValue(undefined),
    logout: jest.fn(),
  });

  render(<LoginScreen />);
  fireEvent.changeText(screen.getByTestId('login-email-input'), 'merchant@example.test');
  fireEvent.changeText(screen.getByTestId('login-password-input'), 'password');

  // Both taps land on the same rendered handler, before `submitting` disables the button.
  const [submit] = screen.UNSAFE_root.findAll(
    (node) => node.props.testID === 'login-submit' && typeof node.props.onPress === 'function',
  );
  const { onPress } = submit.props;
  act(() => {
    void onPress();
    void onPress();
  });

  expect(signIn).toHaveBeenCalledTimes(1);
  await act(async () => {
    resolveSignIn({ ok: false, message: 'Invalid credentials' });
  });
  expect(await screen.findByTestId('login-error')).toHaveTextContent('Invalid credentials');
});
