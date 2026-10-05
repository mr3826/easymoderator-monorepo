import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { CustomerQuickViewScreen } from './CustomerQuickViewScreen';
import i18n from '@/i18n';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockRefetch = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

const mockUseCustomerQuickView = jest.fn();

jest.mock('@/hooks/useCustomer', () => ({
  useCustomerQuickView: (...args: unknown[]) => mockUseCustomerQuickView(...args),
}));

describe('CustomerQuickViewScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, 'openURL').mockImplementation(() => Promise.resolve(true));
  });

  test('renders loading indicator when pending', () => {
    mockUseCustomerQuickView.mockReturnValue({
      isPending: true,
      data: undefined,
      error: null,
      refetch: mockRefetch,
    });

    render(<CustomerQuickViewScreen id="cust-123" />);

    expect(screen.getByTestId('customer-loading')).toBeTruthy();
  });

  test('renders error state and retries on press', () => {
    mockUseCustomerQuickView.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
      error: { kind: 'network' },
      refetch: mockRefetch,
    });

    render(<CustomerQuickViewScreen id="cust-123" />);

    expect(screen.getByTestId('mobile-customer-state')).toBeTruthy();
    const retryBtn = screen.getByTestId('customer-retry-btn');
    fireEvent.press(retryBtn);

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  test('renders customer identity, actions, lifetime stats, and recent orders', () => {
    mockUseCustomerQuickView.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        customer: {
          id: 'cust-123',
          name: 'Hasan Ali',
          phone: '01712345678',
          email: 'hasan@example.com',
        },
        orders: [
          {
            id: 'ord-1',
            order_number: 'ORD-1001',
            order_status: 'delivered',
            fulfillment_status: 'delivered',
            total: 1500,
            currency: 'BDT',
          },
          {
            id: 'ord-2',
            order_number: 'ORD-1002',
            order_status: 'returned',
            fulfillment_status: 'returned',
            total: 750,
            currency: 'BDT',
          },
        ],
        stats: {
          total_orders: 2,
          delivered_count: 1,
          rto_count: 1,
          cancelled_count: 0,
          return_rate: 50,
        },
      },
      error: null,
      refetch: mockRefetch,
    });

    render(<CustomerQuickViewScreen id="cust-123" />);

    // Identity
    expect(screen.getByTestId('customer-display-name')).toHaveTextContent('Hasan Ali');
    expect(screen.getByTestId('customer-phone')).toHaveTextContent('01712345678');
    expect(screen.getByTestId('customer-email')).toHaveTextContent('hasan@example.com');

    // Lifetime stats
    expect(screen.getByTestId('customer-stat-total')).toHaveTextContent('2');
    expect(screen.getByTestId('customer-stat-delivered')).toHaveTextContent('1');
    expect(screen.getByTestId('customer-stat-returned')).toHaveTextContent('1');
    expect(screen.getByTestId('customer-stat-rate')).toHaveTextContent('50%');

    // Recent orders
    expect(screen.getByTestId('customer-order-item-ord-1')).toBeTruthy();
    expect(screen.getByTestId('customer-order-item-ord-2')).toBeTruthy();

    // Order navigation
    fireEvent.press(screen.getByTestId('customer-order-item-ord-1'));
    expect(mockPush).toHaveBeenCalledWith('/order-detail/ord-1');
  });

  test('quick action buttons trigger phone call, message, and manual order navigation', () => {
    mockUseCustomerQuickView.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        customer: {
          id: 'cust-123',
          name: 'Hasan Ali',
          phone: '01712345678',
        },
        orders: [],
        stats: {
          total_orders: 0,
          delivered_count: 0,
          rto_count: 0,
          cancelled_count: 0,
          return_rate: 0,
        },
      },
      error: null,
      refetch: mockRefetch,
    });

    render(<CustomerQuickViewScreen id="cust-123" />);

    // 1. Call button
    fireEvent.press(screen.getByTestId('customer-call-btn'));
    expect(Linking.openURL).toHaveBeenCalledWith('tel:01712345678');

    // 2. Message button
    fireEvent.press(screen.getByTestId('customer-message-btn'));
    expect(Linking.openURL).toHaveBeenCalledWith('sms:01712345678');

    // 3. Create order button
    fireEvent.press(screen.getByTestId('customer-create-order-btn'));
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/quick-action',
        params: expect.objectContaining({
          action: 'manual-order',
          customerId: 'cust-123',
          customerName: 'Hasan Ali',
          customerPhone: '01712345678',
        }),
      })
    );

    // 4. Back button
    fireEvent.press(screen.getByTestId('mobile-customer-back'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
