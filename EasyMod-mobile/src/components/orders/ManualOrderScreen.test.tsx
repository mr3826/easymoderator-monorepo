import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ManualOrderScreen } from './ManualOrderScreen';
import i18n from '@/i18n';

const mockPush = jest.fn();
const mockMutateCreate = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/hooks/useOrders', () => ({
  useCreateManualOrder: () => ({
    mutate: mockMutateCreate,
    isPending: false,
  }),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('ManualOrderScreen component', () => {
  test('renders all manual order entry fields', () => {
    render(<ManualOrderScreen />);

    expect(screen.getByTestId('mobile-manual-phone-input')).toBeTruthy();
    expect(screen.getByTestId('mobile-manual-name-input')).toBeTruthy();
    expect(screen.getByTestId('mobile-manual-address-input')).toBeTruthy();
    expect(screen.getByTestId('mobile-manual-product-input')).toBeTruthy();
    expect(screen.getByTestId('mobile-manual-price-input')).toBeTruthy();
    expect(screen.getByTestId('mobile-manual-total-amount')).toBeTruthy();
  });

  test('dynamically computes total price based on qty, price, and delivery fee', () => {
    render(<ManualOrderScreen />);

    const priceInput = screen.getByTestId('mobile-manual-price-input');
    fireEvent.changeText(priceInput, '500');

    // Default: qty=1, fee=60 -> 560
    expect(screen.getByText('৳560')).toBeTruthy();

    // Increment qty to 2: 2 * 500 + 60 = 1060
    const plusBtn = screen.getByText('+');
    fireEvent.press(plusBtn);
    expect(screen.getByText('৳1060')).toBeTruthy();
  });

  test('validates required fields before submitting', () => {
    render(<ManualOrderScreen />);

    const submitBtn = screen.getByTestId('mobile-manual-order-submit-btn');
    fireEvent.press(submitBtn);

    expect(screen.getByTestId('mobile-manual-order-error')).toBeTruthy();
    expect(mockMutateCreate).not.toHaveBeenCalled();
  });

  test('submits valid manual order with entered customer and item details', () => {
    render(<ManualOrderScreen />);

    fireEvent.changeText(screen.getByTestId('mobile-manual-phone-input'), '01712345678');
    fireEvent.changeText(screen.getByTestId('mobile-manual-name-input'), 'Shakil Ahmed');
    fireEvent.changeText(screen.getByTestId('mobile-manual-address-input'), 'Mirpur-10, Dhaka');
    fireEvent.changeText(screen.getByTestId('mobile-manual-product-input'), 'Leather Wallet');
    fireEvent.changeText(screen.getByTestId('mobile-manual-price-input'), '850');

    const submitBtn = screen.getByTestId('mobile-manual-order-submit-btn');
    fireEvent.press(submitBtn);

    expect(mockMutateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_phone: '01712345678',
        customer_name: 'Shakil Ahmed',
        delivery_address: 'Mirpur-10, Dhaka',
        items: [
          expect.objectContaining({
            name: 'Leather Wallet',
            price: 850,
            quantity: 1,
          }),
        ],
        delivery_fee: 60,
        is_draft: false,
      }),
      expect.any(Object),
    );
  });
});
