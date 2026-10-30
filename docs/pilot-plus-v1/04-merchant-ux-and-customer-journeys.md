# Pilot+ V1 — 04. Merchant UX and Customer Journeys (MomentumUX + BazarLens)

No invented research: scenarios derive from repo evidence (live-commerce f-commerce patterns documented
in docs/pilot-intelligence/02-product.md, mobile ADR M-008, BD language handling in stage2-rules and
customerDisplay helpers). No authorized real merchant logs exist in-repo — noted; synthetic only.

## 1. Jobs-to-be-done

| Actor | Job | Today's friction (verified) | Pilot+ answer |
|---|---|---|---|
| High-volume Messenger merchant | know which chats are real buyers | switch to Customers tab, reload Customer360 | Inbox chip + why-strip (P+01) |
| Live-stream seller | take orders while streaming | typed size/price questions answered by bot only | quick choices + resume (P+02/P+04) |
| Mobile-first merchant | act from phone between tasks | deep nested pages; buttons tiny | inbox-native actions, ≥44px targets, inline panels (no modals for frequent tasks) |
| Customer (Banglish) | ask "size koto ache? delivery charge koto?" without losing cart | answers captured as name/address (F1) | informational interruption class (P+04) |
| Customer uncertain about confirming | review safely | typed "ha/na" ambiguity | Review/Change/Cancel choices bound to summary hash |
| Customer wants a human | reach a person mid-order | cart destroyed (F2) | pause+handoff+claim+resolve (P+03) |
| Merchant correcting FAQ gap | answer recurring unanswered question once | read-only gap table | suggestion -> author -> approve -> published (P+05) |

## 2. Interaction flows (targets = current components from doc 02 §FE)

### 2.1 Inbox (UnifiedInbox / InboxThreadList / InboxThreadDetail)
1. Lead chip on thread row: small dot + strength color (reuse customerDisplay tones: "needs attention,
   never blame"); tooltip = top reason code text (i18n bn/en). Thread detail: one-line why-strip above
   composer: "Serious buyer — asked price + started order 2h ago. [View evidence] [Mark contacted]
   [Dismiss]" — buttons inline (no modal), call existing endpoints, optimistic + rollback on 409.
   "View evidence" navigates to Customer 360 (no duplication). If order already completed: strip shows
   CONVERTED state chip, no follow-up affordance. Contactability expired: strip hides contact action,
   shows WAIT_FOR_CUSTOMER_MESSAGE (server recommended_action verbatim).
2. Action queue: new tab-level segmented control "Needs review" gains ranked counts by bucket
   (1 needs-human … 6 knowledge). Item card compact: reason label + source name + age + grounded
   deadline only when fact-backed (session expiry/window close) + one primary next action (deep link)
   + existing owner indicator. Resolve-at-source removes item on next SSE event (no local optimistic
   disappearance beyond a 2s suppression to avoid flicker).
3. Handoff: take-over (existing) now shows claimed-by avatar+time; second merchant gets inline conflict
   notice (409) naming the owner; resolve dialog (existing) extended with outcome note (required,
   sanitized) — resumes AI only via resume-boundary (unchanged mechanism, visible in UI: "AI resumes
   for messages after this point").
4. Held/failed messages: existing retry surface; bucket-2 items deep-link with pre-scrolled state.

### 2.2 Structured choices (customer-side, Messenger)
Quick replies render natively above composer (platform UI — no FE work). Titles ≤20 chars in three
language sets, e.g. CHECKOUT_DECISION bn: "আবার দেখুন / পরিবর্তন / বাতিল" with "Confirm — ৳X" only
after summary hash bound (title includes price snapshot for honesty; body already shows full summary).
Fallback text (unsupported channel / policy block): numbered lines "1) আবার দেখুন 2) পরিবর্তন 3) বাতিল —
শুধু নম্বর লিখুন"; resolver accepts bare number only when a live bound proposal exists.
Free-text "yes/ha/না/ok" continues to work identically (no regression requirement relaxed).

### 2.3 FAQ Settings (FaqSettings.tsx)
Top panel "Customers keep asking" (flag-gated): suggestion cards grouped by owner_domain; PAYMENT/
DELIVERY/PRODUCT domain cards prefer a "Open settings" navigation button (authoritative-config path);
POLICY/OTHER cards show sample questions (sanitized) + answer editor (draft) + [Approve & publish] +
[Dismiss with reason]. Published card collapses to FAQ list entry (existing row, active). Never shows
AI-proposed answer text — merchant authors; system only clusters + routes.

### 2.4 Orders / Customers / Reports
Orders: no new states shown beyond fixing F3 truth (conversation orders appear confirmed, not draft).
Customers: unchanged (already authoritative). Reports: knowledge gap card gains "resolved via approved
FAQ" state per suggestion id (answerability tracking hook, §16). No new dashboard route anywhere.

## 3. Mobile requirements (Phase 9 gate)

- 375px: thread detail actions wrap to two rows; why-strip truncates w/ expand; queue cards full-width
  single column; touch targets ≥44px (composer precedent min-h-10 honored).
- Long Bangla: font-bn utility (Hind Siliguri) on all new customer-facing strings; word-break for
  question text; money via existing BDT helpers (customerDisplay.ts).
- a11y: aria-labels on chips/strips (existing patterns), @axe-core in Playwright a11y pass; focus order
  inline-actions; reduced-motion: reuse motion presets w/ existing respect.
- Network failure: queue + inbox refetch on SSE reconnect (existing backoff); offline banner precedent.

## 4. UX definition-of-done checklist (answers a merchant can always get)

WHY SEEING THIS: every chip/strip/card carries a reason label sourced from stored reason codes only.
WHAT NEEDS ATTENTION: ranked queue buckets. WHAT CAN I SAFELY DO: only server-authorized actions render
(contactability + flag + state machine). WHAT HAPPENS NEXT: each action's success text is derived from
the authoritative transition response (409 conflicts surface the real state). DID IT SUCCEED: toasts
fire on server confirmation only; committed-without-delivery states render as "sent pending" / "needs
recovery", never silent success (invariant-aligned).

## 5. The-Fool / MomentumUX recorded dissent

- Filed against spec §9.2 bucket order: "business action completed but acknowledgment failed" above
  "customer explicitly needs human" argued (customer blocked > reconciliation). Decision: follow master
  spec order; bucket-2 items age-weighted to surface quickly; dissent retained.
- Rejected ideas: per-conversation pinned notes (scope), merchant-configurable choice builder
  (flow-builder = forbidden), auto-suggested reply text on queue items (LLM surface without job).
- BazarLens correction adopted: during Live, customers type "size" / "price" fragments — bridge must NOT
  treat single-word informational fragments as checkout answers when a session is inactive; existing
  hasPurchaseIntent gate already prevents starting checkout on fragments; verified no change needed.
