import { useInfiniteQuery, useQuery, type InfiniteData, type UseInfiniteQueryResult, type UseQueryResult } from '@tanstack/react-query';

import {
  orderDetailSchema,
  orderListResponseSchema,
  type OrderDetail,
  type OrderListResponse,
} from '@/api/mobile/schemas';
import { mobileQueryKeys } from '@/api/mobile/queryKeys';
import { retryNormalizedError, toQueryFn } from '@/api/query';
import type { NormalizedError } from '@/api/errors';
import { useAuth } from '@/auth/AuthProvider';
import { useNetworkStatus } from './useNetworkStatus';

const PAGE_SIZE = 25;

function ordersPath(page: number, status?: string): string {
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (status) params.set('order_status', status);
  return `/api/mobile/orders?${params.toString()}`;
}

export function useOrders(status?: string): UseInfiniteQueryResult<InfiniteData<OrderListResponse>, NormalizedError> {
  const { user } = useAuth();
  const shopId = user?.shopId ?? null;
  const isOnline = useNetworkStatus();

  return useInfiniteQuery<OrderListResponse, NormalizedError>({
    queryKey: mobileQueryKeys.orders(shopId, status ?? ''),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => toQueryFn(
      ordersPath(Number(pageParam), status),
      orderListResponseSchema,
    )(),
    getNextPageParam: (lastPage) => lastPage.pagination.hasNextPage
      ? lastPage.pagination.page + 1
      : undefined,
    enabled: Boolean(shopId) && isOnline,
    retry: retryNormalizedError,
  });
}

export function useOrder(orderId: string): UseQueryResult<OrderDetail, NormalizedError> {
  const { user } = useAuth();
  const shopId = user?.shopId ?? null;
  const isOnline = useNetworkStatus();

  return useQuery<OrderDetail, NormalizedError>({
    queryKey: mobileQueryKeys.order(shopId, orderId),
    queryFn: toQueryFn(`/api/mobile/orders/${encodeURIComponent(orderId)}`, orderDetailSchema),
    enabled: Boolean(shopId && orderId) && isOnline,
    retry: retryNormalizedError,
  });
}
