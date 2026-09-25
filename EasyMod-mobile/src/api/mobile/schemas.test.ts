import { attentionResponseSchema, todayResponseSchema } from './schemas';

/**
 * Grounded in the real backend response shapes (ADR M-003 "contract tests are the source of
 * truth") — every field/value below is taken directly from `attention.service.js` /
 * `today.service.js` and their integration test (`mobile-attention.integration.test.js`), not from
 * the master brief's summary of them.
 */
describe('attentionResponseSchema', () => {
  it('accepts a real-shaped response covering all six collectors (attention.service.js)', () => {
    const body = {
      items: [
        {
          id: 'courier_failed:order:order-1',
          tier: 1,
          urgency_score: 5.02,
          signal_type: 'COURIER_FAILED',
          reason: 'Courier dispatch failed for order MA-ORDER-1 — needs manual retry',
          entity: { type: 'order', id: 'order-1' },
        },
        {
          id: 'courier_setup_required:shop:shop-1',
          tier: 1,
          urgency_score: 20.1,
          signal_type: 'COURIER_SETUP_REQUIRED',
          reason: 'Courier setup is incomplete and order MA-ORDER-2 is ready to ship',
          entity: { type: 'order', id: 'order-2' },
        },
        {
          id: 'inbox_needs_reply:conversation:convo-1',
          tier: 2,
          urgency_score: 3.1,
          signal_type: 'INBOX_NEEDS_REPLY',
          reason: "The customer's last message has not been answered",
          entity: { type: 'conversation', id: 'convo-1' },
        },
        {
          id: 'draft_order:order:order-3',
          tier: 3,
          urgency_score: 5000,
          signal_type: 'DRAFT_ORDER',
          reason: 'Draft order MA-ORDER-3 (৳500) has been awaiting confirmation for 10h',
          entity: { type: 'order', id: 'order-3' },
        },
        {
          id: 'rto_verify:order:order-4',
          tier: 4,
          urgency_score: 2.0,
          signal_type: 'RTO_VERIFY',
          reason: 'Customer on order MA-ORDER-4 has an elevated return history — verify before shipping',
          entity: { type: 'order', id: 'order-4' },
        },
        {
          id: 'low_stock:product:product-1',
          tier: 5,
          urgency_score: 0.8,
          signal_type: 'LOW_STOCK',
          reason: 'Low Stock Widget is low on stock (2 left, threshold 10)',
          entity: { type: 'product', id: 'product-1' },
        },
      ],
      truncated_count: 0,
      conversation_scan_truncated: false,
      generated_at: '2026-09-14T00:00:00.000Z',
    };

    const parsed = attentionResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it('accepts an empty items array (idle shop)', () => {
    const parsed = attentionResponseSchema.safeParse({
      items: [],
      truncated_count: 0,
      conversation_scan_truncated: false,
      generated_at: '2026-09-14T00:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unrecognized signal_type (drift detection, ADR M-003)', () => {
    const parsed = attentionResponseSchema.safeParse({
      items: [
        {
          id: 'x',
          tier: 1,
          urgency_score: 1,
          signal_type: 'SOMETHING_NEW',
          reason: 'r',
          entity: { type: 'order', id: 'o1' },
        },
      ],
      truncated_count: 0,
      conversation_scan_truncated: false,
      generated_at: '2026-09-14T00:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unrecognized entity.type (drift detection)', () => {
    const parsed = attentionResponseSchema.safeParse({
      items: [
        {
          id: 'x',
          tier: 1,
          urgency_score: 1,
          signal_type: 'LOW_STOCK',
          reason: 'r',
          entity: { type: 'customer', id: 'c1' },
        },
      ],
      truncated_count: 0,
      conversation_scan_truncated: false,
      generated_at: '2026-09-14T00:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a tier outside 1-5', () => {
    const parsed = attentionResponseSchema.safeParse({
      items: [
        {
          id: 'x',
          tier: 6,
          urgency_score: 1,
          signal_type: 'LOW_STOCK',
          reason: 'r',
          entity: { type: 'product', id: 'p1' },
        },
      ],
      truncated_count: 0,
      conversation_scan_truncated: false,
      generated_at: '2026-09-14T00:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('todayResponseSchema', () => {
  it('accepts a real-shaped Asia/Dhaka response (today.service.js)', () => {
    const parsed = todayResponseSchema.safeParse({
      date: '2026-09-14',
      order_count: 2,
      revenue: 550,
      delivered_count: 1,
      pending_actions: {
        draft_orders: 1,
        needs_reply: 0,
        courier_problems: 1,
        rto_verify: 0,
        low_stock: 1,
      },
      timezone_used: 'Asia/Dhaka',
      timezone_note: null,
      conversation_scan_truncated: false,
      generated_at: '2026-09-14T00:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts the UTC-fallback shape with a non-null timezone_note (mobile-day-window.util.js D4)', () => {
    const parsed = todayResponseSchema.safeParse({
      date: '2026-09-14',
      order_count: 0,
      revenue: 0,
      delivered_count: 0,
      pending_actions: { draft_orders: 0, needs_reply: 0, courier_problems: 0, rto_verify: 0, low_stock: 0 },
      timezone_used: 'UTC',
      timezone_note: "Shop timezone is 'America/New_York', not 'Asia/Dhaka'; falling back to UTC day boundaries.",
      conversation_scan_truncated: false,
      generated_at: '2026-09-14T00:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a response missing a pending_actions field (drift detection)', () => {
    const parsed = todayResponseSchema.safeParse({
      date: '2026-09-14',
      order_count: 0,
      revenue: 0,
      delivered_count: 0,
      pending_actions: { draft_orders: 0, needs_reply: 0, courier_problems: 0, rto_verify: 0 },
      timezone_used: 'Asia/Dhaka',
      timezone_note: null,
      conversation_scan_truncated: false,
      generated_at: '2026-09-14T00:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
  });
});
