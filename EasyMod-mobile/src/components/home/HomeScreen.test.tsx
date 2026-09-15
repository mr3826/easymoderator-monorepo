import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';

import { HomeScreen } from './HomeScreen';
import { apiRequest } from '@/api/client';
import { openDeepLink } from '@/lib/deeplink';
import i18n from '@/i18n';
import type { NormalizedError } from '@/api/errors';

jest.mock('@/api/client', () => ({ apiRequest: jest.fn() }));
const mockedApiRequest = jest.mocked(apiRequest);

jest.mock('@/lib/deeplink', () => ({ openDeepLink: jest.fn() }));
const mockedOpenDeepLink = jest.mocked(openDeepLink);

let mockUser: { shopId: string | null } | null = { shopId: 'shop-1' };
jest.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: mockUser, status: 'signedIn', signIn: jest.fn(), logout: jest.fn() }),
}));

let mockIsOnline = true;
jest.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => mockIsOnline }));

// Matches the precedent in `app/__tests__/deeplink-routes.test.tsx`: real wall-clock CPU/render
// time under load can exceed Jest's 5s default, independent of any of the (mocked, instant)
// network calls this file makes.
jest.setTimeout(30_000);

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HomeScreen />
    </QueryClientProvider>,
  );
}

const TODAY_ACTIVE = {
  date: '2026-09-14',
  order_count: 3,
  revenue: 1250,
  delivered_count: 1,
  pending_actions: { draft_orders: 1, needs_reply: 1, courier_problems: 0, rto_verify: 0, low_stock: 0 },
  timezone_used: 'Asia/Dhaka',
  timezone_note: null,
  conversation_scan_truncated: false,
  generated_at: '2026-09-14T00:00:00.000Z',
};

const TODAY_IDLE = {
  ...TODAY_ACTIVE,
  order_count: 0,
  revenue: 0,
  delivered_count: 0,
  pending_actions: { draft_orders: 0, needs_reply: 0, courier_problems: 0, rto_verify: 0, low_stock: 0 },
};

const ATTENTION_ITEM_ORDER = {
  id: 'draft_order:order:o1',
  tier: 3,
  urgency_score: 100,
  signal_type: 'DRAFT_ORDER',
  reason: 'Draft order MA-1 (৳500) has been awaiting confirmation for 10h',
  entity: { type: 'order' as const, id: 'order-1' },
};

const ATTENTION_ITEM_PRODUCT = {
  id: 'low_stock:product:p1',
  tier: 5,
  urgency_score: 0.8,
  signal_type: 'LOW_STOCK',
  reason: 'Widget is low on stock (2 left, threshold 10)',
  entity: { type: 'product' as const, id: 'product-1' },
};

function mockBoth(
  attention: { items: unknown[]; truncated_count: number; conversation_scan_truncated: boolean; generated_at: string },
  today: typeof TODAY_ACTIVE,
) {
  mockedApiRequest.mockImplementation(async (path: string) => {
    if (path === '/api/mobile/attention') return { ok: true, data: attention };
    if (path === '/api/mobile/today') return { ok: true, data: today };
    throw new Error(`unexpected path ${path}`);
  });
}

beforeEach(() => {
  mockedApiRequest.mockReset();
  mockedOpenDeepLink.mockReset();
  mockUser = { shopId: 'shop-1' };
  mockIsOnline = true;
});

describe('HomeScreen', () => {
  it('shows a loading state before either query resolves', () => {
    mockedApiRequest.mockReturnValue(new Promise(() => {}));
    renderHome();
    expect(screen.getByTestId('home-loading')).toBeTruthy();
  });

  it('renders the Today strip and ranked attention cards in the order the backend returned them', async () => {
    mockBoth(
      { items: [ATTENTION_ITEM_ORDER, ATTENTION_ITEM_PRODUCT], truncated_count: 0, conversation_scan_truncated: false, generated_at: 'x' },
      TODAY_ACTIVE,
    );

    renderHome();

    await waitFor(() => expect(screen.getByTestId('today-summary')).toBeTruthy());
    expect(screen.getByText('3')).toBeTruthy(); // order_count
    expect(screen.getByText('1')).toBeTruthy(); // delivered_count

    expect(screen.getByTestId(`attention-card-${ATTENTION_ITEM_ORDER.id}`)).toBeTruthy();
    expect(screen.getByTestId(`attention-card-${ATTENTION_ITEM_PRODUCT.id}`)).toBeTruthy();
    // Never re-sorted client-side: item 1 (order) still precedes item 2 (product) in render order.
    const allCards = screen.getAllByText(/awaiting confirmation|low on stock/);
    expect(allCards[0].props.children).toEqual(expect.stringContaining('awaiting confirmation'));
    expect(allCards[1].props.children).toEqual(expect.stringContaining('low on stock'));
  });

  it('navigates via openDeepLink with the id from the rendered item when an order card is tapped', async () => {
    mockBoth(
      { items: [ATTENTION_ITEM_ORDER], truncated_count: 0, conversation_scan_truncated: false, generated_at: 'x' },
      TODAY_ACTIVE,
    );
    renderHome();

    const card = await screen.findByTestId(`attention-card-${ATTENTION_ITEM_ORDER.id}`);
    fireEvent.press(card);

    expect(mockedOpenDeepLink).toHaveBeenCalledWith('order', 'order-1');
  });

  it('never wires a product card to navigation (informational only, no product route)', async () => {
    mockBoth(
      { items: [ATTENTION_ITEM_PRODUCT], truncated_count: 0, conversation_scan_truncated: false, generated_at: 'x' },
      TODAY_ACTIVE,
    );
    renderHome();

    // Asserted structurally rather than via `fireEvent.press` + "was openDeepLink called": RNTL's
    // `fireEvent.press` walks UP the ancestor chain for a responder-eligible handler when the
    // pressed element has none of its own (real touch-bubbling semantics), which would make this
    // assertion depend on nothing ELSE in the tree ever having an `onPress` — an accident away from
    // silently passing for the wrong reason. Checking the card's own props directly proves what the
    // master brief actually requires: a product card is rendered informational-only, with
    // `accessibilityRole="text"` (not "button") and no `onPress` at all, full stop.
    const card = await screen.findByTestId(`attention-card-${ATTENTION_ITEM_PRODUCT.id}`);
    expect(card.props.onPress).toBeUndefined();
    expect(card.props.accessibilityRole).toBe('text');
  });

  it('shows the overflow indicator when truncated_count is greater than 0', async () => {
    mockBoth(
      { items: [ATTENTION_ITEM_ORDER], truncated_count: 4, conversation_scan_truncated: false, generated_at: 'x' },
      TODAY_ACTIVE,
    );
    renderHome();

    expect(await screen.findByTestId('attention-overflow')).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.home.attention.overflow', { count: 4 }))).toBeTruthy();
  });

  it('shows the genuinely-idle empty state when there are zero attention items and zero today activity', async () => {
    mockBoth({ items: [], truncated_count: 0, conversation_scan_truncated: false, generated_at: 'x' }, TODAY_IDLE);
    renderHome();

    expect(await screen.findByText(i18n.t('mobile.home.empty.idle.title'))).toBeTruthy();
  });

  it('shows the "all caught up" empty state when there are zero attention items but the shop had activity today', async () => {
    mockBoth({ items: [], truncated_count: 0, conversation_scan_truncated: false, generated_at: 'x' }, TODAY_ACTIVE);
    renderHome();

    expect(await screen.findByText(i18n.t('mobile.home.empty.caughtUp.title'))).toBeTruthy();
  });

  it('shows a full-screen mapped error state with retry when both queries fail with nothing cached', async () => {
    // Non-retryable, deliberately (see the note in `useAttention.test.tsx`): `useAttention`/
    // `useToday` wire `retryNormalizedError` as their retry policy, so a retryable kind here would
    // retry twice with real backoff delay before ever reaching `isError`.
    const error: NormalizedError = { kind: 'notFound', message: 'Not found', retryable: false };
    mockedApiRequest.mockResolvedValue({ ok: false, error });
    renderHome();

    expect(await screen.findByTestId('home-error')).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.error.notFound'))).toBeTruthy();

    mockBoth(
      { items: [ATTENTION_ITEM_ORDER], truncated_count: 0, conversation_scan_truncated: false, generated_at: 'x' },
      TODAY_ACTIVE,
    );
    fireEvent.press(screen.getByTestId('home-retry'));

    await waitFor(() => expect(screen.getByTestId('today-summary')).toBeTruthy());
  });

  it('renders Today normally and an inline retry for the attention list when only /attention fails', async () => {
    const error: NormalizedError = { kind: 'validation', message: 'Bad request', retryable: false };
    mockedApiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/mobile/attention') return { ok: false, error };
      return { ok: true, data: TODAY_ACTIVE };
    });
    renderHome();

    await waitFor(() => expect(screen.getByTestId('today-summary')).toBeTruthy());
    expect(screen.getByTestId('attention-inline-error')).toBeTruthy();
    // The inline error message and the mapped kind text render as ONE concatenated `Text` node
    // (`{unavailable}{' — ' + kindMessage}`), so this must match a substring, not the exact node.
    expect(screen.getByText(new RegExp(i18n.t('mobile.error.validation')))).toBeTruthy();
  });

  it('renders an inline retry for Today and the attention list normally when only /today fails', async () => {
    // Non-retryable, deliberately — see the note on the full-screen error test above.
    const error: NormalizedError = { kind: 'validation', message: 'Bad request', retryable: false };
    mockedApiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/mobile/today') return { ok: false, error };
      return {
        ok: true,
        data: { items: [ATTENTION_ITEM_ORDER], truncated_count: 0, conversation_scan_truncated: false, generated_at: 'x' },
      };
    });
    renderHome();

    await waitFor(() => expect(screen.getByTestId('today-summary-error')).toBeTruthy());
    expect(await screen.findByTestId(`attention-card-${ATTENTION_ITEM_ORDER.id}`)).toBeTruthy();
  });

  it('shows the offline state instead of an error/loading spinner when there is no connectivity and nothing cached', async () => {
    mockIsOnline = false;
    mockedApiRequest.mockReturnValue(new Promise(() => {}));
    renderHome();

    expect(await screen.findByTestId('home-offline')).toBeTruthy();
  });

  it('shows the no-shop state (not an infinite spinner) when the signed-in user has no current shop', () => {
    mockUser = { shopId: null };
    renderHome();

    expect(screen.getByTestId('home-no-shop')).toBeTruthy();
    expect(mockedApiRequest).not.toHaveBeenCalled();
  });
});
