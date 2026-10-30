# IC-V1 04 — Independent Adversarial Review & Disposition

**Reviewer:** fresh-context session `ses_e8969255fffeLO6i5fMVphDbsA` (not the implementer).
**Reviewed:** frozen `17fce2f9` / code `a513a4ce`. **Verdict: APPROVED_WITH_FINDINGS**
(0 blockers, 11 findings: 5 medium, 4 low, 2 info). Reviewer personally reproduced:
backend 313/313, tsc 0, FE 665/665, integration 30/30/220, meta-e2e 48/48,
playwright 20/20, rehearsal 30-failed/43-passed, byte-identical ported specs,
bypass hunt clean, never-pushed.

| # | Sev | Finding | Disposition (all closed in `deb3c239` unless noted) |
|---|---|---|---|
| F1 | MED | Gate reorder let DRAFT orders be marked/notified `COURIER_SETUP_REQUIRED` before rejection (v6 as-imported threw first; deleted `draft.update` assertion hid the lost guarantee) | **Fixed at source:** one `draftBookingGuard` throws at EVERY pre-write point (unconfigured-provider branch, missing-data branch, post-confidence point); new unit spec pins update/notify/createDeliveryOrder all uncalled. Full 409 taxonomy below. |
| F2 | MED | `DRAFT_ORDER_NOT_BOOKABLE` pinned only at unit level; legacy draft with COMMITTED dispatch could no longer reconcile | **Fixed:** guard returns the synthesized committed parcel (unit spec); HTTP integration spec added on real Postgres (`book-courier` → 409 + code + order unmutated). The web controller catch previously flattened ALL thrown AppErrors to 500 `COURIER_BOOKING_FAILED` (pre-existing gap the port exposed) — declared 4xx status/code/reasons now pass through. |
| F3 | MED | Counts wrong (28 vs 30 = 27 UnifiedInbox + 1 Dashboard + 2 i18n); rehearsal base undisclosed | **Fixed in docs** 01/05 + proof.json; base stated (rehearsal was onto increment-1; list may shift on rebase onto IC); reviewer's own re-run matches the enumerated names 1:1. |
| F4 | MED | "Frozen" tip moved during review (docs-only d0d98ec7) | Acknowledged; final refreeze `deb3c239` (code) / `1d530e7` (docs binding); review rounds end with a re-verification battery, not chat claims. |
| F5 | MED | Browser batteries never exercised the IC backend (:3000 served pre-IC code; specs route-mocked) | **Closed properly:** founder preview re-hosted FROM the IC tree; real-stack walkthrough 3/3 (live login = dev-cookie CSRF round trip through the IC backend); draft 409, `order_status=draft` filter and zero-mutation proven over HTTP from an authenticated browser session; proof row created/removed in lab DB only. |
| F6 | LOW | "firefox 20/20" had no committed mechanism | `test:e2e:chromium` + `test:e2e:firefox` scripts committed; firefox re-proven **20/20** through them (one initial run died at webServer startup contention; green on clean re-run — recorded honestly). |
| F7 | LOW | doc 02 numbers (+38/−19 vs +32/−6 actual; 23-file vs 26 WIP) | **Fixed** in doc 02 to git-numstat values; route/field facts independently verified true. |
| F8 | LOW | README invented cookie `__Host-easymod.csrf-token` (exists nowhere) | **Fixed**: production keeps library default `__Host-psifi.x-csrf-token`; NODE_ENV must be set (missing ⇒ development naming; the same fail-open also flips cookie `secure` — PRE-EXISTING, flagged for the security owner, not introduced here). |
| F9 | LOW | Undeclared fixture churn + moved pilot-metrics line in 2a4760bb | Fully declared here and in doc 03; the metrics line is the pre-existing committed-dispatch counter correctly fired by the reconciled guard. |
| F10 | INFO | Battery dirties tracked files (fixture regen; 3 PNGs overwritten per run) | Screenshots now written to gitignored `test-results/pw-evidence/`; drifted PNGs restored; fixture follows the documented regenerate-with-run convention. |
| F11 | INFO | commit-graph chain warning | Self-healed before this round (chain files present; `git commit-graph verify` clean; no warnings since). |

## Draft-booking 409 taxonomy (final; every row pinned by tests)

| Draft condition | Answer | Side effects |
|---|---|---|
| already booked (consignment/tracking set) | 200 existing parcel (idempotent) | none |
| courier unconfigured / blocked | 409 `DRAFT_ORDER_NOT_BOOKABLE` | **none** — no setup marking, no notification |
| required fields missing | 409 `DRAFT_ORDER_NOT_BOOKABLE` | none |
| confidence-HELD, courier configured | 409 `ORDER_CONFIDENCE_HOLD` + reasons (ADR-0007) | standard hold marking (intended, pinned) |
| confidence allowed/off, clean draft | 409 `DRAFT_ORDER_NOT_BOOKABLE` | none |
| legacy draft, dispatch COMMITTED | 200 synthesized parcel (reconciliation preserved) | metric increment only |
| any non-draft order | exact prior behavior on every branch | — |

 Reviewer's own judgment on the classic assertion-edit risk (2a4760bb): load-bearing
never-books assertions were retained; the one genuinely lost guarantee (F1) was
restored at the source rather than papered over — independently verifiable via the
two new unit specs plus the real-Postgres HTTP pin.

---

## Round 2 — post-hardening adversarial review (final uncommitted diff)

**Reviewer:** fresh-context session `ses_e86d829cfffeeJKWg7pyBnPfYp`. **Verdict: GO** for the
mutation paths; all 7 release invariants verified INTACT by source trace; no authority bypass;
no production behavior weakened to pass tests (test-authority fixtures use `kind:'test'`
under `NODE_ENV=test` only; replay-harness changes restore production-default fidelity rather
than remove it). Findings: 1 High + 3 Medium + 5 Low + 1 info.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| R2-F1 | HIGH | `intent-router` forced a "cannot verify catalog" handoff on ANY `recorded:false` READ_PRODUCT result — including `domain_agent_runtime_disabled`, which is the rendered production default. Every live bot product answer would hand off at deploy, and both replay harnesses had been flipped to `recorded:true`, masking it. | **Fixed:** `domain_agent_runtime_disabled` is a policy state, not an audit-integrity failure — legacy grounded reply continues while the runtime is off; every other `recorded:false` reason stays fail-closed. New unit test pins both directions. Replay harnesses now mock the shipped default (`recorded:false / domain_agent_runtime_disabled`) instead of a runtime-on fiction. Policy §7 updated. |
| R2-F2 | MED | Kill-switch allow-by-default: unlisted mutating capability (`ACCEPT_PAYMENT`, `CREATE_SUPPORT_CASE`) passed `isDomainAgentActionEnabled` via fall-through. | **Fixed:** explicit map — every `MUTATING_ACTION_TYPES` entry requires its own flag (`AI_PAYMENT_ACCEPTANCE_ENABLED`, `AI_SUPPORT_CASE_ENABLED` added; renderer emits both strict-literal `'false'` defaults); unknown/unmapped types deny. New `ai-runtime-flags` unit suite + gate contract test for `ACCEPT_PAYMENT` denial via `runtime_kill_switch_enabled`. |
| R2-F3 | MED | A committed agent order returned 503 when its post-commit result audit failed. | **Fixed:** committed order survives (returns with `result_unaudited` marker + warn log; replayed turn re-records), mirroring the courier committed-but-unaudited path; failure-path audit errors can no longer mask the original error. New `order-agent-outcome-audit` spec pins both. |
| R2-F4 | MED | No DB constraint behind create-order idempotency (advisory lock no-ops on non-PG). | **Fixed:** migration `20261026_001_order_idempotency_unique` adds partial unique `(shop_id, idempotency_key) WHERE idempotency_key IS NOT NULL`, mirroring the entity; `up` fails loudly on pre-existing duplicates (reconcile-before-deploy, never silent). Verified applying on the disposable Postgres (32-suite integration green). Migration spec included. |
| R2-F5 | LOW | Bare-specifier `require('src/...')` in intent-router broke alias-less ops scripts; duplicated dead flag check + misaligned brace in read-action-evaluator. | **Fixed:** relative require restored; duplicate check removed; brace fixed. |
| R2-F6 | LOW | Authority audit row precedes the draft guard, so a DRAFT 409 leaves a `COURIER_BOOKING_AUTHORIZED` row. | **Dispositioned (no code change):** the row asserts authority verification, not booking completion; reordering would invert the deliberately pinned confidence-hold precedence (held draft must answer `ORDER_CONFIDENCE_HOLD`) and the gate-before-claim source-order security pin. Audit-noise only; documented. |
| R2-F7 | LOW | `recordActionGateOutcome` checked shape, not signature; `audit_logs.idempotency_key` non-unique so the idempotent-result promise is determinism-only. | **Signature half fixed:** result rows now require the gate's own mint signature (TTL deliberately relaxed at result time). The unique index on audit result rows is deferred to a follow-up migration — recorded here; no consumer depends on it yet. |
| R2-F8 | LOW | Duplicate `trigger` key in mobile-courier booking options. | **Fixed** (dropped). |
| R2-F9 | LOW | Mobile AI pause not rolled back when its audit write failed (silent paused state behind a 503). | **Fixed:** symmetric rollback deletes the pause key on both audit-unavailable paths; test asserts the 503 + `del`. |
| R2-F10 | INFO | Deploy consequence: payment-webhook auto-courier booking stops when `AI_COURIER_BOOKING_ENABLED` renders `'false'` (payment still confirms; dispatch goes manual). | **Documented** in AGENT_ACTION_POLICY §11 deployment note; enabling is a deliberate operator action, not a side effect of the deploy. |

### Round-2 browser sweep (full 19-spec e2e directory, chromium)

111 tests: 22 failed / 83 passed / 6 skipped (live self-skips). Root-caused, not hand-waved:
all 22 sit in 5 legacy spec files (`ai-reply-mode`, `shared-inbox`, `meta-platform`,
`core-app`, `chatbot-journey`) pinning pre-Pilot+ markup, and each failure mode was verified
to reproduce at baseline `baaab983`: the baseline `Dashboard.tsx` renders no `Business Health`
heading (it exists only in unused locale keys), the baseline `UnifiedInbox` mounts the same
`ActionQueuePanel` that crashes on the legacy mocks' `data:[]` actions envelope, and
`/api/inbox/actions` was already fetched at baseline (the "unexpected request" guards predate
the feature). 14 of 19 legacy spec files pass as-is. The candidate battery
(`pilot-plus` + `mwv1-journeys`) is 20/20 on chromium and 20/20 on firefox with
`--workers=1` (parallel runs hit 30s `waitForLoadState` timeouts under machine load —
single-worker is the committed procedure).

The shared-inbox crash did surface one genuine robustness defect (pre-existing, not introduced
here): a malformed actions payload threw inside `ActionQueuePanel` and the error boundary
white-screened the entire inbox. **Hardened at source** (payload shape guards, degrade-not-throw)
with a 4-shape pin in `ActionQueuePanel.test.tsx` (FE now 78 files / 692).

### WebKit status

WebKit-2248 is installed but every test fails at sign-in with a `Not allowed by CORS` banner:
the dev-mode `__Host-` CSRF cookie flow (round-1 F8, flagged pre-existing) behaves differently
under WebKit's strict localhost-not-secure treatment on `http://`. Production serves frontend
and API same-origin behind the proxy, where the cookie and CORS conditions do not arise.
WebKit has never appeared in any green battery record for this repo (round-1 proof listed
chromium+firefox only). Owner follow-up: re-probe WebKit against a same-origin stack; treated
here as a documented environment limitation, not a candidate regression.

### Round-2 verification battery (all on Node 20.20.2)

backend units 317/317 suites, 4271 passed, 2 skipped · integration (disposable Postgres/Redis,
new migration applied) 32/32 suites, 225/225 · meta-e2e 2/2, 48/48 · frontend 78 files, 692/692 ·
tsc 0 · build:all success · battery chromium 20/20 + firefox 20/20 (--workers=1) ·
git diff --check clean.

---

## Round 3 — pilot-release-readiness milestone (owner-directed release engineering)

Not a feature review; results are in doc 06. Material outcomes:

- **Production-shaped migration dry-run found and fixed a real defect:** the round-2 F4
  fix created a second unique index over columns that migration `20260611_001` had already
  uniquely indexed since June (constraint existed in every real catalog; the reviewer's
  "indexed non-unique" premise was inaccurate). `20261026_001` was rewritten as a
  reconciliation migration (drop draft artifact, verify/recreate the canonical
  `idx_orders_shop_idempotency`, keep the loud duplicate refusal, never touch the June
  object on `down`); the Order entity now declares the canonical index name so model↔DB
  state agrees; spec rewritten to pin the reconciled semantics; repeatable gate added as
  `npm run test:backend:migration-dryrun` (6 phases on disposable Postgres, PASS).
- **Feature-flag matrix** (`production-defaults-matrix.test.js`, 7 pins) now covers every
  R2-F1/F2/F10 production-default path, including the previously untested
  webhook-`automation_disabled` and granular per-sub-flag enablement/revocation.
- **Browser reconciliation complete:** 22 → 13 → 0. Root causes fixed at the right layer —
  ActionQueuePanel degrade-not-crash (product), `/api/inbox/actions` mock + allowlist
  (spec), task-first heading copy (spec), AppBar duplicate-`h1` → `<p>` (product,
  semantic; unambiguates the customer-intelligence strict-mode locator). Full chromium
  sweep at the milestone tip: 105 passed / 0 failed / 6 intentional skips; firefox
  battery 20/20 after the layout change.
- Milestone gate battery: backend units **318/318, 4,281 passed, 2 skipped** (paid-Gemini
  env gates, inventoried); integration **32/32, 225/225** on the reconciled chain;
  meta-e2e **48/48**; FE **692/692**; tsc 0; build:all ok; dry-run PASS.
