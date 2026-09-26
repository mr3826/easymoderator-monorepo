import {
  PENDING_DEEP_LINK_TTL_MS,
  __resetPendingDeepLinkForTests,
  capturePendingDeepLink,
  getPendingDeepLinkVersion,
  parseEntityDeepLink,
  subscribePendingDeepLink,
  takePendingDeepLink,
} from './pending-deeplink';

beforeEach(() => __resetPendingDeepLinkForTests());

describe('parseEntityDeepLink', () => {
  it.each([
    ['/order/abc', { kind: 'order', id: 'abc' }],
    ['order/abc/', { kind: 'order', id: 'abc' }],
    ['/conversation/c-1?utm=push#top', { kind: 'conversation', id: 'c-1' }],
    ['easymodmerchant://order/abc', { kind: 'order', id: 'abc' }],
    ['easymodmerchantpreview://conversation/a%20b', { kind: 'conversation', id: 'a b' }],
  ])('recognises %s', (path, expected) => {
    expect(parseEntityDeepLink(path)).toEqual(expected);
  });

  it.each(['/', '/order', '/order/', '/orders/abc', '/order/abc/timeline', '/inbox', 'order/%E0%A4%A'])(
    'ignores %s',
    (path) => {
      expect(parseEntityDeepLink(path)).toBeNull();
    },
  );
});

describe('pending deep link slot', () => {
  it('hands a parked link to exactly one taker', () => {
    capturePendingDeepLink({ kind: 'order', id: 'o-1' }, 1_000);

    expect(takePendingDeepLink(2_000)).toEqual({ kind: 'order', id: 'o-1' });
    expect(takePendingDeepLink(2_000)).toBeNull();
  });

  it('keeps only the most recent link', () => {
    capturePendingDeepLink({ kind: 'order', id: 'o-1' }, 1_000);
    capturePendingDeepLink({ kind: 'conversation', id: 'c-2' }, 1_500);

    expect(takePendingDeepLink(2_000)).toEqual({ kind: 'conversation', id: 'c-2' });
  });

  it('drops a link parked longer than the TTL instead of replaying it', () => {
    capturePendingDeepLink({ kind: 'order', id: 'o-1' }, 0);

    expect(takePendingDeepLink(PENDING_DEEP_LINK_TTL_MS + 1)).toBeNull();
  });

  it('notifies subscribers and bumps the version when a link is parked', () => {
    const listener = jest.fn();
    const unsubscribe = subscribePendingDeepLink(listener);
    const before = getPendingDeepLinkVersion();

    capturePendingDeepLink({ kind: 'order', id: 'o-1' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPendingDeepLinkVersion()).toBe(before + 1);
    unsubscribe();
  });
});
