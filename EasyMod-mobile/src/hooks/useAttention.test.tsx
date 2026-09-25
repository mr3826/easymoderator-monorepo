import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { useAttention } from './useAttention';
import { apiRequest } from '@/api/client';
import type { NormalizedError } from '@/api/errors';

jest.mock('@/api/client', () => ({ apiRequest: jest.fn() }));
const mockedApiRequest = jest.mocked(apiRequest);

let mockUser: { shopId: string | null } | null = { shopId: 'shop-1' };
jest.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser, status: 'signedIn', signIn: jest.fn(), logout: jest.fn() }),
}));

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  mockedApiRequest.mockReset();
  mockUser = { shopId: 'shop-1' };
});

function responseFor(shopLabel: string) {
  return {
    items: [
      {
        id: `low_stock:product:${shopLabel}`,
        tier: 5 as const,
        urgency_score: 0.5,
        signal_type: 'LOW_STOCK' as const,
        reason: `${shopLabel} widget is low on stock`,
        entity: { type: 'product' as const, id: `${shopLabel}-product` },
      },
    ],
    truncated_count: 0,
    conversation_scan_truncated: false,
    generated_at: '2026-09-14T00:00:00.000Z',
  };
}

describe('useAttention', () => {
  it('calls GET /api/mobile/attention and resolves with the parsed data', async () => {
    mockedApiRequest.mockResolvedValue({ ok: true, data: responseFor('shop-1') });

    const { result } = renderHook(() => useAttention(), { wrapper: wrapperFor(createClient()) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(responseFor('shop-1'));
    expect(mockedApiRequest).toHaveBeenCalledWith('/api/mobile/attention', expect.anything(), {}, {});
  });

  it('is disabled (never calls apiRequest) when the signed-in user has no current shop', async () => {
    mockUser = { shopId: null };

    const { result } = renderHook(() => useAttention(), { wrapper: wrapperFor(createClient()) });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockedApiRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces a NormalizedError (not a generic Error) on failure', async () => {
    // Non-retryable on purpose: a retryable kind would back off for real before settling.
    const error: NormalizedError = { kind: 'validation', message: 'Bad request', retryable: false };
    mockedApiRequest.mockResolvedValue({ ok: false, error });

    const { result } = renderHook(() => useAttention(), { wrapper: wrapperFor(createClient()) });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(error);
  });

  it('keys the query by shopId, so two different shops never share a cache entry', async () => {
    mockedApiRequest.mockResolvedValue({ ok: true, data: responseFor('shop-1') });
    const wrapper = wrapperFor(createClient());

    const first = renderHook(() => useAttention(), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    mockUser = { shopId: 'shop-2' };
    const second = renderHook(() => useAttention(), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    expect(mockedApiRequest).toHaveBeenCalledTimes(2);
  });

  it('never shows the previous shop list while the switched-to shop is still loading', async () => {
    mockedApiRequest.mockResolvedValueOnce({ ok: true, data: responseFor('shop-1') });
    const { result, rerender } = renderHook(() => useAttention(), { wrapper: wrapperFor(createClient()) });
    await waitFor(() => expect(result.current.data).toEqual(responseFor('shop-1')));

    // Shop 2's request never settles, so anything rendered meanwhile must come from shop 2 alone.
    mockedApiRequest.mockReturnValueOnce(new Promise(() => undefined));
    mockUser = { shopId: 'shop-2' };
    rerender({});

    await waitFor(() => expect(mockedApiRequest).toHaveBeenCalledTimes(2));
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPlaceholderData).toBe(false);
  });
});
