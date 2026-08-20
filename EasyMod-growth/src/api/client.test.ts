import { afterEach, describe, expect, it, vi } from 'vitest';
import { growthApi } from './client';

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('Growth API security contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes CSRF and does not swallow a failed server logout', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { csrfToken: 'csrf-for-logout' }))
      .mockResolvedValueOnce(response(403, {
        code: 'CSRF_INVALID',
        message: 'Invalid CSRF token.',
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(growthApi.logout()).rejects.toMatchObject({
      status: 403,
      code: 'CSRF_INVALID',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/auth/logout',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-for-logout' }),
      }),
    );
  });
});
