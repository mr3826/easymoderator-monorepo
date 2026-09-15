import type { NativeIntent } from 'expo-router';

/**
 * Expo Router's native-intent hook (Phase 2, Lane 4). The app's URL scheme(s) are public on the
 * device — any app can launch `easymodmerchant://<anything>` — so an inbound path is not
 * guaranteed to look like anything this app's routes actually expect. This runs before Expo
 * Router's file-based matching, giving one place to redirect an obviously-broken deep link (a
 * stale share, a malformed push payload) to Home instead of letting the router's own not-found
 * handling deal with an unvalidated external string.
 *
 * Deliberately narrow: this only catches an *empty* id on the two entity routes this lane owns
 * (`order/`, `conversation/` with nothing after the slash) — a link that can never resolve to a
 * real screen no matter what a later lane builds behind `[id]`. Everything else is returned as
 * `null`, meaning "no redirect, let Expo Router's normal matching handle it" — this must never
 * become an allowlist that swallows another lane's routes.
 */
const EMPTY_ENTITY_ID = /^\/?(order|conversation)\/?$/;

export const redirectSystemPath: NativeIntent['redirectSystemPath'] = ({ path }) => {
  try {
    const [pathname] = path.split(/[?#]/);
    if (pathname !== undefined && EMPTY_ENTITY_ID.test(pathname)) {
      return '/';
    }
  } catch {
    // An unparseable path is exactly the case this hook exists for — fall through to the same
    // safe default below rather than letting the router see something it can't classify.
    return '/';
  }
  return null;
};
