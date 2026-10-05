import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { DailySummaryCard } from './DailySummaryCard';
import i18n from '@/i18n';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe('DailySummaryCard / TodaySummary', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockTodayData = {
    date: '2026-10-05',
    order_count: 14,
    revenue: 18500,
    expected_order_value: 18500,
    delivered_count: 9,
    pending_actions: {
      draft_orders: 2,
      needs_reply: 3,
      courier_problems: 2,
      rto_verify: 1,
      low_stock: 0,
    },
    timezone_used: 'Asia/Dhaka' as const,
    timezone_note: null,
    conversation_scan_truncated: false,
    generated_at: '2026-10-05T06:00:00Z',
  };

  test('renders primary KPIs and operational indicators', () => {
    render(
      <DailySummaryCard
        data={mockTodayData}
        isPending={false}
        isError={false}
        errorKind={undefined}
        isOnline={true}
        onRetry={jest.fn()}
      />
    );

    expect(screen.getByTestId('today-orders-count')).toHaveTextContent('14');
    expect(screen.getByTestId('today-delivered-count')).toHaveTextContent('9');
    expect(screen.getByTestId('today-revenue-value')).toHaveTextContent('৳18,500');

    // Operational summary
    expect(screen.getByTestId('today-problems-count')).toHaveTextContent('2');
    // Attention count = 2 (draft) + 3 (reply) + 1 (rto) + 0 (stock) + 2 (courier) = 8
    expect(screen.getByTestId('today-attention-count')).toHaveTextContent('8');

    // Courier alert badge
    expect(screen.getByTestId('today-courier-alert-badge')).toBeTruthy();
  });

  test('clicking Fix Problems button routes to courier problems', () => {
    render(
      <DailySummaryCard
        data={mockTodayData}
        isPending={false}
        isError={false}
        errorKind={undefined}
        isOnline={true}
        onRetry={jest.fn()}
      />
    );

    const fixBtn = screen.getByTestId('today-fix-problems-btn');
    expect(fixBtn).toBeTruthy();
    fireEvent.press(fixBtn);

    expect(mockPush).toHaveBeenCalledWith('/courier-problems');
  });

  test('renders loading and error retry states', () => {
    const onRetry = jest.fn();
    const { rerender } = render(
      <DailySummaryCard
        data={undefined}
        isPending={true}
        isError={false}
        errorKind={undefined}
        isOnline={true}
        onRetry={onRetry}
      />
    );

    expect(screen.getByTestId('today-summary-loading')).toBeTruthy();

    rerender(
      <DailySummaryCard
        data={undefined}
        isPending={false}
        isError={true}
        errorKind="network"
        isOnline={true}
        onRetry={onRetry}
      />
    );

    expect(screen.getByTestId('today-summary-error')).toBeTruthy();
    fireEvent.press(screen.getByTestId('today-summary-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
