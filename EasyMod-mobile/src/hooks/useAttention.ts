import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { attentionResponseSchema, type AttentionResponse } from '@/api/mobile/schemas';
import { mobileQueryKeys } from '@/api/mobile/queryKeys';
import { retryNormalizedError, toQueryFn } from '@/api/query';
import type { NormalizedError } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { useNetworkStatus } from './useNetworkStatus';

const fetchAttention = toQueryFn('/api/mobile/attention', attentionResponseSchema);

/** Reads the server-ranked Needs Attention list for the authenticated current shop. */
export function useAttention(): UseQueryResult<AttentionResponse, NormalizedError> {
  const { user } = useAuth();
  const shopId = user?.shopId ?? null;
  const isOnline = useNetworkStatus();

  return useQuery<AttentionResponse, NormalizedError>({
    queryKey: mobileQueryKeys.attention(shopId),
    queryFn: fetchAttention,
    enabled: Boolean(shopId) && isOnline,
    retry: retryNormalizedError,
    // No placeholderData: a shop switch must render nothing (loading) rather than the previous
    // shop's data. Offline or after a failed refresh, only the cached entry for *this* shop key is
    // shown (retention policy: `src/lib/queryClient.ts`).
  });
}
