# Action-First V1 — Validation Evidence Receipts (2026-10-20)

All commands executed locally in `D:\easymod\_wt-growth-os-action-first-v1`
(branch `feat/growth-os-action-first-v1-20261020T0310Z`). No CI run was
dispatched and no production system was touched.

## Static / unit gates

| Command | Result |
|---|---|
| `npm run typecheck --workspace=easymod-growth` | PASS (tsc --noEmit) |
| `npx vitest run` (EasyMod-growth) | PASS — 27 files / 177 tests (was 24/151 at baseline; +3 suites: AdminHome, PerformancePage, workspaceContext) |
| `npm run build --workspace=easymod-growth` | PASS — production bundle 406 kB (under the 450 kB warning budget) |
| `npm run lint:growth -- --max-warnings=0` | PASS (extended to cover scripts/growth-review and the review seeder) |
| `npx jest src/modules/growth-os/__tests__ --testPathIgnorePatterns=integration --runInBand --forceExit` | PASS — 12 suites / 88 tests |

## PostgreSQL + Redis integration (real services)

Docker Desktop's predefined address pool is exhausted by pre-existing
third-party bridge networks on this shared machine; the canonical
`node scripts/run-backend-integration.js` bootstrap could not create its
Compose network (`all predefined address pools have been fully subnetted`).
No foreign network/container was removed to work around this. Instead the
same suites ran against a freshly migrated database on dedicated,
self-owned containers with an explicit out-of-pool subnet
(`10.245.91.0/24`, loopback-published ports only, removed afterwards):

| Command | Result |
|---|---|
| `npm run migrate` (dedicated `easymod_growth_e2e_test` DB) | PASS — all migrations incl. `20261007_001_growth_os_prospect_integrity` |
| `npx jest --config jest.integration.config.js src/modules/growth-os --runInBand --forceExit` | PASS — 4 suites / 46 tests, including the new `follow-up completion records a typed outcome and reason on the event and audit` (event metadata + `audit.new_values.outcome`, invalid outcome 400, legacy `{status}` body unchanged) |

## Browser E2E (Playwright, disposable fixtures, real auth + TOTP)

Same network-pool workaround: `GROWTH_E2E_USE_EXISTING_SERVICES=true` with
self-owned loopback pg/redis containers; the canonical
`scripts/run-growth-e2e.js` lifecycle (migrate → seed → vite+backend →
Playwright → teardown) otherwise unchanged.

| Run | Result |
|---|---|
| First full run (cold) | 30 pass / 10 fail — failures triaged: 4 real spec-adaptation bugs (fixed in `89ff0054`/`ffa0d43b`: strict-mode ambiguity, `test.use` placement, locator chain, mid-session nav semantics under the new default Admin context) + 1 transient 13 s request timeout under concurrent Docker builds + auth-setup cold-start flake |
| Warm rerun after fixes | **39 passed / 1 skipped / 0 failed** (7.4 min, 1 worker, chromium) — includes new `action-first.spec.ts`: S1 queue→record→typed outcome→timeline persistence, A1 Admin Control default/switch/aggregate honesty, legacy `/analytics` `/sources` deep links + `/performance` tabs, 320 px overflow check, direct-API 403 matrix |
| Skipped test | pre-existing conditional skip (unchanged from baseline) |

## Founder review stack (owned, persistent)

Project `em-growth-review-2e859b49` · http://127.0.0.1:4290 ·
`npm run growth:review:health` → 6/6 PASS (services, SPA, backend health via
proxy, unauthenticated 401 gate, local-only env + providers-disabled proof,
fixture receipts 10 prospects / 2 roles / 3 users).
`npm run growth:review:test` (smoke) → 11/11 PASS: real password+TOTP
sign-ins for admin and sales, admin platform aggregates, reason-bearing
channel reconnect request verified in audit list, sales blocked from all
three admin APIs and admin user creation (403), merchant session blocked
(403 sanitized), duplicate phone → server 409, typed-outcome completion
persisted on the audited event, masked insight carries no admin-only
sections.

## Secret scanning

`gitleaks stdin` over the full branch diff (`07168f49..HEAD`, 238 KB):
**no leaks found**. Credential receipts live only in gitignored
`.growth-review/` (verified `git status` clean of them).

## Docker image smoke

`npm run test:growthos:image` — result recorded in `05-image-smoke-receipt.md`
(runs after the review-stack build to avoid saturating the shared Docker VM).

## Baseline vs after (same synthetic fixtures, deterministic counts)

See `03-baseline-comparison.md`. Headline verified-in-browser facts:
S1 first-action reachability improved from 2 navigations + table scan to 1
queue row; Admin Control aggregate now has explicit next steps and honest
non-links; outcome capture added one deliberate step and produced a typed,
audited event (unit + integration + E2E + smoke all assert persistence).
No percentage uplift claims are made.
