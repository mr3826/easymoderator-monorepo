import { z } from 'zod';

/**
 * Zod schemas for `GET /api/mobile/attention` and `GET /api/mobile/today` (ADR M-008, Phase 2
 * Home lane). These fields are read directly off `EasyMod-backend/src/modules/mobile/
 * attention.service.js` and `today.service.js` (the literal `id`/`tier`/`signal_type`/... keys
 * the controllers `sendSuccess(res, result)` with), NOT off the master brief's summary of them —
 * per ADR M-003 ("contract tests are the source of truth"), the backend source + its integration
 * test (`mobile-attention.integration.test.js`) are what this file is grounded in.
 *
 * `signal_type` and `entity.type` are validated as closed enums (not a bare `z.string()`): both
 * are produced by exactly one server-side module each (`attention.service.js`'s six collectors;
 * the `entity.type` literals hardcoded alongside them), not by any dynamic/user-controlled input,
 * so a value outside this set can only mean the two sides have drifted — exactly the case
 * `apiRequest` should surface as an `unknown`-kind normalized error (with a retry action) rather
 * than silently rendering a card with no icon/label mapping. If a future tier is ever added to the
 * spec's §2.1 table, this file's enums are the other half of that change.
 */

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

/** Matches `getAttentionList()`'s per-item response shape exactly (attention.service.js:381-388) —
 * note `created_at` is intentionally NOT part of the wire shape (it's stripped before the response
 * is built), so it is not modeled here either. */
export const attentionItemSchema = z.object({
  id: z.string(),
  tier: z.number().int().min(1).max(5),
  urgency_score: z.number(),
  signal_type: attentionSignalTypeSchema,
  reason: z.string(),
  entity: z.object({
    type: attentionEntityTypeSchema,
    id: z.string(),
  }),
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

/** Matches `getAttentionList()`'s top-level response shape (attention.service.js:380-397). Items
 * arrive already ranked (tier asc, urgency desc) and capped at `ATTENTION_LIST_CAP` (20) — this
 * client renders them in the order given and never re-sorts or re-slices. */
export const attentionResponseSchema = z.object({
  items: z.array(attentionItemSchema),
  truncated_count: z.number().int().min(0),
  conversation_scan_truncated: z.boolean(),
  generated_at: z.string(),
});
export type AttentionResponse = z.infer<typeof attentionResponseSchema>;

/** Matches `getToday()`'s `pending_actions` shape exactly (today.service.js:51-57). */
export const pendingActionsSchema = z.object({
  draft_orders: z.number().int().min(0),
  needs_reply: z.number().int().min(0),
  courier_problems: z.number().int().min(0),
  rto_verify: z.number().int().min(0),
  low_stock: z.number().int().min(0),
});
export type PendingActions = z.infer<typeof pendingActionsSchema>;

/** Matches `getToday()`'s top-level response shape (today.service.js:59-71). `timezone_note` is
 * `null` for the normal Asia/Dhaka case and a human-readable string only when the shop's timezone
 * fell back to UTC (`mobile-day-window.util.js`'s `getMerchantDayWindowUtc`). */
export const todayResponseSchema = z.object({
  date: z.string(),
  order_count: z.number().int().min(0),
  revenue: z.number(),
  delivered_count: z.number().int().min(0),
  pending_actions: pendingActionsSchema,
  timezone_used: z.string(),
  timezone_note: z.string().nullable(),
  conversation_scan_truncated: z.boolean(),
  generated_at: z.string(),
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;
