/**
 * Subscription Domain API Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as subscription from '../subscription';
import { httpClient } from '@/shared/lib/http/client';

vi.mock('@/shared/lib/http/client', () => ({
  httpClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

describe('Subscription Domain API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSubscription', () => {
    it('should return subscription details', async () => {
      const mockResponse = {
        data: {
          data: {
            plan: 'PRO',
            status: 'active',
            currentPeriodEnd: '2024-12-31',
          },
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await subscription.getSubscription();

      expect(httpClient.get).toHaveBeenCalledWith('/api/subscription');
      expect(result.plan).toBe('PRO');
    });
  });

  describe('getSubscriptionPlans', () => {
    it('should return available plans', async () => {
      const mockResponse = {
        data: {
          data: [
            { id: 'PACKAGE_1', name: 'Package 1', price: 750 },
            { id: 'PACKAGE_2', name: 'Package 2', price: 1950 },
          ],
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await subscription.getSubscriptionPlans();

      expect(httpClient.get).toHaveBeenCalledWith('/api/subscription/plans');
      expect(result).toHaveLength(2);
    });
  });

  describe('subscribeToPlan', () => {
    it('should subscribe to plan', async () => {
      const mockResponse = {
        data: { data: { plan: 'PRO', status: 'active' } },
      };
      (httpClient.put as any).mockResolvedValue(mockResponse);

      const result = await subscription.subscribeToPlan('pro', 'yearly');

      expect(httpClient.put).toHaveBeenCalledWith('/api/subscription/plan', { plan_code: 'pro', billing_cycle: 'yearly' });
      expect(result.plan).toBe('PRO');
    });

    it('should use monthly as default billing cycle', async () => {
      const mockResponse = { data: { data: {} } };
      (httpClient.put as any).mockResolvedValue(mockResponse);

      await subscription.subscribeToPlan('PACKAGE_1');

      expect(httpClient.put).toHaveBeenCalledWith('/api/subscription/plan', { plan_code: 'PACKAGE_1', billing_cycle: 'monthly' });
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel with no reason by default', async () => {
      const mockResponse = { data: { data: { status: 'cancelled' } } };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await subscription.cancelSubscription();

      expect(httpClient.post).toHaveBeenCalledWith('/api/subscription/cancel', { reason: undefined });
      expect(result.status).toBe('cancelled');
    });

    it('should forward a cancellation reason when provided', async () => {
      const mockResponse = { data: { data: { status: 'cancelled' } } };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      await subscription.cancelSubscription('Too expensive');

      expect(httpClient.post).toHaveBeenCalledWith('/api/subscription/cancel', { reason: 'Too expensive' });
    });
  });

  describe('reactivateSubscription', () => {
    it('should reactivate subscription', async () => {
      const mockResponse = { data: { data: { status: 'active' } } };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await subscription.reactivateSubscription();

      expect(httpClient.post).toHaveBeenCalledWith('/api/subscription/reactivate');
      expect(result.status).toBe('active');
    });
  });

  describe('getPaymentMethods', () => {
    it('should return payment methods', async () => {
      const mockResponse = {
        data: {
          data: [
            { id: 'pm1', type: 'card', last4: '4242' },
          ],
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await subscription.getPaymentMethods();

      expect(httpClient.get).toHaveBeenCalledWith('/api/payment-methods/available');
      expect(result[0].last4).toBe('4242');
    });
  });
});
