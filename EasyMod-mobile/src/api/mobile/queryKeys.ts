/**
 * Query keys for mobile server data. The current shop id is part of every key so a shop switch
 * cannot reuse another shop's Home response while the new request is in flight.
 */
export const mobileQueryKeys = {
  attention: (shopId: string | null | undefined) => ['mobile', 'attention', shopId] as const,
  today: (shopId: string | null | undefined) => ['mobile', 'today', shopId] as const,
};
