import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { useToday } from './useToday';
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
  date: '2026-09-14',
  order_count: 2,
  revenue: 550,
  delivered_count: 1,
  pending_actions: { draft_orders: 0, needs_reply: 0, courier_problems: 0, rto_verify: 0, low_stock: 0 },
  timezone_used: 'Asia/Dhaka',
  timezone_note: null,
  conversation_scan_truncated: false,
  generated_at: '2026-09-14T00:00:00.000Z',
};

describe('useToday', () => {
  it('calls GET /api/mobile/today and resolves with the parsed data', async () => {
    mockedApiRequest.mockResolvedValue({ ok: true, data: SAMPLE_RESPONSE });

    const { result } = renderHook(() => useToday(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(SAMPLE_RESPONSE);
    expect(mockedApiRequest).toHaveBeenCalledWith('/api/mobile/today', expect.anything(), {}, {});
  });

  it('is disabled (never calls apiRequest) when the signed-in user has no current shop', async () => {
    mockUser = { shopId: null };

    const { result } = renderHook(() => useToday(), { wrapper: createWrapper() });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockedApiRequest).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('surfaces a NormalizedError (not a generic Error) on failure', async () => {
    // Non-retryable, deliberately — see the identical note in `useAttention.test.tsx`: a
    // retryable kind here would retry with real backoff delay before settling into `isError`.
    const error: NormalizedError = { kind: 'validation', message: 'Bad request', retryable: false };
    mockedApiRequest.mockResolvedValue({ ok: false, error });

    const { result } = renderHook(() => useToday(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(error);
  });
});
