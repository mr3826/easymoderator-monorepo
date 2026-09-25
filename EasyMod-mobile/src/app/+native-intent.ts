import type { NativeIntent } from 'expo-router';

import { capturePendingDeepLink, parseEntityDeepLink } from '@/lib/pending-deeplink';

/**
 * Expo Router's native-intent hook, called with the cold-launch URL (`initial: true`) and every
 * later inbound URL. The app's URL scheme(s) are public on the device — any app can launch
 * `easymodmerchant://<anything>` — so an inbound path is untrusted input.
 *
 * - An empty id on the entity routes (`order/`, `conversation/`) can never resolve: go Home.
 * - A real entity link is parked in `@/lib/pending-deeplink` and the app goes Home; the root
 *   navigator opens it once auth has resolved to signed-in (immediately when already signed in,
 *   after the cold-start refresh, or after login). Matching it directly raced the auth bootstrap
 *   and fell back to Home on cold launch (audit P1-5).
 * - Everything else returns `null` (no redirect) so Expo Router's normal matching handles it —
 *   this must never become an allowlist that swallows other routes.
 */
const EMPTY_ENTITY_ID = /^\/?(order|conversation)\/?$/;

export const redirectSystemPath: NativeIntent['redirectSystemPath'] = ({ path }) => {
  try {
    const [pathname] = path.split(/[?#]/);
    if (pathname !== undefined && EMPTY_ENTITY_ID.test(pathname)) {
      return '/';
    }
    const entity = parseEntityDeepLink(path);
    if (entity) {
      capturePendingDeepLink(entity);
      return '/';
    }
  } catch {
    // An unparseable path is exactly the case this hook exists for — fall through to the same
    // safe default below rather than letting the router see something it can't classify.
    return '/';
  }
  return null;
};
