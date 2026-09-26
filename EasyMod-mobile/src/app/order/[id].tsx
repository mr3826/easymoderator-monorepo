import { useLocalSearchParams } from 'expo-router';

import { DeepLinkEntityScreen } from '@/components/DeepLinkEntityScreen';

/**
 * Deep-link destination for a single order (Phase 2, Lane 4 — deep-link routing + security; ADR
 * M-007 Phase 2 correction / decision D7). Reached via `easymodmerchant://order/<id>` (per-variant
 * scheme, built with `Linking.createURL()` — see `@/lib/deeplink`) or in-app navigation to
 * `/order/<id>`; registered under the signed-in-only group in `src/app/_layout.tsx`, so a
 * signed-out deep link lands on login first, never here.
 *
 * Placeholder screen: Phase 4 (Orders) fills in the real order detail content. This lane delivers
 * the routing (this file resolves `id` from the URL) and the security/idempotency state machine in
 * `@/components/DeepLinkEntityScreen` + `@/lib/deeplink-entity`, both covered by
 * `src/app/__tests__/deeplink-routes.test.tsx`.
 */
export default function OrderDeepLinkScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  // `id` is always a single segment for a `[id].tsx` route, but never trust that at runtime — an
  // unexpected array (or missing param) is handled by `DeepLinkEntityScreen`'s own safe default.
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  return <DeepLinkEntityScreen kind="order" id={id} />;
}
