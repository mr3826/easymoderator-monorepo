import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { DeepLinkEntityKind } from './deeplink';

/**
 * Deep-linked entity resolution (Phase 2, Lane 4).
 *
 * No order/conversation *detail* endpoint is wired up for mobile yet — Phase 3 (Inbox) and Phase 4
 * (Orders) own that contract, and the Phase 2 execution plan explicitly makes Lane 3 the program's
 * first real `apiRequest` consumer, not this lane. `app/order/[id].tsx` and
 * `app/conversation/[id].tsx` are placeholder screens for now; a later lane fills in real content.
 *
 * What this lane must still deliver *now*, with real tests, is the security/idempotency state
 * machine the master brief requires: correct-shop resolves normally, a wrong-shop or
 * nonexistent/deleted id is refused identically (never a distinguishable signal), and a transient
 * failure is retryable rather than misreported as either of those. That state machine is built and
 * proven here against an injectable resolver, so a later lane only has to replace
 * `placeholderResolver` with a real `apiRequest` call — the screens, the guard, and their tests do
 * not change.
 */

export type DeepLinkResolution =
  | { kind: 'found'; id: string }
  /**
   * Deliberately a single outcome for two different real-world causes: an id that belongs to a
   * shop the caller has no access to, and an id that never existed or existed and was since
   * deleted/reassigned. The existing backend's own shop-scoped lookups already collapse "wrong
   * shop" and "doesn't exist" into one identical 404 (see `order.service.js`'s `getOrderById`,
   * which throws the same `AppError('Order not found', 404)` for both) — this type keeps that
   * invariant true on the client no matter what a future resolver's exact HTTP shape turns out to
   * be, so nobody can probe for the existence of another shop's order/conversation id by comparing
   * screen states.
   */
  | { kind: 'unavailable' }
  /** A genuine transient failure (network/timeout/server) — never implies the item is gone. */
  | { kind: 'transientError' };

export type DeepLinkEntityResolver = (kind: DeepLinkEntityKind, id: string) => Promise<DeepLinkResolution>;

/**
 * Phase 2 placeholder: every deep link the router successfully matches "resolves" to its own id.
 * The screen exists, is reachable, and shows placeholder content — there is nothing behind it yet
 * to say otherwise. Replaced wholesale by a later lane's real `apiRequest`-backed resolver.
 */
export const placeholderResolver: DeepLinkEntityResolver = async (_kind, id) => ({ kind: 'found', id });

let activeResolver: DeepLinkEntityResolver = placeholderResolver;

export function useDeepLinkEntity(kind: DeepLinkEntityKind, id: string): UseQueryResult<DeepLinkResolution> {
  return useQuery({
    // Keying on kind+id (not e.g. a raw URL) is what makes two rapid mounts of the same deep link
    // share one in-flight request — TanStack Query's own de-dupe on an identical key — on top of
    // the navigation-level guard in `deeplink.ts`.
    queryKey: ['deeplink', kind, id],
    queryFn: () => activeResolver(kind, id),
    retry: false,
    staleTime: 30_000,
  });
}

/** Test-only seam (mirrors `auth-client.ts`'s `__resetRefreshGuardForTests`): swap the resolver a
 * later lane will eventually replace wholesale, without touching the screens or their tests. */
export function __setDeepLinkResolverForTests(resolver: DeepLinkEntityResolver): void {
  activeResolver = resolver;
}

export function __resetDeepLinkResolverForTests(): void {
  activeResolver = placeholderResolver;
}
