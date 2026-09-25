import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { apiRequest } from '@/api/client';
import type { NormalizedError } from '@/api/errors';
import { openDeepLink } from '@/lib/deeplink';
import i18n from '@/i18n';
import { mobileQueryKeys } from '@/api/mobile/queryKeys';
import { attentionResponseSchema, type AttentionResponse, type TodayResponse } from '@/api/mobile/schemas';
import {
  attentionResponse,
  HOME_ATTENTION_ITEMS,
  TODAY_ACTIVE,
  TODAY_IDLE,
} from '@/test/home-fixtures';
import { HomeScreen } from './HomeScreen';

const BENGALI_REASON_KEYS: Record<(typeof HOME_ATTENTION_ITEMS)[number]['signal_type'], string> = {
  COURIER_FAILED: 'mobile.home.reasons.COURIER_DISPATCH_FAILED',
  COURIER_INDETERMINATE: 'mobile.home.reasons.COURIER_DISPATCH_INDETERMINATE',
  COURIER_SETUP_REQUIRED: 'mobile.home.reasons.COURIER_SETUP_REQUIRED',
  INBOX_NEEDS_REPLY: 'mobile.home.reasons.CUSTOMER_UNANSWERED',
  DRAFT_ORDER: 'mobile.home.reasons.DRAFT_ORDER_AWAITING_CONFIRMATION',
  RTO_VERIFY: 'mobile.home.reasons.RTO_VERIFICATION_REQUIRED',
  LOW_STOCK: 'mobile.home.reasons.LOW_STOCK',
};

jest.mock('@/api/client', () => ({ apiRequest: jest.fn() }));
jest.mock('@/lib/deeplink', () => ({ openDeepLink: jest.fn() }));

let mockShopId: string | null = 'shop-1';
let mockIsOnline = true;

jest.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { shopId: mockShopId },
    status: 'signedIn',
    signIn: jest.fn(),
    logout: jest.fn(),
  }),
}));

jest.mock('@/hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => mockIsOnline,
}));

const mockedApiRequest = jest.mocked(apiRequest);
const mockedOpenDeepLink = jest.mocked(openDeepLink);

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderHome(client = createQueryClient()) {
  const rendered = render(
    <QueryClientProvider client={client}>
      <HomeScreen />
    </QueryClientProvider>,
  );
  return { client, ...rendered };
}

function mockHomeData({
  attention = attentionResponse(),
  today = TODAY_ACTIVE,
}: { attention?: AttentionResponse; today?: TodayResponse } = {}) {
  mockedApiRequest.mockImplementation(async (path: string) => {
    if (path === '/api/mobile/attention') return { ok: true, data: attention };
    if (path === '/api/mobile/today') return { ok: true, data: today };
    throw new Error(`unexpected path ${path}`);
  });
}

const VALIDATION_ERROR: NormalizedError = {
  kind: 'validation',
  message: 'Bad request',
  retryable: false,
};

beforeEach(async () => {
  mockedApiRequest.mockReset();
  mockedOpenDeepLink.mockReset();
  mockShopId = 'shop-1';
  mockIsOnline = true;
  await i18n.changeLanguage('bn');
});

afterEach(async () => {
  await i18n.changeLanguage('bn');
});

jest.setTimeout(30_000);

describe('HomeScreen Today and Attention data', () => {
  it('accepts every supported seeded signal through the runtime attention contract', () => {
    expect(attentionResponseSchema.parse(attentionResponse(HOME_ATTENTION_ITEMS))).toEqual(
      attentionResponse(HOME_ATTENTION_ITEMS),
    );
  });

  it('renders Today labels/values and every supported seeded attention row in backend order', async () => {
    mockHomeData({ attention: attentionResponse(HOME_ATTENTION_ITEMS) });
    renderHome();

    const summary = await screen.findByTestId('today-summary');
    expect(within(summary).getByText(i18n.t('mobile.home.today.title'))).toBeTruthy();
    expect(within(summary).getByText('3')).toBeTruthy();
    expect(within(summary).getByText('৳1,250')).toBeTruthy();
    expect(within(summary).getByText('1')).toBeTruthy();
    expect(within(summary).getByText(i18n.t('mobile.home.today.orders'))).toBeTruthy();
    expect(within(summary).getByText(i18n.t('mobile.home.today.revenue'))).toBeTruthy();
    expect(within(summary).getByText(i18n.t('mobile.home.today.delivered'))).toBeTruthy();

    for (const item of HOME_ATTENTION_ITEMS) {
      expect(await screen.findByTestId(`attention-card-${item.id}`)).toBeTruthy();
      expect(screen.getByText(i18n.t(BENGALI_REASON_KEYS[item.signal_type]))).toBeTruthy();
    }

    const renderedCardIds = screen
      .getAllByTestId(/attention-card-/)
      .map((card) => card.props.testID);
    expect(renderedCardIds).toEqual(HOME_ATTENTION_ITEMS.map((item) => `attention-card-${item.id}`));
  });

  it('renders an explicit timezone note when the Today contract falls back from Dhaka', async () => {
    mockHomeData({
      attention: attentionResponse([]),
      today: { ...TODAY_IDLE, timezone_used: 'UTC', timezone_note: 'Shop timezone is unavailable; using UTC.' },
    });
    renderHome();

    expect(await screen.findByTestId('today-timezone-note')).toHaveTextContent(
      i18n.t('mobile.home.today.timezoneFallback', { timezone: 'UTC' }),
    );
  });

  it('renders the stable expected order value field instead of the compatibility revenue alias', async () => {
    mockHomeData({
      attention: attentionResponse([]),
      today: { ...TODAY_ACTIVE, revenue: 999, expected_order_value: 1250, revenue_basis: 'expected_order_value' },
    });
    renderHome();

    const summary = await screen.findByTestId('today-summary');
    expect(within(summary).getByText('৳1,250')).toBeTruthy();
    expect(within(summary).queryByText('৳999')).toBeNull();
  });

  it('shows the initial loading state while neither Home query has data', () => {
    mockedApiRequest.mockReturnValue(new Promise(() => {}));
    renderHome();

    expect(screen.getByTestId('home-loading')).toBeTruthy();
  });

  it('keeps the attention list usable while Today is still loading', async () => {
    const todayRequest = deferred<{ ok: true; data: TodayResponse }>();
    mockedApiRequest.mockImplementation((path: string) => {
      if (path === '/api/mobile/today') return todayRequest.promise;
      return Promise.resolve({ ok: true, data: attentionResponse([HOME_ATTENTION_ITEMS[0]]) });
    });
    renderHome();

    expect(await screen.findByTestId(`attention-card-${HOME_ATTENTION_ITEMS[0].id}`)).toBeTruthy();
    expect(screen.getByTestId('today-summary-loading')).toBeTruthy();
    expect(screen.queryByTestId('home-loading')).toBeNull();

    todayRequest.resolve({ ok: true, data: TODAY_ACTIVE });
    expect(await screen.findByTestId('today-summary')).toBeTruthy();
  });

  it('shows an inline attention loading state while Today is already available', async () => {
    const attentionRequest = deferred<{ ok: true; data: AttentionResponse }>();
    mockedApiRequest.mockImplementation((path: string) => {
      if (path === '/api/mobile/attention') return attentionRequest.promise;
      return Promise.resolve({ ok: true, data: TODAY_ACTIVE });
    });
    renderHome();

    expect(await screen.findByTestId('today-summary')).toBeTruthy();
    expect(screen.getByTestId('attention-loading')).toBeTruthy();
    expect(screen.queryByTestId('home-loading')).toBeNull();

    attentionRequest.resolve({ ok: true, data: attentionResponse([HOME_ATTENTION_ITEMS[0]]) });
    expect(await screen.findByTestId(`attention-card-${HOME_ATTENTION_ITEMS[0].id}`)).toBeTruthy();
  });
});

describe('HomeScreen empty and error recovery', () => {
  it('shows the idle state when there are no attention items and no Today activity', async () => {
    mockHomeData({ attention: attentionResponse([]), today: TODAY_IDLE });
    renderHome();
    expect(await screen.findByText(i18n.t('mobile.home.empty.idle.title'))).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.home.empty.idle.message'))).toBeTruthy();
  });

  it('shows the caught-up state when there are no attention items after Today activity', async () => {
    mockHomeData({ attention: attentionResponse([]), today: TODAY_ACTIVE });
    renderHome();
    expect(await screen.findByText(i18n.t('mobile.home.empty.caughtUp.title'))).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.home.empty.caughtUp.message'))).toBeTruthy();
  });

  it('renders a full error and recovers both queries through the Home retry action', async () => {
    let shouldFail = true;
    mockedApiRequest.mockImplementation(async (path: string) => {
      if (shouldFail) return { ok: false, error: VALIDATION_ERROR };
      if (path === '/api/mobile/attention') return { ok: true, data: attentionResponse([HOME_ATTENTION_ITEMS[0]]) };
      if (path === '/api/mobile/today') return { ok: true, data: TODAY_ACTIVE };
      throw new Error(`unexpected path ${path}`);
    });
    renderHome();

    expect(await screen.findByTestId('home-error')).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.error.validation'))).toBeTruthy();

    shouldFail = false;
    fireEvent.press(screen.getByTestId('home-retry'));

    expect(await screen.findByTestId('today-summary')).toBeTruthy();
    expect(await screen.findByTestId(`attention-card-${HOME_ATTENTION_ITEMS[0].id}`)).toBeTruthy();
    expect(mockedApiRequest).toHaveBeenCalledTimes(4);
  });

  it('keeps Today visible and recovers an attention-only error with its scoped retry', async () => {
    let attentionFailed = true;
    mockedApiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/mobile/attention' && attentionFailed) return { ok: false, error: VALIDATION_ERROR };
      if (path === '/api/mobile/attention') return { ok: true, data: attentionResponse([HOME_ATTENTION_ITEMS[0]]) };
      return { ok: true, data: TODAY_ACTIVE };
    });
    renderHome();

    expect(await screen.findByTestId('today-summary')).toBeTruthy();
    expect(screen.getByTestId('attention-inline-error')).toBeTruthy();
    expect(screen.queryByTestId('home-error')).toBeNull();

    attentionFailed = false;
    fireEvent.press(screen.getByTestId('attention-retry'));
    expect(await screen.findByTestId(`attention-card-${HOME_ATTENTION_ITEMS[0].id}`)).toBeTruthy();
    expect(screen.queryByTestId('attention-inline-error')).toBeNull();
    expect(mockedApiRequest.mock.calls.filter(([path]) => path === '/api/mobile/today')).toHaveLength(1);
  });

  it('keeps attention visible and recovers a Today-only error with its scoped retry', async () => {
    let todayFailed = true;
    mockedApiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/mobile/today' && todayFailed) return { ok: false, error: VALIDATION_ERROR };
      if (path === '/api/mobile/today') return { ok: true, data: TODAY_ACTIVE };
      return { ok: true, data: attentionResponse([HOME_ATTENTION_ITEMS[0]]) };
    });
    renderHome();

    expect(await screen.findByTestId('today-summary-error')).toBeTruthy();
    expect(await screen.findByTestId(`attention-card-${HOME_ATTENTION_ITEMS[0].id}`)).toBeTruthy();

    todayFailed = false;
    fireEvent.press(screen.getByTestId('today-summary-retry'));
    expect(await screen.findByTestId('today-summary')).toBeTruthy();
    expect(mockedApiRequest.mock.calls.filter(([path]) => path === '/api/mobile/attention')).toHaveLength(1);
  });

  it('renders section-level error and loading states when the other Home query is still pending', async () => {
    const todayRequest = deferred<{ ok: true; data: TodayResponse }>();
    mockedApiRequest.mockImplementation((path: string) => {
      if (path === '/api/mobile/attention') return Promise.resolve({ ok: false, error: VALIDATION_ERROR });
      return todayRequest.promise;
    });

    renderHome();

    expect(await screen.findByTestId('attention-inline-error')).toBeTruthy();
    expect(screen.getByTestId('today-summary-loading')).toBeTruthy();
    expect(screen.queryByTestId('home-error')).toBeNull();

    todayRequest.resolve({ ok: true, data: TODAY_ACTIVE });
    expect(await screen.findByTestId('today-summary')).toBeTruthy();
  });

  it('keeps stale cards/summaries visible when a refresh fails and labels both sections retryable', async () => {
    let shouldFail = false;
    let attentionResolved = false;
    mockedApiRequest.mockImplementation(async (path: string) => {
      if (shouldFail) return { ok: false, error: VALIDATION_ERROR };
      if (path === '/api/mobile/attention') {
        return {
          ok: true,
          data: attentionResponse(attentionResolved ? [] : [HOME_ATTENTION_ITEMS[0]]),
        };
      }
      return { ok: true, data: TODAY_ACTIVE };
    });
    renderHome();

    expect(await screen.findByTestId(`attention-card-${HOME_ATTENTION_ITEMS[0].id}`)).toBeTruthy();
    expect(await screen.findByTestId('today-summary')).toBeTruthy();

    shouldFail = true;
    const list = screen.getByTestId('home-attention-list');
    await act(async () => {
      await list.props.refreshControl.props.onRefresh();
    });

    await waitFor(() => {
      expect(screen.getByTestId(`attention-card-${HOME_ATTENTION_ITEMS[0].id}`)).toBeTruthy();
      expect(screen.getByTestId('attention-stale')).toBeTruthy();
      expect(screen.getByTestId('today-summary-stale')).toBeTruthy();
    });

    shouldFail = false;
    attentionResolved = true;
    await act(async () => {
      fireEvent.press(screen.getByTestId('attention-retry'));
      fireEvent.press(screen.getByTestId('today-summary-retry-stale'));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('attention-stale')).toBeNull();
      expect(screen.queryByTestId('today-summary-stale')).toBeNull();
      expect(screen.queryByTestId(`attention-card-${HOME_ATTENTION_ITEMS[0].id}`)).toBeNull();
    });
    expect(screen.getByText(i18n.t('mobile.home.empty.caughtUp.title'))).toBeTruthy();
  });
});

describe('HomeScreen offline, refresh, and actions', () => {
  it('does not fetch or retry while offline with no shop data cached', async () => {
    mockIsOnline = false;
    mockedApiRequest.mockReturnValue(new Promise(() => {}));
    renderHome();

    expect(screen.getByTestId('home-offline')).toBeTruthy();
    expect(mockedApiRequest).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('home-retry'));
    await waitFor(() => expect(mockedApiRequest).not.toHaveBeenCalled());
  });

  it('shows cached data with an offline notice and does not start a pull refresh offline', async () => {
    mockHomeData({ attention: attentionResponse([HOME_ATTENTION_ITEMS[0]]) });
    const rendered = renderHome();
    expect(await screen.findByTestId(`attention-card-${HOME_ATTENTION_ITEMS[0].id}`)).toBeTruthy();
    const callsBeforeOffline = mockedApiRequest.mock.calls.length;

    mockIsOnline = false;
    rendered.rerender(
      <QueryClientProvider client={rendered.client}>
        <HomeScreen />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('home-offline-cached')).toBeTruthy();
    expect(screen.queryByTestId('home-offline')).toBeNull();
    expect(screen.getByTestId(`attention-card-${HOME_ATTENTION_ITEMS[0].id}`)).toBeTruthy();

    await act(async () => {
      await screen.getByTestId('home-attention-list').props.refreshControl.props.onRefresh();
    });
    expect(mockedApiRequest).toHaveBeenCalledTimes(callsBeforeOffline);
  });

  it('does not spin forever when only an empty Attention snapshot is cached offline', () => {
    mockIsOnline = false;
    const client = createQueryClient();
    client.setQueryData(mobileQueryKeys.attention('shop-1'), attentionResponse([]));

    renderHome(client);

    expect(screen.getByTestId('today-summary-offline')).toBeTruthy();
    expect(screen.getByTestId('home-empty-attention-only')).toBeTruthy();
    expect(screen.queryByTestId('today-summary-loading')).toBeNull();
    expect(screen.queryByTestId('attention-loading')).toBeNull();
    expect(mockedApiRequest).not.toHaveBeenCalled();
  });

  it('renders the no-shop state without issuing either Home request', () => {
    mockShopId = null;
    renderHome();

    expect(screen.getByTestId('home-no-shop')).toBeTruthy();
    expect(mockedApiRequest).not.toHaveBeenCalled();
  });

  it('coalesces concurrent pull-to-refresh events into one two-endpoint refresh', async () => {
    let refreshing = false;
    const nextAttention = deferred<{ ok: true; data: AttentionResponse }>();
    const nextToday = deferred<{ ok: true; data: TodayResponse }>();
    let refreshCalls = 0;
    let refreshBatchStarts = 0;
    let activeRefreshRequests = 0;

    mockedApiRequest.mockImplementation((path: string) => {
      if (!refreshing) {
        if (path === '/api/mobile/attention') return Promise.resolve({ ok: true, data: attentionResponse([HOME_ATTENTION_ITEMS[0]]) });
        return Promise.resolve({ ok: true, data: TODAY_ACTIVE });
      }

      refreshCalls += 1;
      if (activeRefreshRequests === 0) refreshBatchStarts += 1;
      activeRefreshRequests += 1;
      const request = path === '/api/mobile/attention' ? nextAttention.promise : nextToday.promise;
      return request.finally(() => {
        activeRefreshRequests -= 1;
      });
    });

    renderHome();
    expect(await screen.findByTestId('today-summary')).toBeTruthy();
    refreshing = true;

    const getRefresh = () => screen.getByTestId('home-attention-list').props.refreshControl.props.onRefresh as () => Promise<void>;
    let firstRefresh!: Promise<void>;
    await act(async () => {
      firstRefresh = getRefresh()();
    });
    await waitFor(() => {
      expect(screen.getByTestId('home-attention-list').props.refreshControl.props.refreshing).toBe(true);
    });

    let secondRefresh!: Promise<void>;
    await act(async () => {
      secondRefresh = getRefresh()();
    });
    expect(secondRefresh).toBe(firstRefresh);
    expect(refreshCalls).toBe(2);
    expect(refreshBatchStarts).toBe(1);

    nextAttention.resolve({ ok: true, data: attentionResponse([HOME_ATTENTION_ITEMS[1]]) });
    nextToday.resolve({ ok: true, data: { ...TODAY_ACTIVE, order_count: 4 } });
    await act(async () => {
      await firstRefresh;
    });

    expect(await screen.findByTestId(`attention-card-${HOME_ATTENTION_ITEMS[1].id}`)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId('home-attention-list').props.refreshControl.props.refreshing).toBe(false);
    });
  });

  it('routes order and conversation cards through openDeepLink but keeps products informational', async () => {
    const order = HOME_ATTENTION_ITEMS.find((item) => item.entity.type === 'order');
    const conversation = HOME_ATTENTION_ITEMS.find((item) => item.entity.type === 'conversation');
    const product = HOME_ATTENTION_ITEMS.find((item) => item.entity.type === 'product');
    if (!order || !conversation || !product) throw new Error('action fixtures incomplete');

    mockHomeData({ attention: attentionResponse([order, conversation, product]) });
    renderHome();

    fireEvent.press(await screen.findByTestId(`attention-card-${order.id}`));
    fireEvent.press(await screen.findByTestId(`attention-card-${conversation.id}`));
    const productCard = await screen.findByTestId(`attention-card-${product.id}`);

    expect(mockedOpenDeepLink).toHaveBeenNthCalledWith(1, 'order', order.entity.id);
    expect(mockedOpenDeepLink).toHaveBeenNthCalledWith(2, 'conversation', conversation.entity.id);
    expect(productCard.props.accessibilityRole).toBe('text');
    expect(productCard.props.onPress).toBeUndefined();
  });
});

describe('HomeScreen locale and shop boundaries', () => {
  it('renders Bengali by default and updates Today/Attention labels in English', async () => {
    mockHomeData({ attention: attentionResponse([HOME_ATTENTION_ITEMS[0]]) });
    renderHome();

    const summary = await screen.findByTestId('today-summary');
    expect(within(summary).getByText(i18n.t('mobile.home.today.title', { lng: 'bn' }))).toBeTruthy();
    expect(screen.getByText(i18n.t('mobile.home.attention.title', { lng: 'bn' }))).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    await waitFor(() => {
      expect(within(screen.getByTestId('today-summary')).getByText('Today')).toBeTruthy();
      expect(screen.getByText('Needs Attention')).toBeTruthy();
      expect(screen.getByText('Order')).toBeTruthy();
    });
  });

  it('shows a translated warning when the conversation scan was truncated', async () => {
    mockHomeData({
      attention: attentionResponse([HOME_ATTENTION_ITEMS[0]], { conversation_scan_truncated: true }),
    });
    renderHome();

    expect(await screen.findByTestId('attention-scan-truncated')).toHaveTextContent(
      i18n.t('mobile.home.attention.scanTruncated'),
    );
  });

  it('shows the overflow indicator when the server capped the list (truncated_count > 0)', async () => {
    mockHomeData({ attention: attentionResponse([HOME_ATTENTION_ITEMS[0]], { truncated_count: 4 }) });
    renderHome();

    expect(await screen.findByTestId('attention-overflow')).toHaveTextContent(
      i18n.t('mobile.home.attention.overflow', { count: 4 }),
    );
  });

  it('uses distinct shop query keys and never renders the previous shop response after a switch', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    const shopOneItem = { ...HOME_ATTENTION_ITEMS[0], id: 'courier_failed:order:shop-one', reason: 'Shop one courier issue' };
    const shopTwoItem = { ...HOME_ATTENTION_ITEMS[0], id: 'courier_failed:order:shop-two', reason: 'Shop two courier issue' };
    mockedApiRequest.mockImplementation(async (path: string) => {
      const item = mockShopId === 'shop-1' ? shopOneItem : shopTwoItem;
      if (path === '/api/mobile/attention') return { ok: true, data: attentionResponse([item]) };
      return { ok: true, data: TODAY_ACTIVE };
    });

    const rendered = renderHome();
    expect(await screen.findByText('Shop one courier issue')).toBeTruthy();
    expect(rendered.client.getQueryData(mobileQueryKeys.attention('shop-1'))).toEqual(attentionResponse([shopOneItem]));

    mockShopId = 'shop-2';
    rendered.rerender(
      <QueryClientProvider client={rendered.client}>
        <HomeScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Shop two courier issue')).toBeTruthy();
    expect(screen.queryByText('Shop one courier issue')).toBeNull();
    expect(rendered.client.getQueryData(mobileQueryKeys.attention('shop-2'))).toEqual(attentionResponse([shopTwoItem]));
  });

  it('enables Home requests when auth refresh restores a shop id through the auth seam', async () => {
    mockShopId = null;
    const rendered = renderHome();
    expect(screen.getByTestId('home-no-shop')).toBeTruthy();
    expect(mockedApiRequest).not.toHaveBeenCalled();

    mockHomeData({ attention: attentionResponse([HOME_ATTENTION_ITEMS[0]]) });
    mockShopId = 'shop-restored-by-refresh';
    rendered.rerender(
      <QueryClientProvider client={rendered.client}>
        <HomeScreen />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('today-summary')).toBeTruthy();
    expect(await screen.findByTestId(`attention-card-${HOME_ATTENTION_ITEMS[0].id}`)).toBeTruthy();
  });
});
