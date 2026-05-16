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

      expect(httpClient.get).toHaveBeenCalledWith('/subscription');
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

      expect(httpClient.get).toHaveBeenCalledWith('/subscription/plans');
      expect(result).toHaveLength(2);
    });
  });

  describe('subscribeToPlan', () => {
    it('should subscribe to plan', async () => {
      const mockResponse = {
        data: { data: { plan: 'PRO', status: 'active' } },
      };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await subscription.subscribeToPlan('pro', 'monthly');

      expect(httpClient.post).toHaveBeenCalledWith('/subscription/subscribe', { planId: 'pro', billingCycle: 'monthly' });
      expect(result.plan).toBe('PRO');
    });

    it('should use monthly as default billing cycle', async () => {
      const mockResponse = { data: { data: {} } };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      await subscription.subscribeToPlan('PACKAGE_1');

      expect(httpClient.post).toHaveBeenCalledWith('/subscription/subscribe', { planId: 'PACKAGE_1', billingCycle: 'monthly' });
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel at period end by default', async () => {
      const mockResponse = { data: { data: { status: 'cancelled' } } };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await subscription.cancelSubscription();

      expect(httpClient.post).toHaveBeenCalledWith('/subscription/cancel', { atPeriodEnd: true });
    });

    it('should cancel immediately when specified', async () => {
      const mockResponse = { data: { data: { status: 'cancelled' } } };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      await subscription.cancelSubscription(false);

      expect(httpClient.post).toHaveBeenCalledWith('/subscription/cancel', { atPeriodEnd: false });
    });
  });

  describe('reactivateSubscription', () => {
    it('should reactivate subscription', async () => {
      const mockResponse = { data: { data: { status: 'active' } } };
      (httpClient.post as any).mockResolvedValue(mockResponse);

      const result = await subscription.reactivateSubscription();

      expect(httpClient.post).toHaveBeenCalledWith('/subscription/reactivate');
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

      expect(httpClient.get).toHaveBeenCalledWith('/subscription/payment-methods');
      expect(result[0].last4).toBe('4242');
    });
  });
});
