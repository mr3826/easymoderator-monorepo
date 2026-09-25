import React from 'react';
import { Pressable, Text } from 'react-native';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';

import { AuthProvider, useAuth } from './AuthProvider';
import { __resetTokenStoreForTests, setAccessToken } from './token-store';
import { clearRefreshToken, setRefreshToken } from './secure-store';
import { refreshAccessToken, logout as logoutRequest } from './auth-client';
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
  // Phase 2 Home lane: `logout` is mocked too (rather than left as the real implementation) so
  // the new "logout clears the query cache" test below never makes a real network call — the real
  // `logoutRequest` hits `fetchTransport`, which has no server to talk to under Jest.
  logout: jest.fn(),
}));

function Probe() {
  const { status, user, logout } = useAuth();
  return (
    <>
      <Text testID="probe">{`${status}:${user?.id ?? 'none'}:${user?.shopId ?? 'none'}`}</Text>
      <Pressable testID="logout-button" onPress={() => void logout()}>
        <Text>logout</Text>
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

beforeEach(async () => {
  __resetTokenStoreForTests();
  await clearRefreshToken();
  mockedRefreshAccessToken.mockReset();
  mockedLogoutRequest.mockReset();
  mockedLogoutRequest.mockResolvedValue(undefined);
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

describe('AuthProvider logout clears the query cache (Phase 2 Home lane, cross-shop isolation)', () => {
  it('clears every cached query on logout, so a later sign-in never serves a previous shop\'s cached data', async () => {
    // Seeds the cache the way `useAttention`/`useToday` actually key it (`@/api/mobile/queryKeys.ts`)
    // — this is deliberately not an arbitrary key, to prove the exact real cache entries this lane
    // introduces are the ones being protected here.
    queryClient.setQueryData(['mobile', 'attention', 'shop-1'], { items: [] });
    queryClient.setQueryData(['mobile', 'today', 'shop-1'], { order_count: 0 });
    expect(queryClient.getQueryData(['mobile', 'attention', 'shop-1'])).toBeDefined();

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId('probe')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('logout-button'));

    await waitFor(() => {
      expect(mockedLogoutRequest).toHaveBeenCalledTimes(1);
    });
    expect(queryClient.getQueryData(['mobile', 'attention', 'shop-1'])).toBeUndefined();
    expect(queryClient.getQueryData(['mobile', 'today', 'shop-1'])).toBeUndefined();
  });
});
