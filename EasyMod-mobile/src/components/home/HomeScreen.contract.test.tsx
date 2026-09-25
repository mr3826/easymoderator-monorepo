import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';

import { apiRequest } from '@/api/client';
import '@/i18n';
import { HomeScreen } from './HomeScreen';

jest.mock('@/api/client', () => ({ apiRequest: jest.fn() }));
jest.mock('@/lib/deeplink', () => ({ openDeepLink: jest.fn() }));

let mockUser: { shopId: string | null } | null = { shopId: 'shop-1' };
jest.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser, status: 'signedIn', signIn: jest.fn(), logout: jest.fn() }),
}));

let mockIsOnline = true;
jest.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => mockIsOnline }));

const mockedApiRequest = jest.mocked(apiRequest);

jest.setTimeout(30_000);

const TODAY = {
  date: '2026-09-16',
  order_count: 1,
  revenue: 500,
  delivered_count: 0,
  pending_actions: { draft_orders: 1, needs_reply: 0, courier_problems: 0, rto_verify: 0, low_stock: 0 },
  timezone_used: 'Asia/Dhaka',
  timezone_note: null,
  conversation_scan_truncated: false,
  generated_at: '2026-09-16T00:00:00.000Z',
};

const ATTENTION = {
  items: [
    {
      id: 'draft_order:order:first',
      tier: 3,
      urgency_score: 10,
      signal_type: 'DRAFT_ORDER',
      reason: 'First server-ranked item',
      entity: { type: 'order' as const, id: 'first' },
    },
    {
      id: 'low_stock:product:second',
      tier: 5,
      urgency_score: 0.5,
      signal_type: 'LOW_STOCK',
      reason: 'Second server-ranked item',
      entity: { type: 'product' as const, id: 'second' },
    },
  ],
  truncated_count: 0,
  conversation_scan_truncated: false,
  generated_at: '2026-09-16T00:00:00.000Z',
};

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <HomeScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockedApiRequest.mockReset();
  mockUser = { shopId: 'shop-1' };
  mockIsOnline = true;
});

describe('HomeScreen implementation contract', () => {
  it('renders attention items in the exact order returned by the server', async () => {
    mockedApiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/mobile/attention') return { ok: true, data: ATTENTION };
      return { ok: true, data: TODAY };
    });

    renderHome();

    await waitFor(() => expect(screen.getAllByTestId(/^attention-card-/)).toHaveLength(2));
    const cards = screen.getAllByTestId(/^attention-card-/);
    expect(cards[0].props.testID).toBe('attention-card-draft_order:order:first');
    expect(cards[1].props.testID).toBe('attention-card-low_stock:product:second');
  });

  it('coalesces repeated pull-to-refresh events instead of overlapping endpoint requests', async () => {
    mockedApiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/mobile/attention') return { ok: true, data: ATTENTION };
      return { ok: true, data: TODAY };
    });
    renderHome();
    await screen.findByTestId('attention-card-draft_order:order:first');

    mockedApiRequest.mockClear();
    let resolveAttention: (() => void) | undefined;
    let resolveToday: (() => void) | undefined;
    mockedApiRequest.mockImplementation(
      (path: string) =>
        new Promise((resolve) => {
          if (path === '/api/mobile/attention') {
            resolveAttention = () => resolve({ ok: true, data: ATTENTION });
          } else {
            resolveToday = () => resolve({ ok: true, data: TODAY });
          }
        }),
    );

    const list = screen.getByTestId('home-attention-list');
    const onRefresh = list.props.refreshControl.props.onRefresh as () => Promise<void>;
    let firstRefresh: Promise<void> | undefined;
    await act(async () => {
      firstRefresh = onRefresh();
      expect(onRefresh()).toBe(firstRefresh);
      expect(mockedApiRequest).toHaveBeenCalledTimes(2);
      resolveAttention?.();
      resolveToday?.();
      await firstRefresh;
    });

    expect(mockedApiRequest).toHaveBeenCalledTimes(2);
  });
});
