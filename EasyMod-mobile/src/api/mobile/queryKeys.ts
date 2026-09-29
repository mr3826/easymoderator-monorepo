/**
 * Query keys for mobile server data. The current shop id is part of every key so a shop switch
 * cannot reuse another shop's Home response while the new request is in flight.
 */
export const mobileQueryKeys = {
  attention: (shopId: string | null | undefined) => ['mobile', 'attention', shopId] as const,
  today: (shopId: string | null | undefined) => ['mobile', 'today', shopId] as const,
  inbox: (shopId: string | null | undefined, status = '') =>
    ['mobile', 'inbox', shopId, status] as const,
  conversation: (shopId: string | null | undefined, conversationId: string) =>
    ['mobile', 'conversation', shopId, conversationId] as const,
  conversationMessages: (shopId: string | null | undefined, conversationId: string, page = 1) =>
    ['mobile', 'conversation-messages', shopId, conversationId, page] as const,
};

/**
 * ADR M-011: how long a Home read may be shown as clearly-labelled stale data (offline, or after a
 * failed refresh). Home queries keep their cache entry this long so that stale view survives, and
 * it is the persisted cache's max age.
 */
export const HOME_OFFLINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
