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
 * This route remains the safe deep-link resolver. The in-app Inbox uses the separate transcript
 * route so the existing cold/warm link security state machine remains unchanged while Phase 3
 * read details are rolled out.
 */
export default function ConversationDeepLinkScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  return <DeepLinkEntityScreen kind="conversation" id={id} />;
}
