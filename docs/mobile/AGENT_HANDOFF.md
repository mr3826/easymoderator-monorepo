# EasyModerator Mobile Agent Handoff

Last updated: 2026-09-25 (PR #165).

## Repository State

- Integration branch: `feature/mobile-app`. Mobile PRs target it, not `main`.
  Check `gh pr view <n> --json baseRefName` before any rebase or force-push.
- `feature/mobile-app` is behind `main` on non-mobile work, and `main` has no mobile code. Nothing in the
  mobile program has been merged to `main` or deployed.
- All Wave 2 work is committed. The old `D:/easymod/mob` worktree held it uncommitted. It is preserved
  byte-for-byte on the pushed branch `archive/mob-wave2-snapshot-2026-09-25` and was integrated through
  PR #165. Do not rebuild from that archive; it is evidence only.
- Mobile CI (`.github/workflows/mobile-ci.yml`) is the authority for mobile JS, Android builds and
  device E2E. Local Windows builds are a convenience only.

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
  - 2FA challenges are single-use (`MULTI GET+DEL`) and codes replay-protected (`SET NX`).
  - Verify is limited per IP and per account.
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
- **Future `feature/mobile-app` → `main` merge.** Both sides change `auth.middleware.js`:
  - `main` re-checks web shop membership;
  - this branch adds the native session, allowlist and membership checks.
  Keep both.

## Current Phase

- Wave 2.5 is complete in code, CI and emulator E2E (PR #165).
- External items that remain:
  - A production signing keystore / EAS credentials. The CI release APK is debug-signed and marked
    NOT_DISTRIBUTABLE.
  - A physical-device run. The proof so far is the API 24 and API 34 emulators.
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
emulator job.

## CI and Protected Areas

- Mobile CI runs on pushes to `feature/mobile-app` and `mobile/**`, and on every PR into
  `feature/mobile-app` (no path filter for PRs). It carries no secrets, no environment and no
  `workflow_dispatch`.
- Jobs:
  - isolation guard
  - protected paths
  - gitleaks (full history)
  - mobile (typecheck, lint, Jest, audit)
  - backend regression (when the backend is touched)
  - `android-release`: all ABIs, verify, install/launch on API 24
  - `mobile-e2e`: label-gated, API 34, all Maestro flows
  - the `Mobile CI` gate over all of them
- Do not modify production deploy, release, Meta, billing, database migration or non-mobile workflow
  behaviour.
- Do not edit third-party native sources, generated secrets, `google-services.json`, keystores or
  production configuration. The native project is generated (CNG); change it through `app.config.ts`.

## Next Wave

- Before any distribution: provision a release keystore / EAS credentials, and run a physical-device pass.
- Wave 3 planning only after the owner unlocks it. Keep native mutation capabilities disabled until each
  write operation has an explicit server flag and policy review.
