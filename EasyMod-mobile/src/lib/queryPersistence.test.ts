import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';

import { HOME_OFFLINE_MAX_AGE_MS, mobileQueryKeys } from '@/api/mobile/queryKeys';
import {
  PERSISTED_QUERY_CACHE_KEY,
  isPersistableQuery,
  persistenceBuster,
  purgePersistedQueries,
  startQueryPersistence,
} from './queryPersistence';

const HOME = { items: [{ id: 'low_stock:product:p1' }], truncated_count: 0 };
const TODAY = { order_count: 4 };

function createClient() {
  return new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
}

const successQuery = (queryKey: readonly unknown[]) => ({ queryKey, state: { status: 'success' } }) as never;

async function storedCache(): Promise<{ buster: string; timestamp: number; clientState: { queries: { queryKey: unknown[] }[] } } | null> {
  const raw = await AsyncStorage.getItem(PERSISTED_QUERY_CACHE_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function waitForPersist(): Promise<void> {
  // The persister throttles writes (1 s); wait for the trailing write to land.
  await new Promise((resolve) => setTimeout(resolve, 1_200));
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('isPersistableQuery (ADR M-011 allowlist)', () => {
  it('persists only successful Home reads of the current shop', () => {
    expect(isPersistableQuery(successQuery(mobileQueryKeys.attention('shop-1')), 'shop-1')).toBe(true);
    expect(isPersistableQuery(successQuery(mobileQueryKeys.today('shop-1')), 'shop-1')).toBe(true);
  });

  it.each([
    ['another shop', mobileQueryKeys.attention('shop-2')],
    ['a missing shop', mobileQueryKeys.today(null)],
    ['a deep-link entity read', ['deeplink', 'order', 'o-1']],
    ['any other mobile resource', ['mobile', 'orders', 'shop-1']],
  ])('never persists %s', (_label, queryKey) => {
    expect(isPersistableQuery(successQuery(queryKey), 'shop-1')).toBe(false);
  });

  it('never persists an errored or pending read', () => {
    const key = mobileQueryKeys.attention('shop-1');
    expect(isPersistableQuery({ queryKey: key, state: { status: 'error' } } as never, 'shop-1')).toBe(false);
    expect(isPersistableQuery({ queryKey: key, state: { status: 'pending' } } as never, 'shop-1')).toBe(false);
  });
});

describe('startQueryPersistence', () => {
  it('persists the allowlisted reads and restores them into a fresh client for the same session', async () => {
    const first = createClient();
    const stop = await startQueryPersistence(first, 'user-1', 'shop-1');
    first.setQueryData(mobileQueryKeys.attention('shop-1'), HOME);
    first.setQueryData(mobileQueryKeys.today('shop-1'), TODAY);
    first.setQueryData(mobileQueryKeys.attention('shop-2'), { items: ['other shop'] });
    first.setQueryData(['deeplink', 'order', 'o-1'], { kind: 'found' });
    await waitForPersist();
    stop();

    const stored = await storedCache();
    expect(stored?.buster).toBe(persistenceBuster('user-1', 'shop-1'));
    expect(stored?.clientState.queries.map((q) => q.queryKey)).toEqual(
      expect.arrayContaining([mobileQueryKeys.attention('shop-1'), mobileQueryKeys.today('shop-1')]),
    );
    expect(stored?.clientState.queries).toHaveLength(2);

    const restored = createClient();
    (await startQueryPersistence(restored, 'user-1', 'shop-1'))();
    expect(restored.getQueryData(mobileQueryKeys.attention('shop-1'))).toEqual(HOME);
    expect(restored.getQueryData(mobileQueryKeys.today('shop-1'))).toEqual(TODAY);
  });

  it.each([
    ['another user', 'user-2', 'shop-1'],
    ['another shop', 'user-1', 'shop-2'],
  ])('discards a cache persisted for %s instead of rendering it', async (_label, userId, shopId) => {
    const first = createClient();
    const stop = await startQueryPersistence(first, 'user-1', 'shop-1');
    first.setQueryData(mobileQueryKeys.attention('shop-1'), HOME);
    await waitForPersist();
    stop();

    const other = createClient();
    (await startQueryPersistence(other, userId, shopId))();

    expect(other.getQueryData(mobileQueryKeys.attention('shop-1'))).toBeUndefined();
    expect(await storedCache()).toBeNull();
  });

  it('discards a cache older than the 24 h offline window', async () => {
    const first = createClient();
    const stop = await startQueryPersistence(first, 'user-1', 'shop-1');
    first.setQueryData(mobileQueryKeys.attention('shop-1'), HOME);
    await waitForPersist();
    stop();
    const stored = await storedCache();
    await AsyncStorage.setItem(
      PERSISTED_QUERY_CACHE_KEY,
      JSON.stringify({ ...stored, timestamp: Date.now() - HOME_OFFLINE_MAX_AGE_MS - 1 }),
    );

    const restored = createClient();
    (await startQueryPersistence(restored, 'user-1', 'shop-1'))();

    expect(restored.getQueryData(mobileQueryKeys.attention('shop-1'))).toBeUndefined();
  });

  it('purgePersistedQueries removes the stored cache', async () => {
    const first = createClient();
    const stop = await startQueryPersistence(first, 'user-1', 'shop-1');
    first.setQueryData(mobileQueryKeys.attention('shop-1'), HOME);
    await waitForPersist();
    stop();
    expect(await storedCache()).not.toBeNull();

    await purgePersistedQueries();

    expect(await storedCache()).toBeNull();
  });
});
