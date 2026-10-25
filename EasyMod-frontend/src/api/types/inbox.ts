/**
 * P+03 Merchant Action Queue — GET /api/inbox/actions read model.
 * Backend: EasyMod-backend/src/modules/inbox/{inbox.routes.js,inbox-actions.service.js,action-reasons.js}
 *
 * The queue is recomputed per request from authoritative facts; there is no
 * task table, so item/status values mirror the source row's state.
 */

import type { OpportunityStrength } from './customer-intelligence';

/** Buckets encode OPERATIONAL RISK order (1 = highest), never arbitrary urgency. */
export type InboxActionBucketNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type InboxActionBucketName =
  | 'NEEDS_HUMAN'
  | 'COMMITTED_WITHOUT_ACK'
  | 'CUSTOMER_BLOCKED'
  | 'DRAFT_RECOVERY'
  | 'PURCHASE_OPPORTUNITY'
  | 'KNOWLEDGE_GAP';

/** Display map: stable bucket name → wire number (keep in sync with backend action-reasons.js). */
export const INBOX_ACTION_BUCKET: Record<InboxActionBucketName, InboxActionBucketNumber> = {
  NEEDS_HUMAN: 1,
  COMMITTED_WITHOUT_ACK: 2,
  CUSTOMER_BLOCKED: 3,
  DRAFT_RECOVERY: 4,
  PURCHASE_OPPORTUNITY: 5,
  KNOWLEDGE_GAP: 6,
};

/** Inverse display map used to group/order the queue. */
export const INBOX_ACTION_BUCKET_NAME: Record<InboxActionBucketNumber, InboxActionBucketName> = {
  1: 'NEEDS_HUMAN',
  2: 'COMMITTED_WITHOUT_ACK',
  3: 'CUSTOMER_BLOCKED',
  4: 'DRAFT_RECOVERY',
  5: 'PURCHASE_OPPORTUNITY',
  6: 'KNOWLEDGE_GAP',
};

/** Render order: highest operational risk first. */
export const INBOX_ACTION_BUCKET_ORDER: InboxActionBucketNumber[] = [1, 2, 3, 4, 5, 6];

/** Every reason_code the backend can emit (action-reasons.js ACTION_REASONS). */
export type InboxActionReasonCode =
  | 'HITL_REQUIRED'
  | 'HANDOFF_SUSPENDED_CHECKOUT'
  | 'SEND_FAILED_AFTER_MUTATION'
  | 'SEND_NEEDS_RECONCILIATION'
  | 'CHECKOUT_WAITING_CUSTOMER'
  | 'DRAFT_AWAITING_REVIEW'
  | 'HELD_MESSAGE'
  | 'OPPORTUNITY_OPEN'
  | 'KNOWLEDGE_GAP_OPEN';

export type InboxActionNextType =
  | 'open_conversation'
  | 'review_draft'
  | 'reconcile_send'
  | 'resume_checkout'
  | 'review_opportunity'
  | 'review_knowledge_gap';

/** Discriminated union: each action carries only its own grounding detail. */
export type InboxActionNextAction =
  | { type: 'open_conversation' | 'review_draft' | 'reconcile_send' }
  | { type: 'resume_checkout'; step?: string | null }
  | { type: 'review_opportunity'; strength?: OpportunityStrength | null }
  | { type: 'review_knowledge_gap'; owner_domain?: string | null };

export type InboxActionSourceType =
  | 'conversation'
  | 'message'
  | 'delivery_outbox'
  | 'order_session'
  | 'customer_opportunity'
  | 'knowledge_gap_suggestion';

export interface InboxActionItem {
  bucket: InboxActionBucketNumber;
  /** Stable identity of the source fact ('hitl:<id>', 'send:<id>', …) — React key. */
  item_key: string;
  reason_code: InboxActionReasonCode;
  source: { type: InboxActionSourceType; id: string };
  conversation_id: string | null;
  customer_id: string | null;
  /** Copied from the authoritative source row (awaiting_human, HELD, OPEN, …). */
  status: string;
  /** Assignee id when a human owns the item; the UI shows state, never names. */
  owner: string | null;
  next_action: InboxActionNextAction;
  /** Only non-null when a stored fact grounds a real deadline (checkout expiry). */
  grounded_deadline?: string | null;
  /** When the underlying fact became actionable (ISO string). */
  since: string | null;
}

export interface InboxActionsResponse {
  items: InboxActionItem[];
  generated_at: string;
  /** True when one or more sources failed; the queue never fabricates work. */
  partial: boolean;
}
