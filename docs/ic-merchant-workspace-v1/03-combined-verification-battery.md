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
