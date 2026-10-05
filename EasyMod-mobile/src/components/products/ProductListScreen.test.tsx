import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProductListScreen } from './ProductListScreen';
import i18n from '@/i18n';

const mockUseProducts = jest.fn();
const mockMutateQuickUpdate = jest.fn();
const mockMutatePhotoDraft = jest.fn();

jest.mock('@/hooks/useProducts', () => ({
  useProducts: (...args: unknown[]) => mockUseProducts(...args),
  useQuickUpdateStock: () => ({
    mutate: mockMutateQuickUpdate,
    isPending: false,
  }),
  usePhotoDraft: () => ({
    mutate: mockMutatePhotoDraft,
    isPending: false,
  }),
}));

jest.mock('@/hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => true,
}));

const mockProductList = [
  {
    id: 'prod-1',
    name: 'Cotton T-Shirt',
    name_bn: 'সুতি টি-শার্ট',
    sku: 'TS-01',
    category: 'Apparel',
    price: 550,
    compare_at_price: 700,
    quantity: 12,
    low_stock_threshold: 5,
    track_quantity: true,
    in_stock: true,
    stock_status: 'in_stock' as const,
    image_url: null,
    images: [],
    description: '100% Cotton',
    is_active: true,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
  },
  {
    id: 'prod-2',
    name: 'Leather Belt',
    name_bn: 'চামড়ার বেল্ট',
    sku: 'LB-02',
    category: 'Accessories',
    price: 950,
    compare_at_price: null,
    quantity: 0,
    low_stock_threshold: 5,
    track_quantity: true,
    in_stock: false,
    stock_status: 'out_of_stock' as const,
    image_url: null,
    images: [],
    description: 'Genuine leather',
    is_active: true,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
  },
];

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');

  mockUseProducts.mockReturnValue({
    data: {
      products: mockProductList,
      pagination: { page: 1, limit: 20, total_items: 2, total_pages: 1 },
    },
    isLoading: false,
    isRefetching: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
  });
});

describe('ProductListScreen', () => {
  test('renders products list with name, price and cards', () => {
    render(<ProductListScreen />);

    expect(screen.getByTestId('product-screen-title')).toBeTruthy();
    expect(screen.getByTestId('product-card-prod-1')).toBeTruthy();
    expect(screen.getByTestId('product-card-prod-2')).toBeTruthy();
    expect(screen.getByTestId('product-name-prod-1')).toBeTruthy();
    expect(screen.getByTestId('product-price-prod-1')).toBeTruthy();
  });

  test('tapping +1 fires stock update mutation with stockDelta: 1', () => {
    render(<ProductListScreen />);

    const incBtn = screen.getByTestId('stepper-increment-prod-1');
    fireEvent.press(incBtn);

    expect(mockMutateQuickUpdate).toHaveBeenCalledWith({
      productId: 'prod-1',
      stockDelta: 1,
    });
  });

  test('tapping -1 fires stock update mutation with stockDelta: -1', () => {
    render(<ProductListScreen />);

    const decBtn = screen.getByTestId('stepper-decrement-prod-1');
    fireEvent.press(decBtn);

    expect(mockMutateQuickUpdate).toHaveBeenCalledWith({
      productId: 'prod-1',
      stockDelta: -1,
    });
  });

  test('tapping Sold Out button fires newStock: 0 mutation', () => {
    render(<ProductListScreen />);

    const soldOutBtn = screen.getByTestId('stepper-sold-out-prod-1');
    fireEvent.press(soldOutBtn);

    expect(mockMutateQuickUpdate).toHaveBeenCalledWith({
      productId: 'prod-1',
      newStock: 0,
      inStock: false,
    });
  });

  test('tapping + Draft opens modal and saves new product draft', () => {
    render(<ProductListScreen />);

    const addDraftBtn = screen.getByTestId('product-add-draft-btn');
    fireEvent.press(addDraftBtn);

    const nameInput = screen.getByTestId('photo-draft-name-input');
    const priceInput = screen.getByTestId('photo-draft-price-input');

    fireEvent.changeText(nameInput, 'Cotton Panjabi');
    fireEvent.changeText(priceInput, '1250');

    const submitBtn = screen.getByTestId('photo-draft-submit-btn');
    fireEvent.press(submitBtn);

    expect(mockMutatePhotoDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Cotton Panjabi',
        price: 1250,
      }),
      expect.any(Object),
    );
  });
});
