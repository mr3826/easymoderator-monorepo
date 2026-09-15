import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import {
  useDeepLinkEntity,
  placeholderResolver,
  __setDeepLinkResolverForTests,
  __resetDeepLinkResolverForTests,
} from './deeplink-entity';

// A fresh `QueryClient` per test, created once outside the wrapper component's render so
// re-renders (triggered by the hook's own state changes) reuse the same client instead of
// resetting the cache and losing in-flight query identity on every render pass.
function createWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

jest.setTimeout(30_000);

afterEach(() => {
  __resetDeepLinkResolverForTests();
});

describe('useDeepLinkEntity', () => {
  it('resolves to "found" via the Phase 2 placeholder resolver by default', async () => {
    const { result } = renderHook(() => useDeepLinkEntity('order', 'order-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 15_000 });

    expect(result.current.data).toEqual({ kind: 'found', id: 'order-1' });
  });

  it('lets a later lane swap in a real resolver without changing the hook', async () => {
    __setDeepLinkResolverForTests(async (kind, id) => {
      expect(kind).toBe('conversation');
      expect(id).toBe('convo-9');
      return { kind: 'unavailable' };
    });

    const { result } = renderHook(() => useDeepLinkEntity('conversation', 'convo-9'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 15_000 });

    expect(result.current.data).toEqual({ kind: 'unavailable' });
  });

  it('surfaces a transient resolver failure as isError, distinct from "unavailable"', async () => {
    __setDeepLinkResolverForTests(async () => {
      throw new Error('network blip');
    });

    const { result } = renderHook(() => useDeepLinkEntity('order', 'order-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });
  });

  it('resetting the test resolver restores the real Phase 2 placeholder for later tests', async () => {
    __setDeepLinkResolverForTests(async () => ({ kind: 'unavailable' }));
    __resetDeepLinkResolverForTests();

    await expect(placeholderResolver('order', 'order-1')).resolves.toEqual({ kind: 'found', id: 'order-1' });

    const { result } = renderHook(() => useDeepLinkEntity('order', 'order-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 15_000 });
    expect(result.current.data).toEqual({ kind: 'found', id: 'order-1' });
  });
});
