# Execution History
**Last Updated:** 2026-05-17

## Overview
_Updated by EM-Orchestrator after every task completion. Provides persistent learning context across sessions._

---

## Recent Tasks

## 2026-05-19 — Meta Integration Redesign Phase 5 Step 3: Frontend Cutover

**Task:** Implement Step 3 (commit 3) of Phase 5 — frontend fully cuts over from legacy `api/domains/channel.ts` + `api/types/channel.ts` to the canonical `api/domains/meta-channels.ts` client. Branch: `feature/meta-redesign-phase5-cutover` (frontend repo).

**Outcome:** Build clean (0 TS errors). 18 tests passing in our modified files. Pre-existing failures (7 files / 51 tests) are all in unrelated domains (product, customer, knowledge, subscription, CSRF) — none caused by this step. Commit `33229ba`.

**Files Deleted:**
- `src/api/types/channel.ts` — legacy Channel type (now MetaChannel from meta-channels.ts)
- `src/api/domains/channel.ts` — legacy channel REST client (10 functions)
- `src/api/domains/__tests__/channel.test.ts` — legacy tests

**Files Modified:**
- `src/api/types/index.ts` — removed `export * from './channel'`
- `src/api/domains/index.ts` — removed `export * as channel from './channel'`
- `src/api/index.ts` — removed 10 legacy `channelDomain.*` methods from `apiClient`; added 8 meta-channels methods (`listMetaChannels`, `initiateMetaOAuth`, `handleMetaOAuthCallback`, `connectMetaAsset`, `disconnectMetaChannel`, `reconnectMetaChannel`, `pingMetaChannel`, `getMetaChannelConsentSummary`)
- `src/app/components/Channels.tsx` — full rewrite: state is `MetaChannel[]` instead of `Channel[]`; removed `metaByPageId` bridge; consent panel keys off `channel.id` directly; all API calls use meta-channels functions; `connectMetaAsset` uses object arg `{ assetId, displayName, tempToken }`
- `src/app/components/OAuthCallbackPage.tsx` — replaced `apiClient.handleOAuthCallback()` with `handleMetaOAuthCallback()`; removed `channelType` sessionStorage param (not needed by new API)
- `src/app/components/ChatSettings.tsx` — replaced `apiClient.getChannels()` with `listMetaChannels()`; replaced `apiClient.disconnectChannel()` with `disconnectMetaChannel()`; replaced `channel.channel_type || channel.type` with `channel.platform`; DELETED dead `updateChannel()` call at old line 478 and its "Save Changes" button
- `src/app/components/ChatSettings.test.tsx` — fixtures rewritten to `MetaChannel` shape; mocks `@/api/domains/meta-channels` instead of `@/api`
- `src/app/components/Customers.tsx` — replaced `import type { ChannelType }` with local `type ChannelType = string`
- `src/app/components/Reports.tsx` — replaced `apiClient.getChannels()` with `listMetaChannels()` from meta-channels; updated `Channel` → `MetaChannel` usage
- `src/test/Channels.test.tsx` — updated to mock `@/api/domains/meta-channels` directly; updated assertions for new function names (`initiateMetaOAuth`, `handleMetaOAuthCallback`, `connectMetaAsset`)
- `src/test/Reports.test.tsx` — added mock for `@/api/domains/meta-channels`; kept `@/api` mock for `getDashboardMetrics`/`getKnowledgeGaps`

**Key technical decisions:**
- `meta-channels.ts` exports `handleMetaOAuthCallback` (not `completeMetaOAuthCallback` as the plan named it) — used actual export name
- `connectMetaAsset` takes `{ assetId, displayName, tempToken }` object — updated all call-sites
- `pingMetaChannel` (not `testMetaWebhook`) — the actual Phase 2 export name
- `Reports.tsx` channels section now always shows 0 messages per channel (MetaChannel has no messageCount field); this is a known limitation — message counts will be added in Phase 6 observability work

**Acceptance checks passed:**
- `grep -rE "from.*api/(types|domains)/channel"` → 0 matches
- `grep -rn "apiClient\.(getChannels|initiateOAuth|...)"` → 0 matches
- `npm run build` → clean bundle, 0 TS errors
- All 18 tests in modified files pass

## 2026-05-19 — Meta Integration Redesign Phase 4 (Track A): SSE Redis Pub/Sub Bridge

**Task:** Implement Track A of Phase 4 — SSE Redis pub/sub bridge so events emitted on backend instance A reach SSE clients connected to instance B. Also adds Last-Event-ID replay. Branch: `feature/meta-redesign-phase4-comment-to-dm`.

**Outcome:** 24/24 new tests pass. 664 existing tests pass. 2 pre-existing failures in Track B's `comment-to-dm.service.test.js` (invalid state machine transitions — not caused by Track A).

**Files Created:**

- `EasyMod-backend/src/utils/sse-bus.js` — SSEBus class (Redis pub/sub bridge). Channel naming: `sse:shop:{shopId}`. Replay buffer: `LIST sse:shop:{shopId}:replay` (LPUSH, LTRIM 0 49, EXPIRE 600). Sequence: `INCR sse:shop:{shopId}:seq`. Exports class + `getBus()` singleton factory. Fallback to in-process EventEmitter when `_isMemoryFallback=true`. No double-emit: publish() only calls Redis publish; delivery to local handlers is exclusively via the subscription callback.
- `EasyMod-backend/src/utils/__tests__/sse-bus.test.js` — 24 tests (TDD-first): sequence monotonicity, replay buffer cap/TTL/ordering, pub/sub delivery, cross-shop isolation, malformed JSON tolerance, fallback mode, no-double-emit invariant.
- `EasyMod-frontend/src/api/sse-client.ts` — Typed SSEClient class. EventSource wrapper with: typed `on(event, handler)` / `off()`, automatic Last-Event-ID tracking (sessionStorage for page-reload fallback), exponential backoff reconnect (1s→30s with jitter), `emitToAll` support, `createSSEClient()` factory. Documents that the browser sends Last-Event-ID automatically per W3C spec — no manual header injection needed.

**Files Modified:**

- `EasyMod-backend/src/config/redis.js` — Added `sseRedisPub` and `sseRedisSub` clients (DB 3). Both exported. `closeAllRedis()` now quits both. `checkRedisAvailability()` now reports `ssePub` and `sseSub`. Memory-fallback path creates no-op pub/sub stubs with `subscribe`/`unsubscribe` methods so sse-bus can detect and enter fallback mode.
- `EasyMod-backend/src/utils/sse-manager.js` — Full rewrite retaining identical public interface (`register`, `unregister`, `emit`). Internally: `emit()` publishes to SSEBus (not direct `res.write`). `register()` calls `_ensureSubscribed()` which subscribes process to Redis channel on first local connection. `unregister()` calls `_maybeUnsubscribe()` which releases Redis channel when last local connection closes. Added: `attachToRequest(req, res, shopId)` (reads Last-Event-ID, replays, then registers), `emitToAll(event, data)` (retained for circuit-breaker back-compat), `getLocalConnectionCount()`, `getPubSubStatus()`.
- `EasyMod-backend/src/modules/conversation/conversation.controller.js` — `getEventStream` made async; switched from `sseManager.register()` to `sseManager.attachToRequest()` for Last-Event-ID replay support; added `Access-Control-Expose-Headers: Last-Event-ID`.
- `EasyMod-backend/src/modules/conversation/conversation.routes.js` — Added comment documenting Last-Event-ID support and replay behaviour.
- `EasyMod-backend/src/routes/health.routes.js` — Added `GET /health/sse` returning `{ connections, pubsub: 'ready'|'fallback'|'down' }`.

**Architecture Notes:**

- Dedicated DB 3 for SSE pub/sub to avoid `subscribe` mode locking the pipeline on DB 0–2 (ioredis subscriber clients cannot issue regular commands).
- `sseRedisSub` client is exclusively in subscribe mode; `sseRedisPub` handles INCR, LPUSH, LTRIM, EXPIRE, LRANGE, PUBLISH.
- Replay buffer is LPUSH (newest at index 0), LTRIM to 50, EXPIRE 600. `getReplay()` does LRANGE 0 -1, filters id > lastEventId in JS, sorts ascending (oldest first) before sending.
- No double-emit guaranteed by architecture: publish() calls Redis PUBLISH only. The SSE-sub 'message' event handler routes to local res objects.
- `emitToAll` retained (not in original v1) because `circuit-breaker.service.js` calls it. The service guards with `typeof emitToAll === 'function'` — the new manager exports it properly.
- SSEClient stores lastEventId in sessionStorage (not localStorage) as it's session-scoped, plus appends `last_event_id` as query param as a reload-fallback since browsers do not persist Last-Event-ID across full navigations.

**Meta Policy Verdict:** SAFE — pure infrastructure, no Meta API calls, no messaging, no user data sent outbound.

**Not Done (out of scope for Track A):**

- Track B files (commentToDm module, MetaMessengerProvider, MetaInstagramProvider, queue-manager, meta-webhook.routes)

## 2026-05-18 — Meta Integration Redesign Phase 1 (Chunk A): Foundations

**Task:** Implement Phase 1 Chunk A of the Meta Integration Redesign per plan `redesign-and-restructure-the-enchanted-feigenbaum.md`. Branch: `feature/meta-redesign-phase1-foundations`.

**Outcome:** All 30 tests pass (18 cipher + 12 entity). No regressions introduced (pre-existing `webhook.service.test.js` failures confirmed unrelated — SequelizeConnectionRefusedError from missing test DB).

**Files Created:**

- `EasyMod-backend/src/utils/meta-token-cipher.js` — Versioned AES-256-GCM cipher. Format: `v2:iv:authTag:ct`. Backwards-compatible legacy 3-segment read. Exports: `{ encrypt, decrypt, VERSION }`.
- `EasyMod-backend/src/modules/channel-providers/meta-channel.entity.js` — MetaChannel Sequelize model. Platform ENUM: facebook|instagram (no whatsapp). Getter/setter on `page_access_token_ct` for transparent encrypt/decrypt via cipher util.
- `EasyMod-backend/src/modules/channel-providers/meta-channel-settings.entity.js` — 1:1 settings per channel (automation_mode, confidence thresholds, comment-to-DM config).
- `EasyMod-backend/src/modules/channel-providers/meta-channel-consent-event.entity.js` — Append-only consent audit (updatedAt: false). 5 event types, 5 source types.
- `EasyMod-backend/src/modules/channel-providers/normalized-message.types.js` — JSDoc @typedef blocks for NormalizedMessage protocol (no TypeScript — pure JS comments).
- `EasyMod-backend/src/database/migrations/20260520_001_create_meta_channels.js` — Creates 3 tables + customers.messaging_consent. Backfills from meta_integrations + channel_configs. Idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING).
- `EasyMod-backend/src/database/migrations/20260520_002_remove_whatsapp_enums.js` — Strips 'whatsapp' from 3 ENUM columns using rename+recreate+reassign pattern. Defensive row-delete before enum removal. Down() re-adds the value.
- `EasyMod-backend/src/modules/channel-providers/__tests__/meta-token-cipher.test.js` — 18 tests (TDD-first).
- `EasyMod-backend/src/modules/channel-providers/__tests__/meta-channel.entity.test.js` — 12 tests (TDD-first).

**Files Modified:**

- `EasyMod-backend/src/modules/entities.js` — Registered 3 new entities + 8 Sequelize associations (Shop<->MetaChannel, MetaChannel<->Settings, MetaChannel<->ConsentEvent, Customer<->ConsentEvent).
- `EasyMod-backend/src/config/config.js` — Added `metaReadFromNew` (default: false) and `metaWriteLegacy` (default: true) feature flags.

**Architecture Notes:**

- Token cipher uses AAD `Buffer.from('meta-token')` to match the existing migration — legacy tokens from meta_integrations.access_token decrypt cleanly without re-encryption.
- `paranoid: false` on MetaChannel — status field (REVOKED/DISCONNECTED) tracks lifecycle rather than soft-delete rows.
- Migration backfill uses `ON CONFLICT DO NOTHING` to be safe for repeated runs.
- WhatsApp ENUM removal uses PostgreSQL rename+recreate pattern since ALTER TYPE DROP VALUE does not exist in PG.

**Meta Policy Verdict:** SAFE — infrastructure schema only, no send paths, no automation logic.

**Disk Space Warning:** D: drive is 100% full (102GB). Had ~2-3MB available during implementation after clearing coverage dirs. Future sessions should run `npm run test` without --coverage flag to avoid filling disk. Also: jest.config.js now excludes coverage from migrations/ already.

**Not Done (out of scope for this chunk):**

- MetaChannelService (next chunk)
- ChannelProvider.js, MetaMessengerProvider, MetaInstagramProvider (next chunk)
- OAuth service dual-write modification (next chunk)
- Frontend messaging.ts (exists but empty — frontend work in Phase 2)

## 2026-05-17 — Sign-In Spinner: 4 Additional Root Causes Fixed

**Task:** Diagnose and fix persistent infinite spinner on `/signin` that survived all previous fix attempts. Fresh incognito still hung. Backend reportedly receiving no requests from the browser.

**Outcome:** Deployed and verified. New bundle `index-C9TfGKo8.js` live. CSP header now correctly served.

**Modules Affected:**
- `EasyMod-frontend/src/shared/lib/http/client.ts`
- `EasyMod-frontend/src/app/lib/auth.ts`
- `EasyMod-frontend/src/app/App.tsx`
- `EasyMod-frontend/nginx.conf`

**Root Causes Identified:**

1. **`isRefreshing` stays true after 8s timeout (frontend):** When `initializeAuth()` times out (8s race), the background `performTokenRefresh` is still running with `isRefreshing=true`. Any 401 received by DashboardLayout API calls during that window (which can last up to 37s due to ECONNABORTED retries) would be pushed onto the refresh queue and silently wait, producing a stuck loading spinner on the dashboard. Fixed by calling `httpClient.abortPendingRefresh()` when the timeout fires, immediately draining the queue and resetting `isRefreshing=false`.

2. **ECONNABORTED retry block not guarded for refresh/auth endpoints (frontend):** The network-error retry block (`ECONNABORTED/ENOTFOUND/ETIMEDOUT`) retried ALL endpoints 3 times with exponential back-off (up to 37s total). This included `/auth/refresh` — meaning a network timeout on the refresh POST would hold `isRefreshing=true` for up to 37s instead of failing fast. Fixed by adding `!isRefreshEndpoint && !isAuthEndpoint` guards (matching the 429/5xx retry block's existing guards).

3. **nginx `add_header` inheritance drops CSP (nginx):** nginx silently discards parent `server {}`-level `add_header` directives in any `location {}` block that defines its own `add_header`. The `location /` SPA fallback block added `Cache-Control` and `Pragma` headers — this caused ALL parent security headers (CSP, HSTS, X-Frame-Options, etc.) to be dropped from HTML responses. The CSP `connect-src https://api.easymod.tech` was not being served to browsers. Fixed by repeating the full security header set in every `location` block that has any `add_header`.

4. **RouterProvider missing `fallbackElement` (frontend UX):** During the initial route loader execution (while `publicLoader` awaits `authService.ensureInitialized()`), React Router showed a blank white screen (null). Users saw no loading indicator for ~0.5-8s on cold page loads. Fixed by adding `fallbackElement={<PageLoader />}` to RouterProvider.

**Architecture Changes:**
- `HttpClient` now exposes `abortPendingRefresh()` public method — safe for auth.ts to call without importing private internals.
- nginx.conf now explicitly repeats all security headers in each `location` block. This is the correct pattern for nginx (use `include` fragments for DRY, but inline repetition is acceptable for a small conf file).

**Technical Debt:**
- nginx.conf is now verbose (security headers repeated 4x). If more `location` blocks are added, each must include the headers. Consider refactoring to an `include` pattern (`/etc/nginx/snippets/security-headers.conf`).
- The 8s timeout + `abortPendingRefresh()` combination means the background `/api/auth/me` chain is abandoned mid-flight. This is intentional and safe (the IIFE catch handles the rejection gracefully), but it does emit a spurious `auth:unauthorized` event which is then filtered by the `isAuthenticated` check in `AuthProvider`.

**Meta Risk:** N/A — frontend/nginx change only.

**Deployment Verified:**
- GitHub Actions run 25989046774 succeeded in 1m0s
- New bundle `index-C9TfGKo8.js` deployed and verified
- CSP header confirmed in live response: `connect-src 'self' https://api.easymod.tech https://*.googleapis.com https://*.google.com`
- `abortPendingRefresh` present in deployed bundle
- `fallbackElement` present in deployed bundle
- ECONNABORTED guard (`!s&&!o&&`) present in deployed bundle at the correct position

**Future Recommendations:**
- Consider reducing `JWT_ACCESS_EXPIRES_IN` from 15m to something longer (e.g., 30m or 1h) to reduce refresh frequency and the likelihood of token expiry mid-session.
- Monitor for `auth:unauthorized` events in Sentry to track how often the refresh cycle is being triggered in production.
- Add CSP violation reporting endpoint (`report-uri`) to catch any future CSP regressions silently.

## 2026-05-17 — CSRF-Refresh Deadlock Fix + SameSite Cookie Cross-Domain Fix

**Task:** Deploy CSRF-refresh circular deadlock fix (client.ts interceptors) and fix cross-domain cookie blocking (`sameSite: 'lax'` → `'none'` in production). Remove test job from backend deploy workflow that was blocking all deployments.

**Outcome:** Success — both repos deployed, backend health check green, CORS verified, CSRF endpoint public and returning tokens.

**Modules Affected:**

- `EasyMod-frontend/src/shared/lib/http/client.ts` (frontend)
- `EasyMod-backend/src/utils/auth-cookies.js` (backend)
- `EasyMod-backend/src/middleware/session.middleware.js` (backend)
- `EasyMod-backend/.github/workflows/deploy.yml` (backend CI/CD)

**Root Causes Identified:**

1. **CSRF-refresh circular deadlock (frontend):** POST `/api/auth/signin` needed CSRF → fired GET `/api/csrf` → got 401 → response interceptor queued it for token refresh → refresh POST also needed CSRF (not excluded) → fired another GET `/api/csrf` → second CSRF request queued waiting for refresh → refresh waiting for CSRF → permanent deadlock. Fixed with two guards: `!isRefreshRequest` in request interceptor (refresh POST skips CSRF init), `!isCsrfEndpoint` in response interceptor (CSRF 401 never triggers refresh cycle).

2. **SameSite cookie cross-domain blocking (backend):** `easymod.tech` → `api.easymod.tech` is a cross-site request (different registrable domain). With `sameSite: 'lax'`, the browser silently refuses to send `access_token`, `refresh_token`, and `commerce_ai.sid` session cookies on any cross-origin POST. The backend never received auth cookies or session. Fixed by setting `sameSite: 'none'` in production for all three cookie types (auth-cookies.js and session.middleware.js). `secure: true` was already set for production (required pairing for `sameSite: 'none'`).

3. **Test job blocking deployments (CI/CD):** The backend `deploy.yml` had `test → build → deploy` chain. The test job ran `npm test` against a Redis service container, but no test infrastructure is set up — tests fail, blocking all deployments. Removed the `test` job entirely; `build` now runs directly on push.

**Architecture Changes:**

- Session cookies and auth token cookies now correctly use `sameSite: 'none'` in production, enabling cross-domain httpOnly cookie delivery from `api.easymod.tech` to browser sessions initiated from `easymod.tech`.
- Backend deploy pipeline: `test → build → deploy` reduced to `build → deploy`. 

**Technical Debt:**

- Session cookie uses `saveUninitialized: true` — every anonymous CSRF init call creates a Redis session entry. Should be reviewed for session bloat under high anonymous traffic.
- `COOKIE_DOMAIN` env var exists in config but is not set in production — cookies are domain-scoped to `api.easymod.tech` only. If a subdomain sharing strategy is ever needed, this var must be set to `.easymod.tech`.

**Meta Risk:** N/A — auth/cookie change only.

**Deployment Verified:**
- Backend health: `https://api.easymod.tech/health/ready` → `{"status":"ready","database":"connected","redis":"connected"}`
- CORS preflight: `Access-Control-Allow-Origin: https://easymod.tech`, `Access-Control-Allow-Credentials: true`
- CSRF endpoint: `https://api.easymod.tech/api/csrf` returns token without authentication
- Both GitHub Actions runs succeeded (backend run 25986658314, frontend run 25986676692)

**Future Recommendations:**

- Set `COOKIE_DOMAIN=.easymod.tech` if future architecture needs cookies shared across subdomains.
- Add Redis session entry TTL monitoring to detect session bloat from `saveUninitialized: true`.
- Consider switching to stateless CSRF (double-submit cookie pattern) to eliminate session dependency for the CSRF endpoint.

---

## 2026-05-17 — Sign-in Infinite Loader Root Cause Fix

**Task:** End-to-end investigation of sign-in infinite spinner at `easymod.tech/signin` with `admin@test.prod / Admin@12345!`. Previous partial fixes (isRefreshEndpoint guard, error message fix, seed-admin deploy) did not resolve it.

**Outcome:** Success — all four root causes identified and deployed.

**Modules Affected:**

- `EasyMod-backend/src/scripts/seed-admin.js` (backend)
- `EasyMod-frontend/src/app/lib/auth.ts` (frontend)
- `EasyMod-frontend/src/shared/lib/http/client.ts` (frontend)
- `EasyMod-frontend/src/app/components/SignIn.tsx` (frontend)
- `EasyMod-frontend/src/app/components/Signup.tsx` (frontend)

**Root Causes Identified:**

1. **initializeAuth() timeout (primary — infinite loader cause):** `GET /api/auth/me` 401 triggers `POST /api/auth/refresh` through the interceptor. The refresh + CSRF init chain can block for 10-47 seconds (Axios timeout + 3 retries with exponential backoff). While this chain runs, `this.initialization` promise stays pending. Both `publicLoader` and `protectedLoader` call `await authService.ensureInitialized()`, which blocks. After `signin()` succeeds and `navigate('/app')` fires, `protectedLoader` waits on the pending `initialization` promise. Route never loads. Spinner stays indefinitely.

2. **isAuthEndpoint guard missing in deployed code:** The previous deploy (85568fa) only added `isRefreshEndpoint` guard to the 401 interceptor. The `isAuthEndpoint` guard for signin/signup/2fa-verify was only in the local working tree, never deployed. This meant a 401 from wrong-password signin would enter the refresh queue, adding 5-47s latency before showing an error.

3. **429 retry on auth endpoints:** The retry-on-429 logic was not excluding auth endpoints. A rate-limit lockout on signin would silently retry 2 times (5s + 10s delays) before showing an error.

4. **Radix Checkbox incompatible with react-hook-form register():** Radix UI Checkbox uses `onCheckedChange` not `onChange`. Using `register('rememberMe')` spreads `onChange`/`onBlur` which Radix silently ignores. Fixed with `Controller` from react-hook-form.

**Architecture Changes:**

- `initializeAuth()` now races against an 8-second timeout. If backend is slow (cold start, Redis reconnect), the app proceeds as unauthenticated after 8s instead of blocking forever. The in-flight chain continues in the background and updates state when complete.
- `client.ts` interceptor now excludes both `isRefreshEndpoint` and `isAuthEndpoint` from the 401 refresh queue, and excludes `isAuthEndpoint` from the 429 retry logic.
- `seed-admin.js` now checks for active shops on existing users and creates one if missing (idempotent recovery for orphaned admin accounts).

**Technical Debt:**

- The `initialization` promise pattern is fundamentally fragile. A proper solution would use a polling mechanism or explicit initialization state machine rather than a single promise.
- The `isRefreshing` flag and `refreshQueue` pattern is susceptible to edge cases. Consider replacing with a proper token refresh mutex (e.g., `p-limit` or a dedicated token manager class).

**Meta Risk:** N/A — auth flow change only.

**Future Recommendations:**

- Replace `initializeAuth()` single-promise pattern with `AsyncMutex` for token refresh.
- Add `X-Request-ID` header to all auth requests for traceability.
- Add health check endpoint that confirms Redis connectivity (not just HTTP server up).
- Consider `SameSite=None; Secure` for auth cookies to make cross-origin intent explicit (same-site logic covers it today but the intent is unclear).
- Make `CHANNEL_ENCRYPTION_KEY` and `META_APP_ID/SECRET` validation non-blocking for development environments.

---

## 2026-05-16 — Full Codebase Review and Issue Remediation

**Task:** Full audit of 77 modified + 14 deleted files since May 10 review. Fix P0 security issues, broken imports, and phone validator bugs. Perform Meta policy compliance check.

**Outcome:** Partial success (P0 fixes complete, P1 deferred, Meta risks documented)

**Modules Affected:** rto-shield, shop-bd-settings, payment/self-mfs-handler, webhooks/payment-webhook, middleware/csrf, webhook (new shim), delivery-tracking, order-tracking, order-session, notification/owner-notification, invoice, utils/validators/phone

**Architecture Changes:**

- Created `src/modules/webhook/webhook.service.js` — compatibility shim adapting `sendMessage(channel, recipientId, text)` to `meta-send.service.sendWithRateLimit()`. Resolves 9 broken require() call sites across 6 modules.
- Fixed `normalizePhone`, `toInternationalFormat`, `BD_LANDLINE` regex bugs in `src/utils/validators/phone.validator.js`. Shared utility now covers all legacy inline regex variants.
- Replaced private `normalizePhone` + `BD_PHONE_RE` in `rto-shield.service.js` and `self-mfs-handler.service.js` with imports from shared validator.
- Replaced local `BD_PHONE_REGEX` literal in `shop-bd-settings.js` with imported `bdMobileRegex`.

**Technical Debt:**

- `customer.messenger_opted_out` field does not exist on Customer entity — the opt-out flag is stored as `metadata.marketing_opt_out`. Field name mismatch vs meta-policy-skill.md standard. The send path (webhook shim + order/delivery modules) never reads this flag. This is debt that must be resolved before scaling send volume.
- `validateWebhookSignature` silently passes unknown gateway names — should default to 401.

**Meta Risk:** HIGH — Messenger opt-out check missing in automated send pipeline (payment confirmation, delivery tracking, order status). See meta-policy-risks.md.

**Future Recommendations:**

- Add `messenger_opted_out` boolean column to Customer entity (DB migration).
- Add opt-out guard in `webhook/webhook.service.js` before forwarding to `sendWithRateLimit`.
- Add opt-out phrase detection to `message-worker.js` as Guard 0.
- Change `validateWebhookSignature` default behavior to reject unknown gateways (401).
- Consolidate remaining inline BD phone regexes in: `customer.validator.js` (3 instances), `order.validator.js`, `subscription/partner-apply.routes.js`, `shop/shop.validator.js`, `conversation/conversation-state-standalone.service.js`, `order/order-session.service.js`.
- P1 delivery provider interface pattern — still pending (5–6 hr effort, ~200 LOC saved).
- P1 middleware error wrapper — still pending (2–3 hr effort, ~80 LOC saved).

**Entry format:**
```md
## {YYYY-MM-DD} — {Task Title}
**Task:** {what was attempted}
**Outcome:** {succeeded / failed / partial}
**Modules Affected:** {list}
**Architecture Changes:** {description or N/A}
**Technical Debt:** {introduced or N/A}
**Meta Risk:** {discovered or N/A}
**Future Recommendations:** {notes}
```

---

## Key Outcomes

_Aggregated wins and learnings — updated when a milestone is reached._

_No entries yet._

---

## Patterns Observed

_Recurring patterns, anti-patterns, or techniques that proved effective._

_No entries yet._
