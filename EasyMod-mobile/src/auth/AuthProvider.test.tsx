import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider, useAuth } from './AuthProvider';
import { __resetTokenStoreForTests, setAccessToken } from './token-store';
import { clearRefreshToken, setRefreshToken } from './secure-store';
import { logout as logoutRequest, refreshAccessToken, signIn as signInRequest } from './auth-client';
import { queryClient } from '@/lib/queryClient';

/**
 * Phase 2 contract fix (bug #4 in the mobile/p2-contract lane): before this fix, a cold-start
 * silent refresh restored an access token but discarded the user entirely — `refreshAccessToken()`
 * resolved a bare token string, and `AuthProvider` never read anything else out of it. `status`
 * became `'signedIn'` while `user` stayed `null` forever, so any screen keying a query on `shopId`
 * got `undefined` on every app relaunch. The backend's `/refresh` now additively returns the same
 * `shopId`/`safeUser(user)` shape signin does, and `refreshAccessToken()` resolves both — this test
 * proves `AuthProvider` actually stores what it gets back, not just the token.
 */
jest.mock('./auth-client', () => ({
  ...jest.requireActual('./auth-client'),
  refreshAccessToken: jest.fn(),
  logout: jest.fn(),
  signIn: jest.fn(),
}));

function Probe() {
  const { status, user, logout, signIn } = useAuth();
  return (
    <>
      <Text testID="probe">{`${status}:${user?.id ?? 'none'}:${user?.shopId ?? 'none'}`}</Text>
      <Pressable testID="logout-button" onPress={() => void logout()}>
        <Text>logout</Text>
      </Pressable>
      <Pressable testID="sign-in-button" onPress={() => void signIn('account-b@example.test', 'password')}>
        <Text>sign in</Text>
      </Pressable>
    </>
  );
}

// `jest.mocked` (not a bare `as jest.Mock` cast) keeps `mockImplementation`'s return value
// type-checked against the real `refreshAccessToken` signature (`Promise<RefreshedSession | null>`
// from `auth-client.ts`) — if that shape ever drifts, this test fails to typecheck, not just at
// runtime, reinforcing the same drift-prevention goal as the fixture contract test.
const mockedRefreshAccessToken = jest.mocked(refreshAccessToken);
const mockedLogoutRequest = jest.mocked(logoutRequest);
const mockedSignInRequest = jest.mocked(signInRequest);

const USER_ONE = {
  id: 'user-1',
  email: 'account-a@example.test',
  full_name: null,
  phone: null,
  profile_picture: null,
  shopId: 'shop-1',
};

const USER_TWO = {
  id: 'user-2',
  email: 'account-b@example.test',
  full_name: null,
  phone: null,
  profile_picture: null,
  shopId: 'shop-2',
};

beforeEach(async () => {
  __resetTokenStoreForTests();
  await clearRefreshToken();
  mockedRefreshAccessToken.mockReset();
  mockedLogoutRequest.mockReset();
  mockedLogoutRequest.mockResolvedValue(true);
  mockedSignInRequest.mockReset();
  queryClient.clear();
});

describe('AuthProvider cold-start refresh', () => {
  it('restores `user` (including shopId) from a successful cold-start refresh, not just the token', async () => {
    await setRefreshToken('stored-refresh-token');
    mockedRefreshAccessToken.mockImplementation(async () => {
      // Mirrors the real `performRefresh`'s side effect (setAccessToken), which this mock
      // otherwise bypasses by replacing the whole module.
      setAccessToken('new-access-token');
      return {
        accessToken: 'new-access-token',
        user: {
          id: 'user-1',
          email: 'merchant@example.test',
          full_name: null,
          phone: null,
          profile_picture: null,
          shopId: 'shop-1',
        },
      };
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('probe').props.children).toBe('signedIn:user-1:shop-1');
    });
  });

  it('leaves user null and status signedOut when there is no stored refresh token (no regression)', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('probe').props.children).toBe('signedOut:none:none');
    });
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});

describe('AuthProvider auth-transition cache isolation', () => {
  it('clears cached Home data before another shop can render it', async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
    queryClient.setQueryData(['mobile', 'attention', 'shop-1'], { items: [] });
    queryClient.setQueryData(['mobile', 'today', 'shop-1'], { order_count: 0 });

    fireEvent.press(screen.getByTestId('logout-button'));

    await waitFor(() => expect(mockedLogoutRequest).toHaveBeenCalledTimes(1));
    expect(queryClient.getQueryData(['mobile', 'attention', 'shop-1'])).toBeUndefined();
    expect(queryClient.getQueryData(['mobile', 'today', 'shop-1'])).toBeUndefined();
  });

  it('clears Home data when automatic token expiry transitions the provider to signed out', async () => {
    await setRefreshToken('stored-refresh-token');
    mockedRefreshAccessToken.mockImplementation(async () => {
      setAccessToken('access-token');
      return { accessToken: 'access-token', user: USER_ONE };
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedIn:user-1:shop-1'));
    queryClient.setQueryData(['mobile', 'attention', 'shop-1'], { items: ['account-a'] });

    act(() => setAccessToken(null));

    await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedOut:none:none'));
    expect(queryClient.getQueryData(['mobile', 'attention', 'shop-1'])).toBeUndefined();
  });

  it('clears the previous shop cache when sign-in changes the signed-in account', async () => {
    await setRefreshToken('stored-refresh-token');
    mockedRefreshAccessToken.mockImplementation(async () => {
      setAccessToken('account-a-access');
      return { accessToken: 'account-a-access', user: USER_ONE };
    });
    mockedSignInRequest.mockImplementation(async () => {
      setAccessToken('account-b-access');
      return { ok: true, data: USER_TWO };
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedIn:user-1:shop-1'));
    queryClient.setQueryData(['mobile', 'attention', 'shop-1'], { items: ['account-a'] });

    fireEvent.press(screen.getByTestId('sign-in-button'));

    await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedIn:user-2:shop-2'));
    expect(queryClient.getQueryData(['mobile', 'attention', 'shop-1'])).toBeUndefined();
  });

  it('does not wipe a newer session when a superseded logout settles late', async () => {
    await setRefreshToken('stored-refresh-token');
    mockedRefreshAccessToken.mockImplementation(async () => {
      setAccessToken('account-a-access');
      return { accessToken: 'account-a-access', user: USER_ONE };
    });
    let settleLogout: (applied: boolean) => void = () => undefined;
    mockedLogoutRequest.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          settleLogout = resolve;
        }),
    );
    mockedSignInRequest.mockImplementation(async () => {
      setAccessToken('account-b-access');
      return { ok: true, data: USER_TWO };
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedIn:user-1:shop-1'));

    fireEvent.press(screen.getByTestId('logout-button'));
    await waitFor(() => expect(mockedLogoutRequest).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByTestId('sign-in-button'));
    await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedIn:user-2:shop-2'));
    queryClient.setQueryData(['mobile', 'attention', 'shop-2'], { items: ['account-b'] });

    // The client reports the stale logout as superseded; the provider must leave account B intact.
    await act(async () => settleLogout(false));

    expect(screen.getByTestId('probe').props.children).toBe('signedIn:user-2:shop-2');
    expect(queryClient.getQueryData(['mobile', 'attention', 'shop-2'])).toEqual({ items: ['account-b'] });
  });

  it('clears the user and cache when the logout it started is the one that completes', async () => {
    await setRefreshToken('stored-refresh-token');
    mockedRefreshAccessToken.mockImplementation(async () => {
      setAccessToken('account-a-access');
      return { accessToken: 'account-a-access', user: USER_ONE };
    });
    mockedLogoutRequest.mockImplementation(async () => {
      setAccessToken(null);
      return true;
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedIn:user-1:shop-1'));
    queryClient.setQueryData(['mobile', 'attention', 'shop-1'], { items: ['account-a'] });

    fireEvent.press(screen.getByTestId('logout-button'));

    await waitFor(() => expect(screen.getByTestId('probe').props.children).toBe('signedOut:none:none'));
    expect(queryClient.getQueryData(['mobile', 'attention', 'shop-1'])).toBeUndefined();
  });
});
