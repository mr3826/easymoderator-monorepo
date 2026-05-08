/**
 * Dashboard Domain API Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as dashboard from '../dashboard';
import { httpClient } from '@/shared/lib/http/client';

vi.mock('@/shared/lib/http/client', () => ({
  httpClient: {
    get: vi.fn(),
  },
}));

describe('Dashboard Domain API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDashboardMetrics', () => {
    it('should return dashboard metrics', async () => {
      const mockResponse = {
        data: {
          data: {
            totalRevenue: 50000,
            totalOrders: 150,
            totalCustomers: 80,
            period: 30,
          },
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await dashboard.getDashboardMetrics();

      expect(httpClient.get).toHaveBeenCalledWith('/dashboard/metrics', { params: { period: 30 } });
      expect(result.totalRevenue).toBe(50000);
    });

    it('should handle custom period', async () => {
      const mockResponse = { data: { data: {} } };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      await dashboard.getDashboardMetrics(7);

      expect(httpClient.get).toHaveBeenCalledWith('/dashboard/metrics', { params: { period: 7 } });
    });
  });

  describe('getDashboardQueue', () => {
    it('should return queue data', async () => {
      const mockResponse = {
        data: {
          data: {
            pendingOrders: 5,
            unreadMessages: 12,
            atRiskOrders: 2,
          },
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await dashboard.getDashboardQueue();

      expect(httpClient.get).toHaveBeenCalledWith('/dashboard/queue');
      expect(result.pendingOrders).toBe(5);
    });
  });

  describe('getKnowledgeGaps', () => {
    it('should return knowledge gaps with default limit', async () => {
      const mockResponse = {
        data: {
          data: [
            { id: '1', question: 'What are your hours?', frequency: 15 },
          ],
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await dashboard.getKnowledgeGaps();

      expect(httpClient.get).toHaveBeenCalledWith('/analytics/knowledge-gap', { params: { limit: 20 } });
      expect(result).toHaveLength(1);
    });
  });

  describe('getAnalytics', () => {
    it('should return analytics data', async () => {
      const mockResponse = {
        data: {
          data: {
            total_messages: 1000,
            llm_calls: 500,
            cache_hits: 300,
            keyword_matches: 200,
            cost_estimate: 15.5,
          },
        },
      };
      (httpClient.get as any).mockResolvedValue(mockResponse);

      const result = await dashboard.getAnalytics();

      expect(httpClient.get).toHaveBeenCalledWith('/analytics', { params: { period: 30 } });
      expect(result.llm_calls).toBe(500);
    });
  });
});
