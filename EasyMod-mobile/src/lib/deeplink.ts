import { router, type Href } from 'expo-router';
import * as Linking from 'expo-linking';

/**
 * Deep-link URL building + open-once navigation (Phase 2, Lane 4, ADR M-007 Phase 2 correction /
 * decision D7).
 *
 * D7 corrects ADR M-007's original assumption of a literal `easymod://` scheme: the real scheme is
 * per build-variant (`easymodmerchantdev` / `easymodmerchantpreview` / `easymodmerchant`, see
 * `app.config.ts`'s `APP_SCHEMES`). This module never hardcodes any of those strings — every URL
 * this app constructs goes through `Linking.createURL()`, which reads whichever scheme the running
 * binary was actually built with, so the value is always correct for the variant and never drifts
 * out of sync with `app.config.ts` (owned by Lane 0, not touched here).
 */

export type DeepLinkEntityKind = 'order' | 'conversation';

/** The in-app router path for a deep-linkable entity, e.g. `/order/abc123`. */
export function deepLinkPathFor(kind: DeepLinkEntityKind, id: string): `/${string}` {
  return `/${kind}/${encodeURIComponent(id)}`;
}

/**
 * The full external URL for a deep-linkable entity, in whichever scheme this build was configured
 * with. Used both for any future in-app "share this order" action and — until Phase 2b's real push
 * notifications exist — to build the synthetic URLs this lane's tests drive through the router,
 * standing in for a future push payload's `data.entity`/`data.id` (ADR M-007).
 */
export function createEntityDeepLink(kind: DeepLinkEntityKind, id: string): string {
  return Linking.createURL(deepLinkPathFor(kind, id).slice(1));
}

// A duplicate notification delivery (the OS redelivering the same tap) or a doubled tap event
// arrives within milliseconds of the first, never seconds later — this window is generous enough
// to absorb any realistic double-fire while never suppressing a deliberate, later re-open of the
// same item (master brief: "duplicate tap remains idempotent").
const DUPLICATE_TAP_WINDOW_MS = 1500;

let lastOpened: { path: string; at: number } | null = null;

/**
 * Navigates to a deep-linked entity screen, suppressing an identical call that arrives again
 * within `DUPLICATE_TAP_WINDOW_MS` of the last one — the guard a duplicate notification delivery
 * or a double-tap needs so it never produces a second stack entry, a second network request, or
 * any visible glitch. This is the single place a future notification-tap handler (Phase 2b) should
 * call to open a deep link; the route screens themselves stay simple and unaware of de-duping.
 *
 * `now` is an injectable clock (defaults to `Date.now()`) so tests can drive the window
 * deterministically instead of depending on fake-timer semantics.
 *
 * @returns `true` if this call actually navigated, `false` if it was suppressed as a duplicate.
 */
export function openDeepLink(kind: DeepLinkEntityKind, id: string, now: number = Date.now()): boolean {
  const path = deepLinkPathFor(kind, id);
  if (lastOpened && lastOpened.path === path && now - lastOpened.at < DUPLICATE_TAP_WINDOW_MS) {
    return false;
  }
  lastOpened = { path, at: now };
  router.push(path as Href);
  return true;
}

/** Test-only escape hatch: clears the de-dupe guard between tests (mirrors `auth-client.ts`'s
 * `__resetRefreshGuardForTests`). */
export function __resetDeepLinkDedupeForTests(): void {
  lastOpened = null;
}
