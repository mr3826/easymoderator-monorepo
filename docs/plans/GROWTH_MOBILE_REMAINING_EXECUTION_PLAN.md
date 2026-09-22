# Growth OS + Mobile — Remaining Execution Plan

**Deliverable at execution time:** `docs/plans/GROWTH_MOBILE_REMAINING_EXECUTION_PLAN.md`
on branch `plan/growth-mobile-remaining-2026-09`, worktree `D:\easymod\growth-mobile-planning`,
based on `origin/main@befcb180`.

> This file is the plan itself. Plan mode forbids branch/worktree creation, so
> **Task 0** below is the first execution step: create the branch + worktree and
> commit this content as the repo-tracked doc.

---

## Context

Why this plan exists: the 2026-09-21 platform audit
(`D:\easymod\platform-audit\EASYMODERATOR_PLATFORM_AUDIT.md`) froze facts at
`main@cf57db1e`. Main has since advanced **8 commits** (PRs #131, #132, #134,
#135) and production has been redeployed twice. Several audit conclusions are
now stale, and **two are measurably wrong**. Growth OS and Mobile are the two
tracks with no credible release date, and both are blocked by different things
than the audit recorded.

Intended outcome: an evidence-anchored, dependency-ordered task graph that
separate coding agents can execute one branch at a time without re-deriving the
system.

**Scope decisions confirmed by the owner (2026-09-22):**

| # | Decision |
|---|---|
| 1 | **Mobile includes feature work.** Home/attention client, 2FA UI, real deep-link resolver, offline cache — then native build, then device E2E. |
| 2 | **PR #127 is split into stacked PRs**, not rebased whole. |
| 3 | **Growth is planned to release-ready and stops at the gate.** Flag flips and cutover remain separately-authorized human actions. |
| 4 | **Mobile backend lands on main early with all five flags off.** |

---

## 1. Executive state summary

Growth OS is **further along than the audit implies and blocked later in the
pipeline than expected**. The Growth backend module (26 files), `EasyMod-growth/`
SPA, `docs/growth-os/`, `growth-os.yml` and `grant-growth-role.yml` are **already
merged on main**. `growth.easymod.tech` is **live, TLS-valid, Caddy-fronted, and
correctly proxies `/api/auth/*` to the backend**. PR #127 is an *increment* — an
internal control plane plus a new browser extension — not the system itself.

Mobile is **substantially earlier than the docs imply**. Every app screen is a
`PlaceholderScreen`. There is no client for `/api/mobile/attention` or
`/api/mobile/today`, no 2FA UI, and the deep-link resolver returns `found`
unconditionally. The typed API client `apiRequest` has **zero production call
sites**. Mobile is not a verification problem; it is a build problem with a
verification problem behind it.

The two findings that most change the picture:

1. **The audit's own remediation never merged.** PR #129 — all CI hardening,
   least-privilege tokens, dependency bumps, backup hardening, ops-alert fix and
   the *reconciled Growth docs* — is still an **open draft** based on `cf57db1e`.
   Every `PASS` in the audit that depended on that branch describes code that is
   not on main and not in production.
2. **Growth's production image is orphaned.** `GROWTH_BOOTSTRAP_DIGEST` is unset,
   so `ci-cd.yml` resolves whatever container is already running and carries it
   forward. `growth.easymod.tech` serves a build with
   `last-modified: Fri, 21 Aug 2026`. No Growth image published in the last month
   has ever reached production, and the host exposes no version endpoint.

**Neither track is release-blocked by code quality.** Growth is blocked by
release plumbing and unverified runtime identity. Mobile is blocked by unwritten
features and an unproven native toolchain.

---

## 2. Fact freeze

All values independently verified 2026-09-22 via `git ls-remote`, `gh`, and live
HTTP. No historical `PASS` was carried forward.

```
AUDIT_DATE=2026-09-22
PREVIOUS_AUDIT_DATE=2026-09-21
REPO=mr3826/easymoderator-monorepo

ORIGIN_MAIN_SHA=befcb1807b916d92191c6e93f60c5d3408191199   # "Merge PR #135", 2026-09-22 11:45Z
FEATURE_MOBILE_SHA=04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6 # "Merge PR #125", 2026-09-15
COMMON_FORK_POINT=77790a833da372a03899686a365d7a40b2a95a67  # PR #114, 2026-09-13
PRODUCTION_SHA=2b1ad61ac654c246fe0d36337bba36cbd633b403     # LIVE-VERIFIED
PRODUCTION_MATCHES_MAIN=NO — production is 2 merges behind (#134, #135 undeployed)
PRODUCTION_VERIFICATION=GET https://api.easymod.tech/api/version
  -> {"gitSha":"2b1ad61ac654...","buildTime":"2026-09-22T09:55:33Z","migrations":{"count":50}}
PRODUCTION_DEPLOYMENT=6588019932 @ 2026-09-22T09:56:19Z
```

### Growth

```
GROWTH_PR=127
GROWTH_PR_HEAD=1f4cd9de398f9814a2e8dc2cb69fe22b83bc1f05
GROWTH_PR_BASE=main (recorded baseRefOid 77790a83 — STALE by 9 commits)
GROWTH_PR_DRAFT=true
GROWTH_PR_MERGEABLE=UNKNOWN (GitHub has not computed; see REBASE_CLEANLINESS)
GROWTH_PR_SIZE=204 files, +21922/-1726
REBASE_CLEANLINESS=CLEAN — `git merge-tree 77790a83 1f4cd9de befcb180` yields
  0 conflict markers. 8 files changed on both sides; `.gitleaks.toml` is a
  byte-identical blob. Risk is SEMANTIC, not mechanical.

GROWTH_ALREADY_ON_MAIN=EasyMod-growth/ (SPA), EasyMod-backend/src/modules/growth-os/
  (26 files), docs/growth-os/ (9 files), .github/workflows/growth-os.yml,
  .github/workflows/grant-growth-role.yml
GROWTH_NEW_IN_PR127=EasyMod-extension/ (14 files, entire dir), 5 migrations,
  docs/growth-os/05-internal-control-plane.md, docs/growth-os/06-browser-extension.md

GROWTH_HOST=https://growth.easymod.tech -> 200, HTTP/2, TLS valid, via Caddy -> nginx/1.25.5
GROWTH_HOST_LAST_MODIFIED=Fri, 21 Aug 2026 11:30:01 GMT   # STALE BY ~1 MONTH
GROWTH_HOST_VERSION_ENDPOINT=ABSENT (/version returns the SPA shell, 448 bytes)
GROWTH_HOST_API_PROXY=WORKS — /api/auth/me returns the backend's 401 JSON envelope;
  Caddyfile scopes the proxy to /api/csrf, /api/auth/*, /api/internal/growth-os/*
  and 404s every other /api/* path.
GROWTH_OS_ENABLED=false            (.env.prod.example:53)
PRODUCTION_DEPLOY_ENABLED=false    (repo variable)
GROWTH_BOOTSTRAP_DIGEST=UNSET      (verified absent from repo variables)
GROWTH_E2E_REAL_EXTENSION=NOT SET IN CI (opt-in only)
```

### Mobile

```
MOBILE_BUILD_PR=126
MOBILE_BUILD_PR_HEAD=a4bf7c018788d000f022fcaad3995d697631a59b
MOBILE_BUILD_PR_BASE=feature/mobile-app@04bb4d5f
MOBILE_BUILD_PR_STATE=OPEN, not draft, MERGEABLE/CLEAN, 3 files +178/-14

MOBILE_CI_PR=130
MOBILE_CI_PR_HEAD=257c24ffcf0648f8b1a6b35faea1ed44cd83d863
MOBILE_CI_PR_BASE=feature/mobile-app@04bb4d5f
MOBILE_CI_PR_STATE=OPEN, DRAFT, MERGEABLE/CLEAN, 5 files +100/-0

MOBILE_DIR=EasyMod-mobile/   # NOT "mobile/" — the task brief's path does not exist
MOBILE_BACKEND_ON_MAIN=NO — modules/mobile, auth/native, 5 MOBILE_* flags,
  mobile-client-context.middleware.js, docs/mobile/ are ALL absent from main.
  Backend delta 77790a83..04bb4d5f = 32 files, +3630/-14, incl. 1 migration.
MOBILE_CI_ON_MAIN=NO (mobile-ci.yml exists only on feature/mobile-app)
MOBILE_NATIVE_BUILD=NOT_VERIFIED
MOBILE_DEVICE_E2E=NOT_VERIFIED — no .maestro/ dir, no flow YAML, no runner
MOBILE_APP_SCREENS=PLACEHOLDER — (tabs)/{index,inbox,orders,quick-action} all render
  <PlaceholderScreen/>. Zero grep hits for "api/mobile" in EasyMod-mobile/src.
```

### Newer PRs affecting either track (created after the audit)

**None.** The newest PR is #135 (merged). #129/#130 remain the audit's own output.

### Other open PRs

```
#129 audit/platform-production-readiness -> main, OPEN DRAFT, base cf57db1e, 29 files
     CONTAINS ALL CI/SECURITY REMEDIATION. UNMERGED.
#116 fix/delivery-prepaid-cod-amount     -> main, OPEN, base 77790a83, 3 files
#117 fix/backend-product-tenant-...      -> main, OPEN, base 77790a83, 2 files
#118 fix/delivery-cross-provider-...     -> main, OPEN, base 77790a83, 7 files
#119 fix/notification-push-membership... -> main, OPEN, base 77790a83, 6 files
OVERLAP_116_117_118_119_WITH_MAIN=ZERO FILES. Stale base, but conflict-free.
```

### Unpushed local work (invisible to GitHub — a real risk)

```
fix/membership-revocation-lifecycle @ 14bab4a3  (D:\easymod\membership-revocation)
  COMMITTED, clean worktree, NEVER PUSHED, NO PR. 32 files, +887/-104.
  Closes audit P1 #1 (membership removal does not invalidate JWT/refresh).
  Touches growth-os.routes.js + 2 growth-os tests + docs/growth-os/EXECUTION_STATE.md
  AND auth.middleware.js / shop-access.middleware.js / auth.service.js.
  => It is simultaneously a Growth dependency AND a Mobile-auth dependency.
  Overlap with main: 1 file (EasyMod-backend/package.json).

hotfix/security-workflow-ssh-pinning   — 9 dirty files, never pushed
fix/schema-aware-message-rollback      — 2 dirty files, never pushed
```

### Repository controls (re-verified, unchanged since audit)

```
MAIN_BRANCH_CLASSIC_PROTECTION=ABSENT (GET .../branches/main/protection -> 404)
MAIN_PROTECTED_FLAG=true (satisfied only by the ruleset below)
REPOSITORY_RULESETS=[platform-audit-main-probe id=23753830 active, rule=non_fast_forward]
REQUIRED_STATUS_CHECKS=NOT_CONFIGURED
REQUIRED_REVIEWS=NOT_CONFIGURED
PRODUCTION_ENVIRONMENT_REVIEWERS=UNAVAILABLE (billing plan 422)
=> The audit's single P0 is UNCHANGED and still open.
```

### Local build host (new evidence, not in the audit)

```
NODE=v25.6.1        # EasyMod-mobile/.nvmrc pins 22; root pins 20. Expo SDK 57
                    # does not support Node 25. NOT the pinned toolchain.
NPM=9.9.4           # inconsistent with Node 25 (ships npm 11)
JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-8.0.492.9-hotspot   # JDK 8
JDK17_PRESENT=C:\Program Files\Java\jdk-17  (installed but NOT on JAVA_HOME)
ADB=NOT ON PATH   GRADLE=NOT ON PATH
ANDROID_HOME=<unset>   ANDROID_SDK_ROOT=<unset>
DISK: C: 35.5 GB free / D: 157.8 GB free / E: 410.8 GB free / F: 192.2 GB free
CACHES ON C:  ~/.gradle = 11.04 GB, ~/.android = 4.88 GB, LOCALAPPDATA SDK = 0.18 GB
SDK ALSO AT D:\Android = 21.86 GB
```

> **This is the native-build root cause, and it is not what PR #126 concluded.**
> PR #126 correctly diagnosed `CMAKE_OBJECT_PATH_MAX` and correctly recorded a
> `D:`-full ENOSPC. But `JAVA_HOME` points at **JDK 8** while React Native 0.86 /
> AGP requires **JDK 17**, and `ANDROID_HOME` is unset so the SDK at `D:\Android`
> is not discoverable. D: now has 157.8 GB free — the ENOSPC condition PR #126
> recorded **no longer holds**. C: at 35.5 GB with 16 GB of Gradle/Android caches
> on it is the remaining space risk.

### NOT_VERIFIED register (carried forward, nothing promoted)

`GROWTH_TLS_ISSUANCE_GATE`, `PHASE_B_POST_DEPLOY_GATE`, `OPERATOR_BOOTSTRAP_GATE`,
`PRODUCTION_BROWSER_E2E_GATE`, Growth real-extension flow, Growth running image
digest, `MOBILE_NATIVE_BUILD`, `MOBILE_DEVICE_E2E`, live rollback with real
schema, Qdrant/media/Redis restore, measured RPO/RTO, fork-PR secret policy.

---

## 3. Audit reconciliation

Every Growth/Mobile finding in the 2026-09-21 audit, re-classified against
today's evidence.

| # | AUDIT_FINDING | CURRENT_EVIDENCE | STATUS | REQUIRED_ACTION | DEP | BLOCKER |
|---|---|---|---|---|---|---|
| A1 | `main` unprotected, no required checks — single P0 | Re-verified: 404 on classic protection; only `non_fast_forward` ruleset | **OPEN** | Strengthen ruleset: require `PR Merge Gate` + `Security Scan`, 1 review, forbid deletion | none | **YES** |
| A2 | PR #127 "20 files overlap incl. signup + legal" | **INCORRECT.** True overlap at `cf57db1e` was **6**; today vs `befcb180` it is **8**. The audit conflated overlap with the 20 files #128 changed in total | **INCORRECT** | Use the verified 8-file list (§6) | none | NO |
| A3 | PR #127 `VERDICT=NEEDS_REBASE`, risk of auth/legal regression | Rebase is **textually clean** (0 conflict markers). Semantic risk is real and concentrated in `auth.service.js` (+222/-46 vs main's +4) and `Signup.tsx` (PR −1 vs main +72/-10) | **PARTIALLY_RESOLVED** | Split per owner decision; targeted auth/signup regression suite | W1 | **YES** |
| A4 | `STALE_BASE_PRS=116,117,118,119,127` | Confirmed stale. But **#116–#119 have ZERO file overlap with main** — mechanical rebase | **PARTIALLY_RESOLVED** | Downgrade #116–#119 from merge-risk to re-verification-only | none | NO |
| A5 | S-2 membership revocation closed (§11 receipt) | Branch committed at `14bab4a3`, clean worktree, **never pushed, no PR**. Invisible to CI | **OPEN** | Push + PR + CI. Highest-value unlanded work in the repo | none | **YES** |
| A6 | `DEPENDENCY_AUDIT=PASS 0 prod vulns after remediation` | Applies to **PR #129 only**. Main locks express 4.22.2 / qs 6.15.3 / body-parser 1.20.6 / morgan 1.11.0 / js-yaml 3.15.1 vs #129's bumped set. **But** `npm audit --omit=dev --audit-level=high` is a real gate and is **green on main** | **SUPERSEDED** | Land #129's bumps as hygiene. Not a live high-severity exposure | none | NO |
| A7 | CI/CD remediation §5 implemented | **All of it is in unmerged draft #129.** Not on main, not in production | **OPEN** | Rebase #129 onto `befcb180`, split docs from workflows, merge | A1 | **YES** |
| A8 | `GROWTH_E2E=PASS` on Actions `35561961284` | True — but at head `3e5077d` (audit branch), **not** PR #127's head `1f4cd9de`, and not on `befcb180` | **NOT_VERIFIED** for #127 | Re-run the Growth gate on each stacked branch | W2 | **YES** |
| A9 | Growth real-extension flow opt-in, CI does not set it | Confirmed. `capture-extension.spec.ts:91` `test.skip(!process.env.GROWTH_E2E_REAL_EXTENSION, ...)`. Sole skip in the Growth tree | **OPEN** | Add a dedicated headed job; do not fold into the mock gate | W3 | NO (release-blocker for Growth GA only) |
| A10 | `PRODUCTION_GROWTH_DIGEST=NOT_VERIFIED`, image carried forward | **Worse than recorded.** Host serves `last-modified: 2026-08-21`. `GROWTH_BOOTSTRAP_DIGEST` confirmed unset. No `/version` on the Growth host | **OPEN** | Publish image, pin digest, add provenance endpoint | W4 | **YES** (Growth release) |
| A11 | "Investigate quarantined tests" (#127 blocker) | `EasyMod-backend/tests/quarantine.json` ceiling 2, both entries **non-Growth** (`chatbot-rag`, `smart-payment-detection`). **No Growth quarantine debt exists** | **INCORRECT** | Drop from the Growth blocker list | none | NO |
| A12 | `TEST_DISCOVERY: BLOCKED` — 5 untracked backend test files | Later #127 receipt claims discovery passes; unresolved in docs | **NOT_VERIFIED** | Run `check-test-discovery.js` on the rebased branch | W2 | NO |
| A13 | PR #126 `VERDICT=BLOCKED`, ENOSPC, no deterministic toolchain | Root cause confirmed + **extended**: ENOSPC no longer reproduces (D: 157.8 GB free); `JAVA_HOME`=JDK 8 and `ANDROID_HOME` unset are unrecorded blockers | **PARTIALLY_RESOLVED** | Toolchain pinning must include JDK 17 + `ANDROID_HOME`, not only disk/path | W2 | **YES** |
| A14 | `MOBILE_NATIVE_BUILD=NOT_VERIFIED` | Confirmed. Zero committed APK/AAB/hash/log. The one `ANDROID_BUILD=PASS` claim (Phase 1) is uncorroborated prose and is contradicted by two later documented failures | **OPEN** | Full native proof chain | W2 | **YES** |
| A15 | `MOBILE_DEVICE_E2E=NOT_VERIFIED`, "Maestro runs only smoke.yaml" | **INCORRECT — understated.** There is no `.maestro/` dir, no flow YAML, no Maestro binary, no npm script. `smoke.yaml` **does not exist** | **INCORRECT** | Author flows from zero; budget accordingly | W3 | **YES** |
| A16 | Mobile CI green = validation only | Confirmed. 5 jobs: isolation-guard, protected-paths, gitleaks, mobile (tsc/lint/jest/audit), backend-regression. **No gradle, no emulator, no setup-java** | **RESOLVED** (accurate) | Add native job per §15 | W2 | **YES** |
| A17 | P1: Redis outage widens Growth attack surface | **Partially wrong.** Growth *authz* **fails CLOSED** (`GROWTH_OS_REDIS_UNAVAILABLE` 503, verified in `growth-os.middleware.js`). Only *rate limiting* falls back to per-process MemoryStore, and authz 503s first | **PARTIALLY_RESOLVED** | Keep fail-closed. Fix the fail-open limiter for partial degradation | W2 | NO |
| A18 | `docs/growth-os/*` stale (`CURRENT_MAIN: cf634fab`) | Still stale **on main** — the reconciliation lives in unmerged #129. `GROWTH_OS_CURRENT_STATE.md` still says follow-ups are `MISSING` though #127 implements them | **OPEN** | Re-anchor after #129 and each stacked merge | A7 | NO |
| A19 | Mobile backend must land on main | Confirmed absent from main (32 files) | **OPEN** | Flags-off backend PR (owner decision 4) | W1 | **YES** |
| A20 | `MOBILE_*` flags all false / not provisioned | Confirmed. Kill-switch returns **404**, not 403 | **RESOLVED** (accurate) | Keep 404 shape; assert in tests | — | NO |

**Net:** 2 audit findings are **INCORRECT** (A2, A11), 1 is **INCORRECT by
understatement** (A15), 4 are **PARTIALLY_RESOLVED** with changed root causes
(A3, A4, A13, A17), and 1 is **SUPERSEDED** (A6). The rest stand.

---

## 4. Growth OS current state

**Merged and live on main:** Growth backend module (26 files: routes, middleware,
permissions, 3 entities, controllers, services, repository, prospect
scope/identity/lifecycle/validator + 8 tests), `EasyMod-growth/` SPA (85 files,
React 18 + Vite 7 + Vitest 4 + Playwright), `docs/growth-os/` (9 files),
`growth-os.yml`, `grant-growth-role.yml`, 3 Growth migrations.

**In PR #127, not on main:** `EasyMod-extension/` (14 files, Chromium MV3),
5 migrations (2 Growth schema, 1 followups, 1 notes, **1 that alters the shared
`users` table**), 15 more backend growth-os files, `docs/growth-os/05-*` and
`06-*`, plus edits to `rag`, `shop`, `subscription`, `order`, `rto-shield`,
`consent`, `admin`, `analytics`, `audit`, `cache.service.js`, `AppError.js`,
`auth`/`csrf` middleware.

**Authorization model** (`growth-os.middleware.js`): reuses merchant
`authenticate`, then applies a default-deny Growth role layer. Four independent
denials — `503 GROWTH_OS_DISABLED` when the flag is off; `403 GROWTH_OS_FORBIDDEN`
without an active role; `403 GROWTH_OS_MERCHANT_CONTEXT_FORBIDDEN` if
`req.user.shopId` is present; `403 GROWTH_OS_MFA_REQUIRED` for SUPER_ADMIN /
FOUNDER / GROWTH_MANAGER without `mfaVerified`. Non-`AppError` throws become
`503 GROWTH_OS_AUTHZ_UNAVAILABLE` — **fail-closed**. PR #127 collapses six legacy
roles to a canonical two (`SUPER_ADMIN`, `GROWTH_USER`); legacy strings stay in
the enum as compatibility-only and are never grantable.

**Browser extension:** minimal by design — `activeTab`, `scripting`, `storage`;
`host_permissions` only `https://growth.easymod.tech/*`. **There is no network
relay.** The service worker "never performs network requests and never touches
cookies/history." Capture flows operator → popup → `chrome.storage.session`
(128-bit nonce, 5-min TTL) → `/capture?captureNonce=` → content bridge →
`sessionStorage` → SPA. All backend traffic is the SPA's own authenticated
session. Social hosts are rejected at capture time.

**Isolation:** no `shop_id` column on any `growth_os_*` table, by design. Growth
identities are global and forbidden from carrying shop context. Row scoping is
application-level and fail-closed (`'none'` scope becomes `id IS NULL`).

**Release posture:** gated off at three independent points, serving a month-old
image, with no runtime provenance.

---

## 5. Growth OS remaining-task matrix

| ID | Task | Branch | Complexity | Risk | Deps | CI cost | Ext. creds | Human | Parallel |
|---|---|---|---|---|---|---|---|---|---|
| G-0 | Rebase #129 onto `befcb180`; split workflow changes from doc changes; merge | `fix/ci-remediation-rebase` | MED | MED | A1 | low | no | review | no |
| G-1 | Push S-2 branch, open PR, full gate | `fix/membership-revocation-lifecycle` | LOW | MED | G-0 | med | no | review | no |
| G-2 | Reconstruct #127 part 1: growth-core + 4 Growth migrations | `fix/growth-core-reconciliation` | HIGH | MED | G-1 | med | no | review | no |
| G-3 | Reconstruct #127 part 2: auth/temp-password (+`users` migration) | `fix/growth-temp-password-auth` | MED | **HIGH** | G-2 | med | no | review | no |
| G-4 | Reconstruct #127 part 3: `EasyMod-extension/` | `feat/growth-browser-extension` | MED | LOW | G-2 | low | no | review | **yes** (with G-3) |
| G-5 | Reconstruct #127 part 4: non-Growth module edits, individually justified | `fix/growth-shared-module-edits` | MED | MED | G-3 | med | no | review | no |
| G-6 | Migration rollback rehearsal on production-shaped data, incl. `users` alter | `test/growth-migration-rollback` | MED | HIGH | G-3 | med | dump access | **YES** | yes |
| G-7 | Fix fail-open rate limiter under partial Redis degradation | `fix/growth-ratelimit-failmode` | LOW | LOW | G-2 | low | no | no | yes |
| G-8 | Real-extension E2E job (`GROWTH_E2E_REAL_EXTENSION=1`, headed Chromium) | `test/growth-extension-real-flow` | MED | MED | G-4 | **high** | no | no | yes |
| G-9 | Merchant regression matrix (§14) | `test/growth-merchant-regression` | MED | MED | G-5 | high | no | no | yes |
| G-10 | Add `/version` provenance endpoint to the Growth host | `feat/growth-runtime-provenance` | LOW | LOW | G-2 | low | no | no | yes |
| G-11 | Publish Growth image, capture digest, **document** `GROWTH_BOOTSTRAP_DIGEST` | `ops/growth-image-provenance` | LOW | MED | G-10 | low | GHCR | **YES** (set var) | no |
| G-12 | Founder bootstrap procedure via `grant-growth-role.yml` (documented, not run) | `docs/growth-operator-bootstrap` | LOW | MED | G-11 | none | env secret | **YES** | yes |
| G-13 | Re-anchor `docs/growth-os/*` on the new state | `docs/growth-os-reanchor` | LOW | LOW | G-5 | none | no | no | yes |

**Explicitly dropped:** "investigate quarantined tests" (A11 — no Growth
quarantine exists) and "PostgreSQL/Redis integration" as *new* work (already
green in the `browser-e2e` job with `postgres:16-alpine` + `redis:7-alpine`).

---

## 6. Growth architecture findings

The 8 files PR #127 and main both changed — the entire mechanical rebase surface:

| File | #127 | main | Verdict |
|---|---|---|---|
| `EasyMod-backend/src/modules/auth/auth.service.js` | +222/-46 | +4 | **FIX — highest semantic risk.** Temp-password/forced-change/session-invalidation rewrite vs main's signup-consent. Needs a dedicated regression suite, not a diff read |
| `EasyMod-frontend/src/app/components/Signup.tsx` | -1 | +72/-10 | **FIX** — #127 deletes one line from a file #128 rewrote. Verify the consent checkbox survives |
| `EasyMod-backend/src/modules/auth/auth.validator.js` | +23/-2 | +9/-1 | FIX — verify both validators compose |
| `EasyMod-backend/src/modules/auth/__tests__/auth.test.js` | +97 | +87 | FIX — union both suites, no drops |
| `EasyMod-backend/src/jobs/message-worker.js` | +8/-7 | +15 | FIX — #134 grounding work |
| `.../__tests__/message-worker.grounding.test.js` | +1/-1 | +38 | FIX |
| `.github/workflows/ci-cd.yml` | +56/-8 | +20/-2 | FIX — also collides with #129 |
| `.gitleaks.toml` | +10 | +10 | **KEEP** — byte-identical blob, auto-merges |

Component review:

- **Growth authz — KEEP.** Fail-closed at four independent points, MFA-gated,
  merchant-context-forbidden. Correct as designed. Do not soften.
- **Redis role cache — KEEP the fail-closed behaviour.** A stale allow surviving
  a role revocation on another instance is the failure it prevents. Accept the
  503 blast radius: Growth is an internal staff surface, not merchant-facing.
- **Redis rate limiting — FIX.** Silently degrades to per-process `MemoryStore`.
  Unreachable in a full outage (authz 503s first) but wrong under *partial*
  degradation, where N instances each get an independent quota. Make it
  fail-closed to match authz, or log loudly and halve the quota.
- **Browser extension — KEEP.** No network egress, no cookie access, nonce-bound
  single-claim handoff, first-party-only content scripts. This is a good design.
  The gap is *proof*, not architecture: the only real-flow test is opt-in and CI
  never sets the flag.
- **`ci-cd.yml` `changes` filter — SIMPLIFY.** PR #127 widens the Growth trigger
  to `EasyMod-backend/*`, so **every backend PR would pay the full Growth
  browser-E2E cost**. Narrow it to the backend paths Growth actually contracts on
  (`modules/growth-os/**`, `entities.js`, `auth/auth.service.js`,
  `auth/totp.controller.js`, `analytics/growth-metrics.service.js`, `database/**`).
- **`20260914_001_add_temporary_password_controls` — FIX/ISOLATE.** The only
  migration in the set touching a **shared merchant table** (`users`). It must not
  ride in a "Growth" PR. This is why G-3 is its own branch.
- **Non-Growth module edits (rag/shop/subscription/order/rto-shield/consent) —
  REMOVE_CANDIDATE.** They neither overlap main nor are Growth-scoped. Each needs
  an individual justification in G-5 or it comes out.
- **Growth deployment separation — KEEP.** Own image, own host, own pipeline, no
  coupling to the merchant deploy. Justified.
- **Growth runtime provenance — FIX.** No `/version`, no digest pin, image
  carried forward for a month. This is the single largest operational gap.
- **Audit logs — KEEP.** `USER_SHOP` audit records with old/new values; audit
  failure is non-blocking and cannot undo revocation. Correct ordering.
- **Retry/idempotency — DEFER.** No Growth queue, no BullMQ job, no background
  automation exists. Nothing to make idempotent yet. Revisit when automation lands.

---

## 7. Growth execution waves

- **Wave 1 (shared):** G-0, G-1.
  *Entry:* A1 ruleset strengthened. *Exit:* #129 and S-2 merged to main; CI green
  on `befcb180`+2; production redeployed to current main.
- **Wave 2 (reconciliation):** G-2 → G-3 → G-5, with G-4, G-6, G-7 in parallel.
  *Entry:* Wave 1 exit. *Exit:* all four stacked PRs merged, every Growth gate
  re-run on the post-merge SHA, `check-test-discovery.js` green.
- **Wave 3 (proof):** G-8, G-9, G-10.
  *Entry:* Wave 2 exit. *Exit:* real-extension flow passes headed; merchant
  regression matrix green; `/version` live on the Growth host in staging shape.
- **Wave 4 (release-ready, stops at the gate):** G-11, G-12, G-13.
  *Exit:* Growth image published and digest captured; bootstrap procedure written
  and reviewed; docs re-anchored. **Three flag flips remain unexecuted and
  require separate written authorization.**

---

## 8. Mobile current state

`EasyMod-mobile/` — 74 files, Expo `~57.0.22`, React Native `0.86.3`, React
`19.2.3`, expo-router `~57.0.21`, TanStack Query `^5.102.8`, expo-secure-store
`~57.0.4`, TypeScript `~6.0.3`. **Deliberately not an npm workspace** (root
`workspaces` lists only backend/frontend/growth; ADR M-001). Own lockfile, own
`.nvmrc` (22 vs root 20).

**What works:** transport layer with 15s timeout and `X-EM-Client` header;
single-flight 401 refresh with exactly one retry; access token in memory, refresh
token in SecureStore with corrupt-keystore degradation; deep-link idempotency
guard (1500 ms); `+native-intent` malformed-URL guard; route-level
`<Stack.Protected>`; NetInfo offline banner; i18n en/bn; a genuinely good
**generated** contract fixture (`native-auth-responses.json`) consumed by
`native-auth-contract.test.ts` through the *production* Zod schemas.

**What does not exist:** every tab screen is a `PlaceholderScreen`; zero calls to
`/api/mobile/*`; no 2FA UI (a 2FA user gets "Unexpected sign-in response shape"
because `signinDataSchema` requires `accessToken` and the backend returns
`requires2fa` + `tempToken` at HTTP 200); `deeplink-entity` is wired to
`placeholderResolver` returning `found` unconditionally; no TanStack persistence
(ADR M-011 unimplemented); no push/FCM client; Sentry is an inert no-op; no
`versionCode`/`versionName` anywhere (delegated to EAS `appVersionSource: remote`,
never materialised); `EasyMod-mobile/README.md` is untouched `create-expo-app`
boilerplate.

**Native:** `android/` and `ios/` are gitignored — CNG via prebuild. Three
recorded build attempts: one uncorroborated `PASS` (prose only, no artifact), one
`BUILD FAILED` on `CMAKE_OBJECT_PATH_MAX`, one that cleared the path problem
(92/107 reanimated objects) then hit ENOSPC. **No APK has ever been proven.**

**Backend:** 9 endpoints (7 native-auth, 2 mobile), all behind a
`MOBILE_API_ENABLED` 404 gate. `/api/mobile/*` uses `authenticate` +
`verifyShopAccess` (the membership-checking variant, not `requireShop`) — correct.
All of it exists only on `feature/mobile-app`.

---

## 9. Mobile remaining-task matrix

| ID | Task | Branch | Complexity | Risk | Deps | CI cost | Ext. creds | Human | Parallel |
|---|---|---|---|---|---|---|---|---|---|
| M-0 | Backend-only PR to main: `modules/mobile`, `auth/native`, 5 flags **all false**, migration, middleware edits | `feat/mobile-backend-to-main` | MED | MED | G-1 | med | no | review | no |
| M-1 | Rebase `feature/mobile-app` onto main after M-0; drop the now-duplicated backend delta | `chore/mobile-rebase-on-main` | MED | MED | M-0 | med | no | review | no |
| M-2 | Merge #130 (concurrency) then #126 (build docs) into `feature/mobile-app` | — | LOW | LOW | M-1 | low | no | review | no |
| M-3 | **Deterministic toolchain** (§11) + preflight script | `fix/mobile-native-build` | MED | MED | M-2 | low | no | **YES** (install JDK 17) | no |
| M-4 | Clean `expo prebuild --clean` + `assembleDebug` from a short path | `fix/mobile-native-build` | MED | HIGH | M-3 | med | no | no | no |
| M-5 | Release build + signing keystore policy | `fix/mobile-native-release` | MED | HIGH | M-4 | med | **keystore** | **YES** | no |
| M-6 | Artifact manifest: SOURCE_SHA / TOOLCHAIN / PROFILE / ABIS / PATH / SIZE / SHA256 | `fix/mobile-native-release` | LOW | LOW | M-5 | low | no | no | no |
| M-7 | ADB install + cold/warm launch + resume + upgrade-install receipts | `test/mobile-install-launch` | LOW | MED | M-6 | none | device | **YES** | no |
| M-8 | **Feature: Home + attention tiers client** for `/api/mobile/attention` + `/today` | `feat/mobile-home-attention` | HIGH | MED | M-2 | med | no | no | **yes** |
| M-9 | **Feature: 2FA UI** — widen schema to the `requires2fa` branch, add verify screen | `feat/mobile-2fa` | MED | **HIGH** | M-2 | med | no | no | yes |
| M-10 | **Feature: real deep-link entity resolver** replacing `placeholderResolver` | `feat/mobile-deeplink-resolver` | MED | MED | M-8 | med | no | no | yes |
| M-11 | **Feature: offline cache** (ADR M-011 persisted read-only, allowlisted queries) | `feat/mobile-offline-cache` | MED | MED | M-8 | low | no | no | yes |
| M-12 | Contract fixture regeneration **in CI**, not by hand | `test/mobile-contract-ci` | MED | MED | M-0 | med | no | no | yes |
| M-13 | Maestro harness from zero: runner, binary pin, flow dir, npm script | `test/mobile-device-e2e` | MED | MED | M-7 | **high** | no | no | no |
| M-14 | Device E2E flows (§13) | `test/mobile-device-e2e` | HIGH | MED | M-13, M-8..M-11 | **high** | no | no | no |
| M-15 | Native CI job per §15 recommendation | `ci/mobile-native-gate` | MED | MED | M-4 | **high** | no | no | yes |
| M-16 | Re-anchor `docs/mobile/*` on real receipts; retract the Phase 1 `ANDROID_BUILD=PASS` claim | `docs/mobile-reanchor` | LOW | LOW | M-7 | none | no | no | yes |

---

## 10. Mobile architecture findings

- **Standalone, not a workspace member — KEEP.** ADR M-001 is sound. It protects
  the Node 22 / Node 20 split and keeps React 19.2 + RN 0.86 out of the backend
  resolution tree. Cost is a duplicated lockfile; that is the right trade.
- **But the contract test violates the boundary — FIX.**
  `native-auth-contract.test.ts` reaches across with
  `path.join(__dirname,'..','..','..','EasyMod-backend',...)`. A package that is
  "never a workspace member" is file-path-coupled to a sibling's test tree.
  Publish the fixture as a versioned artifact, or have mobile CI fetch it from
  the backend job. This matters more after M-0, when backend lives on main and
  mobile on a feature branch.
- **Fixture is a static snapshot — FIX (M-12).** It is generated by the backend
  integration suite, but mobile CI never regenerates it. Drift is caught only if
  someone re-runs the backend suite *and* commits the result. The mechanism is
  good; the trigger is missing.
- **Single-flight refresh — KEEP.** Correct handling of the reuse-detected case:
  drop everything and sign out. One subtle issue: on a *network throw* it clears
  the access token but leaves the refresh token. That is defensible (transient
  failure should not log you out) but must be an explicit device-E2E assertion.
- **404 kill switch — KEEP.** Flag-off is indistinguishable from a nonexistent
  route. Correct for an unannounced surface.
- **`apiRequest` has zero call sites — FIX.** An entire typed client layer is
  unexercised outside tests. M-8 must consume it rather than bypass it.
- **No `versionCode`/`versionName` — FIX before M-5.** `appVersionSource: remote`
  means EAS owns version codes. A locally-built release APK will have no
  meaningful version identity, and upgrade-install (M-7) cannot be tested without
  two distinct codes.
- **`newArchEnabled: true` + `reactCompiler: true` — RISK, do not change yet.**
  Both are on. Combined with reanimated 4.5.1 this is the most likely source of
  native build surprises after the path/JDK issues clear. Record it; do not
  pre-emptively disable.
- **mobile-ci `backend-regression` is not in the gate's `needs` — FIX.** A
  backend-regression failure does not fail the `Mobile CI` verdict. Either gate
  it or rename it so nobody reads it as a gate.

---

## 11. Deterministic Android build environment (M-3)

Pin exactly. Every value below is chosen against evidence from this workstation.

| Component | Pin | Why |
|---|---|---|
| Node | **22.x** (`EasyMod-mobile/.nvmrc`) | Host runs **v25.6.1**, unsupported by Expo SDK 57. Must be corrected. |
| npm | bundled with Node 22 (10.x) | Host npm 9.9.4 is inconsistent with Node 25. |
| JDK | **17** (`C:\Program Files\Java\jdk-17`, already installed) | `JAVA_HOME` currently points at **JDK 8**. RN 0.86/AGP require 17. **Primary unrecorded blocker.** |
| Gradle | wrapper only, from prebuild | Never use a global `gradle`; none is on PATH anyway. |
| Android SDK | `D:\Android\Sdk` via **`ANDROID_HOME` + `ANDROID_SDK_ROOT`** | Both are unset; the 21.86 GB SDK at `D:\Android` is undiscoverable. |
| build-tools / platform | pin to what RN 0.86 templates request; record actual | Do not float. |
| NDK / CMake | **CMake 3.22.1 + ninja 1.10.2** as installed | PR #126 verified these version-gate the long-path fix. Upgrading CMake ≥4 / ninja ≥1.12 is an *alternative* fix — do not mix both. |
| Expo | `npx expo prebuild --platform android --clean` | `--clean` is mandatory; prior runs used bare `prebuild`. |

**Preflight script (fail the build, do not warn):**

1. `ANDROID_HOME` and `ANDROID_SDK_ROOT` set and pointing at an existing SDK.
2. `java -version` reports 17.
3. `node --version` reports 22.
4. Checkout path length **< 120 chars**. PR #126's arithmetic: the deep worktree
   prefix produced a **267-char** object path (over the ~250 `CMAKE_OBJECT_PATH_MAX`
   ceiling); `D:/easymod/mob-buildfix` produced **229**. Budget headroom.
5. Free space **≥ 15 GB on the build drive AND ≥ 15 GB on `C:`** — Gradle
   (11.04 GB) and `.android` (4.88 GB) caches live on C:, which has only 35.5 GB
   free. Optionally relocate via `GRADLE_USER_HOME`.
6. No pre-existing `EasyMod-mobile/android/` or `.cxx/`.

**Do not rely on:** an NTFS junction (PR #126 proved AGP resolves the real path —
"the junction is a no-op for this specific failure"); `LongPathsEnabled=1`
(already `1`, and irrelevant to `CMAKE_OBJECT_PATH_MAX` at this CMake/ninja
version); any previously warmed Gradle cache; machine-global state.

---

## 12. Mobile build matrix (M-5, M-6)

ABI decision, justified rather than maximal — EasyModerator is a Bangladesh
merchant platform (bKash, Pathao, Steadfast, RedX), so low-end 32-bit ARM devices
are a real part of the install base.

| Artifact | Profile | ABIs | Required? | Rationale |
|---|---|---|---|---|
| Debug APK | `development` | `x86_64` + `arm64-v8a` | **YES** | x86_64 for emulator E2E; arm64 for physical devices. |
| Release APK | `preview` | `arm64-v8a` + `armeabi-v7a` | **YES** | Internal beta sideload. armeabi-v7a is justified by the target market. |
| Release AAB | `production` | all, via Play splits | **YES, at store submission only** | `eas.json` production is already `app-bundle`. Not a per-release-PR gate. |
| x86 (32-bit) | — | — | **NO** | No supported emulator or device target needs it. Explicitly excluded. |

Record for every artifact, in a committed manifest (not prose):

```
SOURCE_SHA= TOOLCHAIN=node/jdk/sdk/ndk/cmake/gradle BUILD_PROFILE= ABIS=
PATH= SIZE= SHA256= BUILD_DURATION= BUILD_LOG_ARTIFACT=
```

`.gitignore` forbids committing `*.apk`/`*.aab` — correct. Commit the **manifest
and the hashes**; upload the binaries as CI artifacts.

---

## 13. Mobile device E2E flows (M-14)

Four tiers, never collapsed into one PASS:

- **MOCKED** — Jest, no device. Already exists (11 files).
- **DISPOSABLE BACKEND** — emulator + ephemeral Postgres/Redis + seeded shop.
- **REAL DEVICE** — physical handset, disposable backend.
- **PRODUCTION-SMOKE** — read-only, flags on, explicitly authorized.

| Flow | Tier | Depends on feature |
|---|---|---|
| Login success / wrong password / locked | DISPOSABLE | exists |
| **2FA challenge → verify → session** | DISPOSABLE | **M-9** |
| Logout (server + client) | DISPOSABLE | exists |
| Session expiry → silent refresh → continue | DISPOSABLE | exists |
| Refresh-token reuse → forced sign-out | DISPOSABLE | exists |
| Invalid/tampered token rejected | DISPOSABLE | exists |
| Cold launch → restored session | REAL DEVICE | exists |
| App restart / process death / resume | REAL DEVICE | exists |
| **Home renders attention tiers** | DISPOSABLE | **M-8** |
| **Empty state (no attention items)** | DISPOSABLE | **M-8** |
| **API 500 error state** | DISPOSABLE | **M-8** |
| **Backend offline** | DISPOSABLE | **M-8** |
| **Device offline → banner → reconnect** | REAL DEVICE | **M-8 + M-11** |
| **Server recovery mid-session** | DISPOSABLE | **M-8** |
| **Deep link to real order/conversation** | DISPOSABLE | **M-10** |
| **Deep link to another shop's id → `unavailable`, indistinguishable from not-found** | DISPOSABLE | **M-10** |
| Malformed deep link → `/` | DISPOSABLE | exists |
| Duplicate deep-link tap suppressed (<1500 ms) | DISPOSABLE | exists |
| **Shop isolation: two shops, no cross-read** | DISPOSABLE | **M-8** |
| Shop switch via `/api/auth/native/switch-shop` | DISPOSABLE | M-8 |

**11 of 20 flows are blocked on feature work that does not exist.** That is the
honest sequencing constraint behind Wave 3.

> Hard constraint carried forward from `docs/mobile/CURRENT_STATE.md` §14:
> **no phase may perform a live outbound send against a real Meta Page.**

---

## 14. Test / gate matrix

### Growth

| Gate | WHAT_RUNS | WHERE | MERGE | RELEASE | SKIPPABLE |
|---|---|---|---|---|---|
| GROWTH_UNIT | `npm test -w easymod-growth` | `growth-os.yml/verify` | YES | YES | no |
| GROWTH_TYPECHECK | `tsc --noEmit` | same | YES | YES | no |
| GROWTH_BUILD | `npm run build -w easymod-growth` | same | YES | YES | no |
| BACKEND_UNIT | backend jest | `ci-cd.yml/test` | YES | YES | no |
| BACKEND_SECURITY | `npm run test:security` | `ci-cd.yml/test` | YES | YES | no |
| POSTGRES + REDIS | pg16 + redis7 services | `growth-os.yml/browser-e2e`, `ci-cd.yml/integration` | YES | YES | no |
| MIGRATION_UP | migrate on disposable pg | browser-e2e | YES | YES | no |
| MIGRATION_DOWN | **G-6, production-shaped** | manual rehearsal | no | **YES** | no |
| SCHEMA_DRIFT | drift audit | integration | YES | YES | no |
| BROWSER_E2E (mock) | Playwright vs dev server | browser-e2e | YES | YES | no |
| BROWSER_E2E (disposable real) | Playwright + real backend | browser-e2e | YES | YES | no |
| EXTENSION_UNIT | `node --test` ×4 + `validate:extension` | `verify` (PR-only, from #127) | YES | YES | no |
| EXTENSION_REAL_FLOW | `GROWTH_E2E_REAL_EXTENSION=1` headed | **G-8, new job** | no | **YES** | no |
| MERCHANT_REGRESSION | §14 matrix below | `ci-cd.yml/frontend-e2e` | YES | YES | no |
| META_SHAPED | signed-webhook harness | `ci-cd.yml/meta-e2e` | YES | YES | no |
| LIVE_HOST / TLS | curl + browser on growth.easymod.tech | manual | no | **YES** | no |
| OBSERVABILITY | `/version` + Caddy logs + alert delivery | manual | no | **YES** | no |

**Merchant regression — evidence-derived.** 13 E2E specs exist; CI runs only
**4** (`ai-reply-mode`, `shared-inbox`, `signup-terms`, `meta-oauth-contract`).
The 9 not run: `core-app`, `courier-setup`, `integration-flows`, `llm-settings`,
`meta-platform`, `notification-system`, `order-management`, `payment-settings`,
`pricing`.

Minimum required additions, chosen by actual code overlap with Growth/S-2:

| Merchant area | Spec | In CI? | Required because |
|---|---|---|---|
| signup | `signup-terms` | YES | G-3 touches `auth.service.js`/`Signup.tsx` |
| authentication | `core-app` | **NO → ADD** | G-3 + S-2 rewrite auth/session |
| subscription | `pricing`, `payment-settings` | **NO → ADD** | #127 edits `subscription` module |
| dashboard | `core-app` | **NO → ADD** | S-2 changes shop-access middleware |
| Meta onboarding | `meta-oauth-contract` | YES | — |
| Meta platform | `meta-platform` | **NO → ADD** | #127 edits `channel-providers` |
| AI reply | `ai-reply-mode` | YES | — |
| conversations | `shared-inbox` | YES | — |
| orders | `order-management` | **NO → ADD** | #127 edits `order`, `rto-shield` |
| notifications | `notification-system` | **NO → ADD** | S-2 + #119 change membership fan-out |
| products | `integration-flows` | **NO → ADD** | #117 tenant isolation |

→ **Add 8 specs to the CI set** (G-9). `courier-setup` and `llm-settings` stay out
— no overlap with either track.

### Mobile

| Gate | WHAT_RUNS | WHERE | MERGE | RELEASE | SKIPPABLE |
|---|---|---|---|---|---|
| MOBILE_TYPECHECK | `tsc --noEmit` | `mobile-ci/mobile` | YES | YES | no |
| MOBILE_LINT | `eslint .` | same | YES | YES | no |
| MOBILE_UNIT | `jest --ci` | same | YES | YES | no |
| MOBILE_SECURITY | gitleaks `--log-opts=--all` | `mobile-ci/gitleaks` | YES | YES | no |
| MOBILE_AUDIT | `npm audit --audit-level=high` | `mobile-ci/mobile` | YES | YES | no |
| BACKEND_REGRESSION | security+unit+migrate+integration | `mobile-ci/backend-regression` | **currently NOT gated — FIX** | YES | no |
| BACKEND_CONTRACT | regenerate fixture, diff, fail on drift | **M-12, new** | YES | YES | no |
| ANDROID_DEBUG | prebuild --clean + assembleDebug | **M-15, new** | **YES (mobile paths)** | YES | no |
| ANDROID_RELEASE | assembleRelease + bundleRelease | **M-15, release-gated** | no | **YES** | no |
| ARTIFACT_HASH | SHA256 manifest | M-15 | no | **YES** | no |
| APK_INSTALL / APK_LAUNCH | adb install + cold/warm launch | M-7, manual+CI | no | **YES** | no |
| MAESTRO_SMOKE | auth/logout/restart | M-13, nightly + release | no | **YES** | no |
| MAESTRO_SUPPLEMENTARY | §13 remainder | M-14, nightly | no | **YES** | yes, with named flow |
| OFFLINE / SESSION_EXPIRY / TWO_FACTOR / DEEP_LINK / SHOP_ISOLATION | §13 | M-14 | no | **YES** | no |

---

## 15. CI-cost strategy

**Measured:** `mobile-ci.yml` currently runs **4–7 min** wall-clock, JS-only, with
observed duplicate push+PR same-SHA pairs (audit: 10 exact pairs). PR #130's
concurrency block fixes the duplication and must merge first. Growth
`browser-e2e` (Chromium + pg16 + redis7) is the most expensive existing gate.

**Recommendation: HYBRID.**

| Job | Cadence | Est. | Justification |
|---|---|---|---|
| `assembleDebug`, **compile-only, no emulator** | **REQUIRED_ON_EVERY_PR** touching `EasyMod-mobile/**` | 15–25 min cold, 8–12 min cached | There is **zero CI evidence anywhere** that this app compiles natively. This is the single highest-leverage gap and PR #126 independently reached the same conclusion. Compile-only on a GitHub-hosted Linux runner also sidesteps every Windows path-length issue. |
| `assembleRelease` + `bundleRelease` + hashes | **REQUIRED_ON_RELEASE_PR** (label `mobile-release`) | 25–40 min | Needs signing material; too costly per PR. |
| Emulator + Maestro | **NIGHTLY** on `feature/mobile-app` + required on release PR | 20–40 min, flaky | ADR M-009 already specified a label gate; it was never implemented. Nightly catches drift without taxing every PR. |
| Contract fixture regeneration | every PR touching backend mobile routes **or** `EasyMod-mobile/src/auth/**` | +3 min | Cheap; closes the static-snapshot hole. |

**Do not** put an emulator on every PR. **Do not** solve cost by dropping the
compile gate — that is the one gate that currently proves nothing exists.

Growth cost control: narrow the `changes` filter (§6) so `EasyMod-backend/*` does
not trigger the full Growth browser gate on every backend PR.

---

## 16. External / human prerequisites

| # | Prerequisite | Blocks | Why it cannot be automated |
|---|---|---|---|
| H-1 | Strengthen the repository ruleset (required contexts, 1 review, no deletion, no admin bypass) | **everything** | Repo settings; the audit's single P0 |
| H-2 | Eligible GitHub plan **or** an equivalent deployment-control path | production gate as a real boundary | Billing — reviewer rule returned `422` |
| H-3 | Install/point `JAVA_HOME` at JDK 17; set `ANDROID_HOME`/`ANDROID_SDK_ROOT` | M-3 → all native | Machine-level change, explicitly out of agent scope |
| H-4 | Downgrade local Node to 22 (or provision a pinned portable Node) | M-3 | Machine-level |
| H-5 | Free ≥15 GB on `C:` or relocate `GRADLE_USER_HOME` | M-4 | 35.5 GB free with 16 GB of caches on C: |
| H-6 | Android signing keystore + secure storage policy | M-5 | Secret material |
| H-7 | Physical device or provisioned AVD (`Nexus_5_API_24` exists) | M-7, M-14 | Hardware |
| H-8 | Production-shaped DB dump for rollback rehearsal | G-6 | Data access |
| H-9 | Set `GROWTH_BOOTSTRAP_DIGEST` repo variable | G-11 | Repo settings |
| H-10 | Authorize the three Growth flag flips + cutover | Growth GA | **Explicitly out of scope per decision 3** |
| H-11 | Founder bootstrap secret `GROWTH_BOOTSTRAP_ACTOR_EMAIL` | G-12 | Protected environment secret |
| H-12 | Decide legacy `push_subscriptions.user_id IS NULL` disposition | #119 | Security sign-off on data |
| H-13 | Review `courier_dispatch_order_scope_conflicts` rows | #118 | Human reconciliation of real data |

---

## 17. Risk register

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R-1 | Splitting #127 loses work or diverges from the 204-file original | MED | HIGH | Reconstruct by cherry-pick onto a fresh branch; assert the union tree matches `1f4cd9de` except for deliberate exclusions, and diff it |
| R-2 | `auth.service.js` merge silently regresses signup consent (#128) or temp-password | MED | **HIGH** | Union both test suites; add the 8 merchant regression specs *before* G-3 merges |
| R-3 | `20260914_001` alters shared `users` with no rollback rehearsal | MED | **HIGH** | G-6 gates G-3's release; additive-only; rehearse `down` on a restored dump |
| R-4 | Someone rebases/force-pushes a dirty user worktree | LOW | **HIGH** | §18 rules; never touch `easy-moderator`, `mob`, or the 30+ existing worktrees |
| R-5 | S-2 branch stays unpushed and is lost or duplicated | **HIGH** | HIGH | G-1 is Wave 1. It is 1 commit ahead of `cf57db1e` with 1 trivial overlap — rebases cheaply today, expensively later |
| R-6 | Native build fails for a *fourth* unrelated reason (newArch + reactCompiler + reanimated 4.5.1) | MED | MED | Compile-only Linux CI job (M-15) isolates the toolchain from Windows; bisect by disabling newArch only if it actually fails |
| R-7 | Growth image published but never deployed; stale Aug-21 image persists | **HIGH** | MED | G-11 pins the digest; G-10 adds `/version` so staleness becomes observable |
| R-8 | Mobile contract fixture drifts undetected | MED | MED | M-12 regenerates in CI |
| R-9 | Feature work (M-8..M-11) expands without bound | MED | MED | Scope to exactly the queries ADR M-011 allowlists; no mutation queue |
| R-10 | Two agents edit the same branch | MED | HIGH | One task = one branch = one worktree (§18) |
| R-11 | Production drifts further behind main | MED | MED | Deploy `befcb180` in Wave 1 before any of this lands |
| R-12 | #129 and #127 both edit `ci-cd.yml`; merging in the wrong order clobbers hardening | **HIGH** | MED | G-0 merges **before** G-2..G-5; rebase the Growth stack on the post-#129 main |

---

## 18. Git branch / worktree plan

**Task 0 (first execution step):**

```bash
# from D:\easymod\platform-audit (NEVER from easy-moderator or mob)
git fetch origin --prune
git worktree add -b plan/growth-mobile-remaining-2026-09 \
    D:/easymod/growth-mobile-planning origin/main
# commit this document as docs/plans/GROWTH_MOBILE_REMAINING_EXECUTION_PLAN.md
```

**Never touch:** `D:\easymod\easy-moderator` (dirty, 34 files, on
`feat/shuru-growth-partner-commercial-model`), `D:\easymod\mob` (dirty), or any of
the ~30 other existing worktrees.

| Branch | Worktree | Base | Depends on |
|---|---|---|---|
| `plan/growth-mobile-remaining-2026-09` | `D:\easymod\growth-mobile-planning` | `origin/main` | — |
| `fix/ci-remediation-rebase` (G-0) | `D:\easymod\wt-ci-remediation` | `origin/main` | — |
| `fix/membership-revocation-lifecycle` (G-1) | **existing** `D:\easymod\membership-revocation` (clean) | rebase onto main | G-0 |
| `fix/growth-core-reconciliation` (G-2) | `D:\easymod\wt-growth-reconciliation` | post-G-1 main | G-1 |
| `fix/growth-temp-password-auth` (G-3) | `D:\easymod\wt-growth-auth` | G-2 | G-2 |
| `feat/growth-browser-extension` (G-4) | `D:\easymod\wt-growth-extension` | G-2 | G-2 |
| `fix/growth-shared-module-edits` (G-5) | `D:\easymod\wt-growth-shared` | G-3 | G-3 |
| `test/growth-os-release-proof` (G-6,8,9) | `D:\easymod\wt-growth-proof` | post-G-5 main | G-5 |
| `ops/growth-image-provenance` (G-10,11,12) | `D:\easymod\wt-growth-release` | post-G-5 main | G-5 |
| `feat/mobile-backend-to-main` (M-0) | `D:\easymod\wt-mobile-backend` | post-G-1 main | G-1 |
| `chore/mobile-rebase-on-main` (M-1,2) | `D:\easymod\wt-mobile-rebase` | `feature/mobile-app` | M-0 |
| `fix/mobile-native-build` (M-3..M-6) | `D:\easymod\wt-mobile-native` | post-M-2 mobile | M-2 |
| `feat/mobile-home-attention` (M-8) | `D:\easymod\wt-mobile-home` | post-M-2 mobile | M-2 |
| `feat/mobile-2fa` (M-9) | `D:\easymod\wt-mobile-2fa` | post-M-2 mobile | M-2 |
| `test/mobile-device-e2e` (M-13,14) | `D:\easymod\wt-mobile-e2e` | post-features | M-7 + features |
| `ci/mobile-native-gate` (M-15) | `D:\easymod\wt-mobile-ci` | post-M-4 mobile | M-4 |

**Rules.** One task = one branch = one worktree. One modifying agent per
worktree. Never force-push another agent's branch. Never rebase a dirty worktree.
Shared backend fixes land **once** on main, then dependent tracks rebase — never
fix the same defect on two long-lived branches. Use
`git show <ref>:<path>` to read cross-branch; never `checkout` the planning
worktree between `main` and `feature/mobile-app`.

---

## 19. Cross-track dependency graph

```
H-1 ruleset (P0, human)
  └─> G-0  #129 rebase + merge ──────────────┐   (must precede any ci-cd.yml edit)
        └─> G-1  S-2 membership revocation ──┤   AUTH · RBAC · MEMBERSHIP REVOCATION
              ├────────────────> GROWTH ─────┤
              │   G-2 core ─> G-3 auth ─> G-5 shared ─> G-6/8/9 proof ─> G-10/11/12 release-ready
              │            └─> G-4 extension (parallel)
              └────────────────> MOBILE ─────┘
                  M-0 backend->main (flags off) ─> M-1 rebase ─> M-2 merge #130,#126
                      ├─> M-3..M-7 native (serial)
                      ├─> M-8/M-9/M-10/M-11 features (parallel)
                      ├─> M-12 contract CI
                      └─> M-13/M-14 device E2E  [needs native AND features]
```

**Shared nodes — fix once, on main:**

| Node | Why shared |
|---|---|
| **AUTH / MEMBERSHIP REVOCATION** (S-2) | Touches `auth.middleware.js`, `shop-access.middleware.js`, `auth.service.js`, **and** `growth-os.routes.js` + 2 Growth tests. Growth authz and mobile native-auth both sit on it. **Must land before G-2 and M-0.** |
| **RBAC** | Growth roles and merchant `verifyShopAccess` share the middleware S-2 rewrites. |
| **API CONTRACTS** | The generated native-auth fixture is produced by the backend suite and consumed by mobile. M-0 moves the producer to main. |
| **BACKEND MIGRATIONS** | `20260914_001` (users, Growth) and `20260914_001_native_session_refresh_lineage` (Mobile) both alter shared auth surfaces. Sequence them; do not land in parallel. |
| **SHOP ISOLATION** | Growth forbids shop context; Mobile requires it. Same middleware, opposite assertions — test both. |
| **CI/CD** | `ci-cd.yml` is edited by #129, #127 and the mobile track. **R-12: order matters.** |
| **PRODUCTION DEPLOYMENT** | One `ci-cd.yml` deploy job carries backend, frontend and the Growth digest. |

Must land on main **before**: Growth rebase → G-0, G-1. Mobile backend rebase →
G-1. Mobile native release proof → M-0, M-2.

---

## 20. Exact execution order

**Wave 1 — shared foundations.** Entry: H-1 done. Exit: main carries #129 + S-2,
production redeployed to current main, CI green.
1. H-1 ruleset · 2. G-0 · 3. G-1 · 4. Deploy main to production (2 merges behind)
· 5. H-3/H-4/H-5 toolchain prerequisites (parallel, human)

**Wave 2 — reconciliation + native foundations.** Entry: Wave 1 exit.
Exit: Growth stack merged with all gates re-run on the post-merge SHA; a hashed
debug APK exists.
6. G-2 · 7. G-3 (+G-4 parallel) · 8. G-5 · 9. G-7 · 10. M-0 · 11. M-1 · 12. M-2 ·
13. M-3 · 14. M-4 · 15. M-15 · 16. M-12

**Wave 3 — proof + features.** Entry: Wave 2 exit.
Exit: Growth real-extension + merchant regression green; mobile features exist
and a release APK is installed and launched.
17. G-6 · 18. G-8 · 19. G-9 · 20. M-8 · 21. M-9 · 22. M-10 · 23. M-11 · 24. M-5 ·
25. M-6 · 26. M-7

**Wave 4 — release-ready.** Entry: Wave 3 exit. Exit: both tracks dispatchable;
no flag flipped without separate authorization.
27. G-10 · 28. G-11 · 29. G-12 · 30. G-13 · 31. M-13 · 32. M-14 · 33. M-16

---

## 21. Stop conditions

Halt and escalate rather than work around:

1. A gate that previously passed now fails on the **same** code and base — a real
   regression, never a flake, until proven otherwise.
2. Rebasing #127 produces a conflict in `auth.service.js`. Today's merge-tree says
   it will not; if it does, the tree changed underneath and the split must be
   re-derived from the new base.
3. Any migration rehearsal cannot roll back cleanly on production-shaped data.
4. `npm audit --audit-level=high` goes non-green on main.
5. A native build fails for a cause **not** in {path length, disk, JDK, SDK path}
   — stop and diagnose before adding workarounds (R-6).
6. Any task would require modifying `easy-moderator`, `mob`, or another dirty
   worktree.
7. Any task would require flipping `GROWTH_OS_ENABLED`,
   `PRODUCTION_DEPLOY_ENABLED`, or dispatching a production deploy — **decision 3
   excludes these**.
8. A Meta Page would receive a live outbound send.
9. The contract fixture must be hand-edited (`_generatedBy`: "do not hand-edit").
10. Two agents are found on the same branch or worktree.

---

## 22. Definition of done

**Growth — release-ready (stops at the gate):** #129 and S-2 on main; #127 landed
as four independently-gated PRs; every Growth gate re-run on the post-merge SHA
(not a historical base); migration rollback rehearsed on production-shaped data;
real-extension flow proven headed; the 8 added merchant specs green; `/version`
live on the Growth host; a Growth image published with its digest captured and
`GROWTH_BOOTSTRAP_DIGEST` documented; Founder bootstrap procedure written and
reviewed; `docs/growth-os/*` re-anchored. **The three flag flips and the cutover
remain unexecuted.**

**Mobile — internal beta ready:** backend on main with all five flags false and
404-verified; `feature/mobile-app` rebased with no duplicated backend delta; a
deterministic pinned toolchain with an enforcing preflight; a clean
`expo prebuild --clean` + debug and release builds for the §12 ABI set with a
committed SHA256 manifest; APK installed and launched on a real device with
receipts; Home/attention, 2FA, deep-link resolver and offline cache implemented;
`assembleDebug` required on every mobile PR in CI; contract fixture regenerated in
CI; Maestro harness plus the §13 flows running nightly; `docs/mobile/*` re-anchored
and the uncorroborated Phase 1 `ANDROID_BUILD=PASS` claim retracted.

---

## Final status block

```
GROWTH_CURRENT_STATUS=CONDITIONAL — core system is merged on main and the host is
  live with valid TLS; blocked on release plumbing and unverified runtime identity,
  not on code quality.
GROWTH_RELEASE_BLOCKERS=
  1. H-1 repository ruleset (single P0, unchanged since 2026-09-21)
  2. PR #129 unmerged — all CI/security remediation absent from main
  3. S-2 membership revocation committed locally but NEVER PUSHED
  4. PR #127 unreconciled (204 files; clean rebase, high semantic risk in auth.service.js)
  5. GROWTH_BOOTSTRAP_DIGEST unset -> Aug-21 image carried forward for ~1 month
  6. No /version endpoint on growth.easymod.tech -> zero runtime provenance
  7. Real-extension flow never executed in CI (GROWTH_E2E_REAL_EXTENSION unset)
  8. Migration rollback never rehearsed on production-shaped data (incl. users alter)
GROWTH_NEXT_ACTION=Strengthen the ruleset (H-1), then rebase and merge PR #129
  (G-0) before any other branch touches ci-cd.yml.

MOBILE_CURRENT_STATUS=BLOCKED — earlier than the docs imply. Every screen is a
  placeholder; no native artifact has ever been proven; device E2E harness does
  not exist.
MOBILE_RELEASE_BLOCKERS=
  1. 100% of the backend mobile surface (32 files) is absent from main
  2. Native build unproven — JAVA_HOME=JDK 8 (needs 17), ANDROID_HOME unset,
     Node v25.6.1 (needs 22). ENOSPC no longer reproduces: D: has 157.8 GB free
  3. All tab screens are PlaceholderScreen; zero calls to /api/mobile/*
  4. No 2FA UI — a 2FA user gets "Unexpected sign-in response shape"
  5. Deep-link resolver returns `found` unconditionally (placeholderResolver)
  6. No .maestro/ dir, no flow YAML, no runner — device E2E is at zero, not partial
  7. No Android job in CI: zero native evidence on any platform
  8. No versionCode/versionName -> upgrade-install untestable
MOBILE_NEXT_ACTION=Land the backend on main behind flags-off (M-0) once S-2 is in,
  and in parallel fix the toolchain (H-3/H-4) so M-3 can pin it.

SHARED_BLOCKERS=
  - H-1 repository ruleset (P0) gates everything
  - S-2 membership revocation: Growth authz AND mobile native-auth both depend on it
  - ci-cd.yml is edited by #129, #127 and the mobile track — order matters (R-12)
  - Production is 2 merges behind main and must be redeployed in Wave 1

PARALLEL_EXECUTION_LANES=4
  L1 Growth reconciliation : G-2 -> G-3 -> G-5
  L2 Growth extension+proof: G-4, G-7, G-8, G-10
  L3 Mobile backend+native : M-0 -> M-1 -> M-2 -> M-3 -> M-4 -> M-15
  L4 Mobile features       : M-8, M-9, M-10, M-11, M-12
  (L1/L2 converge at G-5; L3/L4 converge at M-13)

RECOMMENDED_FIRST_5_TASKS=
  1. H-1  Strengthen the repository ruleset: require PR Merge Gate + Security Scan,
          1 review, forbid deletion and force-push, close admin bypass.
  2. G-0  Rebase PR #129 onto befcb180, split workflows from docs, merge.
          Unblocks every later ci-cd.yml edit (R-12).
  3. G-1  Push fix/membership-revocation-lifecycle (14bab4a3), open a PR, run the
          full gate. It is 1 commit ahead of cf57db1e with 1 trivial overlap —
          cheap now, expensive later (R-5).
  4. Deploy main (befcb180) to production, closing the 2-merge gap, and capture
          /api/version as the new PRODUCTION_SHA receipt.
  5. H-3  Point JAVA_HOME at the already-installed JDK 17, set ANDROID_HOME/
          ANDROID_SDK_ROOT to D:\Android\Sdk, provision Node 22. Unblocks all
          native work and is pure machine setup — fully parallel with 1-4.

PLAN_STATUS=CONDITIONAL
BLOCKERS=
  - H-1 is a repository-settings change only the owner can make; without it every
    merge below remains advisory rather than gated.
  - H-2 required-reviewer protection returned HTTP 422 (billing plan). Until an
    eligible plan or an equivalent deployment-control path exists, the production
    environment gate is not a security boundary.
  - H-3/H-4/H-5 are machine-level changes (JDK 17, Node 22, C: headroom) that are
    explicitly outside agent scope and block every native task.
  - H-6 Android signing keystore does not exist; M-5 cannot start without it.
  - H-8 production-shaped DB dump is required before G-6 can gate G-3.
  - Decision 3 deliberately excludes the three Growth flag flips and the cutover,
    so Growth can reach release-ready but not GA within this plan.
```
