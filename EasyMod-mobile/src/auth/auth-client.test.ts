import { refreshAccessToken, __resetRefreshGuardForTests } from './auth-client';
import { getAccessToken, __resetTokenStoreForTests } from './token-store';
import { clearRefreshToken, getRefreshToken, setRefreshToken } from './secure-store';
import type { HttpResponse, RequestOptions, Transport } from '@/api/transport';

function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

function createFakeTransport(handler: (path: string, options?: RequestOptions) => Promise<HttpResponse>): Transport {
  return { request: jest.fn(handler) };
}

beforeEach(async () => {
  __resetTokenStoreForTests();
  __resetRefreshGuardForTests();
  await clearRefreshToken();
});

describe('refreshAccessToken (single-flight guard)', () => {
  it('makes exactly one network call when several callers race concurrently (concurrent 401s)', async () => {
    await setRefreshToken('initial-refresh-token');

    const transport = createFakeTransport(async () =>
      jsonResponse(200, { accessToken: 'new-access-token', refreshToken: 'rotated-refresh-token' }),
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
    expect(transport.request).toHaveBeenCalledWith(
      '/api/auth/native/refresh',
      expect.objectContaining({ method: 'POST', body: { refreshToken: 'initial-refresh-token' } }),
    );
    results.forEach((token) => expect(token).toBe('new-access-token'));
    expect(getAccessToken()).toBe('new-access-token');
    await expect(getRefreshToken()).resolves.toBe('rotated-refresh-token');
  });

  it('allows a new refresh call once the in-flight one has settled', async () => {
    await setRefreshToken('token-a');
    const transport = createFakeTransport(async () =>
      jsonResponse(200, { accessToken: 'access-1', refreshToken: 'token-b' }),
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
    results.forEach((token) => expect(token).toBeNull());
    expect(getAccessToken()).toBeNull();
    await expect(getRefreshToken()).resolves.toBeNull();
  });

  it('returns null without making a network call when there is no stored refresh token', async () => {
    const transport = createFakeTransport(async () => jsonResponse(200, {}));

    const token = await refreshAccessToken({ transport });

    expect(token).toBeNull();
    expect(transport.request).not.toHaveBeenCalled();
  });
});
