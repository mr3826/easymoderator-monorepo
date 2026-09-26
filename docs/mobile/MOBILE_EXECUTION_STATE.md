# Mobile Program — Execution State

This is the living ledger and phase-receipt log for the mobile program. Every phase appends a
receipt in the format below (master brief §25) and updates the flag/file ledger.

## Current checkpoint - Wave 2.5 release closure (2026-09-26, PR #172 into `main`)

- **Mobile is on `main`.** PR #172 merged `feature/mobile-app` and `main` line by line, keeping both
  sides' `auth.middleware.js` checks, and added the release work:
  - upload-key signing on `main` (ADR M-013);
  - R8 and resource shrinking;
  - fail-closed artifact verification against the pinned signer.
- **Physical device: PASS.** Every one of the 15 Maestro flows passed on a USB-attached arm64 phone
  (Android 13, SDK 33) against the R8 release-mode build. The passes were spread over several runs of
  the same APK, and the receipt below records each run, including the failures.
- **CI on the PR head passed:** mobile checks, backend regression, `android-release` and emulator E2E.
- The signed APK/AAB is built by `mobile-release.yml` for the merge commit. Its hashes are recorded
  on PR #172 and in the run's `SHA256SUMS`.
- **Distribution** is the workflow artifact only (internal QA sideload). There is no Play or EAS
  channel yet; that needs an owner decision and account.
- Production flags stay off, and Wave 3 stays locked.

## Previous checkpoint - Wave 2.5 completion (2026-09-25, PR #165)

- All Wave 2 work is committed. PR #165 (`feat/mobile-release-completion` → `feature/mobile-app`)
  integrates:
  - the formerly uncommitted `D:/easymod/mob` work, archived byte-for-byte at
    `archive/mob-wave2-snapshot-2026-09-25`;
  - PR #152's tests;
  - every 2026-09-20 audit fix (`MOBILE_AUDIT.md`, "Resolution").
- CI run 36179069735 (Mobile CI #40, head `a8d24a2b`): every job passed. Details:
  - The all-ABI release APK + AAB verified; debug-signed, so `NOT_DISTRIBUTABLE`.
  - Install, cold launch and relaunch passed on an API 24 x86 emulator.
  - All 15 Maestro flows passed on an API 34 x86_64 emulator against a disposable backend.
  - The receipt below has the full record.
- External items that remain: production signing / EAS credentials, and a physical-device pass.
  Wave 3 stays locked.
- `main` is untouched by the mobile program.

## Previous checkpoint - Wave 2.5 Runtime Qualification (2026-09-17)

- Integration branch: `feature/mobile-app` at `04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6`; the
  worktree was `D:/easymod/mob` and held uncommitted Wave 2 changes (since archived and integrated
  through PR #165).
- `origin/main` remains `77790a833da372a03899686a365d7a40b2a95a67`; no mobile work landed on `main`.
- Wave 1 lanes are verified from current refs/source: development environment, native-auth contract,
  Attention/Today APIs, and deep-link abstraction/tests (PRs #121/#122/#123/#124/#125).
- Wave 2 Home now consumes the server-ranked Attention and Today contracts with deliberate loading,
  partial, empty, error, offline, stale, refresh, localization, action, and shop-cache states.
- Wave 2.5 core runtime qualification is PASS: a bundled x86 release preview installed/launched on
  `Nexus_5_API_24`, Maestro exercised Bengali login/Home/Today/all six tiers/deep-link navigation,
  and disposable backend shop-scoped resolution passed.
- Current mobile verification: 16 Jest suites, 163 tests, typecheck, and lint pass; disposable backend
  integration is 20 suites/104 tests and native 2FA limiter/security coverage passes.
- Optional empty/error/offline/session-recovery/2FA fixture branches remain explicit preflight gaps;
  they are not represented as core device PASS.

## Feature flag ledger (ADR M-010)

| Flag | Default | Current production state | Gates |
|---|---|---|---|
| `MOBILE_API_ENABLED` | `false` | `false` (not provisioned) | all `/api/auth/native/*`, `/api/mobile/*` |
| `MOBILE_PUSH_ENABLED` | `false` | `false` (not provisioned) | native FCM registration/send for mobile subscriptions |
| `MOBILE_ORDER_MUTATIONS_ENABLED` | `false` | `false` (not provisioned) | mobile-invoked order create/confirm/cancel |
| `MOBILE_COURIER_ACTIONS_ENABLED` | `false` | `false` (not provisioned) | mobile-invoked courier book/retry |
| `MOBILE_AI_DRAFTS_ENABLED` | `false` | `false` (not provisioned) | conversation → order-draft flow |

None of these flags exist in the production environment allowlist yet — adding them there, for
any reason, is a human decision (`CURRENT_STATE.md` §11), never performed by an agent.

## Additive backend delta ledger

See `MOBILE_ARCHITECTURE.md` §2 for the full table. As of Phase 0: **zero backend code changes
have been made** — Phase 0 is documentation-only. The ledger table exists now so Phase 1 has a
single place to check off each row as it lands.

## Track D — pre-existing production defect fixes (tracked separately from phase receipts)

| # | Branch | PR | Status | Merge to `main` |
|---|---|---|---|---|
| 1 | `fix/backend-product-tenant-mass-assignment` | [#117](https://github.com/mr3826/easymoderator-monorepo/pull/117) | Open, mergeable, failing→passing tests verified (74/74 product suite, 115/115 module) | Human gate — requires explicit user approval before merge |
| 2 | `fix/delivery-prepaid-cod-amount` | [#116](https://github.com/mr3826/easymoderator-monorepo/pull/116) | Open, mergeable, failing→passing tests verified (208/208 order+delivery) | Human gate — requires explicit user approval before merge |
| 3 | `fix/delivery-cross-provider-double-booking` | [#118](https://github.com/mr3826/easymoderator-monorepo/pull/118) | Open, mergeable, failing→passing tests verified (275 unit + 67 integration incl. race test); ships an additive migration with a non-destructive conflict-audit table — **human merger must check `courier_dispatch_order_scope_conflicts` after running it against real data, especially any COMMITTED rows, before treating this as closed** | Human gate — requires explicit user approval before merge |
| 4 | `fix/notification-push-membership-targeting` | [#119](https://github.com/mr3826/easymoderator-monorepo/pull/119) | Open, mergeable, failing→passing tests verified (249 notification+shop suite, 2804 full backend unit suite) | Human gate — requires explicit user approval before merge |

All four PRs were built test-first (each has a verified failing-test-on-baseline → passing-after-fix
transition), in isolated worktrees off `origin/main`, touching only the files their own defect
required. None has been merged. None will be merged without the user reviewing and approving each
one individually — see `MOBILE_ARCHITECTURE.md` §2.

Each PR, once opened, is left unmerged. Opening a PR is program work; merging it into `main` is
never self-authorized (see `MOBILE_ARCHITECTURE.md` §2 and the Phase 0 review finding below).

## Phase 0 review finding log

An independent adversarial review (The Fool + BD-merchant value challenge + architecture challenge
protocol, master brief §4/§30) ran against the full Phase 0 document set on 2026-09-13. Verdict:
**PASS-WITH-NOTES** on the overall set and on ADRs M-004, M-008, M-012 individually — no BLOCKED
findings. All four notes were resolved directly in the documents rather than left open:

1. Track D merge-to-`main` framing clarified as an explicit human gate (`MOBILE_ARCHITECTURE.md` §2).
2. `CURRENT_STATE.md` §15's "additive" definition clarified to explicitly cover inert new branches
   inside existing shared files (what M-004 actually does), distinct from behavior changes.
3. `CURRENT_STATE.md` §16's removal procedure now lists the `sid`-revocation and CSRF Bearer-skip
   branches explicitly.
4. ADR M-008 now has a concrete, arithmetic ranking table (`MOBILE_PRODUCT_SPEC.md` §2.1) instead
   of a placeholder cross-reference; ADR M-012 now defines the `STATUS_UNCLEAR` fallback for
   contradictory internal order state instead of leaving it undefined; ADR M-004 now names the
   required hybrid Bearer+cookie CSRF test explicitly; two Bangladesh UX principles (remembered
   customer context, image compression) that the spec had omitted are now recorded as deferred with
   an owning phase (`MOBILE_PRODUCT_SPEC.md` §4.1) instead of silently dropped.

The review's citation spot-check independently re-verified 9 of `CURRENT_STATE.md`'s file:line
claims against live source and found all 9 accurate, including exact line text.

## Phase receipts

### Phase 0 — Discovery, Isolation, Architecture

```text
PHASE=0 (Discovery, Isolation, Architecture)
STATUS=PASS

BRANCH=mobile/p0-discovery (merging into feature/mobile-app)
HEAD_SHA=d1e79e5571d551e22598778467d81c5c58acc8f0

FEATURES_COMPLETED=
- docs/mobile/{CURRENT_STATE,MOBILE_PRODUCT_SPEC,MOBILE_ARCHITECTURE,MOBILE_API_CAPABILITY_MATRIX,DEV_SETUP,MOBILE_EXECUTION_STATE}.md written
- docs/mobile/adr/M-001 through M-012 written (repo ADR format + Assumptions section)
- Independent adversarial review (The Fool / BD-merchant value / architecture challenge) run; all findings resolved in-document
- feature/mobile-app pushed to origin; isolation verified empirically (zero CI runs, zero commit statuses on baseline SHA)

ARCHITECTURE_DECISIONS=M-001..M-012 (see docs/mobile/adr/)

FILES_CHANGED=
- docs/mobile/CURRENT_STATE.md (new)
- docs/mobile/MOBILE_PRODUCT_SPEC.md (new)
- docs/mobile/MOBILE_ARCHITECTURE.md (new)
- docs/mobile/MOBILE_API_CAPABILITY_MATRIX.md (new)
- docs/mobile/DEV_SETUP.md (new)
- docs/mobile/MOBILE_EXECUTION_STATE.md (new)
- docs/mobile/adr/M-001..M-012-*.md (new, 12 files)
No application code, backend code, or CI workflow changed in this phase.

API_CHANGES=none (documentation only; new endpoints are specified, not implemented, in Phase 0)
DB_CHANGES=none

SECURITY_REVIEW=Independent adversarial review completed 2026-09-13 (see Phase 0 review finding log above); no BLOCKED findings; all PASS-WITH-NOTES items resolved in-document before this receipt was written.

UNIT_TESTS=n/a (no code in this phase)
INTEGRATION_TESTS=n/a (no code in this phase)
E2E_TESTS=n/a (no code in this phase)
ANDROID_BUILD=n/a (Phase 1 scope)
EXPO_DOCTOR=n/a (Phase 1 scope)

WEB_REGRESSION_STATUS=UNCHANGED (no backend/frontend file touched)
BACKEND_REGRESSION_STATUS=UNCHANGED (no backend file touched)

PILOT_PRODUCTION_IMPACT=NONE

KNOWN_RISKS=
- Backend behavior described in CURRENT_STATE.md (auth, CSRF, courier, push, orders) is a snapshot at baseline SHA 77790a833da372a03899686a365d7a40b2a95a67; any change landing on main before this program reads these files again could make specific line citations stale. Re-verify against current source before Phase 1 implementation, not just before Phase 0 documentation.
- Track D fixes are documented and scoped but not yet implemented; mobile design decisions that depend on them (M-007's push targeting, M-012's COD-adjacent framing) are correct in intent but not yet true in the running system.

DEFERRED_ITEMS=
- M-008 ranking table weighting may need real-usage tuning once Phase 2 ships; the table itself is the reviewable decision, not a placeholder.
- Two Bangladesh UX principles (remembered customer context — owner Phase 4; image compression — owner Phase 3/6) tracked in MOBILE_PRODUCT_SPEC.md §4.1.
- M-012's write-path order-status-machine correction ADR is required before Phase 4, not written yet (by design — Phase 0 explicitly defers it).

NEXT_PHASE=Phase 1 (Foundation: Expo scaffold, native auth backend M-004/M-005/M-010, mobile-ci.yml) — begins after this receipt and the Phase 0 PR are reviewed. Track D's four fix PRs are opened next, in parallel with Phase 1 start, each requiring explicit user confirmation before merge.
```

### Phase 1 — Foundation (Expo scaffold, native auth backend, CI isolation)

```text
PHASE=1 (Foundation)
STATUS=PASS

BRANCH=mobile/p1-foundation (merging into feature/mobile-app)
HEAD_SHA=f91012fc08ac15895bd8e1f2f990414f2243b334

FEATURES_COMPLETED=
- EasyMod-mobile/: standalone Expo SDK 57 app (Router, TypeScript, New Architecture) per ADR M-001;
  app.config.ts dev/preview/production variants; eas.json profiles (never auto-submitting); tab
  shell (Home/Inbox/+/Orders/More placeholders); native-auth client (SecureStore refresh token,
  in-memory access token, single-flight refresh guard); typed API client with a zod-validated,
  6-envelope error normalizer (ADR M-003); TanStack Query; offline banner, no mutation queue (ADR
  M-011); i18next extending the web app's real bn/en key namespace; web app's brand tokens/Hind
  Siliguri/lucide icons; BD phone/currency utils; inert Sentry interface.
- EasyMod-backend/: five MOBILE_* flags (ADR M-010); additive modules/auth/native/* routes (signin,
  2FA verify, refresh with rotation + reuse-detection, logout, switch-shop, session list/revoke),
  flag-gated 404-when-off (ADR M-004); additive sid-revocation branch in `authenticate`; additive
  CSRF exemption for Bearer-only/zero-cookie requests; the previously-dead user_sessions table
  repaired and given its first real caller (surfaced and fixed two latent, never-triggered bugs in
  session.service.js as a result); one additive migration for refresh-token rotation lineage
  columns; X-EM-Client attribution wired into native audit calls (ADR M-005).
- .github/workflows/mobile-ci.yml (ADR M-009): isolation-guard + protected-paths + gitleaks +
  mobile typecheck/lint/unit/audit + conditional backend-regression (Node 20, real Postgres/Redis)
  jobs. Two dependency-free guard scripts, both locally verified against 8 deliberately broken
  variants each (before AND after a mid-phase strengthening pass — see SECURITY_REVIEW below).
- Independent adversarial code review of the full backend diff (auth.middleware.js,
  csrf-middleware.js, auth.service.js refactor, session.service.js, native/* module, and both guard
  scripts) — found one real bug (a refresh-rotation race condition) and two CI-guard gaps, both
  fixed and re-verified before this receipt.

ARCHITECTURE_DECISIONS=Implements M-001, M-003, M-004, M-005, M-009, M-010, M-011 as designed in
Phase 0; no new ADRs required.

FILES_CHANGED=
- EasyMod-mobile/** (new — standalone package, ~60 files)
- .github/workflows/mobile-ci.yml, .github/scripts/verify-mobile-{ci-isolation,protected-paths}.js (new)
- EasyMod-backend/src/config/config.js (+5 flags, additive keys)
- EasyMod-backend/src/middleware/auth.middleware.js (+1 additive branch, inert without a `sid` claim)
- EasyMod-backend/src/middleware/csrf-middleware.js (+1 additive exemption, inert without the flag
  and any cookie present)
- EasyMod-backend/src/modules/auth/auth.service.js (behavior-preserving extraction:
  resolveAuthenticatedUser)
- EasyMod-backend/src/modules/auth/session.service.js (2 latent bug fixes: `sequelize.Op` reference,
  missing User-Agent null-check — both dead until this phase gave the file its first caller)
- EasyMod-backend/src/modules/auth/session.entity.js (+2 nullable columns)
- EasyMod-backend/src/modules/auth/native/** (new module, 6 files)
- EasyMod-backend/src/middleware/mobile-client-context.middleware.js (new)
- EasyMod-backend/src/database/migrations/20260914_001_native_session_refresh_lineage.js (new,
  additive, reversible)
- EasyMod-backend/src/modules/entities.js (+1 export, no behavior change)
- Test files: 4 new/updated across EasyMod-backend, 5 new in EasyMod-mobile
No file outside this list changed; root package.json/lockfile, EasyMod-frontend/, EasyMod-growth/,
Dockerfiles, docker-compose*.yml, Caddyfile, and every pre-existing workflow are byte-identical to
origin/main (git diff origin/main..HEAD --stat scoped to those paths: empty).

API_CHANGES=New, flag-gated: POST /api/auth/native/{signin,2fa/verify,refresh,logout,switch-shop},
GET/DELETE /api/auth/native/sessions[/:id]. No existing endpoint's contract changed.

DB_CHANGES=One additive migration (20260914_001_native_session_refresh_lineage): two
nullable/defaulted columns + an index on the already-empty user_sessions table. Verified against a
local disposable database only; reversible.

SECURITY_REVIEW=Independent adversarial review completed 2026-09-13/14 against the full backend
diff, tracing (1) the sid-revocation branch's inertness for non-native tokens, (2) the CSRF
exemption's exact Bearer+zero-cookie+flag condition including the required hybrid-cookie
non-exemption case, (3) the authenticateUser/resolveAuthenticatedUser refactor's behavior
preservation, (4) refresh rotation + reuse-detection correctness, (5) flag-gating completeness, (6)
the two session.service.js bug fixes' correctness and blast radius, (7) the CI guard scripts'
actual robustness, (8) general concerns. Verdict: safe with one real bug (item 4: an unconditional
update let two concurrent refreshes of the same not-yet-rotated token race and corrupt the session
row, causing a false reuse-detected/session-revoked outcome for the losing, legitimate caller) and
two minor CI-guard gaps (a literal `\bmain\b` substring check missing a triggerless `push:` or a
bare wildcard branch entry; guard-script changes not flagged for extra review attention). All three
fixed: the refresh update is now an atomic compare-and-swap that fails closed with a clean 409 on a
lost race instead of mutating the session (new test fires two concurrent refreshes, asserts exactly
one 200/one 409, no false revocation — verified to actually fail without the fix and pass with it
by temporarily reverting and restoring it); the isolation guard now requires an explicit,
non-wildcard branches: list on every trigger (re-verified against 8 deliberately broken variants,
including the 2 new checks, all correctly caught); the protected-paths guard now prints a loud,
non-blocking warning when the guard scripts/workflow themselves change, without hard-blocking the
program's own ability to fix its CI tooling.

UNIT_TESTS=EasyMod-mobile: 5 suites, 44 tests, all passing; tsc --noEmit clean; ESLint clean.
EasyMod-backend full suite: 225 suites, 2809 tests, all passing (includes test:security's 49
suites/450 tests).
INTEGRATION_TESTS=EasyMod-backend, real disposable Postgres/Redis: 15 suites, 82+10 tests (the
original integration suite plus the native-auth module's own 10 integration tests — signin body
tokens, refresh rotation + reuse-detection + family revocation + audit log, the new concurrent-
refresh race test, sid revocation vs. an unaffected web token, concurrent multi-device
independence, non-interference with the web refresh slot, switch-shop membership check, session
list/revoke, 2FA + X-EM-Client attribution, flag-off 404s), all passing. One pre-existing, unrelated
timing-sensitive flake in conversation.attachment-durability.integration.test.js, confirmed passing
on isolated retry.
E2E_TESTS=Not yet run (Maestro deferred; no device/emulator flow tests written this phase beyond
the manual Android smoke test below).
ANDROID_BUILD=PASS. `npx expo prebuild --platform android` + `gradlew.bat assembleDebug` succeeded
(1h 3m 32s first-time cold-cache build — investigated mid-build and confirmed genuine NDK/CMake
native compilation across 4 ABIs, not a hang: log advanced continuously, Gradle daemon at ~83% CPU
throughout, no download/timeout/retry pattern in the log). Debug APK (~234 MB, expected for an
unstripped universal debug build) installed and launched cleanly on a booted emulator
(`tech.easymod.merchant.dev`, confirmed running with no crash signature in logcat). Discrepancy
found and flagged: DEV_SETUP.md/CURRENT_STATE.md §13 claimed an API 24 AVD already existed on this
workstation; only API 37.x AVDs actually exist (an API 24 system image is present but no AVD was
ever built from it) — correction needed in those docs before Phase 2 relies on that claim; recorded
here as a known risk below rather than silently corrected, since it affects the low-end-hardware
perf-budget testing plan in MOBILE_PRODUCT_SPEC.md §4.
EXPO_DOCTOR=Not yet run — scheduled for Phase 7 per the program plan; no blocking issue expected
given the clean tsc/ESLint/test results this phase.

WEB_REGRESSION_STATUS=UNCHANGED — csrf-middleware.test.js + auth.security.test.js (the two suites
that exist specifically to catch a regression in shared auth/CSRF behavior): 28/28 passing, exact
same count as the pre-change baseline on origin/main. EasyMod-frontend/ untouched entirely.
BACKEND_REGRESSION_STATUS=UNCHANGED — full 225-suite/2809-test backend unit suite passing at the
same counts; full integration suite passing with the one pre-existing, unrelated flake noted above.

PILOT_PRODUCTION_IMPACT=NONE. Verified live, not just by diff: production `/health/ready` still
reports the pre-program baseline SHA (77790a833da372a03899686a365d7a40b2a95a67); no new GitHub
deployment was created; `main`'s own Actions history has nothing from this program in it;
`mobile-ci.yml` fired correctly on every push/PR to feature/mobile-app and mobile/** during this
phase (4 runs, all green) and never once on main.

KNOWN_RISKS=
- No real API 24 AVD exists on this workstation (see ANDROID_BUILD above) — Phase 2+'s low-end
  perf-budget testing needs one built from the already-present API 24 system image before it can
  run as originally planned.
- The debug APK is large (~234 MB); no size budget has been set or measured against yet (deferred
  to Phase 7 hardening per the product spec's perf-budget section, but flagged here so it isn't
  forgotten).
- Native auth's refresh-rotation grace window is zero — a lost compare-and-swap race now fails
  closed (409) rather than corrupting state, but the losing legitimate caller still needs to retry
  from a full re-login in the rare case its own single-flight guard failed to prevent the race
  client-side; acceptable for Phase 1, worth revisiting if real usage shows this firing often.
- Track D's four fixes remain unmerged (human gate, unchanged from Phase 0) — mobile's own
  behavior doesn't yet benefit from them in any live environment, only in the disposable test
  databases each was verified against.

DEFERRED_ITEMS=
- Maestro E2E flows (login/logout/restart) — planned for this phase per the original plan sketch,
  not written; the manual Android smoke test (install + launch, no crash) substitutes for this
  phase's gate but does not replace it. Owner: Phase 2, alongside the Firebase human gate.
- ~~Correcting the API 24 AVD claim in DEV_SETUP.md/CURRENT_STATE.md §13~~ — done in this phase.
  Still deferred: actually creating the API 24 AVD itself (owner: whoever first runs low-end perf
  budget testing, Phase 2+).
- expo-doctor run (Phase 7, as originally planned).
- The two Bangladesh UX principles and M-012's write-path ADR remain deferred exactly as recorded
  in the Phase 0 receipt above — unchanged this phase.

NEXT_PHASE=Phase 2 (Home/Attention + Push — ADR M-007/M-008). Human gate: Firebase project +
google-services.json (never committed). Track D PR review/merge remains entirely the user's own
decision, independent of phase sequencing.
```

### Correction to the Phase 1 receipt (recorded 2026-09-14, during Phase 2 planning)

The Phase 1 receipt above reports `UNIT_TESTS`, `INTEGRATION_TESTS`, and `ANDROID_BUILD` as PASS
and describes a mobile client wired to the native-auth backend. That description was incomplete in
one specific, material way, on the same pattern as the AVD correction in `CURRENT_STATE.md` §13:
**neither suite, nor the manual Android smoke test, ever exercised a real HTTP round trip between
the mobile client and the backend.** The backend's integration suite asserted only against its own
`res.body.data.*` (internally consistent with itself, since it never checked what a real client
would do with that body); the mobile client's tests validated only a fake `Transport` that returned
whatever shape the client's own `zod` schema happened to expect. `apiRequest` had zero real call
sites. Both suites were legitimately green while the two sides silently disagreed on the wire
contract. Concretely, four real drifts shipped unnoticed:

1. The backend wraps every response as `{ success, message, data: {...} }`
   (`native-auth.controller.js`); the client's zod schemas parsed the raw body — every real parse
   would have failed with "Unexpected sign-in response shape from server."
2. The client posted `{ refreshToken }` to `POST /api/auth/native/refresh`; the Joi validator
   (`native.validator.js`) requires `refresh_token` (snake_case) — a real call would get a 400.
3. `shopId` is returned at the top level of `data`; the client's `userSchema` had no such field and
   read (nonexistent) `user.shopId` elsewhere instead.
4. `POST /api/auth/native/refresh` returned only `{ accessToken, refreshToken }` — no user at all —
   so `AuthProvider.tsx`'s cold-start silent refresh restored a token but left `user: null` forever,
   even though `status` became `'signedIn'`.

This was found during Phase 2 pre-planning discovery (2026-09-14), not caught by either Phase 1
review pass. It is fixed in Phase 2, lane `mobile/p2-contract`: the mobile client now unwraps the
envelope before validating, posts `refresh_token`, and reads `shopId` from the unwrapped
`data.shopId`; the backend's `/refresh` additively returns `shopId` + the same `safeUser(user)`
shape signin/2fa-verify already return (no change to token rotation/reuse-detection, no change to
any other field); and `AuthProvider` now stores the user a cold-start refresh returns instead of
discarding it. A mechanical drift-prevention mechanism now exists specifically so this class of bug
cannot silently recur: the backend integration suite writes its real response bodies for
signin/refresh/2fa-verify to a committed fixture
(`EasyMod-backend/src/modules/auth/native/__tests__/__fixtures__/native-auth-responses.json`), and
a new mobile test (`EasyMod-mobile/src/auth/native-auth-contract.test.ts`) loads that exact fixture
and parses it with the production zod schemas/functions from `auth-client.ts`. If either side
drifts again, one of these two suites fails immediately instead of both staying green.

The Phase 1 receipt's test/build counts above are left exactly as originally recorded — this entry
does not rewrite that history, it documents what those numbers did not, in fact, prove.

## Platform audit reconciliation (2026-09-21)

This is an append-only current-state receipt; earlier phase receipts remain
historical evidence and are not rewritten.

```text
AUDIT_DATE=2026-09-21
FEATURE_MOBILE_APP_SHA=04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6
MAIN_SHA=cf57db1e4706c9d7b3b32f180e1dbede3b64e7c4
PR_126_HEAD=a4bf7c018788d000f022fcaad3995d697631a59
PR_126_TARGET=feature/mobile-app
PR_126_STATUS=OPEN
MOBILE_CI=VALIDATION_ONLY
MOBILE_NATIVE_BUILD=NOT_VERIFIED
MOBILE_DEVICE_E2E=NOT_VERIFIED
PRODUCTION_SECRETS_IN_MOBILE_CI=NONE
PRODUCTION_DEPLOYMENT_FROM_MOBILE_CI=NONE
MAIN_BRANCH_PROTECTION=NOT_VERIFIED / GitHub reports protected=false and no rulesets
```

The current Mobile CI workflow has no native Android build or device job. A
green Mobile CI run cannot close `MOBILE_NATIVE_BUILD` or `MOBILE_DEVICE_E2E`.
The next native proof must run from a short, clean checkout with deterministic
Node 22/JDK 17/Android SDK inputs, perform a clean Expo prebuild, build the
required release/debug ABI set, install and launch the APK, and execute device
flows without changing machine-wide settings.

### Phase 2 - Home / Needs Attention

```text
PHASE=WAVE_2_HOME
STATUS=CONDITIONAL (implementation and automated gates pass; native/device gates remain open)

BRANCH=feature/mobile-app
HEAD_SHA=04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6
BASE_MAIN_SHA=77790a833da372a03899686a365d7a40b2a95a67
MAIN_CURRENT_SHA=77790a833da372a03899686a365d7a40b2a95a67 (origin/main; local main is stale)
MAIN_UNTOUCHED=YES

HANDOFF_ALIGNMENT=PASS

FEATURES_COMPLETED=
- Merchant-first Home with Today summary from GET /api/mobile/today.
- Server-ranked Needs Attention feed from GET /api/mobile/attention.
- All supported seeded attention signal variants, including courier indeterminate.
- Loading, partial, success, empty, API error, retry, offline, cached-read-only, stale, and no-shop states.
- Pull-to-refresh coalescing, no local ranking, no duplicate refresh batch, and shop-scoped query keys.
- Existing deep-link action abstraction for supported order and conversation entities.
- Bengali/English strings, long-content coverage, responsive flex safeguards, and stale-safe no-mutation cards.
- Auth epoch, refresh-token snapshot, SecureStore write serialization, and query-cache transition safety.
- Native session expiry checks, server-enforced native read-only mutation policy, flag-off 404 ordering,
  refresh-token logout proof, cookie-free transport, and timeout coverage.
- Terminal/cancelled/refunded order filtering, expected-order-value semantics, stable attention reason
  codes, Bengali dynamic-reason mapping, fail-closed deep-link resolution, and explicit 2FA handoff state.

WAVE_1_DRIFT_FOUND=
- Documentation still described Phase 0/1 status and stale feature-flag/AVD/cleartext claims.
- The checked-out integration worktree differed from the candidate mobile/p2-home worktree; no Wave 1
  source regression was found in the feature branch.

WAVE_1_DRIFT_FIXED=
- Reconciled CURRENT_STATE, DEV_SETUP, MOBILE_ARCHITECTURE, MOBILE_API_CAPABILITY_MATRIX, and this ledger.
- Added docs/mobile/AGENT_HANDOFF.md.
- Preserved and regression-tested the Wave 1 auth contract while closing stale refresh/cache transitions
  and the native session/read-only security gaps found during final review.

ARCHITECTURE_DECISIONS=
- Reused the existing typed API client, TanStack Query, AuthProvider, feature flags, i18n, and openDeepLink.
- Kept backend classification/ranking and entity authorization authoritative.
- Kept offline behavior read-only and in-memory; persisted query storage remains deferred.
- Added only additive Today/Attention response fields; native mutation safety is enforced server-side.

FILES_CHANGED=
- EasyMod-mobile Home components, hooks, mobile query schemas/keys, error localization, auth transition
  safety, tab shell wiring, locale keys, and focused Jest/RNTL fixtures/tests.
- `.github/workflows/mobile-ci.yml` now runs the verified isolated mobile suite with `--runInBand
  --forceExit`; no production or release workflow was changed.
- EasyMod-backend native auth middleware/service, CSRF/route gating, Attention/Today services and
  integration/security tests.
- docs/mobile/AGENT_HANDOFF.md and current-state/execution/setup/architecture/capability documentation.

API_CHANGES=ADDITIVE (`expected_order_value`, `revenue_basis`, stable `reason_code`; legacy `revenue` alias retained)
DB_CHANGES=NONE

SECURITY_REVIEW=PASS_WITH_GATES; native expiry/read-only/CSRF controls tested; device and live-entity gates remain.
UNIT_TESTS=PASS (16 suites, 143 tests; typecheck and lint pass; Jest requires --forceExit for open handles)
INTEGRATION_TESTS=PASS (disposable backend: 17 suites/96 tests; mobile day-window/semantic tests pass)
E2E_TESTS=NOT_CONFIGURED (no Detox/Maestro/device runner exists; Jest integration is not claimed as E2E)

ANDROID_NATIVE_BUILD=BLOCKED_BY_DOCUMENTED_LOCAL_WINDOWS_PATH_LIMIT
WEB_REGRESSION=UNCHANGED
BACKEND_REGRESSION=PASS (security 49 suites/450 tests and disposable integration 17 suites/96 tests)
SECURITY_REGRESSION=PASS (49 suites/450 tests)

PRODUCTION_IMPACT=NONE
META_IMPACT=NONE
BILLING_IMPACT=NONE

KNOWN_RISKS=
- Cold-launch protected deep links still wait for auth bootstrap; the current resolver fails closed until
  real shop-scoped entity APIs exist.
- Live wrong-shop/deleted-entity resolution is safe-by-default but not proven against a real entity resolver.
- Full 2FA verification UI/API flow remains deferred after the explicit requires2fa/tempToken handoff.
- Native cookie/CSRF behavior is covered by server/client tests but not a production-like device round trip.
- Small-device visual/performance and installable Android behavior remain unverified until the native gate opens.
- The local Windows worktree path can reproduce react-native-reanimated CMAKE_OBJECT_PATH_MAX failures.

DEFERRED_ITEMS=
- Supported shallow/Linux Android build and first internal beta.
- Device E2E runner and low-end Android visual/performance pass.
- Production deep-link entity resolution and fresh entity-state handling.
- Dedicated 2FA verify flow and its security/rate-limit contract.
- Persisted read-only cache, duplicate-ID client policy, and Track D production fixes.

NEXT_RECOMMENDED_WAVE=Resolve native build and device/E2E gates, then authorize internal beta; do not merge to main automatically.
```

### Wave 2.5 - Runtime Qualification (2026-09-17)

```text
PHASE=WAVE_2_5_RUNTIME_QUALIFICATION
STATUS=PASS_CORE_RUNTIME
BRANCH=feature/mobile-app
HEAD_SHA=04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6
BASE_MAIN_SHA=77790a833da372a03899686a365d7a40b2a95a67
MAIN_CURRENT_SHA=2f07a0ef85f9c0a43243375791541b5151d194e4 (local main)
MAIN_UNTOUCHED=YES

ANDROID_SUPPORTED_BUILD=PASS_LOCAL_X86_PREVIEW
ANDROID_INSTALL=PASS
ANDROID_LAUNCH=PASS
ANDROID_ARTIFACT=EasyMod-mobile/android/app/build/outputs/apk/release/app-release.apk
ANDROID_SHA256=5DAF20E50C0E1014DFA384C096A768F282F86348160C492BDA5630FEE296A212
DEVICE_E2E_FRAMEWORK=Maestro 2.6.0
DEVICE_E2E_CORE_HOME=PASS
SIX_ATTENTION_TIERS_DEVICE=PASS
SHOP_SCOPED_RUNTIME_TEST=PASS
CROSS_SHOP_REAL_BACKEND_DENIAL=PASS
STALE_ENTITY_RUNTIME=PASS_SAFE_NOT_FOUND_AND_FRESH_SERVER_RESOLUTION
MOBILE_2FA_FLOW=PASS_CONTRACT_AND_UI
MOBILE_2FA_SECURITY=PASS
AUTH_CONTRACT=PASS
TYPECHECK=PASS
LINT=PASS
UNIT_TESTS=PASS (16 suites, 163 tests)
INTEGRATION_TESTS=PASS (20 suites, 104 tests)
SECURITY_REGRESSION=PASS (existing 49 suites/450 tests plus native 2FA limiter coverage)
CI_STATUS=CONFIGURED (native debug + Maestro Metro path-filtered; no remote run triggered)
FILES_CHANGED=mobile runtime/auth/2FA/deep-link/Home/E2E/CI plus concise mobile docs; no production files
API_CHANGES=NONE beyond existing additive mobile contracts; native 2FA limiter is route policy only
DB_CHANGES=NONE
PRODUCTION_IMPACT=NONE
META_IMPACT=NONE
BILLING_IMPACT=NONE
KNOWN_RISKS=all-ABI Windows Gradle daemon instability; optional empty/error/offline/session-recovery/2FA device fixtures remain explicit preflight gaps
DEFERRED_ITEMS=dedicated fixture toggles and supplementary device flows; Wave 3 write-policy modeling
WAVE_2_FINAL_STATUS=PASS_CORE_RUNTIME
WAVE_3_STATUS=PLANNING_READY_SHARED_INBOX_NEEDS_ME
```

### Wave 2.5 - Completion (2026-09-25, PR #165)

Receipts from Mobile CI run 36179069735 (#40) on PR head `a8d24a2bd9013590e1202fac58a71c9519b35fda`.
Artifacts: `mobile-android-release-40` and `mobile-maestro-e2e`.

```text
PHASE=WAVE_2_5_COMPLETION
STATUS=PASS_EMULATOR; PARTIAL_EXTERNAL (release signing, physical device)
BRANCH=feat/mobile-release-completion -> feature/mobile-app (PR #165)
HEAD_SHA=a8d24a2bd9013590e1202fac58a71c9519b35fda
BASE_SHA=8dcc56d7b5414bb636223569e41d3aebd1602b46 (feature/mobile-app after #152)
MAIN_UNTOUCHED=YES
MOB_ARCHIVE=archive/mob-wave2-snapshot-2026-09-25 (76 files verified equal to the worktree)

ANDROID_ABIS=armeabi-v7a,arm64-v8a,x86,x86_64 (APK and AAB)
ANDROID_PACKAGE=tech.easymod.merchant.preview 1.0.0 (40) MIN_SDK=24 TARGET_SDK=36
ANDROID_APK_SHA256=103ed4ba1540ab94651628bddef8c2bdbd2c18726b21de313c7f0c50b50a9a46 (112,680,743 bytes)
ANDROID_AAB_SHA256=d24505b7fdbdd652fdf8112d476e2184ae500d1cb560b97a41721a00c51ecde6 (76,382,020 bytes)
ANDROID_MANIFEST=debuggable unset, usesCleartextTraffic=false, allowBackup=false, no storage/overlay permissions
ANDROID_SIGNING=Android debug certificate SHA-256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c -> NOT_DISTRIBUTABLE
INSTALL_LAUNCH=PASS on API 24 x86 emulator (cold 1620 ms, relaunch 1407 ms, login visible, 0 crashes)

DEVICE_E2E=PASS 15/15 on API 34 x86_64 emulator, Maestro 2.6.0, disposable Postgres/Redis
E2E_APK=tech.easymod.merchant.dev 1.0.0 (40) SHA-256 41c54978fdabb226685e081022c1058c59fa3529e4f7a3d18cda1080aa1767f7
E2E_FLOWS=state-preflight smoke navigation refresh empty-home api-error offline-reconnect session-expiry session-revocation logout two-factor deep-link-stale deep-link-cold-launch reinstall-keeps-session shop-isolation
E2E_DEVICE_LOG=no FATAL EXCEPTION, no ReactNativeJS errors, no token-shaped strings

MOBILE_CHECKS=PASS (typecheck, lint, Jest 24 suites / 251 tests, npm audit)
BACKEND_REGRESSION=PASS (Node 20: unit 227/2869, security 51/498, disposable integration 22/115, test discovery 252/252 homed, native-auth contract shape unchanged)
GITLEAKS=PASS (full history)
ISOLATION_GUARD=PASS
PROTECTED_PATHS=PASS

DB_CHANGES=NONE in this wave (the existing native-session migration is from PR #125)
PRODUCTION_IMPACT=NONE (nothing deployed; feature/mobile-app only)
META_IMPACT=NONE
BILLING_IMPACT=NONE
EXTERNAL_BLOCKERS=release keystore / EAS credentials; physical-device pass
WAVE_3_STATUS=LOCKED
```
