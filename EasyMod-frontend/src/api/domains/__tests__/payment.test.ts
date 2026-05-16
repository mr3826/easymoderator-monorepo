/**
 * Payment Domain API Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as payment from '../payment';
import { httpClient } from '@/shared/lib/http/client';

vi.mock('@/shared/lib/http/client', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('Payment Domain API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getPaymentConfig', () => {
    it('should return list of payment configs', async () => {
      const mockData = [
        { gateway: 'bkash', is_enabled: true },
        { gateway: 'cod', is_enabled: true },
      ];
      (httpClient.get as any).mockResolvedValue({ data: { success: true, data: mockData } });

      const result = await payment.getPaymentConfig();

      expect(httpClient.get).toHaveBeenCalledWith('/api/payment/config');
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should propagate errors', async () => {
      (httpClient.get as any).mockRejectedValue(new Error('Unauthorized'));

      await expect(payment.getPaymentConfig()).rejects.toThrow('Unauthorized');
    });
  });

  describe('updatePaymentConfig', () => {
    it('should update gateway config', async () => {
      const payload = { gateway: 'bkash', is_enabled: true, credentials: { app_key: 'abc' } };
      const mockResponse = { success: true, data: { gateway: 'bkash', is_enabled: true } };
      (httpClient.post as any).mockResolvedValue({ data: mockResponse });

      const result = await payment.updatePaymentConfig(payload);

      expect(httpClient.post).toHaveBeenCalledWith('/api/payment/config', payload);
      expect(result.success).toBe(true);
    });

    it('should enable a gateway', async () => {
      const payload = { gateway: 'bkash', is_enabled: true };
      (httpClient.post as any).mockResolvedValue({ data: { success: true, data: {} } });

      await payment.updatePaymentConfig(payload);

      expect(httpClient.post).toHaveBeenCalledWith('/api/payment/config', payload);
    });

    it('should update config without credentials', async () => {
      const payload = { gateway: 'bkash', config: { sandbox: false } };
      (httpClient.post as any).mockResolvedValue({ data: { success: true, data: {} } });

      await payment.updatePaymentConfig(payload);

      expect(httpClient.post).toHaveBeenCalledWith('/api/payment/config', payload);
    });
  });

  describe('testPaymentConnection', () => {
    it('should test gateway connection', async () => {
      const payload = { gateway: 'bkash', credentials: { app_key: 'key', app_secret: 'secret' } };
      const mockResponse = { success: true, data: { connected: true }, message: 'Connection successful' };
      (httpClient.post as any).mockResolvedValue({ data: mockResponse });

      const result = await payment.testPaymentConnection(payload);

      expect(httpClient.post).toHaveBeenCalledWith('/api/payment/config/test', payload);
      expect(result.success).toBe(true);
      expect(result.message).toBe('Connection successful');
    });

    it('should return failure when credentials are wrong', async () => {
      const payload = { gateway: 'bkash' };
      (httpClient.post as any).mockResolvedValue({
        data: { success: false, data: { connected: false }, message: 'Invalid credentials' },
      });

      const result = await payment.testPaymentConnection(payload);

      expect(result.success).toBe(false);
    });

    it('should propagate network errors', async () => {
      (httpClient.post as any).mockRejectedValue(new Error('Timeout'));

      await expect(payment.testPaymentConnection({ gateway: 'bkash' })).rejects.toThrow('Timeout');
    });
  });

  describe('deletePaymentConfig', () => {
    it('should delete payment gateway config', async () => {
      (httpClient.delete as any).mockResolvedValue({ data: { success: true } });

      const result = await payment.deletePaymentConfig('bkash');

      expect(httpClient.delete).toHaveBeenCalledWith('/api/payment/config/bkash');
      expect(result.success).toBe(true);
    });

    it('should propagate 404 when gateway not found', async () => {
      (httpClient.delete as any).mockRejectedValue({ response: { status: 404 } });

      await expect(payment.deletePaymentConfig('unknown_gateway')).rejects.toMatchObject({
        response: { status: 404 },
      });
    });
  });
});
