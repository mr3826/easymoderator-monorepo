import { useLocalSearchParams } from 'expo-router';

import { DeepLinkEntityScreen } from '@/components/DeepLinkEntityScreen';

/**
 * Deep-link destination for a single conversation (Phase 2, Lane 4 — deep-link routing + security;
 * ADR M-007 Phase 2 correction / decision D7). Reached via
 * `easymodmerchant://conversation/<id>` (per-variant scheme, built with `Linking.createURL()` —
 * see `@/lib/deeplink`) or in-app navigation to `/conversation/<id>`; registered under the
 * signed-in-only group in `src/app/_layout.tsx`, so a signed-out deep link lands on login first,
 * never here.
 *
 * Placeholder screen: Phase 3 (Inbox) fills in the real conversation content. This lane delivers
 * the routing (this file resolves `id` from the URL) and the security/idempotency state machine in
 * `@/components/DeepLinkEntityScreen` + `@/lib/deeplink-entity`, both covered by
 * `src/app/__tests__/deeplink-routes.test.tsx`.
 */
export default function ConversationDeepLinkScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  return <DeepLinkEntityScreen kind="conversation" id={id} />;
}
