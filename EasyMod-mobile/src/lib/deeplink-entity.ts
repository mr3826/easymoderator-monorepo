import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import { apiRequest, type ApiClientDeps } from '@/api/client';
import type { DeepLinkEntityKind } from './deeplink';

/**
 * Deep-linked entity resolution (Wave 2.5, Lane C).
 *
 * The existing order and conversation detail APIs already enforce `shop_id` on the server. This
 * module deliberately resolves through those APIs rather than introducing a second mobile-only
 * entity endpoint or trusting a shop id supplied by navigation.
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

const entityIdSchema = z.object({ id: z.string() });
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Test seam retained for callers that need to assert the unavailable state without making a
 * request. It is not the production resolver.
 */
export const placeholderResolver: DeepLinkEntityResolver = async () => ({ kind: 'unavailable' });

function entityPath(kind: DeepLinkEntityKind, id: string): string {
  const resource = kind === 'order' ? 'order' : 'conversation';
  return `/api/${resource}/${encodeURIComponent(id)}`;
}

/**
 * Resolves an entity through the existing shop-scoped detail API. The optional dependency seam is
 * test-only; production uses the shared authenticated API client and bearer transport.
 */
export async function apiBackedResolver(
  kind: DeepLinkEntityKind,
  id: string,
  deps: ApiClientDeps = {},
): Promise<DeepLinkResolution> {
  // Do not let a missing or malformed route parameter fall through to a collection endpoint or a
  // database cast error. Both are safe, indistinguishable unavailable outcomes to the client.
  if ((kind !== 'order' && kind !== 'conversation') || !UUID_PATTERN.test(id)) {
    return { kind: 'unavailable' };
  }

  const result = await apiRequest<z.infer<typeof entityIdSchema>>(entityPath(kind, id), entityIdSchema, {}, deps);
  if (!result.ok) {
    return result.error.retryable ? { kind: 'transientError' } : { kind: 'unavailable' };
  }

  // A detail response must identify the same target that was requested. Treat an unexpected
  // response shape or mismatched id as unavailable rather than rendering arbitrary server data.
  if (result.data.id !== id) return { kind: 'unavailable' };
  return { kind: 'found', id: result.data.id };
}

let activeResolver: DeepLinkEntityResolver = apiBackedResolver;

export function useDeepLinkEntity(kind: DeepLinkEntityKind, id: string): UseQueryResult<DeepLinkResolution> {
  return useQuery({
    // Keying on kind+id (not e.g. a raw URL) is what makes two rapid mounts of the same deep link
    // share one in-flight request — TanStack Query's own de-dupe on an identical key — on top of
    // the navigation-level guard in `deeplink.ts`.
    queryKey: ['deeplink', kind, id],
    queryFn: () => activeResolver(kind, id),
    retry: false,
    // Deep-link targets commonly originate from an older notification. Always ask the server when
    // the destination mounts so deletion/status changes win over a cached existence check.
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/** Test-only seam (mirrors `auth-client.ts`'s `__resetRefreshGuardForTests`): swap the resolver a
 * test can replace without touching the screens. */
export function __setDeepLinkResolverForTests(resolver: DeepLinkEntityResolver): void {
  activeResolver = resolver;
}

export function __resetDeepLinkResolverForTests(): void {
  activeResolver = apiBackedResolver;
}
