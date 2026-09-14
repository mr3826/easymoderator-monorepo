# ADR-M-008: New `/api/mobile/attention` and `/api/mobile/today` Endpoints

Status: Accepted<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator + Product

## Context

The Home screen's core job, per the brief, is a single deterministic ranked list of what the
merchant should do right now, spanning: draft orders awaiting confirmation (by age/value), Inbox
conversations needing a reply or AI handoff (`needs_merchant_reply`/`hitl`, already projected —
`CURRENT_STATE.md` §7), failed/stuck courier dispatches (`FAILED`/`INDETERMINATE`,
`CURRENT_STATE.md` §6) and shops needing courier setup, low-stock products (using the
never-before-read `low_stock_threshold` column, `CURRENT_STATE.md` §9), and RTO-risk customers
needing verification. No existing endpoint composes these; `GET /api/dashboard/queue` counts
statuses nothing writes and is unreliable, and "today" throughout the existing dashboard is
computed in UTC, not `Asia/Dhaka` (`CURRENT_STATE.md` §10) — six hours off from a Bangladeshi
merchant's actual day boundary.

## Decision

Add two new, additive, read-only endpoints composed entirely from existing services (no new
scoring model, no AI ranking):

- `GET /api/mobile/attention` — a single ordered list merging the signals above under one
  deterministic, documented ranking (documented in this ADR's follow-up ranking spec in
  `MOBILE_PRODUCT_SPEC.md`; no ML, no opaque scoring — every item's rank is explainable by the
  merchant-facing reason it surfaces).
- `GET /api/mobile/today` — the day's order count, revenue, and pending-action counts, computed
  against `Asia/Dhaka` day boundaries explicitly (not reusing the UTC-boundary dashboard logic).

Both are gated by `MOBILE_API_ENABLED` (ADR M-010) and return 404 when the flag is off.

## Assumptions

- The signals listed above (draft orders, Inbox needs-reply, courier failures/setup, low stock,
  RTO-risk) are the complete Phase 2 attention surface; any additional signal the value-challenge
  review in Phase 0 or later user feedback surfaces gets its own ADR amendment, not a silent
  addition to this endpoint's logic.
- `low_stock_threshold` values currently in the database (never previously read by any code path)
  are trustworthy as merchant-entered thresholds and do not need backfilling or validation before
  this endpoint reads them for the first time — verified with a spot data check in Phase 2, not assumed.

## Alternatives Rejected

- **Extend `GET /api/dashboard` and `/api/dashboard/queue` in place.** Rejected: `/queue` is
  already unreliable (counts statuses nothing writes) and fixing that in place would be an
  undocumented behavior change to an endpoint the web app also consumes — safer to add a new,
  mobile-owned, correctly-specified endpoint than to risk an unreviewed side effect on web's
  dashboard.
- **AI-ranked attention feed.** Rejected for Phase 0–8: the brief requires the ranking be
  deterministic and explainable ("AI must never silently create the committed order" extends in
  spirit to "AI must never silently decide what the merchant sees first"); a learned ranking model
  is out of scope for this program.

## Consequences

- Positive: Home screen ships with a ranking a merchant (or a reviewer) can fully explain from the
  endpoint's documented rules, with no new scoring infrastructure to build, secure, or debug.
- Positive: correcting the day boundary to `Asia/Dhaka` here, in a new endpoint, carries zero risk
  to the existing (already UTC-boundary) web dashboard.
- Negative: two endpoints now compute "today" figures with different day boundaries
  (`/api/dashboard` in UTC, `/api/mobile/today` in `Asia/Dhaka`) until a future ADR unifies them
  for web too — an intentional, documented inconsistency rather than a silent one.

## Phase 2 amendments (Lane 2, `mobile/p2-attention-api`)

Implemented in `EasyMod-backend/src/modules/mobile/` (`attention.service.js`, `today.service.js`,
`mobile-day-window.util.js`, `mobile.controller.js`, `mobile.routes.js`). This section records the
Phase 2 execution plan's D1-D6 decisions as **resolved**, not just referenced, plus the concrete
implementation choices each one required.

- **D1 — low stock on untracked products.** Resolved as specified: `collectLowStockProducts` requires
  `track_quantity = true AND is_active = true`. A product with `low_stock_threshold <= 0` is also
  excluded (a non-positive threshold cannot be meaningfully "below"), which the original decision
  didn't need to address but the implementation does.
- **D2 — `courier_dispatch.status` vs `orders.delivery_status`.** Resolved as specified: every courier
  signal (`COURIER_FAILED`/`COURIER_INDETERMINATE`/`COURIER_SETUP_REQUIRED`) is read from
  `courier_dispatch` (status, and a `COMMITTED`-row check to decide whether an order is still
  blocked). `orders.delivery_status` is never read by this endpoint.
- **D3 — draft order signal.** Resolved as specified: tier 3 fires only for `order_status = 'draft'`.
  Implementing tiers 1b and 4 required two further, closely-related but distinct calls the original
  decision didn't cover, because the production `order_status` vocabulary is genuinely messy
  (`order.service.js` writes `'confirmed'` and `'finalized'` in addition to the declared
  `ORDER_STATES`; `'placed'`/`'fulfilled'` are declared but never written):
  - **Tier 1b ("ready to ship")** is defined negatively as `order_status NOT IN ('draft', 'cancelled',
    'refunded')` — a draft order is explicitly not "ready to ship" yet.
  - **Tier 4 ("pending order" for RTO verification)** is defined negatively as `order_status NOT IN
    ('cancelled', 'refunded', 'finalized', 'fulfilled')` — a *draft* order is deliberately included
    here (unlike tier 1b), since a merchant may want to verify a risky customer before ever
    confirming the order.
  - Neither list is exhaustive by enumeration on purpose — a negative definition is more robust to
    the vocabulary's messiness than trying to name every status a real order might carry.
- **D4 — Dhaka day boundary.** Resolved as specified in `mobile-day-window.util.js`
  (`getMerchantDayWindowUtc`): fixed UTC+06:00 offset arithmetic, no date library added. Non-`Asia/Dhaka`
  `Shop.timezone` values (including `null`/unset) fall back to UTC and set `timezone_note` on the
  `/today` response. Covered by a dedicated pure unit suite
  (`__tests__/mobile-day-window.test.js`) asserting both boundary-adjacent instants and the fallback
  path — this is the backend's first timezone-aware helper, so it is tested as such rather than only
  indirectly through the integration suite.
- **D5 — response shape.** Resolved as specified: `{ success, data: { items, truncated_count,
  generated_at } }` for `/attention`, via the existing `sendSuccess` helper (`utils/AppError.js`),
  which additionally carries the codebase's standard `message`/`requestId`/`timestamp` envelope
  fields — additive, not a deviation from the required shape. `/today` additionally returns
  `order_count`, `revenue`, `delivered_count`, `pending_actions` (an object of per-signal-type counts,
  computed by reusing the same collectors as `/attention` so the two endpoints can never silently
  disagree about what counts as a pending action), `date`, `timezone_used`, and `timezone_note`.
- **D6 — conversation scan bound.** Resolved as specified: `collectConversationSignals` calls
  `getConversations(shopId, { page: 1, limit: 200 })` (no server-side "open" filter exists, so the
  bound is enforced client-side by limiting the page size) and derives `conversationScanTruncated`
  from `pagination.total > 200`. This is reported as a **separate boolean field**
  (`conversation_scan_truncated`) on both endpoints' responses, not folded into `truncated_count` —
  `truncated_count` counts fully-known ranked items beyond the top 20, which is a precise number,
  whereas a truncated conversation scan means some additional needs-reply conversation may exist
  *outside the scanned window entirely* (not even represented as an uncounted item), which is a
  different, weaker kind of "there might be more" and would misrepresent `truncated_count`'s meaning
  if conflated with it.

Two additional implementation notes not required by D1-D6 but load-bearing for correctness:

- **The `createdAt`/`created_at` accessor trap (documented at `conversation.service.js:570-577`)
  applies here too**, and differently per model: `Order` and `Product` expose `.createdAt` (no
  explicit rename), while `CourierDispatch` and `Message` expose `.created_at` (both explicitly
  rename the timestamp attribute to `created_at`). Rather than reasoning about this per call site,
  `mobile-day-window.util.js` exports a single `readTimestamp(row, key)` helper that tries both keys,
  used uniformly by every collector. `WHERE`/`ORDER BY` clauses are unaffected by this trap
  (snake_case column names work there regardless of the JS accessor name, matching existing
  precedent — e.g. `dashboard.service.js:46-47`).
  **Correction from the initial Phase 2 draft of this ADR**: a Sequelize `attributes:` array *is*
  affected, and more severely than a plain property read — it is keyed by attribute name, not column
  name. Requesting the literal string `'created_at'` on `Order`/`Product` (whose real attribute name
  is `createdAt`) silently omits the timestamp from the returned instance under *either* key, so
  `readTimestamp()` has nothing to find and returns `null` (surfacing as a urgency score of exactly
  `0`, caught by `mobile-attention.integration.test.js`'s `courierSetup.urgency_score` assertion
  during Phase 2 verification). The four affected queries (`collectCourierSetupBlocked`,
  `collectDraftOrders`, `collectRtoVerifyOrders`, `collectLowStockProducts`) now request `'createdAt'`
  by its real attribute name instead. `invoice.service.js:482`, cited in the original draft as a
  working precedent, is not actually one — it selects `Order.created_at` inside an `include:`
  association block, whose result is never read as a timestamp (only serialized), so the same defect
  there has simply never been observed.
- **RTO tier scope**: tier 4 fires only for `RtoShieldService.checkPhone(...)` results with
  `tier === TIERS.TIER_VERIFY`, not `TIER_BLOCK`. A `TIER_BLOCK` customer is already refused COD at
  the order-creation gate (a different, earlier point in the flow) — "awaiting verification" in the
  spec's own wording is the `TIER_VERIFY` concept specifically.

All six D1-D6 decisions and both notes above are exercised by
`__tests__/mobile-attention.integration.test.js` (one correctly-scored, correctly-tiered item per
signal, D1's untracked-product exclusion, D6's truncation flag, and cross-tenant/IDOR denial) against
real PostgreSQL, plus `__tests__/mobile-disabled.integration.test.js` for the flag-off 404 behavior.
