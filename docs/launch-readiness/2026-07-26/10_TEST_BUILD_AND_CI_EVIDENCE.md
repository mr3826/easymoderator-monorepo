# 10 — Test, Build and CI Evidence (Workstream I)

All commands were run fresh this audit against `d716ecf` with a clean working tree.

## Results

| # | Command | Location | Exit | Result |
|---|---|---|---|---|
| 1 | `npx jest --runInBand --forceExit --silent` | `EasyMod-backend` | **0** | **107 suites / 1226 tests passed**, 76.9s |
| 2 | `npm run test:security` | `EasyMod-backend` | **0** | **24 suites / 148 tests passed**, 11.2s |
| 3 | `npx tsc --noEmit` | `EasyMod-frontend` | **0** | no type errors |
| 4 | `npx vitest run` | `EasyMod-frontend` | **0** | **49 files / 443 tests passed**, 48.7s |
| 5 | `npm run build` | `EasyMod-frontend` | **0** | built in 18.70s, 2 chunk-size warnings |
| 6 | `node scripts/launch-readiness.js` (BASE_URL=prod) | `EasyMod-backend` | 1 | **NOT READY** — and 2 of the gates false-pass (see `12_`) |
| 7 | `npm audit --omit=dev` | `EasyMod-frontend` | 0 | **2 high** (react-router) |
| 8 | `npm audit --omit=dev` | `EasyMod-backend` | **1** | **BLOCKED** — npm tooling error |
| 9 | `npx eslint src` | `EasyMod-frontend` | — | **no ESLint config exists** |

**Totals: 1,669 tests passed, 0 failed, 0 skipped.**

## Suite composition (backend, 107 suites)

Includes the Meta OAuth, Meta webhook, Messenger policy, tenant-isolation, data-deletion,
deauthorization, order, payment-webhook, delivery-tracking, and workflow-deploy-guard
suites. The full list is in the `test:security` invocation in `EasyMod-backend/package.json`
plus the curated `jest.config.js` set.

## Known warnings (pre-existing, not regressions)

- Backend: `Force exiting Jest: Have you considered using --detectOpenHandles` — an open
  handle after tests complete. Pre-existing; masked by `--forceExit`.
- Frontend build: `Some chunks are larger than 500 kB` (`react-vendor` 571 kB, 183 kB
  gzipped). Pre-existing.
- `launch-readiness.js` ends with a Node libuv assertion (`!(handle->flags & UV_HANDLE_CLOSING)`)
  after printing results — cosmetic, occurs after the verdict.

## Exclusions, gaps, and things that only pass through mocks

### F-15 (P2) — the E2E suite exists but never runs

Eight Playwright specs are committed:

```
tests/e2e/core-app.spec.ts          tests/e2e/notification-system.spec.ts
tests/e2e/integration-flows.spec.ts tests/e2e/order-management.spec.ts
tests/e2e/llm-settings.spec.ts      tests/e2e/payment-settings.spec.ts
tests/e2e/meta-platform.spec.ts     tests/e2e/shared-inbox.spec.ts
```

`package.json` has `test:e2e` and `test:all`, but **CI runs neither** — the workflow runs
only `npm run build` and `npm run test:unit` (`ci-cd.yml:117-134`). The end-to-end
coverage for shared inbox, orders, payments, and the Meta platform is therefore
**dead weight**: it does not gate anything, and it is not run here either (it needs a live
app instance). Quarantined-by-omission.

### F-16 (P2) — CI does not typecheck, despite the comment claiming it does

`ci-cd.yml:116-117` states: *"Frontend production build — TypeScript/import errors fail
here."* The build script is plain `vite build`, which uses esbuild to **strip** types
without checking them. **Type errors do not fail CI.**

No current defect — `tsc --noEmit` passes locally (exit 0) — but the gate is weaker than
documented. `tsc --noEmit` should be added to the workflow.

### F-17 (P2) — there is no lint gate at all

- Frontend: no `eslint.config.js`, no `.eslintrc.*`, no `lint` script. ESLint refuses to run.
- Backend: no `lint` script.

The brief's "backend lint" and "frontend lint" rows are **NOT_APPLICABLE_WITH_JUSTIFICATION**:
the capability does not exist in this repository.

### F-18 (P2) — backend dependency audit is unverified

```
npm audit --omit=dev            → exit 1
npm audit --package-lock-only   → exit 1
{ statusCode: 400, message: 'Invalid package tree, run npm install to rebuild your package-lock.json' }
```

A local npm/registry tooling failure (the quick-audit endpoint is being retired), not a
repository defect — `git show 2225364 -- package.json` proves the only change was the
`test:security` script string, so `npm ci` consistency is intact. But the practical
consequence stands: **backend production dependency vulnerabilities are unknown.**

### F-25 (P3) — frontend: 2 high-severity advisories

```
react-router  7.12.0 - 8.2.0   (via react-router-dom)
GHSA-qwww-vcr4-c8h2 — RSC Mode CSRF Bypass Allows Action Execution Before 400 Response
```

**Likely not exploitable here**: the advisory is specific to React Server Components
mode, and this is a client-rendered Vite SPA with no RSC. Rated P3 rather than P1 on that
basis, but it should be patched (`npm audit fix`) rather than reasoned away permanently.

### Infrastructure-dependent tests

Database-, Redis-, and queue-dependent behaviour is exercised through mocks in the Jest
suite. Genuine integration coverage against a real PostgreSQL instance exists only in
`scripts/validate-meta-compliance-postgres.js`, which **could not be re-run** here
(Docker daemon not running — see `11_`).

### Critical production paths without integration coverage

| Path | Coverage |
|---|---|
| Inbound webhook → durable store → queue → AI reply → Messenger send | unit/mocked only; **no end-to-end integration test** |
| Attachment round-trip through Meta | none (needs live Meta) |
| bKash payment lifecycle | mocked; **no real-money test ever performed** |
| Courier booking lifecycle | mocked; no real booking |
| Backup restore | **none** |

## CI workflow shape

`Test & Build Gate` → `Build & Push Docker Images` → `Deploy to DO Droplet`, with build
and deploy both requiring `refs/heads/main` (feature-branch manual dispatch is test-only,
enforced by `workflow-deploy-guard.test.js`). Path filtering (`needs.changes.outputs.*`)
means a frontend-only change skips the backend suite entirely — normal, but worth knowing
when reading a green check.

**Latest CI on the launch commit `8394a44`: `Test & Build Gate` green, deploy red**
(run `30189476291`). Launch gate 1 ("CI is green on `main`") is therefore **NOT met** —
the run as a whole failed.
