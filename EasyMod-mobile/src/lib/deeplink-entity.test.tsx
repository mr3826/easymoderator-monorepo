import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import {
  apiBackedResolver,
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
  it('fails closed for a malformed id without making a request', async () => {
    const transport = { request: jest.fn() };

    await expect(apiBackedResolver('order', 'order-1', { transport })).resolves.toEqual({ kind: 'unavailable' });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it('resolves an own entity through the existing detail API and returns only its id', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const transport = {
      request: jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ success: true, data: { id, order_status: 'confirmed' } }),
      }),
    };

    await expect(apiBackedResolver('order', id, { transport })).resolves.toEqual({ kind: 'found', id });
    expect(transport.request).toHaveBeenCalledWith(`/api/order/${id}`, {});
  });

  it.each([400, 403, 404])('collapses HTTP %s authorization/not-found responses to unavailable', async (status) => {
    const id = '22222222-2222-4222-8222-222222222222';
    const transport = {
      request: jest.fn().mockResolvedValue({
        status,
        ok: false,
        json: async () => ({ success: false, message: 'not available' }),
      }),
    };

    await expect(apiBackedResolver('conversation', id, { transport })).resolves.toEqual({ kind: 'unavailable' });
    expect(transport.request).toHaveBeenCalledWith(`/api/conversation/${id}`, {});
  });

  it('keeps network/server failures retryable instead of converting them to not-found', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const transport = {
      request: jest.fn().mockResolvedValue({
        status: 503,
        ok: false,
        json: async () => ({ success: false, message: 'temporarily unavailable' }),
      }),
    };

    await expect(apiBackedResolver('conversation', id, { transport })).resolves.toEqual({ kind: 'transientError' });
  });

  it('maps a transport rejection to the retryable transient state', async () => {
    const id = '77777777-7777-4777-8777-777777777777';
    const transport = {
      request: jest.fn().mockRejectedValue(new Error('offline')),
    };

    await expect(apiBackedResolver('order', id, { transport })).resolves.toEqual({ kind: 'transientError' });
  });

  it('fails closed when the detail API returns a different entity id', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const transport = {
      request: jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({ success: true, data: { id: '55555555-5555-4555-8555-555555555555' } }),
      }),
    };

    await expect(apiBackedResolver('order', id, { transport })).resolves.toEqual({ kind: 'unavailable' });
  });

  it('refreshes a stale entity check on a later mount', async () => {
    const id = '66666666-6666-4666-8666-666666666666';
    const resolver = jest
      .fn()
      .mockResolvedValueOnce({ kind: 'found', id } as const)
      .mockResolvedValueOnce({ kind: 'unavailable' } as const);
    __setDeepLinkResolverForTests(resolver);
    const wrapper = createWrapper();

    const first = renderHook(() => useDeepLinkEntity('order', id), { wrapper });
    await waitFor(() => expect(first.result.current.data).toEqual({ kind: 'found', id }));
    first.unmount();

    const second = renderHook(() => useDeepLinkEntity('order', id), { wrapper });
    await waitFor(() => expect(second.result.current.data).toEqual({ kind: 'unavailable' }));

    expect(resolver).toHaveBeenCalledTimes(2);
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

  it('resetting the test resolver restores the real resolver with safe malformed-id handling', async () => {
    __setDeepLinkResolverForTests(async () => ({ kind: 'unavailable' }));
    __resetDeepLinkResolverForTests();

    await expect(apiBackedResolver('order', 'order-1')).resolves.toEqual({ kind: 'unavailable' });
    await expect(placeholderResolver('order', 'order-1')).resolves.toEqual({ kind: 'unavailable' });

    const { result } = renderHook(() => useDeepLinkEntity('order', 'order-1'), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true), { timeout: 15_000 });
    expect(result.current.data).toEqual({ kind: 'unavailable' });
  });
});
