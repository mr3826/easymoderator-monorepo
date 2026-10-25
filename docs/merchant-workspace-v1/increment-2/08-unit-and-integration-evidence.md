# 08 — Unit & Integration Evidence (Increment 2)

All commands run with the portable Node 20.20.2
(`D:\easymod\_local-runtimes\node-v20.20.2\extract\node-v20.20.2-win-x64`);
system Node 25 violates `engines.node` and is not used.

## Backend unit gate (no Docker)

```
cd EasyMod-backend
npx jest --coverage=false --silent --testTimeout=30000
→ Test Suites: 313 passed, 313 total
→ Tests:       4214 passed, 2 skipped, 4216 total
```
Covers the new suites: `conversation-ownership` (10), `customer-notes.service` (8),
`customer-notes.routes` (6), `customer-tags.service` (9), plus extended
`inbox-actions.service` (counts/views), `order.validator`/`order.service`
(customer_id filter), and the two CRM migrations' models. The `--testTimeout=30000`
deterministic convention from Pilot+ is retained (baseline load flakes under
parallel default timeout are documented, not hidden).

## Real-stack integration (real PostgreSQL + Redis)

```
npm run test:backend:integration:docker
→ Test Suites: 30 passed, 30 total
→ Tests:       219 passed, 219 total
```
Includes `mwv1-increment2.integration.test.js` (13 specs) on real Postgres:
- D1 claim→409→owner force→server audit (before/after/forced) over HTTP;
- D2 foreign-shop assignee → 400 INVALID_ASSIGNEE, no write;
- D3 assignee {id,name} present in the list read;
- same-name customers never cross-associate (conversations + orders, by id);
- non-uuid customer_id rejected;
- notes create→list→stranger-edit-403→owner-edit→soft-delete (row survives,
  `deletedAt` set)→audits carry `body_length`, never the body;
- tags dedupe-case-insensitive, reserved-name 400, staff-rename 403, foreign-tag
  smuggle 404, idempotent set (dupes collapse), assign persists;
- queue `counts.views` + `unassigned`/`mine` filtering + unknown-view→attention.

## Meta-shaped E2E (signed webhooks, fake transport, zero live sends)

```
npm run test:backend:meta:e2e:docker
→ Test Suites: 2 passed, 2 total
→ Tests:       48 passed, 48 total
```
Confirms Pilot+ messaging eligibility, opt-out, Draft/Manual/Auto, grounding,
structured choices, checkout recovery, human handoff, delivery truth all still
hold with the increment-2 backend changes present.

## Frontend

```
cd EasyMod-frontend
npx tsc --noEmit        → exit 0
npx vitest run          → Test Files 77 passed, Tests 665 passed
npm run build           → built OK (only pre-existing chunk-size warnings)
```
New/extended FE specs: `CustomerContextPanel` (12: flag-off zero gated reads,
flag-on relationship/RTO, verified-id order link + deep link, degradation,
no-cache/stale discard, owner chip, claim, staff-409-no-force, owner force,
assign-by-id, note create→refetch, author-scoped delete, tag replace-set),
`ActionQueuePanel` (+3 server-count views), `QuickReplySafety`/`UnifiedInbox`
(increment-1 invariants re-confirmed), `order.test`/`conversation.test`
(customer_id + signal plumbing).

## Discovery guard

`tests/__tests__/test-discovery.test.js` green throughout — every new test file is
committed to a single suite home; no quarantine drift.
