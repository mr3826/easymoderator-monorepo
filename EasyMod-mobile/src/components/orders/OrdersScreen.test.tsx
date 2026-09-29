import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';
import { OrdersScreen } from './OrdersScreen';

const mockUser: { shopId: string | null } = { shopId: 'shop-1' };
const mockUseOrders = jest.fn();
const mockUseNetworkStatus = jest.fn(() => true);
const mockPush = jest.fn();

jest.mock('@/hooks/useOrders', () => ({ useOrders: (...args: unknown[]) => mockUseOrders(...args) }));
jest.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => mockUseNetworkStatus() }));
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const order = { id: 'order-1', order_number: 'ORD-001', order_status: 'confirmed', payment_status: 'pending', total: 1200, currency: 'BDT', customer_name: 'Pilot Customer' };

beforeEach(async () => {
  mockUser.shopId = 'shop-1';
  await i18n.changeLanguage('en');
  mockUseNetworkStatus.mockReturnValue(true);
  mockUseOrders.mockReturnValue({ data: { pages: [{ orders: [order], pagination: { page: 1, limit: 25, hasNextPage: false } }] }, isPending: false, isError: false, isRefetching: false, isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn() });
  mockPush.mockReset();
});

afterEach(async () => { await i18n.changeLanguage('bn'); });

describe('OrdersScreen', () => {
  it('renders a shop-scoped order and opens its read-only detail', () => {
    render(<OrdersScreen />);
    expect(screen.getByText('ORD-001')).toBeTruthy();
    expect(screen.getByText('Pilot Customer')).toBeTruthy();
    fireEvent.press(screen.getByTestId('mobile-order-order-1'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/order-detail/[id]', params: { id: 'order-1' } });
  });

  it('filters orders by status without enabling mutations', () => {
    render(<OrdersScreen />);
    fireEvent.press(screen.getByTestId('mobile-orders-filter-confirmed'));
    expect(mockUseOrders).toHaveBeenCalledWith('confirmed');
  });

  it('shows explicit offline state without cached orders', () => {
    mockUseNetworkStatus.mockReturnValue(false);
    mockUseOrders.mockReturnValue({ data: undefined, isPending: false, isError: false, isRefetching: false, isFetchingNextPage: false, hasNextPage: false, refetch: jest.fn(), fetchNextPage: jest.fn() });
    render(<OrdersScreen />);
    expect(screen.getByText(i18n.t('mobile.orders.offline.title'))).toBeTruthy();
  });
});
