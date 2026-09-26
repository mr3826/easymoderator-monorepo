# EasyModerator Mobile Agent Handoff

Last updated: 2026-09-26 (PRs #180–#182, mobile API activated in production).

## Repository State

- **Mobile lives on `main`.** PR #172 merged the Wave 2.5 program (`feature/mobile-app@e4bd2702`)
  into `main` with the release hardening.
- `feature/mobile-app` is retired. Branch mobile work from `main`, and open PRs into `main`.
- The mobile backend is additive and flag-gated (ADR M-010). **`MOBILE_API_ENABLED` is on in production**
  since 2026-09-26, by owner instruction. It comes from the `MOBILE_API_ENABLED` repository variable
  through `render-production-env.js` (PR #180). Activation, proof and rollback are in
  [`MOBILE_API_ACTIVATION_RUNBOOK.md`](../deployment/MOBILE_API_ACTIVATION_RUNBOOK.md). The four Wave 3
  `MOBILE_*` flags are never rendered to production.
- The old `D:/easymod/mob` worktree is preserved byte-for-byte on the branch
  `archive/mob-wave2-snapshot-2026-09-25`. It is evidence only; do not rebuild from it.
- Mobile CI (`.github/workflows/mobile-ci.yml`) is the authority for mobile JS, Android builds and
  device E2E on PRs.
- Signed releases come only from `.github/workflows/mobile-release.yml` on `main` (ADR M-013).
- Local Windows builds are a convenience only.

## Completed Work

- PRs #120–#126 and #130: foundation, native auth, Attention/Today APIs, deep links, the auth contract,
  Android build infrastructure and CI isolation.
- PR #152: the first Home implementation and card tests. It was superseded by the later Home in PR #165,
  but its tests were kept.
- PR #165, Wave 2 / 2.5 completion:
  - Home on `/api/mobile/today` and `/api/mobile/attention`, all six tiers, Bengali first.
  - 2FA sign-in step.
  - Deep-link entity resolution, including cold launch and links opened while signed out.
  - ADR M-011 persisted read-only Home cache with an offline session.
  - The 2026-09-20 audit fixes (see `MOBILE_AUDIT.md`, "Resolution").
  - A disposable E2E fixture mechanism and 15 Maestro flows.
  - An all-ABI Android release build with artifact verification and emulator install/launch proof.
- PR #172, integration and release closure:
  - `main` merged in. `auth.middleware.js`, `auth.service.js` and `totp.service.js` were resolved line
    by line, keeping both sides' checks.
  - Native sign-in follows `main`'s account rules.
  - Upload-key signing on `main` (`mobile-release.yml`) with fail-closed verification against the
    pinned fingerprint in `EasyMod-mobile/release-signing.json`.
  - R8 and resource shrinking in every release build.
  - An arm64 device test APK for the physical-phone pass.

## Current Architecture

- `EasyMod-mobile` is a standalone Expo SDK 57 / RN 0.86 app (Node 22) using Expo Router, TanStack
  Query, Zod, i18next and one typed API client (`src/api/client.ts`).
- **Auth.**
  - The access token lives in memory; the refresh token and a small session identity live in SecureStore.
  - Refresh is single-flight.
  - An auth epoch means a stale logout or cancel can never clear a newer session.
  - A 400/401/403 refresh rejection signs out. Any other failure keeps the stored session: an offline
    session that is read-only and retries on reconnect.
- **Native tokens (backend).**
  - The `sid` session must be active, unexpired, and match the token's user and shop.
  - The shop membership must still be active.
  - Outside `/api/auth/native/*`, the token is read-only and limited to `/api/mobile/*` and the
    order/conversation detail GETs.
  - 2FA is optional for each merchant. Sign-in asks for a code only when the account has it switched on
    (`settings.totp_enabled`, the same rule as the web); otherwise it issues the session directly.
  - 2FA challenges are single-use (atomic Lua `GET`+`DEL`, shared with the web). Each challenge is bound
    to the token generation that passed the password step.
  - Codes are replay-protected (`SET NX EX`, fails closed in production and staging).
  - Verify is limited per IP and per account.
  - Native sign-in refuses:
    - a pending temporary password (403 `AUTH_PASSWORD_CHANGE_REQUIRED`), because native tokens cannot
      reach the web password-change route;
    - Growth OS staff, since native sessions are merchant sessions.
- **Home data.**
  - Query keys carry the shop id, and no placeholder data survives a shop change.
  - Only the Home `attention` and `today` queries are persisted (AsyncStorage, 24 h). The buster is
    `appVersion:userId:shopId`.
  - The persisted cache is purged on logout, revocation, or refusal of the stored session.
  - Android app-data backup is disabled.
- **Deep links.** `+native-intent.ts` captures entity links (`order/<id>`, `conversation/<id>`). The root
  layout opens them after auth resolves (10-minute TTL). Entity access is always re-authorized by the
  backend.

## Invariants

- Do not add screen-level envelope parsing, alternate refresh-token names, a second API client, auth
  path or navigation map.
- Do not trust navigation shop or entity IDs; backend authorization is authoritative.
- No offline writes and no client-side attention scoring or reordering. Native mutations stay blocked
  server-side until each write has an explicit flag and policy review.
- Do not use JWT-shaped secret fixtures (a full-history gitleaks scan runs in CI).
- The E2E fixture route (`POST /api/mobile/e2e/control`) exists only when `NODE_ENV=test`, the flag is
  set, a ≥32-character control token is set, and the database is local and disposable. Never enable it
  anywhere else.
- Keep mobile additive and flag-gated. Web, Meta, billing and production behaviour must stay unchanged.
- **`auth.middleware.js` serves both clients.** Web tokens get `main`'s membership re-check (403) and
  the temporary-password gate. Native (`sid`) tokens additionally get:
  - the session and binding checks;
  - the read-only allowlist;
  - a single membership check that answers 401, so the app refreshes and signs out.

  `native-sid-revocation.test.js` pins every one of these. Keep them all.
- Signing: never commit key material, never give a secret to `mobile-ci.yml`, and never add a
  distribution step to `mobile-release.yml` without an owner decision. The guard script enforces the
  last two.

## Current Phase

- Wave 2.5 is released on `main` (PR #172). The proof covers:
  - code and CI;
  - all 15 Maestro flows on the API 34 emulator;
  - install and launch on API 24;
  - every one of the 15 flows passed on a physical arm64 phone (Android 13) against the R8 build.
    The passes were spread over several USB runs; see `MOBILE_EXECUTION_STATE.md`, "Release closure".
- Signed builds come from `mobile-release.yml` as the `mobile-release-<sha>` workflow artifact, signed
  with the pinned upload key. That artifact is the only distribution channel: internal QA sideload,
  kept 90 days. The app is not on Play or EAS.
- **Production serves the mobile API** (backend `65e67c55`). `mobile-production-proof.yml` run
  36237374273 proved it end to end with the designated test merchant:
  - API: 49/50 checks passed. The one skip is an order detail read, because that merchant's Home shows no
    order.
  - The signed `preview` APK (`5196ad7e`, pinned signer) on an emulator against production passed
    sign-in, Home, tabs, refresh, restart, warm and cold conversation deep links, a refused foreign
    entity, and logout/re-login.
  - 0 mobile 5xx.
  - See `MOBILE_EXECUTION_STATE.md`, "Production activation".
- Production 2FA: the verify route is live, fails closed and is rate-limited. No production test
  identity has 2FA on, so the success path is proven on the physical phone (run 3), not in production.
- Wave 3 (Shared Inbox / Needs Me) stays locked until the owner opens it.

## Verification Commands

Mobile (Node 22), from `EasyMod-mobile/`:

```text
npm ci
npm run typecheck
npm run lint
npm test -- --ci --maxWorkers=2
```

Backend (Node 20), from `EasyMod-backend/`:

```text
npm test
npm run test:security
npm run test:discovery
```

Disposable PostgreSQL/Redis integration suite, from the repo root:

```text
npm run test:backend:integration:docker
```

Android and device E2E: see `DEV_SETUP.md` §11. On a PR, the `mobile-e2e` label opts into the
emulator job and the arm64 phone APK build. Signed release retrieval and the USB phone pass are in §12.

## CI and Protected Areas

- Mobile CI runs on PRs into `main` that touch mobile paths, and on pushes to `mobile/**`. It never runs
  for a push to `main`. It carries no secrets, no environment and no `workflow_dispatch`.
- Mobile CI jobs:
  - isolation guard (also pins `mobile-release.yml`'s signing boundary)
  - protected paths
  - gitleaks (full history)
  - mobile (typecheck, lint, Jest, audit)
  - backend regression (when the backend is touched)
  - `android-release`: all ABIs, R8 mapping, the debug-signature negative control, a throwaway-key
    signing proof, install/launch on API 24
  - `mobile-e2e`: label-gated, API 34, all Maestro flows on the R8 build
  - `android-device-apk`: label-gated arm64 build for a USB phone
  - the `Mobile CI` gate over all of them
- `mobile-release.yml` runs on pushes to `main` that change `EasyMod-mobile/`:
  - it builds both variants, `preview` and `production` (`tech.easymod.merchant`, the Play build), without secrets;
  - it signs each in one step with the upload key from the main-only `mobile-release` environment;
  - it verifies each against the pinned fingerprint and its own variant, package and source SHA, then
    installs/launches on API 24;
  - it uploads `mobile-release-<sha>` (preview) and `mobile-release-production-<sha>`.

  It distributes nothing. See ADR M-013 for rotation and recovery.
- Do not modify production deploy, release, Meta, billing, database migration or non-mobile workflow
  behaviour.
- Do not edit third-party native sources, generated secrets, `google-services.json`, keystores or
  production configuration. The native project is generated (CNG); change it through `app.config.ts`.

## Next Wave

- Store distribution needs an owner decision and a Play Console (or EAS) account. When that happens,
  register the existing upload key (ADR M-013) as the Play upload key. Never generate a new one.
- After any change to mobile, native auth or the shared auth middleware reaches production, re-run
  `mobile-production-proof.yml`. Roll back with the runbook: set the variable to `false` and redeploy.
- `/api/auth/*` is limited to 10 requests per minute per IP, shared by web and mobile (`app.js`). One
  device needs a sign-in plus a refresh about every 15 minutes, and a 429 on refresh keeps the session.
  Revisit the limit before many merchants share one carrier-NAT address.
- Wave 3 planning only after the owner unlocks it. Keep native mutation capabilities disabled until each
  write operation has an explicit server flag and policy review.
