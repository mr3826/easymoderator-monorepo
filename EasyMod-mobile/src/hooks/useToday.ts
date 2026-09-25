import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { todayResponseSchema, type TodayResponse } from '@/api/mobile/schemas';
import { mobileQueryKeys } from '@/api/mobile/queryKeys';
import { retryNormalizedError, toQueryFn } from '@/api/query';
import type { NormalizedError } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { useNetworkStatus } from './useNetworkStatus';

const todaySnapshots = new Map<string, TodayResponse>();
const fetchToday = toQueryFn('/api/mobile/today', todayResponseSchema);
const useRuntimeSnapshots = process.env.NODE_ENV !== 'test';

/** Reads the server-computed Dhaka-day summary for the authenticated current shop. */
export function useToday(): UseQueryResult<TodayResponse, NormalizedError> {
  const { user } = useAuth();
  const shopId = user?.shopId ?? null;
  const isOnline = useNetworkStatus();

  return useQuery<TodayResponse, NormalizedError>({
    queryKey: mobileQueryKeys.today(shopId),
    queryFn: async () => {
      const data = await fetchToday();
      if (useRuntimeSnapshots && shopId) todaySnapshots.set(shopId, data);
      return data;
    },
    enabled: Boolean(shopId) && isOnline,
    retry: retryNormalizedError,
    placeholderData: useRuntimeSnapshots && shopId
      ? todaySnapshots.get(shopId) ?? keepPreviousData
      : keepPreviousData,
  });
}
