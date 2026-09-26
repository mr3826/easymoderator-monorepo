import {
  cancelTwoFactor,
  logout,
  signIn,
  verifyTwoFactor,
  refreshAccessToken,
  __resetRefreshGuardForTests,
} from './auth-client';
import { getAccessToken, __resetTokenStoreForTests, setAccessToken } from './token-store';
import {
  clearRefreshToken,
  getRefreshToken,
  getSessionIdentity,
  setRefreshToken,
  setSessionIdentity,
} from './secure-store';
import type { HttpResponse, RequestOptions, Transport } from '@/api/transport';

function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

/** A real backend success envelope shape (`native-auth.controller.js`'s `res.json({success,message,data})`). */
function envelope(data: unknown): unknown {
  return { success: true, message: 'ok', data };
}

const FIXTURE_USER = {
  id: 'user-1',
  email: 'merchant@example.test',
  full_name: 'Test Merchant',
  phone: null,
  profile_picture: null,
};

function createFakeTransport(handler: (path: string, options?: RequestOptions) => Promise<HttpResponse>): Transport {
  return { request: jest.fn(handler) };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  __resetTokenStoreForTests();
  __resetRefreshGuardForTests();
  await clearRefreshToken();
});

describe('signIn (envelope unwrap + shopId sourcing, Phase 2 contract fix)', () => {
  it('unwraps the {success,message,data} envelope and reads shopId from data.shopId, not user.shopId', async () => {
    const transport = createFakeTransport(async () =>
      jsonResponse(
        200,
        envelope({
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          sid: 'sid-1',
          shopId: 'shop-1',
          // Deliberately no `shopId` key here — the backend's safeUser() never has one; a
          // pre-Phase-2 client that expected `user.shopId` would silently read `undefined`.
          user: { id: 'user-1', email: 'merchant@example.test', full_name: 'Merchant', phone: null, profile_picture: null },
        }),
      ),
    );

    const result = await signIn('merchant@example.test', 'hunter2', { transport });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if ('requires2fa' in result.data) throw new Error('Expected a token response');
    expect(result.data.shopId).toBe('shop-1');
    expect(result.data.id).toBe('user-1');
    expect(getAccessToken()).toBe('access-1');
    await expect(getRefreshToken()).resolves.toBe('refresh-1');
    await expect(getSessionIdentity()).resolves.toEqual({
      id: 'user-1',
      email: 'merchant@example.test',
      full_name: 'Merchant',
      phone: null,
      profile_picture: null,
      shopId: 'shop-1',
    });
  });

  it('reports an unexpected-shape error on a raw (unwrapped) body instead of silently misparsing it', async () => {
    const transport = createFakeTransport(async () =>
      // The pre-fix bug: parsing the raw body directly (no `data` envelope) used to be exactly
      // what the client did, and would fail exactly this way against a real server.
      jsonResponse(200, {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        user: { id: 'user-1', email: 'merchant@example.test' },
      }),
    );

    const result = await signIn('merchant@example.test', 'hunter2', { transport });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('Unexpected sign-in response shape from server.');
    }
  });

  it('returns the backend MFA handoff explicitly without installing a session', async () => {
    await setRefreshToken('previous-session-refresh-token');
    setAccessToken('previous-session-access-token');
    const transport = createFakeTransport(async () =>
      jsonResponse(200, envelope({ requires2fa: true, tempToken: 'temporary-2fa-token' })),
    );

    const result = await signIn('merchant@example.test', 'hunter2', { transport });

    expect(result).toEqual({ ok: true, data: { requires2fa: true, tempToken: 'temporary-2fa-token' } });
    expect(getAccessToken()).toBeNull();
    await expect(getRefreshToken()).resolves.toBeNull();
  });

  it('sends the native logout refresh proof using the backend snake_case contract', async () => {
    await setRefreshToken('logout-refresh-token');
    setAccessToken('logout-access-token');
    const transport = createFakeTransport(async () => jsonResponse(200, {}));

    await setSessionIdentity({ ...FIXTURE_USER, shopId: 'shop-1' });

    await expect(logout({ transport })).resolves.toBe(true);

    expect(transport.request).toHaveBeenCalledWith(
      '/api/auth/native/logout',
      expect.objectContaining({ method: 'POST', body: { refresh_token: 'logout-refresh-token' } }),
    );
    expect(getAccessToken()).toBeNull();
    await expect(getRefreshToken()).resolves.toBeNull();
    await expect(getSessionIdentity()).resolves.toBeNull();
  });

  it('reports a logout superseded by a newer sign-in and leaves that session installed', async () => {
    await setRefreshToken('account-a-refresh-token');
    setAccessToken('account-a-access-token');
    const logoutResponse = deferred<HttpResponse>();
    const logoutStarted = deferred<void>();
    const transport = createFakeTransport(async (path) => {
      if (path === '/api/auth/native/logout') {
        logoutStarted.resolve();
        return logoutResponse.promise;
      }
      if (path === '/api/auth/native/signin') {
        return jsonResponse(
          200,
          envelope({
            accessToken: 'account-b-access-token',
            refreshToken: 'account-b-refresh-token',
            sid: 'account-b-sid',
            shopId: 'shop-b',
            user: FIXTURE_USER,
          }),
        );
      }
      throw new Error(`unexpected path ${path}`);
    });

    const pendingLogout = logout({ transport });
    await logoutStarted.promise;
    await expect(signIn('account-b@example.test', 'password', { transport })).resolves.toMatchObject({ ok: true });
    logoutResponse.resolve(jsonResponse(200, {}));

    await expect(pendingLogout).resolves.toBe(false);
    expect(getAccessToken()).toBe('account-b-access-token');
    await expect(getRefreshToken()).resolves.toBe('account-b-refresh-token');
  });

  it('does not block refresh after a failed sign-in transition', async () => {
    await setRefreshToken('existing-refresh-token');
    const transport = createFakeTransport(async (path) => {
      if (path === '/api/auth/native/signin') return jsonResponse(401, { message: 'Invalid credentials' });
      if (path === '/api/auth/native/refresh') {
        return jsonResponse(
          200,
          envelope({ accessToken: 'refreshed-access', refreshToken: 'rotated-refresh', shopId: 'shop-1', user: FIXTURE_USER }),
        );
      }
      throw new Error(`unexpected path ${path}`);
    });

    await expect(signIn('merchant@example.test', 'wrong-password', { transport })).resolves.toMatchObject({ ok: false });
    await expect(refreshAccessToken({ transport })).resolves.toMatchObject({ accessToken: 'refreshed-access' });
    expect(transport.request).toHaveBeenCalledTimes(2);
  });

  it('does not let a stale MFA handoff clear a newer signed-in session', async () => {
    const firstResponse = deferred<HttpResponse>();
    const firstRequestStarted = deferred<void>();
    let signinCalls = 0;
    const transport = createFakeTransport(async () => {
      signinCalls += 1;
      if (signinCalls === 1) {
        firstRequestStarted.resolve();
        return firstResponse.promise;
      }
      return jsonResponse(
        200,
        envelope({
          accessToken: 'account-b-access',
          refreshToken: 'account-b-refresh-token',
          sid: 'account-b-sid',
          shopId: 'shop-b',
          user: { ...FIXTURE_USER, id: 'user-b', email: 'b@example.test' },
        }),
      );
    });

    const pendingMfaSignIn = signIn('a@example.test', 'password', { transport });
    await firstRequestStarted.promise;
    await expect(signIn('b@example.test', 'password', { transport })).resolves.toMatchObject({ ok: true });

    firstResponse.resolve(jsonResponse(200, envelope({ requires2fa: true, tempToken: 'stale-temp-token' })));

    await expect(pendingMfaSignIn).resolves.toMatchObject({ ok: false });
    expect(getAccessToken()).toBe('account-b-access');
    await expect(getRefreshToken()).resolves.toBe('account-b-refresh-token');
  });
});

describe('verifyTwoFactor (native MFA handoff)', () => {
  it('posts the exact native challenge/code body and installs a session only after success', async () => {
    const transport = createFakeTransport(async () =>
      jsonResponse(
        200,
        envelope({
          accessToken: 'verified-access-token',
          refreshToken: 'verified-refresh-token',
          sid: 'sid-verified',
          shopId: 'shop-1',
          user: FIXTURE_USER,
        }),
      ),
    );

    const result = await verifyTwoFactor('fake-temp-token', '123456', { transport });

    expect(result).toEqual({ ok: true, data: { ...FIXTURE_USER, shopId: 'shop-1' } });
    expect(transport.request).toHaveBeenCalledWith('/api/auth/native/2fa/verify', {
      method: 'POST',
      body: { tempToken: 'fake-temp-token', token: '123456' },
      skipAuth: true,
    });
    expect(getAccessToken()).toBe('verified-access-token');
    await expect(getRefreshToken()).resolves.toBe('verified-refresh-token');
  });

  it('returns an expired-challenge error without installing any session credential', async () => {
    const transport = createFakeTransport(async () =>
      jsonResponse(401, {
        success: false,
        message: 'Invalid or expired session. Please login again.',
        code: 'INTERNAL_ERROR',
      }),
    );

    const result = await verifyTwoFactor('expired-temp-token', '123456', { transport });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'unauthorized',
        message: 'Invalid or expired session. Please login again.',
        retryable: false,
      },
    });
    expect(getAccessToken()).toBeNull();
    await expect(getRefreshToken()).resolves.toBeNull();
  });

  it('cancelling a pending verification invalidates its late success response', async () => {
    const response = deferred<HttpResponse>();
    const requestStarted = deferred<void>();
    const transport = createFakeTransport(async () => {
      requestStarted.resolve();
      return response.promise;
    });

    const pendingVerification = verifyTwoFactor('cancelled-temp-token', '123456', { transport });
    await requestStarted.promise;
    await expect(cancelTwoFactor()).resolves.toBe(true);
    response.resolve(
      jsonResponse(
        200,
        envelope({
          accessToken: 'late-access-token',
          refreshToken: 'late-refresh-token',
          sid: 'late-sid',
          shopId: 'shop-1',
          user: FIXTURE_USER,
        }),
      ),
    );

    await expect(pendingVerification).resolves.toMatchObject({ ok: false });
    expect(getAccessToken()).toBeNull();
    await expect(getRefreshToken()).resolves.toBeNull();
  });
});

describe('refreshAccessToken (single-flight guard)', () => {
  it('makes exactly one network call when several callers race concurrently (concurrent 401s)', async () => {
    await setRefreshToken('initial-refresh-token');

    const transport = createFakeTransport(async () =>
      jsonResponse(
        200,
        envelope({
          accessToken: 'new-access-token',
          refreshToken: 'rotated-refresh-token',
          shopId: 'shop-1',
          user: FIXTURE_USER,
        }),
      ),
    );

    // Simulate several business requests each hitting a 401 at roughly the same time and each
    // independently deciding "I need a fresh token" — this is exactly the race the guard exists
    // to collapse.
    const results = await Promise.all([
      refreshAccessToken({ transport }),
      refreshAccessToken({ transport }),
      refreshAccessToken({ transport }),
      refreshAccessToken({ transport }),
      refreshAccessToken({ transport }),
    ]);

    expect(transport.request).toHaveBeenCalledTimes(1);
    // native.validator.js requires `refresh_token` (snake_case) — no `refreshToken` alias exists
    // on the backend.
    expect(transport.request).toHaveBeenCalledWith(
      '/api/auth/native/refresh',
      expect.objectContaining({ method: 'POST', body: { refresh_token: 'initial-refresh-token' } }),
    );
    results.forEach((result) => {
      expect(result?.accessToken).toBe('new-access-token');
      expect(result?.user).toEqual({ ...FIXTURE_USER, shopId: 'shop-1' });
    });
    expect(getAccessToken()).toBe('new-access-token');
    await expect(getRefreshToken()).resolves.toBe('rotated-refresh-token');
  });

  it('allows a new refresh call once the in-flight one has settled', async () => {
    await setRefreshToken('token-a');
    const transport = createFakeTransport(async () =>
      jsonResponse(
        200,
        envelope({ accessToken: 'access-1', refreshToken: 'token-b', shopId: 'shop-1', user: FIXTURE_USER }),
      ),
    );

    await refreshAccessToken({ transport });
    await refreshAccessToken({ transport });

    expect(transport.request).toHaveBeenCalledTimes(2);
  });

  it('clears tokens and signs the session out when the server reports refresh-token reuse (compromise)', async () => {
    await setRefreshToken('stolen-token');
    const transport = createFakeTransport(async () =>
      jsonResponse(401, { success: false, message: 'Refresh token reuse detected', code: 'SESSION_REVOKED' }),
    );

    const results = await Promise.all([refreshAccessToken({ transport }), refreshAccessToken({ transport })]);

    expect(transport.request).toHaveBeenCalledTimes(1);
    results.forEach((result) => expect(result).toBeNull());
    expect(getAccessToken()).toBeNull();
    await expect(getRefreshToken()).resolves.toBeNull();
  });

  it.each([400, 401, 403])('ends the stored session (token and identity) when refresh is rejected with %i', async (status) => {
    await setRefreshToken('rejected-token');
    await setSessionIdentity({ ...FIXTURE_USER, shopId: 'shop-1' });
    const transport = createFakeTransport(async () => jsonResponse(status, { success: false, message: 'rejected' }));

    await expect(refreshAccessToken({ transport })).resolves.toBeNull();

    await expect(getRefreshToken()).resolves.toBeNull();
    await expect(getSessionIdentity()).resolves.toBeNull();
  });

  it.each([429, 500, 502, 503])(
    'keeps the stored session when refresh fails with a transient %i (e.g. a deploy), without an access token',
    async (status) => {
      await setRefreshToken('still-valid-token');
      await setSessionIdentity({ ...FIXTURE_USER, shopId: 'shop-1' });
      setAccessToken('expired-access-token');
      const transport = createFakeTransport(async () => jsonResponse(status, { success: false, message: 'busy' }));

      await expect(refreshAccessToken({ transport })).resolves.toBeNull();

      expect(getAccessToken()).toBeNull();
      await expect(getRefreshToken()).resolves.toBe('still-valid-token');
      await expect(getSessionIdentity()).resolves.toEqual({ ...FIXTURE_USER, shopId: 'shop-1' });
    },
  );

  it('stores the refreshed identity (including a changed session shop) with the rotated token', async () => {
    await setRefreshToken('old-refresh-token');
    const transport = createFakeTransport(async () =>
      jsonResponse(
        200,
        envelope({ accessToken: 'new-access', refreshToken: 'new-refresh', shopId: 'shop-9', user: FIXTURE_USER }),
      ),
    );

    await refreshAccessToken({ transport });

    await expect(getRefreshToken()).resolves.toBe('new-refresh');
    await expect(getSessionIdentity()).resolves.toEqual({ ...FIXTURE_USER, shopId: 'shop-9' });
  });

  it('returns null without making a network call when there is no stored refresh token', async () => {
    const transport = createFakeTransport(async () => jsonResponse(200, {}));

    const result = await refreshAccessToken({ transport });

    expect(result).toBeNull();
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('does not install a refresh response that completes after logout starts', async () => {
    await setRefreshToken('account-a-refresh-token');
    const refreshResponse = deferred<HttpResponse>();
    const refreshStarted = deferred<void>();
    const transport = createFakeTransport(async (path) => {
      if (path === '/api/auth/native/refresh') {
        refreshStarted.resolve();
        return refreshResponse.promise;
      }
      if (path === '/api/auth/native/logout') return jsonResponse(200, {});
      throw new Error(`unexpected path ${path}`);
    });

    const pendingRefresh = refreshAccessToken({ transport });
    await refreshStarted.promise;
    await logout({ transport });

    refreshResponse.resolve(
      jsonResponse(
        200,
        envelope({
          accessToken: 'account-a-access-after-logout',
          refreshToken: 'account-a-rotated-after-logout',
          shopId: 'shop-a',
          user: FIXTURE_USER,
        }),
      ),
    );

    await expect(pendingRefresh).resolves.toBeNull();
    expect(getAccessToken()).toBeNull();
    await expect(getRefreshToken()).resolves.toBeNull();
  });

  it('does not let a previous account refresh overwrite a newer sign-in', async () => {
    await setRefreshToken('account-a-refresh-token');
    const refreshResponse = deferred<HttpResponse>();
    const refreshStarted = deferred<void>();
    const transport = createFakeTransport(async (path) => {
      if (path === '/api/auth/native/refresh') {
        refreshStarted.resolve();
        return refreshResponse.promise;
      }
      if (path === '/api/auth/native/signin') {
        return jsonResponse(
          200,
          envelope({
            accessToken: 'account-b-access',
            refreshToken: 'account-b-refresh-token',
            shopId: 'shop-b',
            user: { ...FIXTURE_USER, id: 'user-b', email: 'b@example.test' },
          }),
        );
      }
      throw new Error(`unexpected path ${path}`);
    });

    const pendingRefresh = refreshAccessToken({ transport });
    await refreshStarted.promise;
    await expect(signIn('b@example.test', 'password', { transport })).resolves.toMatchObject({ ok: true });

    refreshResponse.resolve(
      jsonResponse(
        200,
        envelope({
          accessToken: 'account-a-access-after-sign-in',
          refreshToken: 'account-a-rotated-after-sign-in',
          shopId: 'shop-a',
          user: FIXTURE_USER,
        }),
      ),
    );

    await expect(pendingRefresh).resolves.toBeNull();
    expect(getAccessToken()).toBe('account-b-access');
    await expect(getRefreshToken()).resolves.toBe('account-b-refresh-token');
  });
});
