# 03 — Merchant Workflow & UX Specification (Increment 2)

**Gate owner:** MomentumUX (decision), FieldFounder + BazarLens (challenge), CTO (reuse discipline).

## The five questions → one surface

Opening a conversation must answer: **Who? What happened? What now? Who owns it? What
result?** Today the thread answers #3 and partly #4 (HITL banner, lead strip). Phases 3-6
add the rest without adding a screen.

## Design alternatives considered

| Option | Description | For | Against | Verdict |
|---|---|---|---|---|
| A. Compact context drawer (slide-over) | Button in thread header opens overlay | zero layout change | hides history/ownership behind a tap; "what needs attention" invisible while answering; overlay competes with composer on mobile | reject |
| B. **Persistent desktop right panel + mobile third-state sheet** | `xl:` fixed ~320px panel inside the split row (UnifiedInbox.tsx:1192 sibling), collapsible sections; mobile extends the existing `mobilePanelOpen` swap to a 3rd state (list→thread→context) | answers 4/5 questions at a glance; progressive disclosure via collapse; reuses proven 768px swap pattern; composer/timeline stay primary | screen width budget on md — hidden below xl, thread header button opens as sheet | **SELECTED** |
| C. Contextual cards inserted in thread | history/ownership as cards above messages | simple mount | pollutes the customer-visible timeline mental model; duplicate cards on SSE refresh; breaks "timeline is sacred" rule | reject |

Selection reasoning (MomentumUX): merchants on the BazarLens profile run the inbox on a
phone with one hand and a desktop with the other; B is the only option where ownership
and history remain visible *while* typing the reply — the actual job. Panel state is
per-conversation and survives SSE refresh; nothing in it blocks the composer.

## Panel anatomy (top → bottom, §7.2 hierarchy)

1. **Identity** — name, channel+Page chip, last activity, consent/window micro-status
   (links to the existing 24h banner, never a second source).
2. **Relationship** — derived state badge (customer-state/1.0.0), delivered-order count +
   lifetime delivered value (labels: "delivered value", never "received cash"), "Repeat
   buyer" only from state rules.
3. **Current operations** — up to 3 most recent orders (status = authoritative string from
   order authority, click → `/orders?orderId=` (existing contract)); active checkout session
   status when present; open opportunity strip (existing `inbox-lead-insight` stays where
   it is — panel links down, does not duplicate); RTO signal only as neutral facts.
4. **Ownership** — current owner name (DEFECT D3 fix makes this real), claim/take-over,
   assign-to (from `/api/shop/agents`), resolve-with-note, reopen when closed. Conflict →
   server 409 message displayed verbatim; optimistic state is rolled back on conflict
   (never overwrite authority).
5. **CRM Lite** — staff-private notes list (newest 3 + expand) + composer row; tag chips
   (shop vocabulary) add/remove. A "private" affordance communicates non-sending.

Collapsed by default when narrow; Identity+Operations+Ownership expanded, Relationship
collapsed. All sections degrade to honest "—" unknowns (Moment F).

## Moment walkthroughs (mission §6)

- **A "আগের অর্ডারের মতো"**: Operations shows real previous orders w/ item names (order
  authority, not names); merchant clicks the right one; no guessing.
- **B live-surge**: queue views (Phase 6 server counts) + thread owner chips; panel not
  required to triage.
- **C team handoff**: staff B claims → SSE owner field updates staff A's thread ("taken by
  Nowrim"); duplicate-answer risk cut by claimed state; handoff note persists.
- **D returning with issue**: history visible, but actions limited to what backend supports
  (no phantom refund button; SupportTicket deferred).
- **E context note**: note saved from panel appears on Customer detail; never in composer,
  never in AI prompt.
- **F no facts**: every unavailable field is "—"; panel never fabricates from cache.

## Interaction/navigation contracts

- Open context: thread header button (desktop toggle; mobile third state, back button
  mirrors existing `md:hidden` pattern).
- Order deep link `/orders?orderId=`; customer deep link `/customers/:id` (existing).
- Ownership mutations: existing PATCH only; new `owner_changed` payload rides the existing
  `hitl_changed`/`conversation_updated` SSE types (no new channel).
- Notes/tags: shop-scoped REST under `/api/customer/:id/notes|tags` with `authenticate` +
  service-level membership verify (customer module's existing pattern).
- Feature gate: panel sections gated by the authorities they use — Relationship/Opportunity
 /RTO require `customer_intelligence`; basic Identity/Operations/Ownership/Notes/tags use
  non-gated conversation+customer scope (documented per-section). No flag bypasses.
- Stale requests: per-conversation AbortController (FE-08 pattern reused).
- i18n: every string through `t()` with en+bn keys (translation-coverage guard test will
  enforce); Banglish-friendly short labels, no truncation of Bangla at 375px.

## A11y & responsive rules

- Panel sections are `aria-region` with headings; ownership controls keyboard-reachable
  from thread header; focus returns to thread list on close.
- 375/390: context sheet scrolls independently; composer never occluded (journey 11 test).
- axe: zero critical/serious on new surfaces (extended into existing a11y journey).

## Acceptance (feeds Phase 8 journeys)
J1 repeat-buyer; J2 same-name different Page isolation; J3 unlinked manual order honest
state; J4 handoff→claim→resolve; J5 simultaneous claim single winner; J6 note persists
privately across refresh; J7 tag change keeps queue+context consistent; J8 views counts
== server; J9 flag-off no CI exposure; J10 SSE reconnect converges owner/status;
J11 mobile context access w/ composer intact; J12 no synthetic success labels anywhere.
