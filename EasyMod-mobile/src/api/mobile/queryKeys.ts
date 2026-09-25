/**
 * Query-key factory for the mobile Home surface (ADR M-008 Phase 2 lane).
 *
 * Every key is namespaced by the current shop id, not just the endpoint name: `AuthProvider`'s
 * `doLogout` clears the whole `queryClient` on sign-out (defense line 1), and this per-shop key is
 * defense line 2 — if a later sign-in on the same device switches to a different shop before the
 * cache is otherwise touched, `['mobile','attention', shopA]` and `['mobile','attention', shopB]`
 * are simply different cache entries, never the same stale one served across a shop boundary.
 *
 * `shopId` is `string | null | undefined` because `AuthUser.shopId` (`auth-client.ts`) is
 * nullable — a signed-in user with no shop yet still has a key, just one no query is ever enabled
 * against (see `useAttention`/`useToday`).
 */
export const mobileQueryKeys = {
  attention: (shopId: string | null | undefined) => ['mobile', 'attention', shopId] as const,
  today: (shopId: string | null | undefined) => ['mobile', 'today', shopId] as const,
};
