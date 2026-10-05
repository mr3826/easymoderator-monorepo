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
  orders: (shopId: string | null | undefined, status = '') =>
    ['mobile', 'orders', shopId, status] as const,
  order: (shopId: string | null | undefined, orderId: string) =>
    ['mobile', 'order', shopId, orderId] as const,
  orderRisk: (shopId: string | null | undefined, orderId: string) =>
    ['mobile', 'order-risk', shopId, orderId] as const,
  customer: (shopId: string | null | undefined, customerId: string) =>
    ['mobile', 'customer', shopId, customerId] as const,
  problemParcels: (shopId: string | null | undefined, filter = '') =>
    ['mobile', 'problem-parcels', shopId, filter] as const,
  deliveryTracking: (shopId: string | null | undefined, orderId: string) =>
    ['mobile', 'delivery-tracking', shopId, orderId] as const,
  products: (shopId: string | null | undefined, filter = '', search = '') =>
    ['mobile', 'products', shopId, filter, search] as const,
};

/**
 * ADR M-011: how long a Home read may be shown as clearly-labelled stale data (offline, or after a
 * failed refresh). Home queries keep their cache entry this long so that stale view survives, and
 * it is the persisted cache's max age.
 */
export const HOME_OFFLINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
