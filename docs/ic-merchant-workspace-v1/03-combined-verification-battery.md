# IC-V1 03 — Combined-Candidate Verification Battery

**Candidate under test:** `feat/…` @ `a513a4ce` (code tip; docs follow).
Tree: increment-2 (`434a8cfc`) + v6 contract port (`65c99f43`) + ADR-0007 reconciliation
(`2a4760bb`) + tooling-guard fix (`a513a4ce`). Portable Node 20.20.2 throughout.

| Gate | Command | Result |
|---|---|---|
| Backend units (full) | `npx jest --coverage=false --silent --testTimeout=30000` (clean env, no local .env) | **313/313 suites; 4219 passed, 2 skipped** |
| Real-stack integration | `npm run test:backend:integration:docker` (disposable compose Postgres+Redis) | **30/30 suites; 220/220** — incl. order-confidence integration on the reordered draft gate + the 14-spec MW-V1 CRM/ownership suite + all Pilot+/increment-1/mobile integration specs unmodified |
| Meta-shaped E2E | `npm run test:backend:meta:e2e:docker` | **2/2 suites; 48/48** — zero live sends, zero paid AI calls |
| TypeScript | `npx tsc --noEmit` (FE) | **0 errors** |
| Frontend units | `npx vitest run --maxWorkers=2` | **77 files; 665/665** |
| Frontend build | `npm run build` | **success** (pre-existing chunk-size warnings only) |
| Browser — deterministic journeys | `npx playwright test pilot-plus mwv1-journeys --workers=1` | **chromium 20/20; firefox 20/20** (one initial firefox J1 miss proven a battery-contention flake — green isolated + on re-run) |
| Security surface | covered continuously by the integration + unit suites (tenant isolation, JWT-scope, CSRF regression specs incl. the ported v6 cookie spec) | green |

## Environment-provenance notes (honest accounting)

1. **totp.service.test.js** fails ONLY when a local, gitignored lab `.env` is present
   (it re-populates env vars the test deletes — increment-2 review F1, pre-existing).
   The battery above ran WITHOUT any .env: 313/313.
2. **lab-replay / lab-process** initially failed at commit `2a4760bb` because the
   PE privacy heuristic matched a digit run inside the commit's own provenance
   hex digest (`engineSourceRevision`). Fixed in `a513a4ce` by excluding
   machine-identifier fields (`*sha256|*revision|*hash`) while content fields
   stay fully scanned and the forbiddenMarkers raw-input check is untouched.
   **Flagged for the product-experience owner's confirmation** — it is their tool.
3. The IC worktree keeps the shared repo's `.gitignore`d lab-file convention; nothing
   local was committed.

## Combined-candidate verdicts

```text
PRODUCT_ENGINE_V1_3_PRESENT=YES (all grounding suites green)
PILOT_PLUS_PRESENT=YES (10/10 journeys + integration green)
MW_INCREMENT_1_PRESENT=YES (FE-01/03/08 specs + journeys green)
MW_INCREMENT_2_PRESENT=YES (context panel/ownership/notes/tags/views green)
V6_CONTRACT_PORT=GREEN (booking gate reconciled with ADR-0007; owner UX deferred)
MOBILE_CONTRACT_COMPATIBILITY=VERIFIED (read-only; /products/images pending upstream)
LOST_FUNCTIONALITY=NONE detected across 313 suites + 220 integration + 40 browser runs
DUPLICATE_BUSINESS_AUTHORITIES=NONE (single queue read model, single payment truth,
  single ownership PATCH, notes/tags as their own new authorities by design)
PRODUCTION_CHANGED=NO; PUSHED=NO; MERGED=NO
```

Next: freeze → independent adversarial review (doc 04) → founder package (doc 05 + proof.json).

## Post-review hardening round (adversarial review 17fce2f9/a513a4ce -> this commit)

Closed findings F1-F10 per doc 04; re-verification on the FIXED tree:
- order module + confidence + CRM units: 57/57 suites 811 green (incl. 3 new draft-guard specs);
- integration real-stack: mwv1 suite now 15 specs incl. HTTP 409 DRAFT_ORDER_NOT_BOOKABLE pin; order-confidence integration 17/17 unchanged;
- **true-stack browser certification (F5 fix):** founder preview now runs the IC tree (backend :3000 + vite :5173); pilot-plus-walkthrough 3/3 live; dev-cookie CSRF round-trip proven via real browser login; order_status=draft filter + draft-booking 409 + zero-mutation proven over HTTP from an authenticated browser session against the IC backend.
- FINAL battery after fixes (this commit): backend 313/313 (4221 passed, clean env); integration 30/30 (221/221 incl. HTTP draft pin); meta-e2e 48/48; FE 665/665 + tsc 0; Playwright pilot-plus+mwv1-journeys 20/20 chromium AND 20/20 firefox via the now-committed `npm run test:e2e:chromium`/`test:e2e:firefox` scripts (one initial firefox run failed at dev-server startup contention; green on clean re-run).

## Round-2 authorization/hardening battery (adversarial review round 2 -> final freeze)

Post-review findings R2-F1..R2-F10 closed/dispositioned per doc 04; re-verification on the
FINAL tree (Node 20.20.2; lab .env PRESENT throughout — see note 1 revision):

| Gate | Command | Result |
|---|---|---|
| Backend units (full, incl. test-discovery) | `npm run test:backend` (jest --runInBand --coverage=false --silent) | **317/317 suites; 4,271 passed, 2 skipped** |
| Real-stack integration | `npm run test:backend:integration:docker` | **32/32 suites; 225/225** — disposable Postgres applied the new `20261026_001_order_idempotency_unique` migration; courier-race/ownership/confidence suites now use `kind:'test'` authority fixtures |
| Meta-shaped E2E | `npm run test:backend:meta:e2e:docker` | **2/2 suites; 48/48** — zero live sends |
| Frontend units | `npm run test:frontend` | **78 files; 692/692** (incl. ActionQueuePanel degrade-not-crash pin) |
| TypeScript / build | `tsc --noEmit` / `npm run build:all` | **0 / success** |
| Browser battery | `npx playwright test pilot-plus mwv1-journeys --workers=1` | **chromium 20/20; firefox 20/20** |
| Full legacy e2e sweep | `npx playwright test --browser=chromium` | 83 passed / 22 failed / 6 skipped — ALL 22 in 5 legacy files pinning pre-Pilot+ markup, each root-caused as baseline-reproducible (doc 04 round-2); owner debt, not candidate regressions |

1. **Revised:** the totp lab-.env interplay (original note 1) is fixed at the test level
   (service instance reused instead of jest.resetModules+re-require, which re-ran dotenv);
   this round's full battery ran WITH the lab .env present and is green.
2. Parallel Playwright (default workers) intermittently hits 30s load timeouts on this
   machine under suite contention; `--workers=1` is the reliable procedure for the battery.
3. WebKit (installed, 2248): dev-stack `__Host-` CSRF cookie/CORS limitation on
   http://localhost — every test fails at login identically; production is same-origin.
   Never previously battery-green; documented as environment limitation in doc 04.
