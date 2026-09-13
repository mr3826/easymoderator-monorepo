# Mobile Product Spec

Status: Accepted (Phase 0)<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator + Product

## 1. Positioning

**Web = configure the business. Mobile = run the business.** Telegram remains an optional
secondary alert channel. EasyModerator's backend stays the single system of record for every
entity — mobile never invents local truth for orders, money, or delivery state.

The merchant's day is one causal chain: **SELL → VERIFY → DELIVER → COLLECT.** A customer messages
or orders (SELL); the merchant or AI verifies who they are and whether to trust them with COD
(VERIFY); a courier is booked and the parcel moves (DELIVER); cash or online payment is reconciled
(COLLECT). Every mobile screen exists to move one order along this chain faster, or to tell the
merchant which order is stuck and why.

## 2. Priority order (what the Home screen surfaces, top to bottom)

1. **Needs Attention** — the single ranked list (ADR M-008): draft orders aging without
   confirmation, failed/stuck courier dispatches, shops missing courier setup, low-stock products,
   RTO-risk customers awaiting verification. Push notifications exist to pull the merchant into
   this list, not to replace it — every push deep-links to the specific item here.
2. **Inbox "Needs Me"** — conversations where `needs_merchant_reply` is true or the AI has handed
   off (`hitl`), because an unanswered customer message is the highest-cost delay in the SELL
   step.
3. **Orders** — everything in flight across VERIFY → DELIVER → COLLECT, searchable and filterable,
   with the customer's verification evidence (RTO-shield check, prior order history) shown
   alongside — never a bare trust score. Confirm/cancel require an explicit confirmation step.
4. **Courier** — book, retry, and see delivery status for orders that have moved past VERIFY.
   COD figures shown here are always labelled as order-derived expectations, never as settlement
   fact, until a provider gives the backend a reliable settlement signal (`CURRENT_STATE.md` §6).
5. **Products** — stock and price adjustments, and "Photo → Draft" for fast listing creation; never
   auto-published, never AI-priced without merchant confirmation.
6. **Customer quick view** — order history and verification status for a given customer, reached
   from Orders/Inbox, not a standalone top-level destination in Phase 0–7.
7. **Daily summary** — a passive, correctly-Dhaka-dated end-of-day figure (ADR M-008), not an
   action item.

This ordering is a product decision this document records, not a technical constraint — a future
product review can reorder it, but any reorder is a spec change here, not a silent drift in what a
phase happens to build first.

### 2.1 Needs Attention ranking (ADR M-008's concrete tie-break rules)

The attention list is one flat, ordered list, not five separate sections. Each underlying signal
is assigned a **tier** (lower tier number = shown first); within a tier, items sort by **urgency
score** (higher first); the score is a documented arithmetic expression, never a learned or opaque
value, so any position in the list is explainable as "tier X because of signal Y, ranked here
because of Z":

| Tier | Signal | Urgency score (higher = shown first within tier) |
|---|---|---|
| 1 | Courier dispatch `FAILED` or `INDETERMINATE` | hours since the dispatch attempt |
| 1 | Shop courier setup required and blocking a ready-to-ship order | hours since the order became ready to ship |
| 2 | Inbox `needs_merchant_reply` or `hitl` handoff | hours since the customer's last inbound message |
| 3 | Draft order awaiting confirmation | `order.total` (BDT) × hours since creation |
| 4 | RTO-risk customer awaiting verification on a pending order | hours since the order entered a verification-required state |
| 5 | Product below `low_stock_threshold` | 1 − (current stock ÷ threshold), i.e. the closer to zero stock, the higher |

Tier 1 outranks every other tier unconditionally: a stuck courier or blocked shipment is the
single most time-sensitive failure mode (a parcel physically not moving), so it is never buried
under a large volume of lower-tier items. Within a tier, ties (identical score to the minute) break
by earliest-created-first (older items surface first, so nothing silently ages out of view). The
list is capped at the 20 highest-ranked items with a count of how many more exist below the fold —
never silently truncated without saying so.

This table is the actual algorithm `GET /api/mobile/attention` implements; a change to the tiers,
the score formulas, or the cap is a change to this table, reviewed like any other product decision.

## 3. Bengali-first UX

`bn` is the default language, extending the web app's existing ~1,800-key translation namespace
(`CURRENT_STATE.md` §12) rather than starting a second one. Bangladeshi phone numbers are
validated with the same regex the web app already uses (`/^01[3-9]\d{8}$/`). Currency is always
rendered as ৳ with Bangladeshi digit grouping. Every screen is designed and tested in `bn` first;
`en` is the secondary, verified-after language.

## 4. Low-end hardware target

The primary AVD/device target for every phase's manual and Maestro testing is API 24 (Android 7),
~1.5 GB RAM class — not a modern flagship. Perf budgets (validated per phase, see
`MOBILE_EXECUTION_STATE.md`):

- Cold start to interactive Home screen: ≤ 3 seconds on the API-24 AVD.
- JS bundle size budget: tracked per phase; any phase that grows the bundle materially records why.
- List scrolling (Orders, Products, Inbox) must not drop frames at 500 rows on the API-24 AVD —
  virtualized lists only, no unbounded `.map()` renders.

## 4.1 Deferred UX principles (tracked, not dropped)

Two of the brief's Bangladesh UX principles are not designed in Phase 0 and are explicitly
deferred with an owning phase rather than silently omitted:

- **Remembered customer/address context where safe** — owner: Phase 4 (Orders), when the manual
  order-creation and repeat-customer flows are designed; must respect the same "never persist
  message content" and shop-switch cache purge rules as ADR M-011.
- **Appropriate compression of uploaded images** — owner: Phase 3 (Inbox reply attachments) and
  Phase 6 (Photo → Draft product images); both already touch image upload and are the natural
  place to specify target resolution/size before transmission on constrained BD mobile data.

## 5. What mobile explicitly does not do

Matching the program's non-negotiable constraints, restated in product terms so a feature request
can be checked against them directly:

- Mobile never lets AI silently create the order the merchant is about to commit to — every
  AI-assisted order draft requires an explicit merchant confirmation tap before it becomes a real
  order.
- Mobile never queues order creation, order cancellation, courier booking, or any financial change
  while offline (ADR M-011) — these actions are simply unavailable offline, clearly labelled as such.
- Mobile never calls a courier provider directly — every courier action goes through the existing
  backend courier service.
- Mobile never infers or displays settlement data as if it were confirmed — COD figures are
  order-derived expectations until a provider integration proves otherwise (`CURRENT_STATE.md` §6).
- Mobile never shows a customer trust decision as an opaque score — verification evidence (RTO
  check result, order history) is shown, and the merchant decides.
