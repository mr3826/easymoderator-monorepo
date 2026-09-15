import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { toQueryFn, retryNormalizedError } from '@/api/query';
import { attentionResponseSchema, type AttentionResponse } from '@/api/mobile/schemas';
import { mobileQueryKeys } from '@/api/mobile/queryKeys';
import { useAuth } from '@/auth/AuthProvider';
import type { NormalizedError } from '@/api/errors';

/**
 * `GET /api/mobile/attention` (ADR M-008, Phase 2 Home lane) — the ranked "Needs Attention" list.
 * Disabled while there is no current shop (`AuthUser.shopId` nullable) so it never fires a request
 * `verifyShopAccess` would reject anyway, and never renders a spinner that could never resolve.
 */
export function useAttention(): UseQueryResult<AttentionResponse, NormalizedError> {
  const { user } = useAuth();
  const shopId = user?.shopId ?? null;

  return useQuery<AttentionResponse, NormalizedError>({
    queryKey: mobileQueryKeys.attention(shopId),
    queryFn: toQueryFn('/api/mobile/attention', attentionResponseSchema),
    enabled: Boolean(shopId),
    retry: retryNormalizedError,
  });
}
