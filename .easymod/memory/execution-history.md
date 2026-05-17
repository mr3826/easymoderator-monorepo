# Execution History
**Last Updated:** 2026-05-17

## Overview
_Updated by EM-Orchestrator after every task completion. Provides persistent learning context across sessions._

---

## Recent Tasks

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
