import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { customerQuickViewSchema, type CustomerQuickView } from '@/api/mobile/schemas';
import { mobileQueryKeys } from '@/api/mobile/queryKeys';
import { retryNormalizedError, toQueryFn } from '@/api/query';
import type { NormalizedError } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { useNetworkStatus } from './useNetworkStatus';

export function useCustomerQuickView(customerId: string): UseQueryResult<CustomerQuickView, NormalizedError> {
  const { user } = useAuth();
  const shopId = user?.shopId ?? null;
  const isOnline = useNetworkStatus();

  return useQuery<CustomerQuickView, NormalizedError>({
    queryKey: mobileQueryKeys.customer(shopId, customerId),
    queryFn: toQueryFn(`/api/mobile/customers/${encodeURIComponent(customerId)}`, customerQuickViewSchema),
    enabled: Boolean(shopId && customerId) && isOnline,
    retry: retryNormalizedError,
  });
}
