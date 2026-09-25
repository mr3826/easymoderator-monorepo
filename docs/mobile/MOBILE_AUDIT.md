# EasyModerator Mobile Audit

Audit date: 2026-09-20

## Executive Summary

The mobile program is **BLOCKED** for native-mobile security sign-off, internal beta,
and Wave 3. The clean feature branch contains the foundation and backend contracts
through PR #125. Home, E2E, fixture, CI, and security qualification work exists in a
dirty worktree and is not represented by one reproducible reviewed commit.

Current evidence supports:

- Mobile typecheck and lint pass.
- The dirty-tree mobile Jest aggregate reports 16 suites and 163 tests passing.
- Backend security reports 49 suites and 450 tests passing.
- The selected backend mobile unit suite reports 12 tests passing.
- Home and read-only mobile API source exists.
- Native auth, refresh, SecureStore usage, deep-link resolution, and server-side native
  mutation blocking are implemented in source.

Current evidence does not support:

- A clean-commit Wave 2.5 qualification.
- Current device E2E or supplementary state-flow proof.
- A clean Linux/EAS all-ABI Android artifact.
- Complete tenant isolation after membership removal or shop switching.
- Full native 2FA security qualification.
- Mobile push security or production push readiness.

No production deployment, migration, Meta change, billing change, or production-data
mutation occurred during this audit.

## Repository State

| Item | Value |
|---|---|
| Worktree | `D:\easymod\mob` |
| Branch | `feature/mobile-app` |
| Feature HEAD | `04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6` |
| Origin feature | `04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6` |
| Local main | `2f07a0ef85f9c0a43243375791541b5151d194e4` |
| Origin main | `77790a833da372a03899686a365d7a40b2a95a67` |
| Worktree | Dirty; 41 modified tracked files and many untracked files |
| Main mobile impact | No native mobile program paths on `main` |

The current tree contains untracked E2E flows, fixture controllers, Home components,
hooks, API helpers, and backend integration/security tests. Tracked entrypoints import
some of those untracked files, including:

- `EasyMod-mobile/src/app/(tabs)/index.tsx`
- `EasyMod-backend/src/modules/mobile/mobile.controller.js`

A clean checkout of `HEAD` therefore does not reproduce the current dirty-tree app.

## Timeline

| Change | Result | Current relevance |
|---|---|---|
| PR #115 / `da09e24` | Phase 0 discovery and architecture | Foundation documentation |
| PR #120 / `2c08721` | Phase 1 foundation | Expo/native foundation |
| PR #121 / `4f8e282` | Development environment | Setup and isolation |
| PR #122 / `58d234f` | Documentation correction | Documentation only |
| PR #123 / `ae8bf9f` | Attention and Today APIs | Backend Home contracts |
| PR #124 / `9091503` | Deep-link routing/security | Entity resolution foundation |
| PR #125 / `04bb4d5` | Native auth contract | Current committed feature HEAD |
| PR #126 | Android build infrastructure | Open/unmerged; local `a4bf7c0` |
| `98b769a` | Home implementation | Local `mobile/p2-home` only |
| `d1c8688` | Home logout cache clearing | Local `mobile/p2-home` only |

## Implementation Status

### Authentication

- Login envelope, access token, refresh token, shop identity, and user identity are
  implemented.
- Access tokens are memory-only; refresh tokens use Expo SecureStore.
- Refresh rotation, session expiry, revocation, and read-only native session policy exist
  in the dirty tree, but some enforcement is not present in committed `HEAD`.
- Logout and query-cache clearing exist, but stale async logout/cancellation can clear a
  newer account state (`AuthProvider.tsx:117-129`).
- Real SecureStore cold-restart behavior is not device-proven.

### Home, Today, And Attention

- `GET /api/mobile/today` and `GET /api/mobile/attention` are implemented, flag-gated,
  read-only, tenant-scoped, and backend-ranked.
- Home renders server-supplied order and reason data rather than duplicating ranking.
- Bengali and English locale strings exist.
- Loading, empty, error, offline, stale, and refresh states exist in source/tests.
- Home implementation is uncommitted/dirty; device proof is historical only.

### Deep Links

- Order and conversation entity resolution reuses existing shop-scoped API routes.
- Malformed, stale, missing, and unauthorized entities have fail-closed UI states.
- Cold-launch protected links race auth bootstrap and can fall back to Home.
- Deep-link tests have inconsistent results: one serial run passed 2 suites/17 tests,
  while another focused run failed two tests with timeout/router-state symptoms.
- Deep-link runtime is therefore not qualified.

### Mutation Policy

- Native `sid` sessions are intended to be read-only outside auth/session routes.
- Server-side mutation blocking exists in the dirty tree and is tested on representative
  paths.
- Write flags such as `MOBILE_ORDER_MUTATIONS_ENABLED`, `MOBILE_COURIER_ACTIONS_ENABLED`,
  and `MOBILE_AI_DRAFTS_ENABLED` are declarations without current mobile consumers.
- Inbox, order, courier, product, customer, and reply mutations are not implemented in
  the mobile UI.

### Mobile UI Scope

| Area | State |
|---|---|
| Home | Implemented in dirty tree |
| Inbox | Placeholder screen |
| Quick Action | Placeholder screen |
| Orders | Placeholder screen |
| More | Logout and build metadata only |
| Order detail | Found/unavailable/entity-state screen only |
| Conversation detail | Found/unavailable/entity-state screen only |
| Products | No mobile product screen |
| Customers | No mobile customer screen |
| Courier/COD | No mobile action screens |
| Push | No mobile registration/handler/dependency |
| iOS | No iOS tree, build, or CI proof |

## E2E And Fixtures

Maestro 2.6.0 is the configured framework. Seven flow files plus support scripts parse
successfully, but `run-maestro.js:576-579` executes only `smoke.yaml`. The supplementary
flows are contract-checked but not scheduled.

The preflight exits blocked because disposable `emptyHome` and `homeApiError` controls are
missing. Fixture code exists but is not mounted by `mobile.routes.js`; health capability
metadata is also absent. Production fail-closed checks exist in the helper, but there is
no live positive fixture-isolation proof.

Historical artifacts contain one successful smoke XML, but the same artifact directory
contains assertion failures, heartbeat errors, SIGSEGV indicators, and an ANR. The artifact
is not current clean runtime evidence.

| E2E area | Current classification |
|---|---|
| Cold launch/login/Home | Historical smoke only |
| Six attention categories | Historical smoke only |
| Deep-link navigation | Historical/unstable |
| Empty state | Configured, not proven |
| Error/retry | Configured, not proven |
| Offline/reconnect | Configured, not proven |
| Session expiry | Configured, not proven |
| Logout | Configured, not proven |
| 2FA | Configured, not proven |

## Android And CI

| Build | State |
|---|---|
| Windows local | Historical x86 convenience build; all-ABI attempt failed |
| Android dev | Historical x86 install/native launch |
| Android preview | EAS configuration only |
| Linux/CI | Workflow configured; no current artifact |
| All ABI | Not proven |
| Production signed | No artifact |

The known APK is historical, x86-only, development-signed, and uses
`tech.easymod.merchant.dev`. No clean Linux/EAS artifact verifies `armeabi-v7a`,
`arm64-v8a`, `x86`, and `x86_64` together.

The mobile CI isolation script passes static checks, but:

- The current workflow is uncommitted and differs materially from `HEAD`.
- Backend regression is not included in the mobile gate verdict.
- Path filters can skip protected/shared changes.
- Artifact uploads do not require SHA, ABI, package, signing, or non-empty validation.
- The local E2E runner does not scrub all Meta, payment, and courier credentials.
- The documented Linux environment helper is Windows-specific.
- Production deployment runs migrations; the feature branch contains an additive native
  session migration.

## Current Validation

| Gate | Current result |
|---|---|
| Mobile typecheck | Pass |
| Mobile lint | Pass |
| Mobile Jest aggregate | 16 suites / 163 tests reported passing with `--forceExit` |
| Home tests | 2 suites / 42 tests pass |
| Auth tests | 3 suites / 26 tests pass |
| Backend build | Pass |
| Backend security | 49 suites / 450 tests pass |
| Backend mobile unit | 1 suite / 12 tests pass |
| Test discovery | Fail; two integration tests are untracked |
| Full backend regression | Timed out after 600 seconds |
| Docker integration | Not run; Docker daemon unavailable |
| Current device E2E | Not run; no ADB device |
| E2E preflight | Blocked |
| All-ABI build | Not run/currently unproven |

The `--forceExit` Jest result is useful test evidence but not a clean teardown proof.
Node 25 was used locally while CI pins Node 22.

## Phase Matrix

| Phase | Implemented | Tested | Runtime proven | Status | Blocker |
|---|---:|---:|---:|---|---|
| Wave 1 | Yes | Yes | Partial | Foundation only | Clean current integration proof |
| Wave 2 | Dirty-tree only | Yes | Historical/partial | Active development | Provenance and runtime gaps |
| Wave 2.5 | Partial | Partial | No current proof | Blocked | Security, E2E, build, device gates |
| Wave 3 | No mobile UI | No | No | Locked | Wave 2.5 and security gates |
| Orders | Backend only | No mobile tests | No | Not started mobile | Orders UI absent |
| Courier/COD | Backend partial | No mobile tests | No | Not started mobile | Action and settlement UI absent |
| Products | Backend/low-stock signal | No mobile tests | No | Not started mobile | Product UI absent |

## Security Findings

### P0 - Active Production/Tenant Blockers

1. Push fan-out is not reliably shop- or membership-scoped. Removed staff can continue
   receiving shop notifications and multi-shop users may receive another shop's content.
   Evidence: `conversation-limit-notifier.service.js:44-75`,
   `push-notification.service.js:125-151`, `shop.service.js:254-285`.
2. Membership removal does not revoke refresh access or invalidate all shop-scoped access.
   Several notification and analytics routes rely on authentication without current
   membership checks. Evidence: `auth.service.js:540-578`, `auth.middleware.js:70-87`,
   notification and analytics route guards.

### P0 - Latent

1. The legacy Bangladesh payment router trusts client-supplied shop, order, amount, and
   refund fields if it is ever remounted. It is not currently mounted.

### P1 - Beta/Release Blockers

1. Current qualification depends on dirty/untracked files; clean `HEAD` is foundation-only.
2. Tracked entrypoints import untracked files, risking clean-build/backend-startup failure.
3. No authoritative Linux/EAS all-ABI or production-signed Android artifact exists.
4. Supplementary E2E fixture controls are unmounted and optional flows are not executed.
5. Cold-launch deep links race auth bootstrap; focused deep-link results are unstable.
6. Shop snapshot placeholders can display previous-shop data after shop changes, and
   module-level snapshots are not cleared by `queryClient.clear()`.
7. A stale logout/cancellation callback can clear a newer account's state and cache.
8. Native 2FA can issue a session for stale `last_logged_shop_id` without active-membership
   validation.
9. Native tokens are not restricted to an explicit mobile endpoint allowlist or consistently
   bound to the current session shop.
10. Product/order flows trust client-controlled tenant and foreign-key fields, including
    cross-shop customer references.
11. Telegram notification binding lacks owner/admin authorization and can redirect customer
    and order content.
12. Mobile CI does not require backend regression in its verdict.
13. Mobile path filters can bypass protected/shared changes without running the gate.

### P2 - Required Hardening

- Native 2FA rate limits are IP-only and can fail open when shared limiter setup fails.
- Temporary-token and TOTP replay protection are non-atomic.
- PII can appear in logs, stored notification payloads, and Telegram alerts.
- Offline logout is local-only; a stolen refresh token remains valid until expiry.
- Shop creation trusts tenant identity from request data.
- Web refresh tokens remain non-rotating.
- E2E environment scrubbing does not clear every payment, Meta, and courier credential.
- CI artifacts lack ABI, SHA, package, signing, and missing-file validation.
- Transport body timeouts can be misclassified as schema/unknown errors.
- Unknown app variants and missing API configuration fall back toward development/localhost.
- Documentation claims Track D fixes and runtime PASS states that Git/source evidence does
  not support.

### P3 - Deferred Debt

- Fixture token comparison is not constant-time.
- Legacy plaintext session-token storage remains.
- Offline cache is not persisted across process restarts.
- Sentry is intentionally a no-op; iOS, push, and later mobile phases remain unimplemented.

## Pilot Isolation

| Area | Finding |
|---|---|
| Pilot code on `main` | No mobile program paths observed |
| Current runtime impact | None observed; branch is undeployed |
| Shared backend impact | Additive auth/mobile code and one migration are present on feature branch |
| Database migration | Not executed during audit |
| Meta | No observed impact |
| Billing | No observed impact |
| Production deployment | None observed |
| Formal isolation status | Conditional / no-go for qualification |

The app directory is isolated, but the full program is not physically isolated from shared
backend and deployment behavior. Removing only `EasyMod-mobile/` would not remove the
backend changes or migration.

## Documentation Drift

The following documents overstate current completion or contain stale claims:

- `docs/mobile/AGENT_HANDOFF.md` reports core qualification PASS despite dirty provenance,
  unmounted fixtures, and absent current device proof.
- `AGENT_HANDOFF.md` says no database migration occurred, but the feature branch contains
  `20260914_001_native_session_refresh_lineage.js`.
- `MOBILE_EXECUTION_STATE.md` reports aggregate PASS and `DB_CHANGES=NONE` without separating
  dirty-tree evidence from clean-commit evidence.
- `MOBILE_API_CAPABILITY_MATRIX.md` implies Track D fixes are landed or on `main`; refs show
  they remain unmerged.
- Current E2E and CI additions are not represented in the committed feature HEAD.

## Current Blockers

```text
BLOCKER_1=Consolidate intended mobile changes into one reviewed reproducible commit.
BLOCKER_2=Fix P0 tenant access, push fan-out, and membership/session revocation issues.
BLOCKER_3=Fix native 2FA membership and token/session binding issues.
BLOCKER_4=Resolve stale-shop cache and auth transition races.
BLOCKER_5=Wire disposable fixtures and execute every supplementary E2E flow.
BLOCKER_6=Produce a clean Linux/EAS all-ABI, production-appropriate Android artifact.
BLOCKER_7=Make backend regression and protected-path changes part of the mobile gate.
BLOCKER_8=Reconcile documentation with current Git/source/test evidence.
```

## Recommendation

```text
NEXT_RECOMMENDED_WAVE=FIX_SECURITY_FIRST
```

Do not begin Wave 3, approve internal beta, merge to `main`, deploy, or run production
migrations. Resolve P0/P1 findings first, then rerun the complete qualification from one
reviewed commit with a live disposable backend, connected device, and clean all-ABI build.

## Machine-Readable Receipt

```text
MOBILE_AUDIT=COMPLETE

BRANCH=feature/mobile-app
HEAD_SHA=04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6
MAIN_SHA=2f07a0ef85f9c0a43243375791541b5151d194e4
ORIGIN_MAIN_SHA=77790a833da372a03899686a365d7a40b2a95a67
MAIN_UNTOUCHED=YES

MOBILE_STATUS=BLOCKED
SECURITY_SIGNOFF=NO_GO
BUILD_ISOLATION=NO_GO

WAVE_1=FOUNDATION_ONLY
WAVE_2=ACTIVE_DEVELOPMENT_DIRTY_TREE
WAVE_2_5=BLOCKED
WAVE_3=LOCKED

AUTH=IMPLEMENTED; CLEAN_RUNTIME_NOT_PROVEN
2FA=IMPLEMENTED_WITH_SECURITY_GAPS
HOME=DIRTY_TREE_IMPLEMENTATION; HISTORICAL_RUNTIME_ONLY
ATTENTION=BACKEND_IMPLEMENTED; DEVICE_NOT_CURRENTLY_PROVEN
DEEPLINKS=IMPLEMENTED; COLD_LAUNCH_AND_RUNTIME_NOT_QUALIFIED
SHOP_ISOLATION=INCOMPLETE

ANDROID_BUILD=HISTORICAL_X86_DEVELOPMENT_ONLY
ALL_ABI_BUILD=NOT_PROVEN
INSTALL_LAUNCH=HISTORICAL_NATIVE_X86_ONLY
DEVICE_E2E_CORE=HISTORICAL_SMOKE_ONLY
DEVICE_E2E_SUPPLEMENTARY=CONFIGURED_NOT_PROVEN

TYPECHECK=PASS
LINT=PASS
MOBILE_TESTS=16_SUITES_163_TESTS_DIRTY_TREE_FORCE_EXIT
BACKEND_INTEGRATION=NOT_CURRENTLY_RUN
SECURITY=49_SUITES_450_TESTS; MOBILE_SECURITY_SIGNOFF_NO_GO

P0_COUNT=2_ACTIVE
P0_LATENT_COUNT=1
P1_COUNT=13
P2_COUNT=11
P3_COUNT=4

PRODUCTION_IMPACT=NONE_OBSERVED; CONDITIONAL_IF_DEPLOYED
META_IMPACT=NONE_OBSERVED
BILLING_IMPACT=NONE_OBSERVED

TOP_BLOCKERS=P0_TENANT_SECURITY; DIRTY_PROVENANCE; SUPPLEMENTARY_E2E; ALL_ABI; CI_GATE
NEXT_RECOMMENDED_WAVE=FIX_SECURITY_FIRST
```

## Resolution (2026-09-25, PR #165)

Every finding above, resolved on `feat/mobile-release-completion` (PR #165 into
`feature/mobile-app`) unless marked otherwise. Each fix landed with a test that
fails without it. `main` was not changed by this work.

### P0

| # | Finding | Status | Where |
|---|---|---|---|
| P0-1 | Push fan-out not membership-scoped | Fixed on `main` by #119 (`9c3cc148`). Mobile push is not implemented (ADR M-007), and `feature/mobile-app` takes the fix when it is next brought up to `main`. | `main` |
| P0-2 | Membership removal does not revoke access | Native: each request with a native token re-checks the active `UserShop` (401 `NATIVE_SHOP_ACCESS_REVOKED`), and refresh re-checks it too. Web: `main`'s `authenticate` re-checks membership for shop claims. Both edit `auth.middleware.js`; a future merge to `main` must keep both checks. | `60535649`, `main` |
| P0-L1 | Legacy payment router trusts client fields | Still unmounted. Native tokens cannot reach it (P1-9 allowlist). Web-side debt. | Not mobile scope |

### P1

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1, 2 | Dirty-tree provenance; tracked files importing untracked ones | Resolved. The `mob` worktree is archived byte-for-byte at `archive/mob-wave2-snapshot-2026-09-25` and integrated as reviewed commits. Clean-checkout CI runs every suite. | `5dae73f7`…`5086a3ba` |
| 3 | No Linux all-ABI artifact | Resolved for build proof. `android-release` builds APK + AAB for `armeabi-v7a, arm64-v8a, x86, x86_64` on Linux, then verifies and hashes them. Production signing is an external blocker (debug certificate, NOT_DISTRIBUTABLE). | `18167adc`, `2f9ea3f7` |
| 4 | Fixture controls unmounted; optional flows never run | Resolved. The fixture route is mounted only behind four gates, and `run-maestro.js` schedules all 15 flows. | `4b4e4192`, `b3cfab35` |
| 5 | Cold-launch deep links race auth bootstrap | Resolved. Entity links are held, then opened once auth resolves. | `f47f3660` |
| 6 | Previous-shop snapshot after shop change | Resolved. Module snapshots and `placeholderData` are removed. | `f977c378` |
| 7 | Stale logout/cancel clears a newer session | Resolved (auth epoch). | `dca51a51` |
| 8 | 2FA session for a stale `last_logged_shop_id` | Resolved. The shop comes from an active membership. | `3bf4c80f` |
| 9 | Native token scope | Resolved. The token must match its session's user and shop, and is limited to an allowlist of read routes (`/api/mobile/*`, order/conversation detail GETs). Anything else gets 403. | `60535649` |
| 10 | Web product/order flows trust client tenant fields | Not mobile scope. Native tokens cannot reach these routes (P1-9). | Web backlog |
| 11 | Telegram binding authorization | Not mobile scope. Unreachable with native tokens. | Web backlog |
| 12 | CI verdict ignores backend regression | Resolved. The gate requires `backend-regression` whenever the backend is touched, plus `android-release`, gitleaks and E2E when it runs. | `18167adc` |
| 13 | Path filters bypass the gate | Resolved. Pull requests have no `paths:` filter. | `18167adc` |

### P2 / P3

| Finding | Status | Evidence |
|---|---|---|
| 2FA limit IP-only / fail-open | Resolved. Adds a per-account failure limit (5 per sliding 5 min, Redis, fails closed) on top of the per-IP limiter. The single-use challenge already costs a password sign-in per guess. | `83131cb8` |
| Non-atomic tempToken / TOTP replay | Resolved: `MULTI GET+DEL` and `SET NX`. | `bc947a68` |
| E2E env scrubbing | Resolved. Uses an allowlisted env and synthetic credentials. | `b3cfab35` |
| CI artifacts lack validation | Resolved. `verify-android-artifact.js` checks ABIs, package, version, manifest flags, blocked permissions and the signer, then writes a SHA-256 manifest. | `18167adc`, `6ed48a92`, `2f9ea3f7` |
| Body timeouts misclassified | Resolved. | `d4d7879d` |
| Unknown app variant / missing API URL | Resolved. An unknown variant throws. Preview/production without an HTTPS URL throw. | `d4d7879d` |
| Offline logout is local-only | Residual. The device forgets the session, but the server row lives until expiry or until revoked from another signed-in device (`DELETE /api/auth/native/sessions/:id`). | Documented |
| PII in logs, shop creation tenant trust, non-rotating web refresh | Not mobile scope (web). | Web backlog |
| Documentation drift | Resolved in this PR (`AGENT_HANDOFF.md`, `MOBILE_EXECUTION_STATE.md`, `CURRENT_STATE.md`, `DEV_SETUP.md`). | This PR |
| P3 fixture token not constant-time | Resolved: SHA-256 digests compared with `timingSafeEqual`. | `4b4e4192` |
| P3 offline cache not persisted | Resolved (ADR M-011): Home only, 24 h, shop-bound buster, purged on logout, revoke or shop switch; `allowBackup=false`. | `4e68428e`, `396ca775` |
| P3 legacy plaintext session tokens, Sentry no-op | Deferred. | Backlog |

Found and fixed during the 2026-09-25 review:
- The release manifest requested storage and `SYSTEM_ALERT_WINDOW` permissions the app never uses (`6ed48a92`).
- A same-frame double tap sent two sign-in requests (`019d4bed`).

Found by the CI emulator flows and fixed:
- An entity link opened while the app was already running and signed in was undone by Expo
  Router's own navigation to `/` (`edc21fba`).
- `signIn`'s token clear on a 2FA-required answer briefly reported `signedIn`, which re-mounted
  the login screen and lost the 2FA step (`13e8cce1`).
