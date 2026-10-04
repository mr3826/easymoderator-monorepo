import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { CourierProblemScreen } from './CourierProblemScreen';
import i18n from '@/i18n';

const mockUseProblemParcels = jest.fn();
const mockUseDeliveryTracking = jest.fn();
const mockMutateBookCourier = jest.fn();

jest.mock('@/hooks/useCourier', () => ({
  useProblemParcels: (...args: unknown[]) => mockUseProblemParcels(...args),
  useDeliveryTracking: (...args: unknown[]) => mockUseDeliveryTracking(...args),
  useBookCourier: () => ({
    mutate: mockMutateBookCourier,
    isPending: false,
  }),
}));

jest.mock('@/hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => true,
}));

const mockParcels = [
  {
    order_id: 'ord-p1',
    order_number: 'ORD-501',
    customer_name: 'Imran Khan',
    customer_phone: '01719998877',
    total_amount: 1450,
    cod_amount: 1450,
    delivery_provider: 'steadfast',
    consignment_id: 'CS-501',
    tracking_code: 'SF-501',
    delivery_status: 'failed_delivery',
    order_status: 'confirmed',
    delivery_address: 'Uttara Sector 10, Dhaka',
    problem_reason: 'Customer phone was switched off',
    updated_at: '2026-10-04T12:00:00Z',
  },
];

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');

  mockUseProblemParcels.mockReturnValue({
    data: { parcels: mockParcels, pagination: { page: 1, limit: 25, total: 1, hasNextPage: false } },
    isPending: false,
    isRefetching: false,
    refetch: jest.fn(),
  });

  mockUseDeliveryTracking.mockReturnValue({
    data: {
      order_id: 'ord-p1',
      order_number: 'ORD-501',
      provider: 'steadfast',
      tracking_number: 'SF-501',
      current_status: 'failed_delivery',
      status_history: [
        { status: 'booked', timestamp: '2026-10-02T10:00:00Z', location: 'Dhaka Hub' },
        { status: 'failed_delivery', timestamp: '2026-10-04T12:00:00Z', location: 'Uttara' },
      ],
      cod_derived_note: 'Order-derived expectation',
    },
    isPending: false,
  });
});

describe('CourierProblemScreen', () => {
  test('renders problem parcels with order number, customer phone and reason', () => {
    render(<CourierProblemScreen />);

    expect(screen.getByText('#ORD-501')).toBeTruthy();
    expect(screen.getByText('Imran Khan')).toBeTruthy();
    expect(screen.getByText('01719998877')).toBeTruthy();
    expect(screen.getByText(/Customer phone was switched off/)).toBeTruthy();
    expect(screen.getByTestId('mobile-courier-card-ord-p1')).toBeTruthy();
  });

  test('calls customer phone when Call button is tapped', () => {
    const spyOpenURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    render(<CourierProblemScreen />);

    const callBtn = screen.getByTestId('mobile-courier-call-btn');
    fireEvent.press(callBtn);

    expect(spyOpenURL).toHaveBeenCalledWith('tel:01719998877');
  });

  test('opens tracking timeline modal when Track button is tapped', () => {
    render(<CourierProblemScreen />);

    const trackBtn = screen.getByTestId('mobile-courier-track-btn');
    fireEvent.press(trackBtn);

    expect(screen.getByTestId('mobile-courier-tracking-modal')).toBeTruthy();
    expect(screen.getByText('Dhaka Hub')).toBeTruthy();
    expect(screen.getByText('Uttara')).toBeTruthy();
  });

  test('opens booking modal and submits courier re-dispatch', () => {
    render(<CourierProblemScreen />);

    const retryBtn = screen.getByTestId('mobile-courier-retry-btn');
    fireEvent.press(retryBtn);

    expect(screen.getByTestId('mobile-courier-booking-modal')).toBeTruthy();

    const providerPathao = screen.getByTestId('mobile-courier-provider-pathao');
    fireEvent.press(providerPathao);

    const submitBtn = screen.getByTestId('mobile-courier-confirm-book-btn');
    fireEvent.press(submitBtn);

    expect(mockMutateBookCourier).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord-p1',
        provider: 'pathao',
      }),
      expect.anything(),
    );
  });

  test('shows empty state when no problem parcels exist', () => {
    mockUseProblemParcels.mockReturnValue({
      data: { parcels: [], pagination: { page: 1, limit: 25, total: 0, hasNextPage: false } },
      isPending: false,
      isRefetching: false,
      refetch: jest.fn(),
    });

    render(<CourierProblemScreen />);
    expect(screen.getByTestId('mobile-courier-empty')).toBeTruthy();
  });
});
