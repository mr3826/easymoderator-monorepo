# Action-First V1 — Decision Log (gate 2 of the execution brief)

Every entry: user task → value → existing support → alternatives (incl. doing nothing) → risk/cost → choice → independent objection → acceptance test. Evidence baseline: `07168f49` current code (verified 2026-10-20).

## KEEP — untouched contracts (highest protection)
- `SUPER_ADMIN`/`GROWTH_USER` canonical roles, `PERMISSIONS_BY_ROLE` maps, legacy role strings compatibility-only (`growth-os.permissions.js`). Value: security. No change.
- MFA assurance, bootstrap states, merchant-context rejection, Redis fail-closed 503, rate limits (`growth-os.middleware.js`, routes). No change.
- Prospect lifecycle/transition table, identity unique indexes, dedupe 409 `conflictingProspectId`, scope redaction (`growth-os.prospect.lifecycle/identity/scope`, service). No change.
- Server-selected Merchant 360 full vs masked insight (`growth-os.merchants.service.js`); client never chooses shape. No change.
- Existing deep links `/prospects`, `/quick-add`, `/capture`, `/sources`, `/analytics`, `/operations`, `/audit`, `/growth-users`, `/access-control`, `/search`, `/follow-ups`, `/pipeline`, `/merchants*` all keep rendering (extension handoff and tests depend on them). Acceptance: `App.test.tsx` route matrix + Playwright.
- Extension capture flow: unchanged code path; no new capture kinds.

## IMPROVE 1 — Sales landing becomes an item-backed Action Queue
- Task (S1/S3): operator must find and finish today's overdue/due work without hunting. Value: task completion, not card admiration.
- Existing support: `GET /followups?state=overdue|due_today&owner=me` (server Asia/Dhaka day bounds), `GET /prospects?status=qualified&owner=unassigned`, `?status=onboarding&stalledBefore=<server window>`, `?status=new&owner=unassigned`, plus `/home` windows/counts. No new endpoint needed.
- Alternatives: (a) do nothing — counts already exist but are not actionable; (b) new backend `/home/queue` aggregation — rejected: duplicates existing read APIs, more surface area, more tests (CTO objection: platform already has the domain reads; do not build a new service layer to reorganize pages).
- Risk: client fans out up to 5 GETs; rate limit reads=300/min per user — acceptable (pageSize 5 each; one page load). Partial failure handled per segment (allSettled + inline retry), never a blank queue.
- Choice: `HomePage` composes ordered segments from existing endpoints; each row deep-links to the real record/action with a human "why" (overdue-by-N-days computed vs server `generatedAt`; stalled-since from `statusChangedAt`; "unassigned qualified lead").
- Objection (BazarLens): cognitive cost. Mitigation: ≤5 rows per segment with "showing top N of M" + drill link; explanation copy per segment; counts from the same `/home` payload so queue and totals agree.
- Acceptance: HomePage unit tests (segment composition, ordering, drill URLs, per-segment failure); Playwright S1: sign in as growth user → Today → first overdue row → prospect/My Work → complete → persisted state.

## IMPROVE 2 — typed follow-up outcome on completion (smallest audited field, NO migration)
- Task (S1): record why contact succeeded/failed; Growth discipline measurement.
- Existing support: `growth_os_prospect_events` has `reason(200)` + `metadata JSONB`; audit trail already wraps transitions transactionally. Follow-up table itself is terminal-immutable (completed rows cannot reopen; brief: never overwrite history) — so outcome belongs on the event/audit, not a new mutable column.
- Alternatives: (a) free-text only — rejected, unmeasurable; (b) new column + migration — rejected: same evidence obtainable via existing typed-event ledger, zero schema/rollback cost (CTO + Postgres veto on needless migration); (c) PATCH note then transition — rejected: two calls, mutates original note, races.
- Choice: extend `POST /followups/:id/status` body with optional `outcome` enum `reached|no_answer|not_interested|next_step_scheduled|other` + optional `reason` ≤200. Persisted in event `metadata.outcome`, event `reason`, audit `newValues.outcome`. Backward-compatible: existing `{status}` callers keep working (validator was `.unknown(false)`, now accepts exactly these two optional keys).
- Risk: enum is a hypothesis, not a scoring model; labels are operational, not demographic. Objection (Security): unknown fields still rejected; reason is sanitized like any prospect reason; no PII redaction change needed because events keep reasons while *audit snapshots* keep existing sanitizer.
- Acceptance: backend jest transition tests (valid/invalid outcome, audit+event payload, legacy body still passes), frontend dialog test, Playwright outcome persistence in timeline.

## IMPROVE 3 — Admin Control attention landing (`/admin`)
- Task (A1): "what is wrong, who is affected, what action is permitted, did it succeed".
- Existing support: `/home` already computes SUPER_ADMIN-only `platformAttention` (stuck payments >24h, unhealthy Meta channels, suspended subscriptions), `merchantAttention`, `recentPrivilegedActions`; `/operations` provides the detail page; `/merchants` admin list shows per-merchant plan/status; Merchant 360 shows channels; `/audit` is the receipt view.
- Data-truth rule (G3): stuck-payment and channel aggregates have NO per-merchant endpoint at platform scope → landing presents them as honest aggregates pointing to Operations detail; only signals with real drilldowns (suspended subscriptions → merchants table, stalled onboarding → prospects stalled filter, privileged actions → audit) are linked to cohorts. Never invent incident↔merchant correlation.
- Alternatives: (a) keep super-admin home == sales home — rejected (P0 audit finding: different success conditions); (b) new backend incident correlation — REJECTED/DEFERRED: no supported source; would be fabricated semantics.
- Choice: new `/admin` route (guarded ANY-of admin permissions server-side; nav-only otherwise) reusing `/home` payload; no backend change.
- Objection (Growth strategist): avoid KPI-heavy vanity; hence each card carries owner action text + drill or an explicit "aggregate only" note.
- Acceptance: AdminHome unit tests (links, aggregate honesty, absent blocks for missing data), Playwright A1: admin lands via context switch → suspended-subscriptions card → merchants list → 360 → suspend with reason → success + audit row; A2 Team & Access flows.

## MERGE NAV — two-context workspace switcher + grouped destinations
- Task: same staff, two different questions; server authority must not change with the switch.
- Choice: client context state (`sales`|`admin`) persisted in sessionStorage; switcher rendered only when the session holds admin-side permissions (i.e., SUPER_ADMIN effective grants) — GROWTH_USER never sees it and keeps Sales nav only. Switching navigates to that context's home (`/` vs `/admin`) and changes the visible sidebar groups. Guards remain permission-based in `RequirePermission` — a crafted URL hits the server 403 anyway (B2/B1).
- Consolidations: Sources + Analytics → `/performance` (tabs Funnel | Source attribution; `/analytics` and `/sources` routes still render the same pages standalone, deep links intact); Growth Users + Access Control → "Team & Access" sidebar group (routes unchanged); Quick Add removed from sidebar (primary header action **Add prospect** → `/prospects/new`, quick path stays reachable from Leads area and prospect pages); Search stays in header, sidebar entry removed (results page `/search` unchanged).
- Objection (BrandForge/UX): nav change costs muscle memory → mitigation: identical route URLs, preserved labels otherwise; reviewer note: "clarity outranks spectacle".
- Acceptance: GrowthShell tests (per-role nav sets, switcher visibility, no escalation), `permissions.spec.ts` updates.

## IMPROVE 4 — "AI Activated" semantics
- Existing label "Activated (last 7 days)" already maps `convertedLast7d` = converted + active linked shop + first AI reply; copy clarified to **AI Activated** everywhere user-facing with one-line explainer "first successful AI reply — not a paid conversion". Canonical status string `converted` untouched in API/payloads. Unchanged: `notAvailable` list still refuses CAC/reply-rate/retention. Acceptance: HomePage/Analytics copy tests + G3 checklist.

## IMPROVE 5 — role copy correctness
- `ProspectDetailPage.tsx:536,603` say "Growth Managers and Founders" → canonical "Super Admins and Growth Users". Legacy role selector display in GrowthUsersPage stays (shows `legacy: X` for compatibility rows) but only canonical roles are grantable (verified server-side too). Acceptance: copy assertions in tests.

## DEFER (documented, no empty UI)
- Qualified-unassigned *claiming* workflow (assign-from-home): API exists (`/assign`) but queue rows keep deep link to detail instead of inline mutation — smaller blast radius this phase.
- Outcome analytics (rate by outcome): needs accumulated data; deferred until ≥ one real cohort exists.
- Cohort drill for stuck payments per merchant: no endpoint; deferred.

## REJECT (with counterargument)
- New `/home/queue` backend aggregate: duplicates canonical reads (CTO veto). Objection considered and declined: aggregation client-side costs 5 requests only on the landing page; server adds no new authority surface.
- New prospect qualification columns (stage/volume/pain): existing `niche`, `notes`, `source_detail`, `metadata` + typed notes cover the hypothesis fields without PII expansion or fake scoring (BazarLens). If pilot proves insufficiency → next phase with evidence.
- Any autonomous outreach/scraping/campaign publishing, AI scoring, plan overrides, bulk credits: prohibited by the mission; no code.
- Server-side per-merchant incident correlation: no verified data source (G3).

## Review-stack decision (local founder review)
- Reuse: `docker-compose.test.yml` pattern, `seed-growth-e2e.js` account/TOTP semantics (real bcrypt passwords, real TOTP enrollment, real role rows), env contract of `run-growth-e2e.js`.
- New: persistent isolated project `em-growth-review-<token>` with own network/volumes, loopback-only ports via free-probe, backend+frontend images, review nginx conf proxying `/api` to backend on docker DNS, `GROWTH_REVIEW_MODE=true`, DB name containing `_review_..._test` (disposable guard), fresh random credentials written ONLY to gitignored `0600`-style receipt file under repo `.growth-review/`; E2E runner untouched (its auto-teardown preserved).
- Ownership safety: `down`/`reset` re-verify project label before any destructive call; never broad prune. Acceptance: review runner unit-level self-check + documented health command output receipts.
