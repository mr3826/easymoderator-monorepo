import { QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query is the only server-state store (MOBILE_ARCHITECTURE.md §3) — there is no
 * separate global store for server data, only this client plus thin local UI state (active tab,
 * in-progress form drafts) kept in component state/context.
 *
 * Phase 1 does not yet implement the ADR M-011 persisted read-only cache (that needs the
 * concrete allowlisted queries — Home attention list, order list/detail, product list, customer
 * quick-view — which land with the screens that own them); this is the in-memory client those
 * screens will configure `persistQueryClient` against later.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});
