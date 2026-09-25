import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { todayResponseSchema, type TodayResponse } from '@/api/mobile/schemas';
import { mobileQueryKeys } from '@/api/mobile/queryKeys';
import { retryNormalizedError, toQueryFn } from '@/api/query';
import type { NormalizedError } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { useNetworkStatus } from './useNetworkStatus';

const fetchToday = toQueryFn('/api/mobile/today', todayResponseSchema);

/** Reads the server-computed Dhaka-day summary for the authenticated current shop. */
export function useToday(): UseQueryResult<TodayResponse, NormalizedError> {
  const { user } = useAuth();
  const shopId = user?.shopId ?? null;
  const isOnline = useNetworkStatus();

  return useQuery<TodayResponse, NormalizedError>({
    queryKey: mobileQueryKeys.today(shopId),
    queryFn: fetchToday,
    enabled: Boolean(shopId) && isOnline,
    retry: retryNormalizedError,
    // No placeholderData: a shop switch must render nothing (loading) rather than the previous
    // shop's data. Offline or after a failed refresh, only the cached entry for *this* shop key is
    // shown (retention policy: `src/lib/queryClient.ts`).
  });
}
