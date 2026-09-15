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

function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  mockedApiRequest.mockReset();
  mockUser = { shopId: 'shop-1' };
});

const SAMPLE_RESPONSE = {
  items: [
    {
      id: 'low_stock:product:p1',
      tier: 5 as const,
      urgency_score: 0.5,
      signal_type: 'LOW_STOCK' as const,
      reason: 'Widget is low on stock (1 left, threshold 5)',
      entity: { type: 'product' as const, id: 'p1' },
    },
  ],
  truncated_count: 0,
  conversation_scan_truncated: false,
  generated_at: '2026-09-14T00:00:00.000Z',
};

describe('useAttention', () => {
  it('calls GET /api/mobile/attention and resolves with the parsed data', async () => {
    mockedApiRequest.mockResolvedValue({ ok: true, data: SAMPLE_RESPONSE });

    const { result } = renderHook(() => useAttention(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(SAMPLE_RESPONSE);
    expect(mockedApiRequest).toHaveBeenCalledWith(
      '/api/mobile/attention',
      expect.anything(),
      {},
      {},
    );
  });

  it('is disabled (never calls apiRequest) when the signed-in user has no current shop', async () => {
    mockUser = { shopId: null };

    const { result } = renderHook(() => useAttention(), { wrapper: createWrapper() });

    // Give any accidental fetch a moment to fire before asserting it never did.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockedApiRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces a NormalizedError (not a generic Error) on failure', async () => {
    // A non-retryable kind, deliberately: `useAttention` wires `retryNormalizedError` (not the
    // wrapper QueryClient's own `retry: false`) as its per-query retry policy, and a *retryable*
    // kind here would actually retry twice with real backoff delay before settling into `isError`,
    // making this assertion flaky/slow rather than wrong — see `query.test.ts` for that policy's
    // own dedicated, timer-free coverage.
    const error: NormalizedError = { kind: 'validation', message: 'Bad request', retryable: false };
    mockedApiRequest.mockResolvedValue({ ok: false, error });

    const { result } = renderHook(() => useAttention(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(error);
  });

  it('keys the query by shopId, so two different shops never share a cache entry', async () => {
    mockedApiRequest.mockResolvedValue({ ok: true, data: SAMPLE_RESPONSE });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    mockUser = { shopId: 'shop-1' };
    const first = renderHook(() => useAttention(), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(mockedApiRequest).toHaveBeenCalledTimes(1);

    mockUser = { shopId: 'shop-2' };
    const second = renderHook(() => useAttention(), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));

    // A different shopId is a different query key, so it fetches again rather than reusing
    // shop-1's cached response.
    expect(mockedApiRequest).toHaveBeenCalledTimes(2);
  });
});
