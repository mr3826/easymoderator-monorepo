# EasyModerator Mobile Agent Handoff

## Repository State

- Integration branch: `feature/mobile-app`
- Integration worktree: `D:/easymod/mob`
- Integration HEAD: `04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6` (Wave 2 work is uncommitted in this worktree)
- `origin/feature/mobile-app`: `04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6`
- Main baseline: `origin/main@77790a833da372a03899686a365d7a40b2a95a67`
- Main is untouched by mobile work. Do not reset or clean the integration worktree.

## Completed Work

- Phase 0 and Phase 1 mobile foundation/auth/CI work merged locally through PRs #120, #121, and #122.
- Attention and Today backend APIs, flags, tenant scoping, and tests merged through PR #123.
- Deep-link routing and security tests merged through PR #124.
- Native auth contract/envelope/refresh-token/shop identity fixes and fixtures merged through PR #125.
- Wave 2 Home implementation and behavior tests are present in the integration worktree.

## Current Architecture

- `EasyMod-mobile` is a standalone Expo SDK 57 app using Expo Router, TanStack Query, Zod, i18next, and the shared typed API client.
- Home reads server-authoritative `GET /api/mobile/today` and `GET /api/mobile/attention` through `useToday` and `useAttention`.
- Today adds `expected_order_value` and `revenue_basis`; Attention adds stable `reason_code` values.
  The legacy `revenue` alias remains order-derived for compatibility.
- Attention ordering, tiering, reasons, entity scope, and priority remain backend-owned; the client only renders the supplied order.
- Home actions use the existing `openDeepLink` abstraction. Products remain informational until a supported detail route exists.
- Auth uses in-memory access tokens, SecureStore refresh tokens, single-flight refresh, auth epochs, and query-cache clearing across auth/shop transitions.
- Native session expiry is enforced on refresh and access middleware; signed native bearer sessions are
  server-read-only outside dedicated auth/session routes. Native transport omits cookies and logout uses
  `refresh_token`.
- Home offline data is read-only in-memory React Query cache. Persisted query storage is not implemented.

## Invariants

- Do not add screen-level envelope parsing, alternate refresh-token names, a second API client, auth path, or navigation map.
- Do not trust navigation shop/entity IDs; backend authorization is authoritative.
- Do not add unsafe offline writes or client-side attention scoring/reordering.
- Do not rely on client checks for native mutation safety; the backend read-only policy is authoritative.
- Do not use JWT-shaped secret fixtures.
- Keep mobile additive and flag-gated; web, Meta, billing, and production behavior must remain unchanged.

## Current Phase

- Wave 2.5: runtime qualification.
- Wave 2 Home is qualified against the current source and disposable runtime evidence.
- Status: PASS for the defined core gates; optional empty/error/2FA device branches remain explicit follow-up flows.

## Wave 2.5 Receipt

- Android build environment: Windows 11, Node 25.6.1/npm 9.9.4, session JDK 17.0.12, SDK `D:/Android/Sdk`, Expo SDK 57 / RN 0.86.3 / Reanimated 4.5.1, Gradle 9.3.1 / AGP 8.12.0.
- Native workaround: all-ABI Windows packaging is not authoritative after the Gradle daemon failure; local x86 convenience builds are successful. CI/release ABI defaults remain all four ABIs.
- Final local preview: `app-release.apk`, x86, 48,678,471 bytes, SHA-256 `5DAF20E50C0E1014DFA384C096A768F282F86348160C492BDA5630FEE296A212`.
- Install/launch: PASS on `Nexus_5_API_24` API 24/x86, package `tech.easymod.merchant.dev`, foreground `MainActivity`.
- E2E framework/command: Maestro 2.6.0, `node e2e/run-maestro.js --start-backend --install --apk android/app/build/outputs/apk/release/app-release.apk`.
- Device core E2E: PASS for credentials, Bengali login, Home, Today, all six tiers, conversation navigation, and real backend entity resolution.
- Runtime backend: disposable PostgreSQL/Redis, two-shop entity integration and stale/deleted denial PASS; no production data.
- 2FA contract: native signin returns a one-use Redis-backed 64-hex `tempToken` with a five-minute TTL; verification is `POST /api/auth/native/2fa/verify` with a six-digit code. Invalid/replay/expired/cross-user and sixth-attempt `429` tests pass; no resend endpoint exists.
- Remaining device branch: empty/error/offline/session-recovery/2FA flows are configured under `EasyMod-mobile/e2e/`, with state-preflight reporting the missing disposable fixture toggles rather than claiming PASS.

## Known Risks and Deferred Gates

- The all-ABI Windows Gradle daemon remains unreliable; use the supported Linux CI/native path for release-quality all-ABI proof.
- The optional state-preflight still needs deterministic backend toggles for empty/error/session-expiry and dedicated on-device 2FA.
- No production deployment, database migration, Meta behavior, billing behavior, courier production behavior, or `main` merge occurred.

## Verification Commands

Run from `D:/easymod/mob/EasyMod-mobile`:

```text
npm run typecheck
npm run lint
npm test -- --ci --runInBand --forceExit
npm test -- --runInBand src/components/home/HomeScreen.test.tsx src/components/home/AttentionCard.test.tsx
npm test -- --runInBand src/auth/AuthProvider.test.tsx src/auth/auth-client.test.ts src/auth/native-auth-contract.test.ts
npm test -- --runInBand src/app/__tests__/deeplink-routes.test.tsx src/lib/deeplink.test.ts
```

Relevant backend unit/security checks run from `D:/easymod/mob/EasyMod-backend`:

```text
npm test -- --runInBand --forceExit src/modules/mobile/__tests__/mobile-day-window.test.js
npm run test:security
```

Run the disposable PostgreSQL/Redis integration suite from `D:/easymod/mob`:

```text
npm run test:backend:integration:docker
```

## CI and Protected Areas

- Mobile CI: `.github/workflows/mobile-ci.yml`; it is path-filtered to mobile/backend/mobile-doc changes,
  keeps Maestro as the sole device framework, retains APK/JUnit/debug artifacts, and remains isolated to
  `feature/mobile-app`/`mobile/**`.
- Do not modify production deploy, release, Meta, billing, database migration, or existing non-mobile workflow behavior.
- Do not edit third-party native sources, generated secrets, `google-services.json`, keystores, or production configuration.

## Next Wave

- Wave 3 planning may begin: Shared Inbox / Needs Me. Keep native mutation capabilities disabled until each
  write operation has an explicit server flag and policy review.
