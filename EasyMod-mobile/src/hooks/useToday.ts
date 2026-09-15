import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { toQueryFn, retryNormalizedError } from '@/api/query';
import { todayResponseSchema, type TodayResponse } from '@/api/mobile/schemas';
import { mobileQueryKeys } from '@/api/mobile/queryKeys';
import { useAuth } from '@/auth/AuthProvider';
import type { NormalizedError } from '@/api/errors';

/**
 * `GET /api/mobile/today` (ADR M-008, Phase 2 Home lane) — the day's order/revenue/delivered
 * summary strip. Disabled while there is no current shop, same reasoning as `useAttention`.
 */
export function useToday(): UseQueryResult<TodayResponse, NormalizedError> {
  const { user } = useAuth();
  const shopId = user?.shopId ?? null;

  return useQuery<TodayResponse, NormalizedError>({
    queryKey: mobileQueryKeys.today(shopId),
    queryFn: toQueryFn('/api/mobile/today', todayResponseSchema),
    enabled: Boolean(shopId),
    retry: retryNormalizedError,
  });
}
