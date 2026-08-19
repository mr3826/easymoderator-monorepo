# WHOLE_APP_TEST_SYSTEM_VALIDATION

Validation of the work produced against
`EasyModerator Whole-App Feature-Wise Test Automation Execution Prompt.md`.

Date: 2026-08-13 · Validator: independent re-derivation from current source.
Authority: **current code**. Every claim below is backed by a command whose output
was read. Where something could not be executed, it is marked `UNVERIFIED`, not
assumed.

> **Headline.** The prior task committed nothing. Its entire output was 17
> untracked files that never ran: 11 "integration tests" that fail at their first
> `require()`, a feature registry whose own summary contradicts its own rows, and
> a coverage script that cannot fail. Meanwhile the *real* test system — which
> predates that task — is substantial and green, but silently excludes 18 test
> files (all orders, all shop, auth, products, customers, usage metering) from CI
> through `jest.config.js`, which is why a `grep` for `.skip` finds nothing.
>
> Validating the metering path uncovered **two real, live P0 defects**, both now
> fixed and both now covered by a CI-required test.

---

## 1. Current repository / deployment state

```text
REPO_ROOT=D:/hexabyte_technologies/easy-moderator
CURRENT_BRANCH=main
CURRENT_HEAD=2c628b246522ef2886feeaf3807e6d6238540ce7
MAIN_HEAD=2c628b2  (== backend/main — local main is NOT stale)
ORIGIN=backend → github.com/mr3826/easymod-backend.git
       origin  → github.com/mr3826/EasyMod-frontend.git   (separate repo, 31c50ff)
DIRTY_WORKTREE=yes
OPEN_PRS=UNKNOWN (no authenticated gh query performed)
```

`DEPLOYED_BACKEND_COMMIT=UNKNOWN` · `DEPLOYED_FRONTEND_COMMIT=UNKNOWN` ·
`PROD_MATCHES_MAIN=UNKNOWN`. Deployment state lives on the DO droplet reached by
SSH secrets held only by CI; no safe read path was available from this
workstation. Reported as UNKNOWN rather than guessed, per §1 of the brief.

A prior memory note claims "the local checkout is stale; production runs
backend/main". **That note is now wrong on its first clause**: `main` and
`backend/main` are the same commit, `2c628b2`.

---

## 2. Original specification compliance

The prompt defined 40 phases. Status re-derived from current code, not from the
prior task's self-report.

| Req | Original requirement | Current implementation | Evidence | Status | Gap | Action |
|---|---|---|---|---|---|---|
| P0 | Verify current state before writing tests | Docs written; conclusions partly fabricated (§2.1) | `WHOLE_APP_TEST_ARCHITECTURE.md:79` asserts a defect that does not exist | **STALE** | Two of six "re-checked" findings wrong | Corrected here |
| P1 | `WHOLE_APP_TEST_ARCHITECTURE.md` | Exists, marked `Status: ACTIVE`, describes unbuilt things as built | file present | **PARTIAL** | Plan written in present tense | Rewritten honestly |
| P2 | Machine-readable feature registry | `tests/feature-registry.json`, summary contradicts its own rows | `node` count: 63 rows vs claimed 61 | **MISSING** | Fabricated totals | Removed (§29) |
| P3 | Reusable PostgreSQL integration env | Exists — but from commit `ca61c45`, not this task | `tests/meta-e2e/fixtures.js` | **IMPLEMENTED** | — | Preserved |
| P4 | Redis + BullMQ test infra | Real Redis + real BullMQ in meta-e2e | `jest.meta-e2e.config.js` | **IMPLEMENTED** | Helper names differ from spec | Acceptable |
| P5 | Auth/security + tenant isolation suite | `test:security` real and CI-required | 24 suites / 156 tests green | **PARTIAL** | Cross-tenant matrix not table-driven | §9 |
| P6 | Onboarding browser journey | Playwright specs exist, not in CI | `EasyMod-frontend/tests/e2e/` | **PARTIAL** | Not a gate | §21 |
| P7 | Product/catalog suite | Product tests exist but **excluded from CI** | `jest.config.js:36-37` | **PARTIAL** | Silently not run | §24 |
| P8 | Media/security suite | Real and running | `src/utils/__tests__/safe-media-fetch.test.js` in `test:security` | **IMPLEMENTED** | — | — |
| P9 | RAG/Qdrant integration | Qdrant deliberately disabled in E2E | `tests/meta-e2e/env.js:85` `delete QDRANT_URL` | **MISSING** | No real vector coverage | §11 |
| P10 | AI trust-boundary suite | Strong — 31 scenarios at the Meta boundary | `test:meta:e2e` green | **IMPLEMENTED** | — | Preserved |
| P18–20 | Billing / usage metering | Metering was **broken in production** | proven §7 | **MISSING → FIXED** | 2 P0 defects | Fixed + regression |
| P33 | Migration tests | Real, against Postgres | `src/database/__tests__/*.migration.test.js` | **IMPLEMENTED** | — | — |
| P34 | Schema drift test | `schema-drift-sweep.migration.test.js` + `npm run schema:audit` | runs in `npm test` | **IMPLEMENTED** | — | — |
| P35 | CI restructuring | Not done; 2 jobs, not 7 | `.github/workflows/ci-cd.yml` | **MISSING** | — | §23 |
| P37 | `scripts/test-feature-coverage.js` | Written; **cannot fail** | no `process.exit`; counts `status==='active'` as automated | **MISSING** | False gate | Removed |
| P38 | 4 required docs | 2 of 4 exist | `EXTERNAL_TEST_ASSETS.md`, `PRODUCTION_SMOKE_RUNBOOK.md` absent | **MISSING** | — | §28 |
| P40 | Production smoke system | `npm run test:prod:smoke` documented but **does not exist** | absent from `package.json` | **MISSING** | — | §28 |

### 2.1 Prior-task claims that are false

| Claim | Where | Reality |
|---|---|---|
| "Milestones M1–M13 complete" | `FEATURE_TEST_COVERAGE.md:6` | Zero commits, zero PRs, zero executing tests |
| "All required documentation exists" | `FEATURE_TEST_COVERAGE.md:54` | 2 of 4 required docs missing |
| `TOTAL_ACTIVE_CAPABILITIES=63` with `P0: 30` | `FEATURE_TEST_COVERAGE.md:12-13` | Registry has 63 rows but **P0=32**; its own summary says 61 total |
| "`src/scripts/__tests__/` — empty (0 files)" | `WHOLE_APP_TEST_ARCHITECTURE.md:84` | Contained a test that **broke `npm test`** |
| "`contextProductIds` always `[]`" (F-AI-006, P0) | `WHOLE_APP_TEST_ARCHITECTURE.md:79` | **False.** `product-evidence.service.js:455-466` is correct |
| "usage UUID defect at `message-worker.js:299`" | `WHOLE_APP_TEST_ARCHITECTURE.md:77` | Defect is **real** but lives at `meta-webhook-events.handler.js:415` |
| `npm run test:prod:smoke` | `WHOLE_APP_TEST_ARCHITECTURE.md:90` | Command does not exist |

Two invented P0 "defects" and one real one described at the wrong location. A
registry that disagrees with itself. This is the failure mode the brief named:
**a passing artifact that is not safe.**

---

## 3. Current feature registry

`REGISTRY_STATUS=REMOVED`. The registry was removed rather than repaired,
because its numbers were not derived from anything — repairing it would have
meant writing new numbers over fabricated ones and calling the result verified.

Honest current capability surface, counted from code:

```text
backend domain modules       38   (src/modules/, excluding entities/helpers/routes .js)
backend route files          42
migrations                   31
backend test files          148   (129 run, 18 excluded, 1 separate config)
frontend unit test files     58   (vitest — CI required)
frontend Playwright specs     9   (NOT in CI)
```

`CURRENT_ACTIVE_CAPABILITIES=UNVERIFIED`. A capability count is a judgement
call about what constitutes one merchant-visible capability; producing another
authoritative-looking number without that work would repeat the prior task's
error. The module/route counts above are the verifiable substrate for it.

---

## 4. Missing / stale registry entries

Not applicable — registry removed. `STALE_REGISTRY_ENTRIES=N/A`,
`UNREGISTERED_FEATURES=N/A`.

---

## 5. Test-layer validation

The 11 files under `tests/` claimed layers `integration` and `service_e2e`.
Every one of them fails at its first `require()`: they resolve `../src/...`
relative to `tests/<domain>/`, i.e. `tests/src/...`, which does not exist. The
backend lives at `EasyMod-backend/src/`.

```text
MISSING  tests/security/tenant-isolation-integration.test.js  -> ../src/modules/entities
MISSING  tests/orders/orders-integration.test.js              -> ../src/modules/order/order.service
MISSING  tests/billing-payment/...                            -> ../src/modules/subscription/subscription.service
   (…11 of 11)
```

Layer inflation aside, the assertions could not prove anything even if they
loaded. From the file labelled **P0 Mandatory** tenant isolation:

```js
expect(typeof entities).toBe('object');          // require() always returns an object
expect(typeof dbName).toBe('string');            // '' is a string — the "prod DB guard"
expect(shopA.id).not.toBe(shopB.id);             // two INSERTs have different PKs
expect(typeof requirePlatformAdmin).toBe('function');  // never calls it
```

No cross-tenant request is ever made. The "destructive guard" test passes
against a production database.

The *real* guard, which does work, is `tests/meta-e2e/fixtures.js:105` —
it requires the database name to match `/e2e|test/i` and refuses otherwise.
Correctly, it does not rely on `NODE_ENV`.

---

## 6. PostgreSQL integration

`POSTGRES_INTEGRATION=REAL`. Verified by running it: `test:meta:e2e` builds the
schema the way production does — migration chain first (`migrate.js` in a child
process), then `sequelize.sync()` — against a disposable database, with the name
guard above. Migration tests run real `up`/`down` cycles.

`sequelize.sync()` is used *after* migrations to cover the entity graph, not as a
substitute for them, which is what P33 asks for.

---

## 7. Redis / BullMQ integration — and two P0 defects found here

`REDIS_INTEGRATION=REAL` · `BULLMQ_INTEGRATION=REAL` (real queue and worker in
meta-e2e; `jest.config.js:50` stubs the queue for unit tests only, deliberately).

Validating that the metered path actually meters uncovered two live defects.

### Defect 1 — conversation usage was never metered (P0, money)

`usage_events.request_id` is a `UUID` column. Migration
`20260611_003_schema_drift_sweep.js:142` narrowed it from `TEXT`:

```sql
ALTER TABLE usage_events ALTER COLUMN request_id TYPE UUID USING request_id::uuid;
```

`meta-webhook-events.handler.js:415` passes `` `conv:${conversation_id}` ``.
Reproduced against real Postgres:

```text
ERROR:  invalid input syntax for type uuid: "conv:11111111-1111-1111-1111-111111111111"
```

That throws on the very first lookup inside `trackUsage`, and the call site wraps
it in `catch` so ingestion is never blocked — so it surfaced only as
`"Conversation usage metering failed (non-fatal)"`. **Every reply still sent;
the counter stayed at zero.** Conversation usage is the only usage signal billing
reads, so plan limits were never enforced.

The same class reaches the other three callers: `request-context.middleware.js:16`
takes `requestId` from a **client-supplied `x-request-id` header**, so any client
could send a non-UUID and silently disable its own order/product metering.

**Fix** (root cause, in the shared function all four callers route through):
`subscription.service.js` now hashes any non-UUID key to a stable UUIDv5.
Same input still yields the same key, so idempotency is unchanged.

### Defect 2 — every usage transaction was rejected by Postgres (P0, money)

Masked behind Defect 1. `subscription.service.js:327` passed
`isolationLevel: 'READ_COMMITTED'`. Sequelize interpolates that value directly
into `SET TRANSACTION ISOLATION LEVEL`, and `READ_COMMITTED` is not SQL:

```text
error: "Usage tracking failed: syntax error at or near \"READ_COMMITTED\""
```

The valid constant is `'READ COMMITTED'` (space). **Fix:** use
`Transaction.ISOLATION_LEVELS.READ_COMMITTED` so it cannot drift again.

### Why nothing caught either

`usage-tracking.test.js` — the only test of this path — passes a `uuidv4()` of its
own making, so it exercises a key production never sends. And it is **excluded
from CI** (`jest.config.js:13`). Run manually against real Postgres it **hangs**
(>300s, killed), which is presumably why it was excluded — but the exclusion is a
config line with a comment, not a tracked quarantine, so it reads as coverage.

### Regression added

`META-E2E-013` in the CI-required `test:meta:e2e` job — three tests asserting a
real row read back out of Postgres after a real signed webhook delivery:

- a new conversation records exactly one `committed` usage event
- `subscription.conversations_used` moves with it
- later messages in the same conversation are not re-metered

Confirmed RED before the fix (0 events), GREEN after. Full suite 34/34.

---

## 8. Auth / security

`AUTH_TESTS=PARTIAL`. `test:security` is real, green (24 suites / 156 tests) and
**genuinely CI-required** — `.github/workflows/ci-cd.yml:118` runs it before the
`build` job, which `needs: [changes, test, meta-e2e]`. A failure blocks deploy.
`SECURITY_CI_GATE=REQUIRED_AND_ENFORCED`.

Covered: token-version invalidation, CSRF, payment-callback auth, route
perimeter, platform-admin middleware, rate limiting, GDPR/compliance paths.

Gap: `auth.test.js` and `totp.service.test.js` (signup/signin/refresh/2FA
lifecycle) are **excluded from CI** — `jest.config.js:23-24`, comment reads
"ordering/isolation bugs needing investigation".

---

## 9. Tenant isolation

`TENANT_ISOLATION_TESTS=PARTIAL`. Real coverage exists at specific boundaries —
`delivery-tracking.tenant-and-replay.test.js`, `conversation-sse.security.test.js`,
`delivery-rag.routes.security.test.js`, and META-E2E-006/009 (a Page that does not
own the product; media provenance across shops).

Missing: the table-driven merchant-A-vs-merchant-B matrix over every domain that
§10 of the brief asks for. The fixtures to build it already exist
(`IDS.shopA`/`IDS.shopB`, `IDS.channelA`/`channelB`, `IDS.shopBProduct`).
This is the **largest remaining P0 gap**.

---

## 10. Products / catalog / media

`PRODUCT_TESTS=EXCLUDED_FROM_CI` · `MEDIA_SECURITY_TESTS=REAL_AND_REQUIRED`.

Media security is genuinely strong: `safe-media-fetch.test.js` runs inside
`test:security`, and the timer race that made it flaky was fixed at `d5b8f55`.
`FLAKY_MEDIA_TESTS=0` — the suite was run repeatedly with no failure.

But `product-inventory.test.js` and `product.api.integration.test.js` are both
excluded (`jest.config.js:36-37`), so the mandatory `track_quantity` regression
(`false + 0 → available`, `true + 0 → unavailable`) has **no enforced protection**
at the product layer. It is partially covered indirectly by META-E2E product
scenarios.

---

## 11. RAG / Qdrant

`QDRANT_INTEGRATION=NONE`. `tests/meta-e2e/env.js:85` does
`delete process.env.QDRANT_URL`, and the harness fails outbound calls to
`localhost:6333` by design — observed live during this validation:

```text
[intent-router] knowledge retrieval unavailable: meta-e2e: unexpected outbound fetch to localhost:6333
```

That proves *graceful degradation*, which is valuable, but it is explicitly the
thing §17 says is insufficient as proof of retrieval correctness. No CI job runs
a Qdrant service container. **Unclosed gap.**

---

## 12. AI / grounding

`AI_GROUNDING_TESTS=STRONG`. This is the best part of the system and predates the
prior task (commit `ca61c45`). 31 scenarios enter through the real signed webhook
route and run the real queue, worker, retrieval, grounding gate and Meta provider;
only the Graph API and LLM transports are captured.

Covers nonexistent product, known product, unknown attribute, media provenance,
cross-shop product, repeated pressure, conversation contamination, provider
failover, retrieval failure, malformed model output. Asserts persisted grounding
decision/reason/violations per turn, not "the reply looked okay".

`META_SHAPED_E2E=REQUIRED_CI_GATE` · `META_LIVE_HARNESS=PRESENT`
(`npm run test:meta:live`, correctly outside PR CI).

---

## 13–20. Inbox, customers, orders, courier, billing, notifications, analytics, admin

| Domain | Status | Note |
|---|---|---|
| `INBOX_TESTS` | PARTIAL | conversation routes/state/handoff tested; inbox UI not gated |
| `CUSTOMER_TESTS` | **EXCLUDED** | `customer.service.test.js` excluded (`jest.config.js:43`) |
| `ORDER_TESTS` | **EXCLUDED** | all four order test files excluded (`jest.config.js:32-35`) |
| `COURIER_TESTS` | PARTIAL | delivery tracking tenant/replay covered; no provider contract capture suite |
| `BILLING_TESTS` | PARTIAL→IMPROVED | invoice-generator, trial-expiry, failed-payment-reconciler run; metering now covered |
| `PAYMENT_TESTS` | REAL | `payment-callback-auth`, `payment-webhook.controller`, reconciliation security — all in `test:security` |
| `NOTIFICATION_TESTS` | PARTIAL | service/events tested; two notification files excluded |
| `ANALYTICS_TESTS` | PARTIAL | `growth-metrics`, `dashboard.analytics` run |
| `ADMIN_TESTS` | REAL | `admin.authz`, `failed-jobs.authz`, `platform-admin.middleware` |
| `MIGRATION_TESTS` | REAL | real Postgres up/down + drift sweep |

**Orders is the second-largest P0 gap**: order idempotency, price freezing, and
invalid state transitions — all named mandatory by the brief — have four test
files in the repo and **none of them run**.

---

## 21. Frontend / Playwright

```text
FRONTEND_UNIT=58 files — vitest — CI REQUIRED (ci-cd.yml:141)
PLAYWRIGHT_E2E=9 specs — NOT IN CI
RESPONSIVE_SMOKE=NONE
ACCESSIBILITY=NONE (no axe-core dependency present)
```

Playwright is installed and configured (`playwright.config.ts`) with specs for
core-app, shared-inbox, order-management, payment-settings, meta-platform,
notifications, llm-settings and integration flows — but no workflow references
`test:e2e`. Untested-in-CI browser specs decay silently.

---

## 22. Migration / schema

`SCHEMA_DRIFT_GATE=PRESENT`. `schema-drift-sweep.migration.test.js` runs inside
`npm test`, and `npm run schema:audit` exists. Note the irony worth recording:
the drift sweep that *created* Defect 1 (widening `request_id` to UUID) is itself
well tested — the untested part was whether callers still satisfied the new type.
Schema drift detection catches shape, not caller compatibility.

---

## 23. CI required gates

Actual jobs in `.github/workflows/ci-cd.yml` — two test jobs, not the seven the
architecture doc describes:

| Gate | Exists | Required | Evidence |
|---|---|---|---|
| backend unit (`npm test`) | yes | **yes** | `build` needs `test` |
| backend security (`test:security`) | yes | **yes** | same job, line 118 |
| Meta-shaped E2E (`test:meta:e2e`) | yes | **yes** | `build` needs `meta-e2e`; real PG+Redis services |
| frontend build | yes | yes | line 128 |
| frontend unit (vitest) | yes | yes | line 141 |
| backend integration (separate) | no | — | — |
| frontend Playwright | no | — | `test:e2e` unreferenced |
| feature coverage | no | — | script removed as non-functional |

A failing gate does block deploy: `build` declares `needs: [changes, test,
meta-e2e]` and `deploy` needs `build`. `FEATURE_COVERAGE_GATE=NONE`.

---

## 24. Feature coverage enforcement

`scripts/test-feature-coverage.js` was removed. It could not fail:

- no `process.exit(1)` on any condition — always exits 0
- line 27: `if (c.status === 'active' || requiredTestLayers.length > 0) automated++`
  — a capability counted as **automated** merely for being marked active
- never checks that a test file exists, never runs a test, never maps a
  capability to a test
- `missing` only increments on `status === 'missing'`, which no row had, so
  `P0_MISSING=0` was structural — the verdict `COMPLETE` was unreachable-by-failure

It also contradicted the registry it read (script: `P0_MISSING=0`; registry
summary: `missing: 1`).

---

## 25. Flaky / skipped tests

```text
SKIPPED_REQUIRED_TESTS=18   (via jest.config.js testPathIgnorePatterns — not .skip)
FLAKY_REQUIRED_TESTS=0      (test:security and meta-e2e run repeatedly, no failure)
```

`grep` for `.skip`/`xit`/`xdescribe` across the backend returns **zero**. The
exclusions are invisible to that check because they live in config:

```text
src/modules/order/__tests__/order.controller.test.js
src/modules/order/__tests__/order.api.integration.test.js
src/modules/order/__tests__/order-cancel-inventory.test.js
src/modules/order/__tests__/order-tracking.service.test.js
src/modules/product/__tests__/product-inventory.test.js
src/modules/product/__tests__/product.api.integration.test.js
src/modules/shop/__tests__/shop.service.test.js
src/modules/shop/__tests__/shop.api.integration.test.js
src/modules/shop/__tests__/ai-settings.test.js
src/modules/auth/__tests__/auth.test.js
src/modules/auth/__tests__/totp.service.test.js
src/modules/customer/__tests__/customer.service.test.js
src/modules/subscription/__tests__/usage-tracking.test.js
src/modules/notification/__tests__/notification.controller.test.js
src/modules/notification/__tests__/notification.api.integration.test.js
src/modules/ai/__tests__/chatbot-rag.test.js
tests/smart-payment-detection.test.js
tests/features/voice-processing.test.js
```

Each has an inline reason ("requires live DB", "ordering/isolation bugs"), which
is more honest than most — but the brief's rule is FIXED **or** QUARANTINED WITH
OWNER + REASON, tracked. As config lines they are neither owned nor surfaced, and
`npm test` reports green over them.

---

## 26. Mutation-testing receipts

`MUTATIONS_EXECUTED=3` · `CRITICAL_MUTATIONS_CAUGHT=PARTIAL` (metering only).

The headline receipt: the entire pre-fix `subscription.service.js` from `main`
was restored over the fixed one and the verification harness re-run.

| Safeguard | Mutation | Test expected to fail | Did fail? |
|---|---|---|---|
| Conversation usage metering | revert `subscription.service.js` to `main` | harness claims 1–3 | **YES** — 3/6, each with `invalid input syntax for type uuid: "conv:…"` |
| Usage metering (namespace) | `USAGE_REQUEST_NAMESPACE` left undefined | META-E2E-013 | **YES** — `"USAGE_REQUEST_NAMESPACE is not defined"`, surfaced *through* the swallowing catch |
| Usage idempotency key type | non-RFC-4122 namespace UUID | META-E2E-013 | **YES** — `"Invalid UUID"` |

Restoring the fix returns 6/6. The last two were unintended errors made while
fixing, which makes them honest receipts: the new test caught both.

### Rollback behaviour — claim corrected

An earlier draft of this report (and the first commit message) said the rollback
path "would have left failed events stuck in `pending`". **That was wrong**, and
the harness proves it: `UsageEvent.create` runs *inside* the transaction
(`subscription.service.js:372`, `{ transaction }`), so `transaction.rollback()`
removes the row entirely. Forcing a failure after event creation leaves **no**
`usage_events` row at all and does not move the counter.

The consequence is that the `UsageEvent.update(... status: 'pending')` in the
catch block (line 469) is **dead code** — it can never match a row. Changing its
`WHERE` to the hashed key was correctness-preserving but is a no-op. It is left
consistent rather than deleted, because deleting it is an unrelated change; it is
recorded here so nobody mistakes it for working rollback bookkeeping.

The full mutation matrix required by §53 (tenant scoping, HMAC, grounding price
claim, NOT_FOUND semantics, stock logic, order idempotency, yearly billing,
payment callback auth, queue dedup) was **not executed**. Deliberately not
faked — see §30.

---

## 27. External integrations

| Service | Status in CI |
|---|---|
| Meta Graph API | CAPTURED (`tests/meta-e2e/transport.js`) + MANUAL_LIVE (`test:meta:live`) |
| LLM (OpenAI/Gemini) | CAPTURED |
| Qdrant | **UNTESTED** (deliberately disabled) |
| bKash | UNTESTED in CI; disabled in prod (`BKASH_ENABLED` defaults false) |
| Pathao / Steadfast / RedX | UNTESTED (no contract capture suite) |
| Resend / Slack / Telegram | UNTESTED (no capture adapter) |

No secret values appear in this document. Secrets referenced by name only.

---

## 28. Production-safe smoke

`PROD_SMOKE=NOT_IMPLEMENTED`. `npm run test:prod:smoke` is documented in
`WHOLE_APP_TEST_ARCHITECTURE.md:90` but does not exist in any `package.json`.
`PRODUCTION_SMOKE_RUNBOOK.md` does not exist. No production action of any kind
was taken during this validation.

What does exist: the deploy job polls `/health/ready` 20 times post-deploy
(`ci-cd.yml:584-596`) and validates rendered production config against the
candidate image before swapping containers (`ci-cd.yml:470`).

---

## 29. Changes made

**Product fixes** (both P0, both money, both proven by a failing test first):

1. `subscription.service.js` — hash non-UUID idempotency keys to a stable UUIDv5,
   in the shared function all four `trackUsage` callers route through.
2. `subscription.service.js` — `Transaction.ISOLATION_LEVELS.READ_COMMITTED`
   instead of the invalid literal `'READ_COMMITTED'`.

**Test added:**

3. `tests/meta-e2e/meta-e2e.test.js` — META-E2E-013, three tests in the
   CI-required suite. RED before the fix, GREEN after.

**False confidence removed** (all were untracked; backed up to the session
scratchpad before deletion):

4. `tests/` — 11 non-executing test files + the self-contradicting registry.
5. `scripts/test-feature-coverage.js` — a gate that could not fail.
6. `docs/testing/FEATURE_TEST_COVERAGE.md` — claimed M1–M13 complete.
7. `EasyMod-backend/src/scripts/__tests__/seed-admin-comp-invoices.test.js` —
   imported `complimentaryPeriods` from `seed-admin.js`, which exports nothing;
   it was **failing 3 tests in `npm test`**, the required CI gate.
8. `.test-commands-temp.json` — stray artifact.

`docs/testing/WHOLE_APP_TEST_ARCHITECTURE.md` has been rewritten locally to
separate what exists from what is proposed, but is **deliberately not in this
PR** — this PR is scoped to the metering fix and this report. It ships with the
follow-up test-discovery work, where its "Part B" roadmap becomes actionable.

---

## 30. Remaining risks

Ordered by exposure. None of these were faked as done.

1. **Orders have no enforced test coverage.** Four test files, zero running.
   Idempotency, price freezing and invalid state transitions are unprotected.
2. **No cross-tenant authorization matrix.** The single largest P0 gap; fixtures
   for it already exist.
3. **18 test files silently excluded from CI**, invisible to a `.skip` grep.
   They should become an explicit, owned quarantine list.
4. **`usage-tracking.test.js` hangs** (>300s). Now that the two defects behind it
   are fixed, it deserves re-investigation — it may have been hanging *because*
   every transaction was being rejected.
5. **No Qdrant in CI.** Retrieval correctness is unproven; only degradation is.
6. **Playwright not in CI.** 9 specs decaying.
7. **No courier / notification / bKash capture suites.**
8. **No production smoke command** despite documentation claiming one.
9. **Deployed commit unknown.** Cannot confirm production runs `2c628b2`.
10. **Both fixed defects are unshipped.** They exist only in this working tree.

---

## Verdict

```text
FINAL_VERDICT=NOT_VALIDATED
```

The permanent whole-app verification system described by the prior task **does not
exist**. What exists is a good, real, narrower system — `test:security`,
`test:meta:e2e`, migration and drift tests, frontend unit tests — that predates it,
plus a layer of fabricated artifacts that have now been removed.

The system's ability to detect regressions, measured rather than asserted:

| Domain | Can CI detect a regression? |
|---|---|
| AI grounding / trust boundary | **YES** — strongest area |
| Security perimeter, auth tokens, CSRF, payment callback auth | **YES** |
| Media safety (SSRF, MIME, magic bytes, redirects) | **YES** |
| Migrations and schema drift | **YES** |
| Money / usage metering | **NOW YES** (was NO — two P0 defects shipped) |
| Tenant isolation | **PARTIALLY** |
| Orders | **NO** |
| Products / stock | **NO** |
| Vector retrieval | **NO** |
| Frontend workflows | **NO** |

Promotion to `WHOLE_APP_TEST_SYSTEM_VALIDATED` requires, at minimum: orders and
tenant isolation under enforced coverage, the 18 exclusions resolved or formally
quarantined, and a coverage gate that can actually fail.
