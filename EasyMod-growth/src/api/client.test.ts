import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConflictingProspectId, growthApi } from './client';

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
    vi.clearAllMocks();
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

  it('CSRF-protects the forced temporary-password change', async () => {
    vi.resetModules();
    const { growthApi: freshGrowthApi } = await import('./client');
    const fetchMock = vi.fn((url: string) => Promise.resolve(
      url === '/api/csrf'
        ? response(200, { csrfToken: 'csrf-for-password-change' })
        : response(200, { success: true, message: 'Password changed successfully.' }),
    ));
    vi.stubGlobal('fetch', fetchMock);

    await freshGrowthApi.changePassword('temporary-password', 'New-password-123!');

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
    const changeCall = calls.find(([url]) => url === '/api/auth/change-password');
    expect(changeCall).toBeDefined();
    expect(changeCall?.[1]).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'temporary-password', newPassword: 'New-password-123!' }),
      headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-for-password-change' }),
    });
  });

  it('serializes list filters with the Phase 3 query names and page-size limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, {
      success: true,
      data: { items: [], total: 0, page: 3, pageSize: 100, totalPages: 0 },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await growthApi.getProspects({
      status: 'qualifying',
      source: 'manual_entry',
      ownerUserId: 'owner-1',
      q: 'rahim fashion',
      linked: 'true',
      page: 3,
      pageSize: 250,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/growth-os/prospects?status=qualifying&source=manual_entry&ownerUserId=owner-1&q=rahim+fashion&linked=true&page=3&pageSize=100',
      expect.objectContaining({ credentials: 'include' }),
    );
    const requestOptions = fetchMock.mock.calls[0][1] as RequestInit;
    expect(requestOptions.body).toBeUndefined();
    expect(requestOptions.headers).not.toHaveProperty('X-CSRF-Token');
  });

  it('uses a CSRF-protected POST body for duplicate preflight', async () => {
    vi.resetModules();
    const fetchMock = vi.fn((url: string) => Promise.resolve(
      url === '/api/csrf'
        ? response(200, { csrfToken: 'csrf-for-duplicate' })
        : response(200, { success: true, data: { matches: [] } }),
    ));
    vi.stubGlobal('fetch', fetchMock);
    const { growthApi: freshGrowthApi } = await import('./client');

    await freshGrowthApi.checkProspectDuplicates({
      contactPhone: '01700000000',
      contactEmail: 'owner@example.com',
      pageUrl: 'https://example.com/page',
      excludeId: 'prospect-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/csrf',
      expect.objectContaining({ credentials: 'include' }),
    );
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
    const duplicateCall = calls.find(([url]) => url === '/api/internal/growth-os/prospects/duplicate-check');
    expect(duplicateCall).toBeDefined();
    const requestOptions = duplicateCall?.[1] as RequestInit;
    expect(requestOptions.method).toBe('POST');
    expect(requestOptions.body).toBe(JSON.stringify({
      contactPhone: '01700000000',
      contactEmail: 'owner@example.com',
      pageUrl: 'https://example.com/page',
      excludeId: 'prospect-1',
    }));
    expect(requestOptions.headers).toMatchObject({ 'X-CSRF-Token': 'csrf-for-duplicate' });
  });

  it('keeps Growth user search terms out of API URLs', async () => {
    vi.resetModules();
    const { growthUsersApi: freshGrowthUsersApi } = await import('./client');
    const fetchMock = vi.fn((url: string) => Promise.resolve(
      url === '/api/csrf'
        ? response(200, { csrfToken: 'csrf-for-user-search' })
        : response(200, { success: true, data: [] }),
    ));
    vi.stubGlobal('fetch', fetchMock);

    await freshGrowthUsersApi.list('owner@example.com');

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/internal/growth-os/admin/users/search',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
        body: JSON.stringify({ search: 'owner@example.com' }),
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-for-user-search' }),
      }),
    );
  });

  it('serializes bounded timeline pagination on prospect detail requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, {
      success: true,
      data: {},
    }));
    vi.stubGlobal('fetch', fetchMock);

    await growthApi.getProspect('prospect-1', { timelinePage: 2, timelinePageSize: 250 });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/internal/growth-os/prospects/prospect-1?timelinePage=2&timelinePageSize=100',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('preserves the conflicting prospect ID from a 409 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(409, {
      success: false,
      code: 'GROWTH_OS_PROSPECT_DUPLICATE',
      message: 'A matching prospect already exists.',
      conflictingProspectId: 'prospect-2',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await growthApi.createProspect({
      businessName: 'Rahim Fashion',
      contactPhone: '01700000000',
      source: 'manual_entry',
    }).catch((requestError: unknown) => requestError);

    expect(getConflictingProspectId(error)).toBe('prospect-2');
  });

  it('uses the lower-case prospect routes and adds CSRF only to mutations', async () => {
    vi.resetModules();
    const { growthApi: freshGrowthApi } = await import('./client');
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/csrf') return response(200, { csrfToken: 'csrf-for-prospects' });
      return response(200, { success: true, data: {} });
    });
    vi.stubGlobal('fetch', fetchMock);

    await freshGrowthApi.getProspects();
    await freshGrowthApi.getProspect('prospect-1');
    await freshGrowthApi.checkProspectDuplicates({ contactEmail: 'owner@example.com' });
    await freshGrowthApi.getProspectLinkageSuggestions('prospect-1');
    await freshGrowthApi.createProspect({
      businessName: 'North Star',
      contactPhone: '01700000000',
      source: 'manual_entry',
    });
    await freshGrowthApi.updateProspect('prospect-1', { notes: 'Updated' });
    await freshGrowthApi.assignProspect('prospect-1', { ownerUserId: null, reason: 'Rebalance' });
    await freshGrowthApi.transitionProspectStatus('prospect-1', { status: 'contacted' });
    await freshGrowthApi.linkProspect('prospect-1', { shopId: 'shop-1', reason: 'Verified' });
    await freshGrowthApi.mergeProspect('prospect-1', {
      targetProspectId: 'prospect-2',
      reason: 'Duplicate review',
    });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>;
    expect(calls.filter(([url]) => url === '/api/csrf')).toHaveLength(1);
    expect(calls.map(([url]) => url)).toEqual([
      '/api/internal/growth-os/prospects',
      '/api/internal/growth-os/prospects/prospect-1',
      '/api/csrf',
      '/api/internal/growth-os/prospects/duplicate-check',
      '/api/internal/growth-os/prospects/prospect-1/linkage-suggestions',
      '/api/internal/growth-os/prospects',
      '/api/internal/growth-os/prospects/prospect-1',
      '/api/internal/growth-os/prospects/prospect-1/assign',
      '/api/internal/growth-os/prospects/prospect-1/status',
      '/api/internal/growth-os/prospects/prospect-1/link',
      '/api/internal/growth-os/prospects/prospect-1/merge',
    ]);

    for (const [, options] of calls.filter(([url]) => url !== '/api/csrf')) {
      const method = options?.method || 'GET';
      const headers = options?.headers as Record<string, string> | undefined;
      if (method === 'GET') {
        expect(headers).not.toHaveProperty('X-CSRF-Token');
      } else {
        expect(headers).toMatchObject({ 'X-CSRF-Token': 'csrf-for-prospects' });
      }
    }
  });

  it('maps mutation API failures to ApiError without exposing transport details', async () => {
    vi.resetModules();
    const {
      ApiError: FreshApiError,
      growthApi: freshGrowthApi,
    } = await import('./client');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { csrfToken: 'csrf-for-errors' }))
      .mockResolvedValueOnce(response(503, {
        success: false,
        error: {
          code: 'GROWTH_OS_PROSPECT_UNAVAILABLE',
          message: 'Growth OS prospect service is temporarily unavailable.',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);

    const error = await freshGrowthApi.updateProspect('prospect-1', { notes: 'retry' })
      .catch((requestError: unknown) => requestError);

    expect(error).toBeInstanceOf(FreshApiError);
    expect(error).toMatchObject({
      status: 503,
      code: 'GROWTH_OS_PROSPECT_UNAVAILABLE',
      message: 'Growth OS prospect service is temporarily unavailable.',
    });
    expect(JSON.stringify(error)).not.toContain('postgres');
  });
});
