import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { httpClient } from '../client';

/**
 * A 401 must only trigger POST /api/auth/refresh when this browser has actually
 * held a session. Anonymous page views previously fired a refresh that could
 * never succeed, burning the shared per-IP auth rate limit that real sign-ins
 * depend on.
 */
const runWithAdapter = async (
  handler: (config: any) => { status: number; data?: any }
) => {
  const axiosInstance = httpClient.getAxiosInstance();
  const originalAdapter = axiosInstance.defaults.adapter;
  const calls: string[] = [];

  axiosInstance.defaults.adapter = vi.fn(async (config: any) => {
    calls.push(`${(config.method || 'get').toUpperCase()} ${config.url}`);
    const result = handler(config);
    const response = {
      data: result.data ?? {},
      status: result.status,
      statusText: 'OK',
      headers: {},
      config,
    };
    if (result.status >= 400) {
      const err: any = new Error(`Request failed with status ${result.status}`);
      err.config = config;
      err.response = response;
      throw err;
    }
    return response;
  });

  try {
    await httpClient.get('/api/protected').catch(() => undefined);
    return calls;
  } finally {
    axiosInstance.defaults.adapter = originalAdapter;
  }
};

describe('HTTP client — session hint gating of token refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    httpClient.setShopId(null);
    httpClient.clearCsrfToken();
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('does not attempt a refresh on 401 when no session was ever established', async () => {
    httpClient.setSessionHint(false);

    const calls = await runWithAdapter(() => ({ status: 401 }));

    expect(calls.some((c) => c.includes('/api/auth/refresh'))).toBe(false);
    expect(calls).toEqual(['GET /api/protected']);
  });

  it('attempts a refresh on 401 when a session hint is present', async () => {
    httpClient.setSessionHint(true);

    const calls = await runWithAdapter((config) =>
      config.url?.includes('/api/auth/refresh')
        ? { status: 401 }
        : { status: 401 }
    );

    expect(calls.some((c) => c.includes('/api/auth/refresh'))).toBe(true);
  });

  it('clears the hint once the session is definitively gone', async () => {
    httpClient.setSessionHint(true);
    expect(httpClient.hasSessionHint()).toBe(true);

    await runWithAdapter(() => ({ status: 401 }));

    // The refresh failed, so a subsequent anonymous load must not retry.
    expect(httpClient.hasSessionHint()).toBe(false);
  });

  it('treats unavailable storage as "session may exist" so real refreshes are never suppressed', () => {
    const getItem = vi
      .spyOn(window.localStorage, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage disabled');
      });

    // Private browsing / storage-blocked users must still be able to refresh an
    // expired access token, so an unreadable hint has to fail open.
    expect(httpClient.hasSessionHint()).toBe(true);

    getItem.mockRestore();
  });
});
