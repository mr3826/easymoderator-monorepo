# IC-V1 06 — Pilot Release Readiness: Founder GO/NO-GO Report

**Scope of this milestone:** release engineering and owner decisions only — no feature
work, no deploy, no push. Candidate under test: `integration-candidate/merchant-workspace-v1`
at `d79332fd` (round-2 freeze `0386207c` + docs pin), worktree
`D:\easymod\_wt-ic-merchant-workspace-v1`.

---

## 1. Freeze verification (step 1) — COMPLETE

| Check | Result |
|---|---|
| Branch tip / lineage | `deb3c239 → 1d530e79 → baaab983 → 0386207c (round-2 freeze) → d79332fd (pin)` — all ancestors verified |
| Docs-only delta `0386207c..d79332fd` | 2 files (`proof.json`, `05-founder-handoff.md`); every gate result is attributable to the tested code tree |
| `git fsck` | no corruption; only benign dangling objects |
| Never pushed | `git ls-remote origin` shows no `integration-candidate/*`; branch has no upstream |
| Hooks | no active git hooks (the `--no-verify` used at freeze bypassed nothing — disclosed) |
| Sibling worktrees | pilotplus `9f562aaf`, increment-1 `3d1bc0eb`, increment-2 `434a8cfc`, mobile `939de5dc` all untouched; PE artifacts deliberately excluded from the candidate commit |

## 2. Production-default & feature-flag matrix (step 2) — COMPLETE

New single-source matrix suite `production-defaults-matrix.test.js` (7 pins) drives the
REAL `buildRenderedEnv` output for a first deploy (all AI flags strict-`'false'`) through
every authority surface:

- every mutating gate action denied at `runtime_kill_switch_enabled`, denial audited;
- `READ_PRODUCT` reports the policy state `domain_agent_runtime_disabled` (legacy bot
  answers continue — the R2-F1 production-default hazard, now pinned in both directions);
- a fully-verified payment webhook cannot auto-book couriers (`automation_disabled`, zero
  provider/dispatch side effects — previously untested behavior, R2-F10);
- partial enablement is granular (order-mutations ON ≠ courier-booking ON ≠ payment-acceptance ON);
- in-flight kill-switch revocation: a minted authorization fails verification the moment its
  sub-flag flips off, signature intact;
- static cross-check: every `MUTATING_ACTION_TYPES` entry maps to exactly one
  render-production-env flag (a new action type without a flag fails the build).

## 3. Legacy failure & skip reconciliation (step 3) — COMPLETE

**22 → 0.** Re-swept after the ActionQueuePanel hardening: 13 failures, root-caused and
closed at the correct layer:

| Group | Count | Resolution |
|---|---|---|
| `shared-inbox` + `meta-platform` + ai-reply A/B | 9 (earlier sweep) | **Product hardening** (round-2): malformed actions payload no longer white-screens the inbox |
| `ai-reply-mode` C–I | 9 | **Spec fix**: harness allowlist + empty-queue mock for `/api/inbox/actions` (P+03 read model mounted by the inbox strip; scenario content is not its contract — J6/pilot-plus pin that) |
| `core-app`, `chatbot-journey` dashboard heading | 3 | **Spec update**: pinned to the shipped task-first heading `Today's work` / `Orders today` (the rename was an approved IC decision; vitest + pilot-plus already pinned it — e2e lagged) |
| `customer-intelligence` strict-heading violation | 1 | **Product fix (small, semantic)**: the AppBar page title was a second `<h1>` per page; downgraded to `<p>` — single-h1 semantics restored, locators unambiguous, visuals unchanged |

Full-suite state at this milestone (final numbers in §7): every non-`test.skip` browser test
green; no failure left "explained away" — 14 of 19 legacy files were already green, the
remaining five are green now.

**Skipped-test inventory (complete):**
- Backend units: 2 skipped — both in `lab-replay.test.js`, the paid Gemini photo
  diagnostics gated by `LAB_GEMINI_PRO_PHOTO_PROBE` / `LAB_GEMINI_LITE_PHOTO_DIAGNOSTIC`.
  Skip is intentional under the no-paid-evaluation rule. Not coverage.
- Frontend units: 0 skipped (692/692 run).
- Playwright: 6 skipped by design — `mwv1-live.spec.ts` (5) self-skip unless `MWV1_LIVE=1`
  against the seeded live stack; `meta-platform` 'channel settings expose Messenger only'
  carries an explicit `test.skip` with a Phase-D-revamp rewrite note (owner debt, listed in §6).

## 4. Production-shaped migration dry-run (step 4) — COMPLETE, and it caught a real defect

New repeatable gate: `npm run test:backend:migration-dryrun` (disposable compose stack;
refuses any non-disposable `DATABASE_URL`). Six phases:

1. Full migration chain (June → `20261026_001`) applies to an empty catalog.
2. Seeds production-shaped data: 3 tenants/shops/owners, 15 customers, 242 orders across
   every status with JSONB addresses/metadata and 90-day spread, agent idempotency keys —
   including the SAME key across two different shops.
3. Asserts the orders catalog carries **exactly one** partial unique index
   (`idx_orders_shop_idempotency`), that it refuses a within-shop duplicate at the DB
   (SQLSTATE 23505) while cross-shop reuse stays legal, and that the courier-dispatch and
   MW-V1 notes/tags objects exist.
4. Simulates a pre-June-style dirty catalog: index absent + duplicate rows → the migration
   **refuses loudly** and names the invariant (never silently enforces over dirty data).
5. Dedupes → migration creates the canonical index → duplicate insert refused again.
6. down/up round-trip: `down` reverses only this migration's own artifact and never the
   June-owned index; `up` is idempotent (index count stays 1).

**Defect found and fixed:** the round-2 draft of `20261026_001` created a SECOND index over
identical columns because migration `20261026…/20260611_001` had already established the
canonical one since June — the reviewer's F4 concern (no DB constraint) was already
satisfied in production-shaped catalogs, and the draft would have double-indexed orders in
every deploy. `20261026_001` was rewritten as a reconciliation step (drop the redundant
draft name, keep/verify the canonical, preserve the loud-refusal precheck), the entity now
declares the canonical name (model↔DB truth aligned), and the draft spec was rewritten to
pin the reconciled semantics. Dev/lab catalogs that already ran the draft self-heal on the
next `npm run migrate`; production never ran it. This is the value the dry-run milestone
existed for.

## 5. Mobile Inbox compatibility & V6/Orders dispositions (step 5) — COMPLETE

Endpoint-level diff of the mobile client's real calls (non-test) against the candidate
backend route registry:

| Client call | Backend | Status |
|---|---|---|
| `/api/mobile/today`, `/api/mobile/attention` | present | ✅ (contract suite green) |
| `/api/mobile/inbox/conversations[/:id[/messages|/reply|/ai-mode]]` | present | ✅ pinned by `mobile-inbox-contract.integration.test.js` (225-test integration run) |
| `/api/mobile/orders/*` incl. `manual`, `draft`, `book-courier`, `cancel`, `confirm` | present | ✅ authority + draft-409 semantics unchanged |
| `/api/mobile/products`, `photo-draft`, `quick-update` | present | ✅ |
| `/api/auth/native/{signin,refresh,logout,2fa/verify,sessions}` | present | ✅ |
| `/api/notifications/subscriptions[/:id]` | present | ✅ |
| **`POST /api/mobile/products/images`** | **absent** | ⚠️ known gap (client `useProducts.ts:216` photo-upload flow). Pending upstream contribution from the mobile branch. **Decision D-5 below.** |

V6/Orders dispositions unchanged and verified: the four v6 contract deltas (draft-booking
409, order-status filter, dev CSRF cookie, toast opt-out) are ported with their specs and
green in the integration gate; the v6 UX line remains deferred with the 30-item owner
acceptance list (doc 01); orders-execution-workspace-v2 untouched. The earlier-stated
"retired-tag 422 / reply-shape superset" findings were re-checked in this session's
integration suites — no drift.

## 6. Owner decision package (step 6)

**D-1 — Pilot cohort authorization.** (Entry to any live traffic.)
- Proposed cohort: 3–5 existing BD Messenger shops; requirements: ≥30 days of real
  conversation history, active `pages_messaging` page token, owner account available for
  the 30-minute enablement walkthrough, and a named merchant contact who opts in.
- Entry criteria: cohort shops enabled with `customer_intelligence` + `order_confidence_mode`
  per docs/pilot-intelligence/07-operations-runbook.md §1, ALL commerce flags OFF.
- Exit/abort triggers (any one): action-gate denial spikes not explained by kill-switches;
  any unauthorized write found by the read-only SQL checks (runbook §5); merchant-reported
  reply-safety incident; Sentry error-rate on `/api/mobile|order` >1% for 24h.
- This is an owner action; engineering does not select shops.

**D-2 — Meta permissions / App Review.**
- The candidate introduces **zero new Graph API scopes** (verified against the permission
  table in docs/launch-readiness/2026-07-26/07_META_REVIEW_PACKAGE_AUDIT.md —
  `pages_show_list`, `pages_messaging`, `pages_manage_metadata` — all pre-existing, and the
  2026-09-22 production proof already exercised live messaging send/delivered with them).
- Outstanding from before this candidate and unchanged: Human-Agent App Review status for
  the AI-replies feature disclosure (doc-05 lists it as pre-existing). Owner to confirm
  current App Review console state before the cohort's AI modes go above MANUAL.

**D-3 — Monitoring wiring (pre-cohort checklist).**
- Required in production render (validator already enforces one of): `SENTRY_DSN` +
  (`SLACK_ALERT_WEBHOOK_URL`); ops-alert fanout covers Action Gate audit failures and
  committed-but-unaudited markers (`result_unaudited`, `action_audit_unavailable`).
- New queries the candidate makes observable (audit `audit_logs.action`):
  `ai.action_gate.authorized|denied|exception|result_recorded` — alert on: any `authorized`
  row while flags are OFF (authority regression), `exception` rate > 0 sustained, and
  `courier booking blocked automation_disabled` volume (tells you the flag is OFF when
  merchants expect bookings).
- Watch the inbox delivery reconciler for `INDETERMINATE` dispatch backlog (runbook §3).
- Decision needed: which Slack channel(s) receive ops-alerts, and who owns the dashboards.

**D-4 — Kill-switch playbook (three levels, all already tested).**
1. Per-conversation: merchant/Mobile "pause AI" (Redis `ai:pause:<id>`, now with
   symmetric rollback — R2-F9).
2. Per-shop: `automation_mode=MANUAL` (instant, DB-backed, no deploy).
3. Global commerce mutations: `AI_ORDER_MUTATIONS_ENABLED`, `AI_COURIER_BOOKING_ENABLED`,
   `AI_PAYMENT_ACCEPTANCE_ENABLED`, `AI_SUPPORT_CASE_ENABLED`, parent
   `DOMAIN_AGENT_RUNTIME_ENABLED` — each strict-literal, default `false`, applied by
   re-rendering production env + restart (no runtime API mutates these). Committed
   mutations survive flag flips (reconciliation paths pinned); in-flight authorizations
   are revoked the moment a sub-flag flips (matrix-pinned).
- Decision needed: who is authorized to flip flags in production, and the expected
  confirmation path (two-person rule recommended for the four mutation sub-flags).

**D-5 — Mobile photo upload (`POST /api/mobile/products/images`).**
- The mobile client calls it; the backend does not implement it. Options: (a) gate the
  client flow behind feature detection until the mobile branch's contribution merges
  (recommended — already effectively gated by `MOBILE_API_ENABLED=false` default);
  (b) accept the mobile PR scope into a post-freeze increment. Owner choice; nothing in
  this candidate blocks either path.

**D-6 — v6 UX line + `meta-platform` channel-settings rewrite.**
- v6 action-first shell remains deferred with the 30-item acceptance list (doc 01);
  the Phase-D `Channels.tsx` e2e rewrite (1 skipped spec with an in-file follow-up note)
  is the same class of owner-tracked debt. Both safe to schedule post-pilot.

**D-7 — Webhook auto-booking stance.**
- As of this candidate, even a verified paid webhook books nothing while
  `AI_COURIER_BOOKING_ENABLED=false` (the rendered default). If merchants expect paid →
  auto-dispatch during pilot, that expectation is currently OFF by design (AGENT_ACTION_POLICY
  §11 deployment note). Owner decision: enable it for specific pilot shops or run manual
  dispatch for the pilot.

## 7. Independent verification battery (step 1 gate + this milestone) — numbers

(Rerun at the final tip; filled from §8 logs — all commands on Node 20.20.2.)

| Gate | Command | Result |
|---|---|---|
| Backend units | `npm run test:backend` | **318/318 suites; 4,281 passed, 2 skipped** (skips inventoried §3) |
| Real-stack integration | `npm run test:backend:integration:docker` | **32/32 suites; 225/225** — disposable Postgres ran the reconciled chain |
| Meta-shaped E2E | `npm run test:backend:meta:e2e:docker` | **2/2 suites; 48/48**, zero live sends |
| Production-shaped dry-run | `npm run test:backend:migration-dryrun` | **PASS** (6 phases §4) |
| Frontend units | `npm run test:frontend` | **78 files; 692/692** |
| TypeScript / build | `tsc --noEmit` / `build:all` | **0 / success** |
| Browser full sweep | chromium, `--workers=1` | see §8 |
| Journey battery | pilot-plus + mwv1-journeys | 20/20 chromium + 20/20 firefox (round-2, unchanged tree for these surfaces) |

## 8. Full sweep results (this milestone)

- Chromium, all 19 spec files, `--workers=1` at the milestone tree: **105 passed, 0 failed,
  6 skipped** (the 6 are the §3 inventory: 5 `MWV1_LIVE`-gated + 1 documented Phase-D
  rewrite). The 22-round-2 failures and the 13 mid-milestone failures are fully closed at
  the correct layer; no browser test remains red or silently excluded.
- Journey battery re-run after the AppBar `<h1>` reconciliation: firefox **20/20**
  (`--workers=1`); chromium coverage is contained in the 105-test full sweep above.

## 9. GO / NO-GO

**Technical verdict: GO for pilot deployment rehearsal — with every commerce mutation flag
OFF** — conditioned on the owner decisions §6 D-1…D-7 and the deploy rehearsal on live
infra. The release-engineering question "is this candidate a complete, safe, verified
pilot artifact?" is answered YES by: pinned production defaults, a DB-enforced idempotency
backstop with a loud rollout precheck, zero known unexplained browser failures, a complete
skip inventory, mobile compatibility established at endpoint level, and a repeatable
migration dry-run gate.

**Production release itself remains NO-GO until:** cohort authorization (D-1), live deploy
rehearsal, Meta review confirmation (D-2), and monitoring wiring (D-3). Nothing was pushed,
merged, deployed, or production-changed by this milestone; the candidate stays local at
`d79332fd`.
