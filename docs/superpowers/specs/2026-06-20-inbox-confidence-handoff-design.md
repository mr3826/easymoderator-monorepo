# Deliver-aware AI suggestions + real low-confidence human handoff

**Date:** 2026-06-20
**Status:** Approved (brainstorming) → implementation
**Branch:** `fix/inbox-confidence-handoff`

## Problem

1. **Redundant suggestion panel.** In the conversation page, the "AI Suggestion —
   Use this / Edit / Ignore" panel renders for *any* recent `sender:'ai'` message.
   In auto-reply mode the AI has *already delivered* that reply to the customer, so
   the panel is redundant and confusing.
2. **Low-confidence handoff does not actually exist.** The worker auto-sends every
   AI reply regardless of confidence. `auto-approve.service.js` (`shouldAutoApprove`)
   was written for this but is **never imported** — dead code. The only thing that
   escalates a conversation to a human today is *sentiment* (angry customer). A
   low-confidence reply is sent to the customer anyway.

## Approved decisions

- **Low-confidence customer experience:** *Hold + holding message.* Do not send the
  uncertain reply; hand the conversation to a human (`hitl=true`) and send the
  customer one short acknowledgement so they are not left in silence.
- **Threshold source of truth:** per-shop `confidence_threshold` (0–100, default 75).
  Align the frontend, which currently hardcodes `0.65`.
- **Suggest-only / DRAFT mode is left exactly as-is** (no holding message added) —
  it is a deliberate "I handle everything" mode where the owner is watching.

## Core principle

The suggestion panel appears **iff the AI reply was *held* (not delivered to the
customer).** Everything else follows from this single signal.

| Situation | Delivered? | Panel |
|---|---|---|
| Auto mode, confidence ≥ threshold | sent | hidden |
| Auto mode, confidence < threshold | held → handoff | shown (the held draft) |
| Suggest-only / DRAFT mode | held | shown |
| Plain human takeover, no fresh AI draft | n/a | hidden |

## Backend changes (`EasyMod-backend`)

All in the live pipeline: `src/jobs/message-worker.js`.

### 1. Confidence gate (new)
After `confidence` is computed and before delivery. Applies **only**:
- in auto mode (`automation_mode === 'AI_ACTIVE'`, i.e. not a draft/suggest/manual
  deny), and
- to conversational replies — deterministic order-flow turns return confidence
  `1.0` and are never held.

Threshold read from per-shop `confidence_threshold` (default 75), normalized to a
0–1 fraction (`threshold/100`) to compare against the model confidence (0–1 scale,
matching the `messages.ai_confidence DECIMAL(3,2)` column and the FE).

When `confidence < threshold`:
1. Stamp the stored AI draft: `metadata.delivered = false`,
   `metadata.held_reason = 'low_confidence'`. Do **not** deliver it.
2. `conversation.hitl = true`; emit `hitl_changed` SSE.
3. Send **one** holding message to the customer via the existing
   `escalation-auto-reply.service` (shop-configurable template, delivered on the
   same channel the inbound arrived on). The HITL guard short-circuits all later
   messages, so it fires exactly once.
4. Return `{ sent: false, reason: 'low_confidence_handoff', handoff: true }`.

`confidence == null` or `0` (AI pipeline failure path) counts as low → handoff. This
is safer than auto-sending an ungrounded fallback; called out for visibility.

### 2. Per-message delivery flag (new signal)
The AI message is currently stored *before* the send decision and the `new_message`
SSE is emitted immediately. Reorder so that **after** the policy/confidence decision
the worker stamps the AI message's `metadata.delivered` (true/false) and
`metadata.held_reason` (`'low_confidence' | 'draft_mode' | null`), then emits the SSE.
This is the single signal the FE keys off, reliable across auto, draft,
business-hours, rate-limit, and handoff outcomes.

- Allowed + sent → `delivered: true`.
- Policy deny `DRAFT_MODE`/`SUGGEST_ONLY`/etc. → `delivered: false`,
  `held_reason: 'draft_mode'`.
- Low-confidence handoff → `delivered: false`, `held_reason: 'low_confidence'`.

### 3. `escalateToHuman()` helper (refactor)
Extract the escalation sequence (set `hitl`, emit `hitl_changed`, store + deliver the
holding message) shared by the existing sentiment path and the new low-confidence
path. No behavior change to the sentiment path.

### 4. Remove dead code
Delete `src/modules/ai/auto-approve.service.js` (folding its threshold read into the
gate) — or repoint it; it is currently unused. No other module imports it.

## Frontend changes (`EasyMod-frontend`)

`src/app/components/inbox/InboxThreadDetail.tsx`:
- `hasAiSuggestion` shows the panel **iff** `lastAiMsg.metadata?.delivered === false`
  (held) + not dismissed + customer awaiting reply. **Drop the `!hitl` guard** — a
  low-confidence handoff sets `hitl=true` and we *want* the held draft visible to the
  human who just took over.
- The amber "AI wasn't sure" note keys off `metadata.held_reason === 'low_confidence'`
  instead of the hardcoded `0.65`. Draft-mode holds show the panel with no warning.

`src/api/types/conversation.ts`: add optional `delivered?: boolean` and
`held_reason?: 'low_confidence' | 'draft_mode'` to the message `metadata` type.

## No migration required
Uses the existing `messages.metadata` JSON column and `conversations.hitl`. No DDL,
so the deploy's `npm run migrate` step is a no-op for this change.

## Testing

**Backend (Jest, TDD):**
- low-confidence auto → not delivered, `hitl=true`, holding message sent once, draft
  stamped `held_reason='low_confidence'`.
- high-confidence auto → delivered, no `hitl`, no holding message.
- draft/suggest-only mode → held, `held_reason='draft_mode'`, **no** `hitl`, **no**
  holding message.
- threshold boundary (74 vs 75).
- order-flow turn (confidence 1.0) → never held.

**Frontend (Vitest):**
- panel hidden when `delivered === true`.
- panel shown when `delivered === false`, including when `hitl === true`.
- "unsure" note only when `held_reason === 'low_confidence'`.

## Out of scope (YAGNI)
- No new settings UI (the `confidence_threshold` field already exists).
- No change to per-channel `confidence_threshold_send/suggest` columns.
- No reviving the orphaned HTTP `ai-chatbot.controller` confidence path.

## Deploy
PR → `origin/main` → `ci-cd.yml` builds + deploys to droplet, health-gated. Verify
`/health` and the inbox after deploy.
