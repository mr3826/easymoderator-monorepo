import { signIn, refreshAccessToken, __resetRefreshGuardForTests } from './auth-client';
import { getAccessToken, __resetTokenStoreForTests } from './token-store';
import { clearRefreshToken, getRefreshToken, setRefreshToken } from './secure-store';
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
    if (result.ok) {
      expect(result.data.shopId).toBe('shop-1');
      expect(result.data.id).toBe('user-1');
    }
    expect(getAccessToken()).toBe('access-1');
    await expect(getRefreshToken()).resolves.toBe('refresh-1');
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

  it('returns null without making a network call when there is no stored refresh token', async () => {
    const transport = createFakeTransport(async () => jsonResponse(200, {}));

    const result = await refreshAccessToken({ transport });

    expect(result).toBeNull();
    expect(transport.request).not.toHaveBeenCalled();
  });
});
