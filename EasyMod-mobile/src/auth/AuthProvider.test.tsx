import React from 'react';
import { Text } from 'react-native';
import { render, screen, waitFor } from '@testing-library/react-native';

import { AuthProvider, useAuth } from './AuthProvider';
import { __resetTokenStoreForTests, setAccessToken } from './token-store';
import { clearRefreshToken, setRefreshToken } from './secure-store';
import { refreshAccessToken } from './auth-client';

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
}));

function Probe() {
  const { status, user } = useAuth();
  return <Text testID="probe">{`${status}:${user?.id ?? 'none'}:${user?.shopId ?? 'none'}`}</Text>;
}

// `jest.mocked` (not a bare `as jest.Mock` cast) keeps `mockImplementation`'s return value
// type-checked against the real `refreshAccessToken` signature (`Promise<RefreshedSession | null>`
// from `auth-client.ts`) — if that shape ever drifts, this test fails to typecheck, not just at
// runtime, reinforcing the same drift-prevention goal as the fixture contract test.
const mockedRefreshAccessToken = jest.mocked(refreshAccessToken);

beforeEach(async () => {
  __resetTokenStoreForTests();
  await clearRefreshToken();
  mockedRefreshAccessToken.mockReset();
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
