/**
 * Order Domain API Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as order from '../order';
import { httpClient } from '@/shared/lib/http/client';

vi.mock('@/shared/lib/http/client', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  },
}));

describe('Order Domain API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getOrders', () => {
    it('should return list of orders', async () => {
      const mockResponse = {
        data: {
          data: [
            { id: '1', total: 100, status: 'pending' },
            { id: '2', total: 200, status: 'confirmed' },
          ],
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await order.getOrders();

      expect(httpClient.get).toHaveBeenCalledWith('/api/order', { params: undefined });
      expect(result).toEqual(mockResponse.data.data);
    });

    it('should handle query parameters', async () => {
      const mockResponse = { data: { data: [] } };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      await order.getOrders({ status: 'pending', page: 1, limit: 10 });

      expect(httpClient.get).toHaveBeenCalledWith('/api/order', { params: { status: 'pending', page: 1, limit: 10 } });
    });
  });

  describe('getOrder', () => {
    it('should return single order', async () => {
      const mockResponse = {
        data: {
          data: { id: '1', total: 100, status: 'pending', items: [] },
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await order.getOrder('1');

      expect(httpClient.get).toHaveBeenCalledWith('/api/order/1');
      expect(result.id).toBe('1');
    });
  });

  describe('createOrder', () => {
    it('should create order successfully', async () => {
      const orderData = { items: [{ product_id: '1', quantity: 2 }], customer_id: 'cust1' };
      const mockResponse = {
        data: { data: { id: '3', ...orderData, status: 'pending' } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await order.createOrder(orderData as any);

      expect(httpClient.post).toHaveBeenCalledWith('/api/order', orderData);
      expect(result.id).toBe('3');
    });
  });

  describe('updateOrder', () => {
    it('should update order successfully', async () => {
      const updateData = { status: 'confirmed' };
      const mockResponse = {
        data: { data: { id: '1', ...updateData } },
      };
      (httpClient.patch as any).mockResolvedValue(mockResponse);

      const result = await order.updateOrder('1', updateData);

      expect(httpClient.patch).toHaveBeenCalledWith('/api/order/1', updateData);
      expect(result.id).toBe('1');
    });
  });

  describe('confirmOrder', () => {
    it('should confirm order', async () => {
      const mockResponse = {
        data: { data: { id: '1', status: 'confirmed' } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await order.confirmOrder('1');

      expect(httpClient.post).toHaveBeenCalledWith('/api/order/1/confirm');
      expect(result.status).toBe('confirmed');
    });
  });

  describe('cancelOrder', () => {
    it('should cancel order with reason', async () => {
      const mockResponse = {
        data: { data: { id: '1', status: 'cancelled' } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      await order.cancelOrder('1', 'Out of stock');

      expect(httpClient.post).toHaveBeenCalledWith('/api/order/1/cancel', { reason: 'Out of stock' });
    });

    it('should cancel order without reason', async () => {
      const mockResponse = {
        data: { data: { id: '1', status: 'cancelled' } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      await order.cancelOrder('1');

      expect(httpClient.post).toHaveBeenCalledWith('/api/order/1/cancel', { reason: undefined });
    });
  });

  describe('bookCourier', () => {
    it('should book courier successfully', async () => {
      const payload = { provider: 'steadfast', cod_amount: 500 };
      const mockResponse = {
        data: { data: { tracking_id: 'TRK123', provider: 'steadfast' } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await order.bookCourier('1', payload as any);

      expect(httpClient.post).toHaveBeenCalledWith('/api/order/1/courier', payload);
      expect(result.tracking_id).toBe('TRK123');
    });
  });

  describe('getDeliverySettings', () => {
    it('should return delivery settings', async () => {
      const mockResponse = {
        data: {
          data: {
            default_delivery_charge: 50,
            cod_enabled: true,
            providers: [
              { provider: 'pathao', enabled: true },
              { provider: 'steadfast', enabled: false },
            ],
          },
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await order.getDeliverySettings();

      expect(httpClient.get).toHaveBeenCalledWith('/api/shop/delivery/settings');
      expect(result.providers).toHaveLength(2);
    });
  });

  describe('connectDeliveryProvider', () => {
    it('should connect provider with credentials', async () => {
      (httpClient.post as any).mockResolvedValue({ data: {} });

      const payload = { provider: 'pathao' as any, credentials: { client_id: '123', client_secret: 'secret' } };
      await order.connectDeliveryProvider(payload);

      expect(httpClient.post).toHaveBeenCalledWith('/api/shop/delivery/connect', payload);
    });
  });

  describe('disconnectDeliveryProvider', () => {
    it('should disconnect provider', async () => {
      (httpClient.post as any).mockResolvedValue({ data: {} });

      await order.disconnectDeliveryProvider('pathao' as any);

      expect(httpClient.post).toHaveBeenCalledWith('/api/shop/delivery/disconnect', { provider: 'pathao' });
    });
  });

  describe('toggleDeliveryProvider', () => {
    it('should toggle provider on via POST', async () => {
      (httpClient.post as any).mockResolvedValue({ data: {} });

      await order.toggleDeliveryProvider('pathao' as any, true);

      expect(httpClient.post).toHaveBeenCalledWith('/api/shop/delivery/toggle', { provider: 'pathao', isActive: true });
    });

    it('should toggle provider off', async () => {
      (httpClient.post as any).mockResolvedValue({ data: {} });

      await order.toggleDeliveryProvider('steadfast' as any, false);

      expect(httpClient.post).toHaveBeenCalledWith('/api/shop/delivery/toggle', { provider: 'steadfast', isActive: false });
    });
  });

  describe('updateDeliverySettings', () => {
    it('should update settings', async () => {
      (httpClient.put as any).mockResolvedValue({ data: {} });

      const settings = { default_delivery_charge: 50, cod_enabled: true };
      await order.updateDeliverySettings(settings);

      expect(httpClient.put).toHaveBeenCalledWith('/api/shop/delivery/settings', settings);
    });

    it('should update partial settings', async () => {
      (httpClient.put as any).mockResolvedValue({ data: {} });

      await order.updateDeliverySettings({ cod_charge: 20 });

      expect(httpClient.put).toHaveBeenCalledWith('/api/shop/delivery/settings', { cod_charge: 20 });
    });
  });

  describe('testDeliveryConnection', () => {
    it('should test delivery provider connection', async () => {
      (httpClient.post as any).mockResolvedValue({ data: {} });

      await order.testDeliveryConnection('pathao' as any);

      expect(httpClient.post).toHaveBeenCalledWith('/api/shop/delivery/test', { provider: 'pathao' });
    });
  });
});
