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
