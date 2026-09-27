# Pilot Intelligence — Test Evidence

Date: 2026-09-27.

Branch: `feat/pilot-customer-rto-intelligence`, from `main` @ `e876644b`. The
branch had not moved at the time of testing.

Machine: Windows 11, Node 25.6.1 (CI uses Node 20), Docker 29.8.

Disposable services come from the repo's `docker-compose.test.yml`:

- PostgreSQL 16-alpine on `127.0.0.1:55433`, with databases
  `easymod_pilot_integration_test`, `easymod_meta_e2e` and
  `easymod_pilot_perf_test`;
- Redis 7-alpine on `127.0.0.1:56380`.

Statuses are `PASS`, `FAIL`, `PRE-EXISTING`, `NOT RUN` and `NOT CONFIGURED`.
Mock-only layers are labelled as such.

## Results

| Gate | Command | Result |
| --- | --- | --- |
| Migration up / down / up (real PG) | `npm run migrate` → `migrate:down` → `migrate` | **PASS**: the 3 tables and 11 indexes were created, fully removed, then re-created |
| Schema drift (real PG) | `npm run schema:audit` | **PASS**: "No drift found" across 65 models. There is 1 pre-existing non-gating warning (`push_subscriptions.user_id`). |
| Backend security gate | `npm run test:security` | **PASS**: 58 suites, 749 tests (includes the 4 new pilot security files) |
| Backend unit (full) | `npm test` (jest, coverage) | 254 of 255 suites pass; **3,307 of 3,308 tests** pass. The 1 failure is **PRE-EXISTING** (see below). |
| New backend unit tests | pilot files only | **PASS**: 112 tests on Node 20 (container) and on Node 25 |
| Backend integration (real PG + Redis, full suite) | `jest --config jest.integration.config.js` | **PASS**: 26 suites, **188 tests** (includes 38 new pilot tests) |
| Meta-shaped E2E (real signed webhook → receipt → Redis/BullMQ → worker; only the Graph and LLM transports captured) | `jest --config jest.meta-e2e.config.js` | **PASS**: 45 tests: 43 existing and 2 new |
| Backend build | `npm run build` (`node --check server.js`) | **PASS** |
| Frontend typecheck | `tsc --noEmit -p tsconfig.json` (strict) | **PASS** (exit 0) |
| Frontend unit (full) | `vitest run` | **PASS**: 71 files, **603 tests** (includes 24 new) |
| Frontend production build | `npm run build` (vite) | **PASS** (the chunk-size warning is pre-existing) |
| Playwright, new spec (mock-only tier, like the CI browser job) | `playwright test tests/e2e/customer-intelligence.spec.ts` | **PASS**: 7 journeys, including a 375px mobile viewport |
| Playwright, existing CI specs (regression) | `ai-reply-mode`, `shared-inbox`, `signup-terms`, `meta-oauth-contract` | **PASS**: 26 tests |
| Production dependency audit | `npm audit --workspaces --include-workspace-root --omit=dev --audit-level=high` | **PASS**: 0 vulnerabilities |
| Secret scan | pinned Gitleaks v8.28.0 image (CI digest), `dir` mode on every changed tree | **PASS**: no leaks. The git-history mode is run again on the committed branch before push; see §"Pre-push". |
| Whitespace / conflict markers | `git diff --cached --check` | **PASS** |
| Docs link integrity | `node scripts/pr-docs-check.js <changed .md>` | **PASS**; see §"Pre-push" |
| Lint | — | **NOT CONFIGURED**: the repository has no ESLint install or lint script. `.eslintrc-architecture-rules.js` is an unreferenced fragment. |

### Pre-existing failure (not caused by this branch)

- **The failure.** `src/modules/ai/grounding/__tests__/grounding-boundary.test.js`
  › "repeated customer pressure › asking again never converts NOT_FOUND into a
  claim" hits jest's 10s timeout on this machine.
- **Classification.** It failed identically in the baseline run, before any
  pilot service code existed. It mocks the whole entity registry and exercises
  only the AI intent router and grounding.
- **Proof it is environmental.** Under **Node 20 (the CI version) it passes:
  48/48 in 21s** (`node:20-bookworm-slim` container). It is a Node 25/Windows
  timing issue, not a regression.

### Environment-only note

In the Node 20 container, `order.controller.confidence-hold.test.js` cannot
*load*: `sqlite3` reports "invalid ELF header" because the mounted
`node_modules` was installed on Windows. Its tests pass on the host, and CI
installs its own Linux `node_modules`.

## Acceptance scenarios

Every scenario below is **PASS**.

| # | Scenario | Test |
| --- | --- | --- |
| 1 | Messenger participant → exactly one customer under webhook replay | Meta E2E `customer-intelligence.test.js` "one customer under webhook replay…" (same `mid` posted twice through the signed route) |
| 2 | Shop isolation: the same PSID on another merchant's Page is a different customer; another shop's ids return 404 | Meta E2E (Page B customer is distinct); integration "another shop's customer and opportunity ids return 404"; "another shop cannot read, verify or approve an order" |
| 3 | Customer detail reflects that shop's conversations, orders and courier outcomes | Integration "list and detail reflect this shop's orders, outcomes, timeline and opportunities" |
| 4 | Repeat customer | The same test: 2 deliveries give `REPEAT_BUYER`, delivered value 3000 |
| 5 | A high-intent conversation that stops becomes one explainable OPEN opportunity; re-runs and overlapping instances never duplicate | Integration "…one explainable OPEN opportunity, idempotently" (3 concurrent detector runs); Meta E2E |
| 6 | A subsequent order converts it idempotently | Integration "converts the opportunity immediately and exactly once", "real order-creation path converts through its post-commit hook", "unlinked phone order converts through the sweep"; Meta E2E |
| 7 | No follow-up message is sent when policy denies it | Meta E2E "a follow-up to a customer who opted out is denied by the central policy engine and never sent" (0 captured Graph sends, and a `policy_decisions` deny row); the detector produces 0 sends; the boundary test forbids send imports |
| 8 | RTO READY books exactly once | Integration "a READY order books exactly once under concurrent booking requests" (5 concurrent `bookForOrder`, 1 provider call, 1 `courier_dispatch` row) |
| 9 | RTO VERIFY: no automatic booking before verification | Integration "automatic booking is held without a claim or provider call, and verification releases it"; Playwright journeys 7–8 |
| 10 | RTO MANUAL_REVIEW: paused until an authorised decision | Integration "needs owner/admin approval: staff get 403, verify is refused…"; Playwright journey 9 (staff and owner) |
| 11 | Override audit: who, when, why, what changed | Same integration test asserts the `audit_logs` row: `user_id`, old decision, note, fingerprint, versions |
| 12 | A material order change after approval re-holds the order | Integration "a material edit after approval voids it and the order is held again" (`RESOLUTION_STALE`) |
| 13 | Retry race: no duplicate parcels | Integration "provider timeout leaves an INDETERMINATE claim and a retry never books a second parcel", "after a successful booking, later order updates never cause a second booking", "two concurrent approvals… exactly one wins" |
| 14 | The delivery outcome is associated with the order-confidence decision | Integration "a delivered outcome is recorded once even when the courier webhook is replayed concurrently" (the first terminal outcome wins over a later `returned`) |

Additional failure and robustness coverage, all **PASS** on real PostgreSQL:

- cancelled after approval: never booked, and re-approval gives 409;
- shadow mode never blocks but records a would-hold;
- `off` writes nothing;
- evidence-only changes do not bump the decision version;
- concurrent evaluations converge;
- the database refuses a second live opportunity;
- the quiet period, a single question, explicit cancel, negation and opt-out
  create no opportunity;
- a dismissed opportunity does not come back without new intent;
- expiry after 7 days;
- merchant action state conflict gives 409;
- the tamper test: a shop member cannot change flags through
  `PATCH /shop/:id`;
- SUPER_ADMIN-only flag changes are audited;
- the global kill switch;
- unauthenticated requests get 401; malformed and unknown fields get 400.

## Representative scale (real PG, seeded)

The seeded shop had 3,000 customers, 12,000 orders, 400 conversations and
1,200 messages, and the tables were ANALYZEd. Figures are medians of 5 runs
(3 for the detector), on the same laptop.

| Path | Median |
| --- | --- |
| Customers list page (20) | 52 ms |
| Customers search by full phone | 23 ms |
| Customer detail | 43 ms |
| Order-confidence evaluate + persist (gate core) | 24 ms |
| Opportunity detector, 400 conversations | 237 ms |

`EXPLAIN ANALYZE` of the order-history lookup
`(customer_id = ? OR customer_phone IN (3 variants))` gives a BitmapOr of
`idx_orders_customer` and the new **`idx_orders_shop_customer_phone`**, with an
execution time of 1.7 ms.

## What each layer does and does not prove

- **Real-provider courier booking was not exercised.** The courier provider is
  a controlled fixture (`deliveryService.createDeliveryOrder` stubbed) in the
  integration suite. That is deliberate: no real parcel may be booked in tests.
  The provider adapters themselves are unchanged by this branch.
- **The Playwright tier is mock-only**, matching the CI browser job. It proves
  what the merchant sees, the requests each action sends, and how the UI reacts
  to 409 holds and conflicts. Server behaviour is proven by the integration and
  Meta E2E rows above, not by Playwright.
- **Real Meta was not exercised.** The Meta E2E captures the Graph transport,
  and the pilot adds no Meta API calls.
- **Bangla UI strings and the classifier's Bangla literals have no native QA**,
  consistent with the repo's existing `PENDING_BANGLA_LANGUAGE_QA_LITERALS`
  note.

## Plan divergences

These are recorded against [01-plan.md](01-plan.md):

1. **A material versus evidence-only version rule was added.** PostgreSQL
   integration showed that the JSONB key reordering made every read look like a
   change. The fix was canonical comparison. A second rule was then added:
   evidence-only changes, such as a network count, do not bump
   `decision_version`, so a merchant's approval is not invalidated by numbers
   that moved.
2. **Gate bookkeeping does not bump the version.** An automatic retry must not
   invalidate an approval in progress.
3. **`?orderId=` deep link on Orders and `?conversation=` deep link on the
   Inbox were added.** They are needed for the notification and follow-up
   paths. The existing NEW_ORDER notification link also works now.
4. **The Customers page keeps the legacy view** for non-pilot shops. It gains a
   field-mapping fix (`phone`/`channel_type` were rendered as "—"). The legacy
   page's broken block-list toggle, which calls non-existent
   `/customer/:id/blacklist` endpoints, is pre-existing and left as is (tech
   debt §11.3 in [00-current-state.md](00-current-state.md)).

## Pre-push

The following run on the committed branch. Their results are recorded in the
pull request description and in the final execution report:

- the Gitleaks git-history scan, exactly as CI runs it;
- `pr-docs-check`;
- the commit list.
