import { router } from 'expo-router';
import * as Linking from 'expo-linking';

import { createEntityDeepLink, deepLinkPathFor, openDeepLink, __resetDeepLinkDedupeForTests } from './deeplink';

// `expo-linking` is mocked for this file only, so `createEntityDeepLink`'s assertions can check
// *how* it delegates to `Linking.createURL()` without depending on (or hardcoding) whatever
// scheme string Expo's config resolution happens to produce under Jest — the real per-variant
// scheme (`easymodmerchantdev` / `easymodmerchantpreview` / `easymodmerchant`, `app.config.ts`)
// is only ever read by the real `Linking.createURL()` at runtime, never written here.
jest.mock('expo-linking', () => ({
  createURL: jest.fn((path: string) => `mock-scheme://${path}`),
}));

beforeEach(() => {
  __resetDeepLinkDedupeForTests();
  jest.clearAllMocks();
});

describe('deepLinkPathFor', () => {
  it('builds the in-app router path for an order', () => {
    expect(deepLinkPathFor('order', 'abc123')).toBe('/order/abc123');
  });

  it('builds the in-app router path for a conversation', () => {
    expect(deepLinkPathFor('conversation', 'c-1')).toBe('/conversation/c-1');
  });

  it('percent-encodes an id that contains reserved characters', () => {
    expect(deepLinkPathFor('order', 'a/b?c')).toBe('/order/a%2Fb%3Fc');
  });
});

describe('createEntityDeepLink', () => {
  it('delegates to Linking.createURL with the in-app path (no leading slash) — never a hardcoded scheme', () => {
    createEntityDeepLink('order', 'abc123');

    expect(Linking.createURL).toHaveBeenCalledWith('order/abc123');
  });

  it('returns whatever Linking.createURL produces, unmodified', () => {
    expect(createEntityDeepLink('conversation', 'c-1')).toBe('mock-scheme://conversation/c-1');
  });
});

describe('openDeepLink (duplicate-tap idempotency)', () => {
  it('navigates on the first call', () => {
    const pushSpy = jest.spyOn(router, 'push').mockImplementation(() => {});

    const opened = openDeepLink('order', 'order-1', 1_000);

    expect(opened).toBe(true);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith('/order/order-1');
  });

  it('suppresses an identical call (duplicate notification redelivery / double tap) arriving milliseconds later', () => {
    const pushSpy = jest.spyOn(router, 'push').mockImplementation(() => {});

    expect(openDeepLink('order', 'order-1', 1_000)).toBe(true);
    expect(openDeepLink('order', 'order-1', 1_200)).toBe(false);

    // Exactly one navigation, no duplicate stack entry — the second call is a pure no-op.
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('does not suppress a different entity opened immediately after', () => {
    const pushSpy = jest.spyOn(router, 'push').mockImplementation(() => {});

    expect(openDeepLink('order', 'order-1', 1_000)).toBe(true);
    expect(openDeepLink('conversation', 'order-1', 1_050)).toBe(true);

    expect(pushSpy).toHaveBeenCalledTimes(2);
  });

  it('does not suppress a deliberate re-open of the same entity once the duplicate-tap window has elapsed', () => {
    const pushSpy = jest.spyOn(router, 'push').mockImplementation(() => {});

    expect(openDeepLink('order', 'order-1', 1_000)).toBe(true);
    expect(openDeepLink('order', 'order-1', 1_000 + 1_500)).toBe(true);

    expect(pushSpy).toHaveBeenCalledTimes(2);
  });

  it('treats a different id for the same kind as a distinct navigation, not a duplicate', () => {
    const pushSpy = jest.spyOn(router, 'push').mockImplementation(() => {});

    expect(openDeepLink('order', 'order-1', 1_000)).toBe(true);
    expect(openDeepLink('order', 'order-2', 1_050)).toBe(true);

    expect(pushSpy).toHaveBeenCalledTimes(2);
  });
});
