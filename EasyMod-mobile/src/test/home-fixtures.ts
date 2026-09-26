import type { AttentionItem, AttentionResponse, TodayResponse } from '@/api/mobile/schemas';

/** Real-shaped Home fixtures, including every supported attention signal. */
export const TODAY_ACTIVE: TodayResponse = {
  date: '2026-09-16',
  order_count: 3,
  revenue: 1250,
  delivered_count: 1,
  pending_actions: {
    draft_orders: 1,
    needs_reply: 1,
    courier_problems: 2,
    rto_verify: 1,
    low_stock: 1,
  },
  timezone_used: 'Asia/Dhaka',
  timezone_note: null,
  conversation_scan_truncated: false,
  generated_at: '2026-09-16T00:00:00.000Z',
};

export const TODAY_IDLE: TodayResponse = {
  ...TODAY_ACTIVE,
  order_count: 0,
  revenue: 0,
  delivered_count: 0,
  pending_actions: {
    draft_orders: 0,
    needs_reply: 0,
    courier_problems: 0,
    rto_verify: 0,
    low_stock: 0,
  },
};

/**
 * The product spec has six ranking rows: tier 1 is split into failed/indeterminate courier and
 * setup-blocked shipment, followed by tiers 2 through 5. The API additionally supports both
 * tier-1 courier signal variants, so this fixture contains seven items in total.
 */
export const HOME_ATTENTION_ITEMS: readonly AttentionItem[] = [
  {
    id: 'courier_failed:order:order-1',
    tier: 1,
    urgency_score: 5.02,
    signal_type: 'COURIER_FAILED',
    reason: 'Courier dispatch failed for order MA-1 — needs manual retry',
    entity: { type: 'order', id: 'order-1' },
  },
  {
    // The backend uses the courier_failed id prefix for both FAILED and INDETERMINATE rows.
    id: 'courier_failed:order:order-2',
    tier: 1,
    urgency_score: 8.4,
    signal_type: 'COURIER_INDETERMINATE',
    reason: 'Courier dispatch status is unresolved for order MA-2 — verify with the provider',
    entity: { type: 'order', id: 'order-2' },
  },
  {
    id: 'courier_setup_required:shop:shop-1',
    tier: 1,
    urgency_score: 20.1,
    signal_type: 'COURIER_SETUP_REQUIRED',
    reason: 'Courier setup is incomplete and order MA-3 is ready to ship',
    entity: { type: 'order', id: 'order-3' },
  },
  {
    id: 'inbox_needs_reply:conversation:conversation-1',
    tier: 2,
    urgency_score: 3.1,
    signal_type: 'INBOX_NEEDS_REPLY',
    reason: "The customer's last message has not been answered",
    entity: { type: 'conversation', id: 'conversation-1' },
  },
  {
    id: 'draft_order:order:order-4',
    tier: 3,
    urgency_score: 5000,
    signal_type: 'DRAFT_ORDER',
    reason: 'Draft order MA-4 (৳500) has been awaiting confirmation for 10h',
    entity: { type: 'order', id: 'order-4' },
  },
  {
    id: 'rto_verify:order:order-5',
    tier: 4,
    urgency_score: 2,
    signal_type: 'RTO_VERIFY',
    reason: 'Customer on order MA-5 has an elevated return history — verify before shipping',
    entity: { type: 'order', id: 'order-5' },
  },
  {
    id: 'low_stock:product:product-1',
    tier: 5,
    urgency_score: 0.8,
    signal_type: 'LOW_STOCK',
    reason: 'Widget is low on stock (2 left, threshold 10)',
    entity: { type: 'product', id: 'product-1' },
  },
];

export function attentionResponse(
  items: readonly AttentionItem[] = HOME_ATTENTION_ITEMS,
  overrides: Partial<Omit<AttentionResponse, 'items'>> = {},
): AttentionResponse {
  return {
    items: [...items],
    truncated_count: 0,
    conversation_scan_truncated: false,
    generated_at: '2026-09-16T00:00:00.000Z',
    ...overrides,
  };
}
