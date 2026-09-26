import { z } from 'zod';

/** Wire contracts for the flag-gated mobile Home endpoints (ADR M-008). */
export const attentionEntityTypeSchema = z.enum(['order', 'conversation', 'product']);
export type AttentionEntityType = z.infer<typeof attentionEntityTypeSchema>;

export const attentionSignalTypeSchema = z.enum([
  'COURIER_FAILED',
  'COURIER_INDETERMINATE',
  'COURIER_SETUP_REQUIRED',
  'INBOX_NEEDS_REPLY',
  'DRAFT_ORDER',
  'RTO_VERIFY',
  'LOW_STOCK',
]);
export type AttentionSignalType = z.infer<typeof attentionSignalTypeSchema>;

export const attentionItemSchema = z.object({
  id: z.string(),
  tier: z.number().int().min(1).max(5),
  urgency_score: z.number(),
  signal_type: attentionSignalTypeSchema,
  reason_code: z.string().min(1).optional(),
  reason: z.string(),
  entity: z.object({
    type: attentionEntityTypeSchema,
    id: z.string(),
  }),
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

export const attentionResponseSchema = z.object({
  items: z.array(attentionItemSchema),
  truncated_count: z.number().int().min(0),
  conversation_scan_truncated: z.boolean(),
  generated_at: z.string(),
});
export type AttentionResponse = z.infer<typeof attentionResponseSchema>;

export const pendingActionsSchema = z.object({
  draft_orders: z.number().int().min(0),
  needs_reply: z.number().int().min(0),
  courier_problems: z.number().int().min(0),
  rto_verify: z.number().int().min(0),
  low_stock: z.number().int().min(0),
});
export type PendingActions = z.infer<typeof pendingActionsSchema>;

export const todayResponseSchema = z.object({
  date: z.string(),
  order_count: z.number().int().min(0),
  revenue: z.number(),
  expected_order_value: z.number().optional(),
  revenue_basis: z.literal('expected_order_value').optional(),
  delivered_count: z.number().int().min(0),
  pending_actions: pendingActionsSchema,
  timezone_used: z.enum(['Asia/Dhaka', 'UTC']),
  timezone_note: z.string().nullable(),
  conversation_scan_truncated: z.boolean(),
  generated_at: z.string(),
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;
