import { redirectSystemPath } from '../+native-intent';

// The exported hook is typed as optional (`NativeIntent['redirectSystemPath']`) because Expo
// Router's own `NativeIntent` type allows a module not to define it at all — this file's module
// always does, so every call site below can safely assert it's present.
const redirect = redirectSystemPath!;

/**
 * `redirectSystemPath` runs before Expo Router's own file-based matching (Phase 2, Lane 4). It is
 * deliberately narrow — see the doc comment on `+native-intent.ts` — so these tests pin down both
 * halves of that contract: it *does* catch the one class of link that can never resolve to a real
 * screen (an empty id on `order/`/`conversation/`), and it *never* becomes a broader allowlist
 * that swallows routes it doesn't own.
 */
describe('redirectSystemPath', () => {
  it.each(['/order', '/order/', 'order', 'order/'])('redirects an empty order id (%s) to Home', (path) => {
    expect(redirect({ path, initial: true })).toBe('/');
  });

  it.each(['/conversation', '/conversation/', 'conversation', 'conversation/'])(
    'redirects an empty conversation id (%s) to Home',
    (path) => {
      expect(redirect({ path, initial: true })).toBe('/');
    },
  );

  it('strips a query string before checking for an empty id', () => {
    expect(redirect({ path: '/order?utm_source=push', initial: true })).toBe('/');
  });

  it('strips a hash fragment before checking for an empty id', () => {
    expect(redirect({ path: '/conversation#top', initial: true })).toBe('/');
  });

  it('does not redirect a real order id — lets Expo Router match it normally', () => {
    expect(redirect({ path: '/order/order-1', initial: true })).toBeNull();
  });

  it('does not redirect a real conversation id', () => {
    expect(redirect({ path: '/conversation/convo-1', initial: true })).toBeNull();
  });

  it('never widens into an allowlist for routes this lane does not own', () => {
    expect(redirect({ path: '/inbox', initial: true })).toBeNull();
    expect(redirect({ path: '/', initial: true })).toBeNull();
    expect(redirect({ path: '/orders', initial: true })).toBeNull();
    expect(redirect({ path: '/order-summary', initial: true })).toBeNull();
  });

  it('falls through to the same safe Home redirect on an unparseable (null) path rather than throwing', () => {
    // The public `NativeIntent` type declares `path: string`, but the hook's own `try/catch`
    // exists precisely because a real inbound path is not guaranteed to match that promise (see
    // the doc comment on `+native-intent.ts`) — this cast constructs exactly the malformed input
    // the catch branch is defending against.
    expect(redirect({ path: null as unknown as string, initial: true })).toBe('/');
  });
});
