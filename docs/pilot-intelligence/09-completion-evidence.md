# Pilot Intelligence — Phase 2 Completion Evidence

Date: 2026-10-04.

Branch: `feat/pilot-customer-rto-completion`, from `origin/main` @ `59bcb4dc`.
Local HEAD before commit: `59bcb4dc` + the worktree changes listed below.

Machine: Windows 11, Node 25.6.1, npm 9.9.4, Docker 29.8.0 / Compose v5.5.1.
CI (remote) runs Node 20; the local Node 25 results below are strictly stronger
or equal for the gates they cover.

Disposable services come from the repo's `docker-compose.test.yml`
(PostgreSQL 16-alpine + Redis 7-alpine, tmpfs, loopback only).

Statuses are `PASS`, `FAIL`, `PRE-EXISTING`, `NOT RUN`.

## Results

| Gate | Command | Result |
| --- | --- | --- |
| Order tenant integrity (new) | `npx jest src/modules/order/__tests__/order-customer-integrity.test.js --forceExit` | **PASS**: 4/4 tests (same-shop accepted; cross-shop 400; non-existent 400; no `customer_id` accepted) |
| Order module regression | `npx jest src/modules/order --forceExit` | **PASS**: 20 suites, **274 tests** |
| Backend integration (disposable Docker PG + Redis) | `npm run test:backend:integration:docker` | **PASS**: 26 suites, **188 tests** |
| Frontend unit (full) | `npm run test:unit --workspace=easymod-frontend` | **PASS**: 72 files, **603 tests** |
| Frontend typecheck | `npx tsc --noEmit` (strict) | **PASS** (exit 0) |
| Real-stack browser E2E (new live tier) | `node scripts/run-pilot-e2e.js` | **PASS**: 4 tests / **10 journeys**, 52.8s, clean teardown |
| Backend build | `npm run build:backend` (`node --check server.js`) | **PASS** |
| Frontend production build | `npm run build:frontend` (vite 7.3.6) | **PASS** (38.5s; the 500kB chunk-size warning is PRE-EXISTING) |
| Backend Docker image | `docker build -t easymod-backend:validation-local ./EasyMod-backend` | **PASS**: image `01d3db228586`, 901MB |
| Frontend Docker image (final sources) | `docker build -t easymod-frontend:validation-local ./EasyMod-frontend` | **PASS**: image `200f35da3ba8`, 78.7MB |
| Backend container initialization | production-mode container against disposable PG + migrated schema | **PASS**: strict production-config validator accepted; Docker `HEALTHCHECK` reached **healthy**; `/health` 200, `/health/ready` 200 |
| Frontend container initialization | nginx container from the built image | **PASS**: HTTP 200 on `:8080` |
| Whitespace / conflict markers | `git diff --check` | **PASS** |

## Component 1 — Order tenant integrity (Tech Debt #7)

`EasyMod-backend/src/modules/order/order.service.js`, `_createOrderCore`:

```js
// 5. Verify customer_id belongs to this shop if provided (Tech Debt #7)
if (orderData.customer_id) {
    const customerRecord = await Customer.findOne({
        where: { id: orderData.customer_id, shop_id: shopId },
        transaction,
    });
    if (!customerRecord) {
        throw new AppError('Customer does not belong to this shop', 400);
    }
}
```

New regression suite `EasyMod-backend/src/modules/order/__tests__/order-customer-integrity.test.js`
(pure unit tier, exercising the shared core through `createOrderInternal`):

- accepts a `customer_id` belonging to the order's shop;
- rejects a cross-shop `customer_id` with `AppError` 400 — and the tenant-scoped
  `findOne` receives `shop_id: shopId`, so a foreign customer can never match;
- rejects a non-existent `customer_id` with the same 400;
- creates the order when no `customer_id` is supplied (regression guard).

All 4 tests pass, and the full `src/modules/order` suite (274 tests) confirms no
regression from the applied production change.

## Component 2 — Legacy Customers page cleanup (Tech Debt #3)

Removed the non-functioning blacklist toggle and its dead API surface:

- `EasyMod-frontend/src/app/components/Customers.tsx`: removed
  `togglingBlacklist` state, `handleToggleBlacklist`, and the
  "Blacklist Customer" / "Remove from Blacklist" button in the customer
  slide-over.
- `EasyMod-frontend/src/api/domains/customer.ts`: removed `blacklistCustomer`
  (`POST /api/customer/:id/blacklist`) and `removeFromBlacklist`
  (`DELETE /api/customer/:id/blacklist`).
- `EasyMod-frontend/src/api/index.ts`: removed the corresponding `apiClient`
  re-exports.
- `EasyMod-frontend/src/api/domains/__tests__/customer.test.ts`: removed the
  tests for the removed functions.

Kept intentionally: the read-only `blacklisted` badge/field rendering
(server-flagged display state used by the pilot surfaces), the RTO Shield
domain's `checkPhone` blacklist concept, and the `CUSTOMER_BLACKLISTED` event
constant. A repo-wide search for `blacklistCustomer|removeFromBlacklist`
confirms the removed functions had no other callers.

Verification: `npx vitest run src/app/components/Customers.test.tsx` plus the
domain test — **7/7 tests pass**; `npx tsc --noEmit` clean. The legacy detail
view renders without the removed action.

## Component 3 — Real-stack Playwright E2E (live tier)

New harness (upgrades the mock-only tier established in PR #196):

- `scripts/run-pilot-e2e.js` — follows the `scripts/run-growth-e2e.js`
  pattern: per-run Compose project `easymod-pilot-e2e-<pid>`, free-port
  probing (loopback-only), `assertDisposableTarget`/`assertLoopback` guards,
  `PILOT_E2E_USE_EXISTING_SERVICES=true` escape hatch, full migration chain,
  deterministic seeding, backend on `:3000`, Playwright driven through the
  frontend `playwright.config.ts` webServer (vite dev server proxying `/api`
  to the real backend), and guaranteed `down --volumes --remove-orphans` +
  `taskkill` teardown.
- `EasyMod-backend/src/scripts/seed-pilot-e2e.js` — deterministic fixtures
  against the real schema: `shop_pilot_features` row
  (`customer_intelligence: true`, `order_confidence_mode: 'enforce'`), owner
  (`owner@pilot-test.bd`) + staff users, four customers, order history driving
  `REPEAT_BUYER` / `AT_RISK`, a buying-intent conversation with an OPEN
  opportunity, and the three gate orders (`READY`, `ADDRESS_TOO_SHORT` /
  `VERIFY`, `REPEATED_RETURNS` / `MANUAL_REVIEW`). A sandbox courier
  integration is seeded so the booking gate returns its real 409
  `ORDER_CONFIDENCE_HOLD` before any external courier call is possible.
- `EasyMod-frontend/tests/e2e/customer-intelligence-live.spec.ts` — the 10
  journeys; skips unless `PILOT_E2E_LIVE=true`, so the mock-tier CI lane is
  unaffected. `.pilot-fixtures.json` (run artifact) is gitignored.

Observed run (exit 0): Compose PG 16 + Redis 7 healthy → all 59 migrations
including `20260927_001_pilot_customer_rto_intelligence` → fixtures seeded →
backend healthy → Playwright:

| # | Journey | Result |
| --- | --- | --- |
| 1 | Customers list shows computed states (`REPEAT_BUYER`, `INTERESTED`, `NEW`) with delivered counts | PASS |
| 2 | Customer detail: commerce metrics, timeline, order history incl. phone-match linkage | PASS |
| 3 | Search by phone; opportunities tab filter | PASS |
| 4 | Open opportunity shows products, reasons and conversation link | PASS |
| 5 | Mark contacted → Contacted; Open conversation → `/inbox?conversation=…` | PASS |
| 6 | `READY` / `VERIFY` / `MANUAL_REVIEW` decisions per seeded order (real rules engine) | PASS |
| 7 | `VERIFY` order shows `ADDRESS_TOO_SHORT` hold; booking refused with the real 409 hold message | PASS |
| 8 | Mark verified → `Cleared for booking`; booking button re-enabled | PASS |
| 9 | `MANUAL_REVIEW`: staff see owner-only guidance, no approve control | PASS |
| 10 | Owner approval requires a note, records the audit history entry, releases the hold | PASS |

`4 passed (52.8s)`. Containers and network were removed in the same run.

## Component 4 — Local Docker validation

Backend image built from the branch (runtime sources include the tenant fix):

```
docker build -t easymod-backend:validation-local ./EasyMod-backend
# → 01d3db228586, 901MB
```

Run against a disposable, migrated PostgreSQL 16 + Redis 7 (production-mode
env: `NODE_ENV=production`, strict `production-config.validator` accepted):

- Docker `HEALTHCHECK` (GET `/health/ready`) reached **healthy**;
- `/health` → 200; `/health/ready` → 200;
- `/api/version` → `migrations: { count: 59, latest: "20260927_001_pilot_customer_rto_intelligence" }`.

Frontend image rebuilt from the **final** worktree sources after the Component 2
cleanup:

```
docker build -t easymod-frontend:validation-local ./EasyMod-frontend
# → 200f35da3ba8, 78.7MB; nginx container served HTTP 200
```

Note: the backend runtime code has no changes after the validated backend
build; the only later-added backend files are the seeder and the unit test
suite, which are not part of the production runtime path. Remote CI additionally
builds both images from the final commit as the merge gate.

## Git and remote verification (executed after this document)

1. Commit the listed changes to `feat/pilot-customer-rto-completion`.
2. Push and open the PR (evidence summary in the body; includes the final commit SHA).
3. Wait for and verify the remote checks: **PR Merge Gate**, **Security Scan**,
   **Docker build validation**.
4. Merge to `main`.
5. Trigger the deployment workflow to the DigitalOcean droplet.
6. Verify `https://api.easymod.tech/health` returns HTTP 200 and
   `/api/version` reports the new commit SHA.

## Notes

- The backend integration run regenerates
  `EasyMod-backend/src/modules/auth/native/__tests__/__fixtures__/native-auth-responses.json`
  (capture timestamp + random ids). That machine-generated churn is **reverted
  before commit**; it is unrelated to the pilot changes.
- Pilot features remain default-`off` for production shops
  (`shop_pilot_features` absent ⇒ customer intelligence disabled,
  order confidence `off`); enablement stays a per-shop admin action in shadow
  mode. The shipped code paths are inert for non-pilot shops.
- The full backend unit suite with coverage is not re-run locally as a whole;
  the remote PR Merge Gate runs it. Locally, the touched module (order) and all
  26 integration suites were run in full.
