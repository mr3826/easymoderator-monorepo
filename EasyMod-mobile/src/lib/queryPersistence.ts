import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query, QueryClient } from '@tanstack/react-query';
import { persistQueryClientRestore, persistQueryClientSubscribe } from '@tanstack/react-query-persist-client';

import { HOME_OFFLINE_MAX_AGE_MS } from '@/api/mobile/queryKeys';
import { getAppVersion } from '@/config/env';

/**
 * ADR M-011: a read-only, time-boxed, allowlisted offline cache.
 *
 * - Allowlist: only the Home reads (`['mobile', 'attention' | 'today', shopId]`) of the *current*
 *   shop, and only successful ones. Their content is server-built summary text (order numbers,
 *   totals, product names, fixed status phrases) — never message bodies or attachments.
 * - Bound to one session: the buster is `appVersion:userId:shopId`, so a different app build,
 *   account or shop discards the stored cache instead of rendering it.
 * - Time-boxed: anything older than 24 h is discarded on restore.
 * - Purged on logout, session rejection/revocation and sign-out (`AuthProvider`).
 * - Nothing here queues or replays a write; mutations do not exist offline.
 */

export const PERSISTED_QUERY_CACHE_KEY = 'easymod.query-cache.v1';
const PERSISTED_RESOURCES: ReadonlySet<string> = new Set(['attention', 'today']);

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: PERSISTED_QUERY_CACHE_KEY,
  throttleTime: 1000,
});

export function persistenceBuster(userId: string, shopId: string): string {
  return `${getAppVersion()}:${userId}:${shopId}`;
}

export function isPersistableQuery(query: Pick<Query, 'queryKey' | 'state'>, shopId: string): boolean {
  const [scope, resource, keyShopId] = query.queryKey as readonly unknown[];
  return (
    scope === 'mobile' &&
    typeof resource === 'string' &&
    PERSISTED_RESOURCES.has(resource) &&
    keyShopId === shopId &&
    query.state.status === 'success'
  );
}

/**
 * Restores this session's persisted Home cache (discarding it when stale or bound to another
 * session), then keeps it updated. Returns the unsubscribe function.
 */
export async function startQueryPersistence(
  queryClient: QueryClient,
  userId: string,
  shopId: string,
): Promise<() => void> {
  const buster = persistenceBuster(userId, shopId);
  try {
    await persistQueryClientRestore({ queryClient, persister: queryPersister, maxAge: HOME_OFFLINE_MAX_AGE_MS, buster });
  } catch {
    // An unreadable cache is not an error for the merchant; the network copy will replace it.
    await purgePersistedQueries();
  }
  return persistQueryClientSubscribe({
    queryClient,
    persister: queryPersister,
    buster,
    dehydrateOptions: { shouldDehydrateQuery: (query) => isPersistableQuery(query, shopId) },
  });
}

export async function purgePersistedQueries(): Promise<void> {
  try {
    await queryPersister.removeClient();
  } catch {
    // Storage unavailable: nothing was persisted there either.
  }
}
