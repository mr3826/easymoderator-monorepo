import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import { attentionResponseSchema, type AttentionResponse } from '@/api/mobile/schemas';
import { mobileQueryKeys } from '@/api/mobile/queryKeys';
import { retryNormalizedError, toQueryFn } from '@/api/query';
import type { NormalizedError } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { useNetworkStatus } from './useNetworkStatus';

const attentionSnapshots = new Map<string, AttentionResponse>();
const fetchAttention = toQueryFn('/api/mobile/attention', attentionResponseSchema);
const useRuntimeSnapshots = process.env.NODE_ENV !== 'test';

/** Reads the server-ranked Needs Attention list for the authenticated current shop. */
export function useAttention(): UseQueryResult<AttentionResponse, NormalizedError> {
  const { user } = useAuth();
  const shopId = user?.shopId ?? null;
  const isOnline = useNetworkStatus();

  return useQuery<AttentionResponse, NormalizedError>({
    queryKey: mobileQueryKeys.attention(shopId),
    queryFn: async () => {
      const data = await fetchAttention();
      if (useRuntimeSnapshots && shopId) attentionSnapshots.set(shopId, data);
      return data;
    },
    enabled: Boolean(shopId) && isOnline,
    retry: retryNormalizedError,
    placeholderData: useRuntimeSnapshots && shopId
      ? attentionSnapshots.get(shopId) ?? keepPreviousData
      : keepPreviousData,
  });
}
