import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHttpShopId } from '../useHttpShopId';
import { useShop } from '@/shared/context/ShopContext';
import { httpClient } from '../client';

// Mock the shop context
vi.mock('@/shared/context/ShopContext', () => ({
  useShop: vi.fn(),
}));

const mockUseShop = useShop as any;

describe('useHttpShopId Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    httpClient.setShopId(null);
  });

  it('should set shop ID on mount', () => {
    mockUseShop.mockReturnValue({
      currentShopId: 'shop_123',
    });

    renderHook(() => useHttpShopId());

    expect(httpClient.getShopId()).toBe('shop_123');
  });

  it('should update shop ID when shop changes', () => {
    mockUseShop.mockReturnValue({
      currentShopId: 'shop_123',
    });

    const { rerender } = renderHook(() => useHttpShopId());

    expect(httpClient.getShopId()).toBe('shop_123');

    // Update shop context
    mockUseShop.mockReturnValue({
      currentShopId: 'shop_456',
    });

    rerender();

    expect(httpClient.getShopId()).toBe('shop_456');
  });

  it('should handle null shop ID', () => {
    mockUseShop.mockReturnValue({
      currentShopId: null,
    });

    renderHook(() => useHttpShopId());

    expect(httpClient.getShopId()).toBeNull();
  });

  it('should clear shop ID when context updates to null', () => {
    mockUseShop.mockReturnValue({
      currentShopId: 'shop_123',
    });

    const { rerender } = renderHook(() => useHttpShopId());

    expect(httpClient.getShopId()).toBe('shop_123');

    mockUseShop.mockReturnValue({
      currentShopId: null,
    });

    rerender();

    expect(httpClient.getShopId()).toBeNull();
  });

  it('should sync multiple shop changes', () => {
    const shopSequence = ['shop_a', 'shop_b', 'shop_c', 'shop_a'];

    mockUseShop.mockReturnValue({
      currentShopId: shopSequence[0],
    });

    const { rerender } = renderHook(() => useHttpShopId());

    expect(httpClient.getShopId()).toBe('shop_a');

    shopSequence.slice(1).forEach((shopId) => {
      mockUseShop.mockReturnValue({
        currentShopId: shopId,
      });

      rerender();

      expect(httpClient.getShopId()).toBe(shopId);
    });
  });
});

describe('Multi-Tenant Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    httpClient.setShopId(null);
    localStorage.clear();
  });

  it('should sync shop context to HTTP client', () => {
    mockUseShop.mockReturnValue({
      currentShopId: 'shop_integration_test',
    });

    renderHook(() => useHttpShopId());

    // Verify HTTP client has the shop ID
    expect(httpClient.getShopId()).toBe('shop_integration_test');

    // Simulated request would now include X-Shop-ID header
  });

  it('should maintain shop ID across hook updates', () => {
    mockUseShop.mockReturnValue({
      currentShopId: 'shop_main',
    });

    const { rerender } = renderHook(() => useHttpShopId());

    expect(httpClient.getShopId()).toBe('shop_main');

    // Simulate re-render without shop change
    rerender();

    // Should still be the same
    expect(httpClient.getShopId()).toBe('shop_main');
  });

  it('should handle rapid shop switches', () => {
    mockUseShop.mockReturnValue({
      currentShopId: 'shop_1',
    });

    const { rerender } = renderHook(() => useHttpShopId());

    // Rapid switches
    for (let i = 1; i <= 10; i++) {
      const shopId = `shop_${i}`;
      mockUseShop.mockReturnValue({
        currentShopId: shopId,
      });

      rerender();

      expect(httpClient.getShopId()).toBe(shopId);
    }
  });
});
