# 07 — Implementation & Migration Record (Increment 2)

**Worktree:** `D:\easymod\_wt-merchant-workspace-v1-increment2` · **Branch:** `feat/merchant-workspace-v1-increment2`
**Base:** `3d1bc0eb…` (increment-1 tip) · **Candidate (frozen for review):** see §Freeze below.

## Commit ledger (19 commits above base, in order)

| SHA | Phase | What |
|---|---|---|
| `14bd5d92` | 0 | baseline verification + worktree safety (doc 00) |
| `57c5ada3` | 1 | adopt pilot-rto create-time `customer_id` shop-integrity guard (content port) |
| `e7dbfdf5` | 1 | integration rehearsal PARTIAL verdict (doc 01) |
| `436c0770` | 0/2 | capability gap matrix (02) + UX spec (03) |
| `21ebf39f` | 4 | ownership D1-D4 backend (validator force, membership, visibility, audit, single SSE) |
| `2dc0563a` | 3 | order list `customer_id` association filter |
| `17874b96` | 3 | customer-context read contract (doc 04) |
| `79ac85ae` | 5 | staff-private notes vertical slice (migration 003 + service + routes) |
| `1913c813` | 6 | tags vocabulary/assignments (migration 004) + queue views/counts |
| `076e24a4` | 4-6 | ownership + CRM contracts (doc 05) |
| `92d42279` | 6 | queue view chips (FE) |
| `d6b9a7ad` | 3 | CustomerContextPanel core read (FE) |
| `6981cba7` | 4 | ownership lifecycle UI + SSE convergence (FE) |
| `71e2a4af` | 5/6 | notes composer + tag picker (FE) |
| `1e35d6cb` | 7 | policy-blocked explanation + blacklist removal |
| `0b645dc0` | 7 | security/privacy/meta review (doc 06) |
| `0ea22a31` | 8 | real-stack contract repairs (validator allowUnknown query, AppError status, assignment timestamps) + 13-spec integration |
| `1528d4fc` | 8 | deterministic journeys + live walkthrough + conflict-reason surfacing fix |
| `45e89296` | 8 | axe a11y journey + live perf harness |
| `5f2d04ed` | 10 | live founder screenshots + lab reset helper |

## Migrations (additive, reversible)

- `20261025_003_customer_notes` — `customer_notes` (id, shop_id→shops CASCADE,
  customer_id→customers CASCADE, body TEXT CHECK 1..2000, author_id→users SET NULL,
  author_name, created/updated/deleted_at). Index `(shop_id, customer_id,
  created_at DESC)` + partial `(shop_id) WHERE deleted_at IS NULL`. Down: DROP TABLE.
- `20261025_004_customer_tags` — `customer_tag_definitions` (UNIQUE
  `(shop_id, name_lower)`) + `customer_tag_assignments` (UNIQUE `(tag_id,
  customer_id)`). Both CASCADE on shop/customer delete. Down: DROP both.
- No change to `conversations` — `assignee_id`/`resolution_note`/`resolved_at`
  already existed (increment-1/P+03); this increment only exposed + enforced them.

## Real-stack repairs discovered during Phase 8 (commit `0ea22a31`)

Running the new integration spec against real PostgreSQL (not mocks) surfaced three
bugs the unit/mock layers could not:
1. `GET /api/conversation` **rejected** `customer_id` (400 "is not allowed") — the
   module `helpers` validator is unknown-strict for query. Increment 1's FE-08 live
   link was therefore broken over HTTP despite sound service tests. Fixed by typing
   `customer_id: Joi.string().uuid()` in the query schema.
2. notes/tags `fail()` built `AppError(message, statusCode)` but the class stores
   `.status`; controllers read `.statusCode` → every intended 400/403/404 became 500.
   Fixed to set both.
3. `customer_tag_assignments` entity declared default timestamps against a table with
   `created_at` only → first `bulkCreate` threw. Model aligned to migration.

And in `1528d4fc`: the OwnershipBlock read only `response.data.error.message`, but the
httpClient's `normalizeApiError` rewrites errors onto `.message` — so a takeover 409
showed a generic label and the privileged force affordance never appeared for a real
(non-mocked) conflict. Fixed to mirror the thread takeover handler.

## Isolation

- Created worktree + branch from the exact increment-1 SHA; increment-1, Pilot+, and
  Product V1.3 worktrees left at their prior SHAs and clean (re-verified each phase).
- Rehearsal done in a separate disposable worktree, never merged forward.
- Lab uses dedicated containers (`easymod-postgres`/`easymod-redis`) + `easymod_dev`;
  integration/meta-e2e use their own disposable compose project (`docker-compose.test.yml`,
  DB names containing `test`). No other agent's worktree/process touched.
