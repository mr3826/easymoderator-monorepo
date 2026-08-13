# WHOLE_APP_TEST_ARCHITECTURE

Reconciled to `2c628b2` (current `main`) on 2026-08-13.

Two sections, kept strictly apart:

- **Part A — What exists**, verified by running it. Every row here was executed.
- **Part B — What is proposed**, not built. Nothing here protects anything today.

An earlier revision of this file described Part B items in the present tense
under `Status: ACTIVE`, including a `npm run test:prod:smoke` command that does
not exist. See `WHOLE_APP_TEST_SYSTEM_VALIDATION.md` §2.1. If you are about to
add a row, put it in Part B until it runs in CI.

---

# Part A — What exists

## Tiers actually in use

| Tier | Suite | DB | Redis | Queue | External | CI |
|---|---|---|---|---|---|---|
| T0 unit | `npm test` (128 suites, 1557 tests) | none — queue stubbed via `jest.config.js:50` | none | stubbed | mocked | **required** |
| T0/T1 security | `npm run test:security` (24 suites, 156 tests) | none | none | stubbed | mocked | **required** |
| T1 migration | inside `npm test` | real Postgres, real `up`/`down` | — | — | — | **required** |
| T2 Meta-shaped E2E | `npm run test:meta:e2e` (34 tests) | **real Postgres** (disposable, name-guarded) | **real Redis** | **real BullMQ + worker** | Graph API + LLM captured | **required** |
| T3 browser | `EasyMod-frontend`: 58 vitest files | — | — | — | — | **required** (unit only) |
| T4 external live | `npm run test:meta:live` | production | production | production | **real Meta** | manual only — correct |

## The required CI graph

`.github/workflows/ci-cd.yml`. A failing gate blocks deploy, because
`build` declares `needs: [changes, test, meta-e2e]` and `deploy` needs `build`.

```
changes ─┬─> test      (backend npm test + test:security, frontend build + vitest)
         └─> meta-e2e  (Postgres 16 + Redis 7 service containers)
                          └─> build ──> deploy (main only)
```

## Destructive-execution guard

`tests/meta-e2e/fixtures.js:105`. The database name must match `/e2e|test/i` or
the suite refuses to start. It does **not** rely on `NODE_ENV`, which is the
right call — `NODE_ENV=test` is trivially set against a production URL.

```js
if (!/e2e|test/i.test(name)) throw new Error(`meta-e2e refuses to run against database "${name}"`);
```

## Schema construction

The E2E suite builds schema the way production does, in production order:
migration chain first (`migrate.js` in a child process, because it is a CLI),
then `sequelize.sync()` for the entity graph. `sync()` supplements migrations;
it never substitutes for them.

## External boundaries in CI

```
EasyModerator → Meta Graph API   → CAPTURED (tests/meta-e2e/transport.js)
              → LLM providers    → CAPTURED
              → Qdrant           → DISABLED (env.js deletes QDRANT_URL)
              → bKash            → not exercised
              → couriers         → not exercised
              → Resend/Slack/TG  → not exercised
```

Real Meta transport is reachable only through `npm run test:meta:live`, which is
never invoked by CI.

## Known exclusions

`jest.config.js` `testPathIgnorePatterns` removes **18 test files** from `npm test`,
covering all orders, all shop, auth lifecycle, 2FA, products, customers, usage
metering and notification controllers. A `grep` for `.skip` finds nothing, because
the exclusion is config, not code. Enumerated in
`WHOLE_APP_TEST_SYSTEM_VALIDATION.md` §25.

Treat `npm test` green as "the 129 included files pass", not "the backend passes".

---

# Part B — Proposed, not built

Nothing below exists. Do not cite any of it as coverage.

| Proposal | Why | Blocked on |
|---|---|---|
| Cross-tenant authorization matrix | Largest P0 gap; merchant-A-vs-B over every domain | nothing — `IDS.shopA`/`shopB` fixtures already exist |
| Re-enable order tests | Idempotency, price freezing, invalid transitions unprotected | the 4 files need a live-DB harness |
| Resolve the 18 exclusions | Config exclusions read as coverage | each needs fixing or an owned quarantine entry |
| Qdrant service container | Retrieval correctness unproven; only degradation is | CI service + deterministic embedding transport |
| Playwright in CI | 9 specs exist, none gated | determinism work |
| Courier / bKash / notification capture suites | External side effects unverified | capture adapter per provider |
| `test:prod:smoke` + `PRODUCTION_SMOKE_RUNBOOK.md` | Documented previously but never written | — |
| Feature registry + coverage gate | Previous attempt could not fail; removed | must assert a test *runs*, not that a row says `active` |

## If you rebuild the coverage gate

The removed one failed for reasons worth not repeating:

- it never exited non-zero, so CI could not fail on it;
- it counted a capability as automated because its row said `status: "active"`;
- it never checked that any test file existed, let alone ran;
- its own totals disagreed with the registry it read.

A gate that cannot go red is a decoration. Bind each capability to a test **id**
that the runner reports as passed, and fail on any active P0 without one.
