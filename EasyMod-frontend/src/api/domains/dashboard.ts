/**
 * Dashboard & Analytics API Domain
 */

import { httpClient } from '@/shared/lib/http/client';
import type { ApiResponse } from '../types/common';
import type { DashboardMetrics, DashboardQueue } from '../types/dashboard';
import type { KnowledgeGap } from '../types/knowledge';
import type { AxiosResponse } from 'axios';

/**
 * Get dashboard metrics for specified period
 * @param period - Time period in days for metrics (default: 30)
 * @returns Promise resolving to dashboard metrics object
 * @throws {Error} When metrics retrieval fails
 * @example
 * ```typescript
 * const metrics = await getDashboardMetrics(7); // Last 7 days
 * ```
 */
export async function getDashboardMetrics(period = 30): Promise<DashboardMetrics> {
  const response: AxiosResponse<ApiResponse<DashboardMetrics>> = await httpClient.get(
    '/api/dashboard/metrics',
    { params: { period } }
  );
  return response.data.data;
}

/**
 * Get dashboard queue information
 * @returns Promise resolving to dashboard queue object
 * @throws {Error} When queue retrieval fails
 * @example
 * ```typescript
 * const queue = await getDashboardQueue();
 * console.log('Queue length:', queue.length);
 * ```
 */
export async function getDashboardQueue(): Promise<DashboardQueue> {
  const response: AxiosResponse<ApiResponse<DashboardQueue>> = await httpClient.get(
    '/api/dashboard/queue'
  );
  return response.data.data;
}

/**
 * Get knowledge gaps analysis
 * @param limit - Maximum number of gaps to return (default: 20)
 * @returns Promise resolving to array of knowledge gaps
 * @throws {Error} When knowledge gaps retrieval fails
 * @example
 * ```typescript
 * const gaps = await getKnowledgeGaps(10);
 * console.log('Knowledge gaps:', gaps.length);
 * ```
 */
export async function getKnowledgeGaps(limit = 20): Promise<KnowledgeGap[]> {
  const response: AxiosResponse<ApiResponse<KnowledgeGap[]>> = await httpClient.get(
    '/api/analytics/knowledge-gap',
    { params: { limit } }
  );
  return response.data.data;
}

/**
 * Get analytics data for specified period
 * @param period - Time period in days for analytics (default: 30)
 * @returns Promise resolving to analytics object with messages, calls, cache hits, keyword matches, and cost estimate
 * @throws {Error} When analytics retrieval fails
 * @example
 * ```typescript
 * const analytics = await getAnalytics(7); // Last 7 days
 * console.log('Total messages:', analytics.total_messages);
 * ```
 */
export async function getAnalytics(period = 30): Promise<{
  total_messages: number;
  llm_calls: number;
  cache_hits: number;
  keyword_matches: number;
  cost_estimate: number;
}> {
  const response: AxiosResponse<ApiResponse<{
    total_conversations: number;
    total_messages: number;
    llm_calls: number;
    cache_hits: number;
    keyword_matches: number;
    cost_estimate: number;
  }>> = await httpClient.get('/api/analytics', { params: { period } });
  return response.data.data;
}

