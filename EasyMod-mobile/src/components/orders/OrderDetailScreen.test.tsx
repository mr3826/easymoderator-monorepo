import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { OrderDetailScreen } from './OrderDetailScreen';
import i18n from '@/i18n';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockUseOrder = jest.fn();
const mockUseOrderRisk = jest.fn();
const mockMutateConfirm = jest.fn();
const mockMutateCancel = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

jest.mock('@/hooks/useOrders', () => ({
  useOrder: (...args: unknown[]) => mockUseOrder(...args),
  useOrderRisk: (...args: unknown[]) => mockUseOrderRisk(...args),
  useConfirmOrder: () => ({
    mutate: mockMutateConfirm,
    isPending: false,
  }),
  useCancelOrder: () => ({
    mutate: mockMutateCancel,
    isPending: false,
  }),
}));

jest.mock('@/hooks/useCourier', () => ({
  useBookCourier: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
  useDeliveryTracking: () => ({
    data: null,
    isPending: false,
  }),
}));

const mockOrder = {
  id: 'ord-101',
  order_number: 'ORD-101',
  order_status: 'draft',
  payment_status: 'pending',
  fulfillment_status: 'unfulfilled',
  customer_id: 'cust-1',
  customer_name: 'Farhan Kabir',
  customer_phone: '01711223344',
  total: '1850',
  currency: 'BDT',
  order_items: [
    { id: 'item-1', name: 'Cotton Polo Shirt', quantity: 2, price: 900, total: 1800 },
  ],
};

const mockRisk = {
  delivered_count: 3,
  rto_count: 0,
  cancelled_count: 0,
  total_orders: 3,
  has_duplicate_recent_order: false,
  risk_level: 'low' as const,
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');

  mockUseOrder.mockReturnValue({
    data: mockOrder,
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  });

  mockUseOrderRisk.mockReturnValue({
    data: mockRisk,
    isPending: false,
    isError: false,
  });

  jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
});

describe('OrderDetailScreen component', () => {
  test('renders order details, items, and verification risk summary', () => {
    render(<OrderDetailScreen id="ord-101" />);

    expect(screen.getByText('ORD-101')).toBeTruthy();
    expect(screen.getByText('Farhan Kabir')).toBeTruthy();
    expect(screen.getByText('01711223344')).toBeTruthy();
    expect(screen.getByText('Cotton Polo Shirt')).toBeTruthy();
    expect(screen.getByText('1850 BDT')).toBeTruthy();

    expect(screen.getByTestId('mobile-order-risk-panel')).toBeTruthy();
    expect(screen.getByText('Low Risk')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy(); // delivered count
  });

  test('displays duplicate order warning when recent duplicate is flagged', () => {
    mockUseOrderRisk.mockReturnValue({
      data: {
        ...mockRisk,
        has_duplicate_recent_order: true,
        risk_level: 'high' as const,
      },
      isPending: false,
      isError: false,
    });

    render(<OrderDetailScreen id="ord-101" />);

    expect(screen.getByTestId('mobile-order-duplicate-warning')).toBeTruthy();
    expect(screen.getByText('High Risk')).toBeTruthy();
  });

  test('opens confirm modal and submits order confirmation', () => {
    render(<OrderDetailScreen id="ord-101" />);

    const confirmBtn = screen.getByTestId('mobile-order-confirm-btn');
    fireEvent.press(confirmBtn);

    const modalSubmitBtn = screen.getByTestId('mobile-order-modal-confirm-submit');
    fireEvent.press(modalSubmitBtn);

    expect(mockMutateConfirm).toHaveBeenCalledWith(
      { orderId: 'ord-101' },
      expect.any(Object),
    );
  });

  test('opens cancel modal, accepts reason, and submits order cancellation', () => {
    render(<OrderDetailScreen id="ord-101" />);

    const cancelBtn = screen.getByTestId('mobile-order-cancel-btn');
    fireEvent.press(cancelBtn);

    const reasonInput = screen.getByTestId('mobile-order-cancel-reason-input');
    fireEvent.changeText(reasonInput, 'Customer changed their mind');

    const modalSubmitBtn = screen.getByTestId('mobile-order-modal-cancel-submit');
    fireEvent.press(modalSubmitBtn);

    expect(mockMutateCancel).toHaveBeenCalledWith(
      { orderId: 'ord-101', reason: 'Customer changed their mind' },
      expect.any(Object),
    );
  });

  test('invokes Linking.openURL when Call Customer is tapped', () => {
    render(<OrderDetailScreen id="ord-101" />);

    const callBtn = screen.getByTestId('mobile-order-call-customer');
    fireEvent.press(callBtn);

    expect(Linking.openURL).toHaveBeenCalledWith('tel:01711223344');
  });
});
