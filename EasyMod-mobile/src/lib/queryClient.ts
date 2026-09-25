import { QueryClient } from '@tanstack/react-query';

import { HOME_OFFLINE_MAX_AGE_MS } from '@/api/mobile/queryKeys';

/**
 * TanStack Query is the only server-state store (MOBILE_ARCHITECTURE.md §3) — there is no
 * separate global store for server data, only this client plus thin local UI state (active tab,
 * in-progress form drafts) kept in component state/context.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

// ADR M-011: Home reads stay available (shop-keyed, never across shops) for the offline/stale view
// for as long as they may be shown. Configured here rather than per hook so this app client owns
// the retention policy; test clients keep their own short-lived defaults.
queryClient.setQueryDefaults(['mobile'], { gcTime: HOME_OFFLINE_MAX_AGE_MS });
