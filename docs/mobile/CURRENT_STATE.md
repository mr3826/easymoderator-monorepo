# Mobile Program — Current State of the Monorepo

Status: Living document (Phase 0 baseline)<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator<br>
Baseline: `origin/main@77790a833da372a03899686a365d7a40b2a95a67` (PR #114)

Evidence convention: every claim below cites `path:line` as of the baseline SHA above, or
states `NOT FOUND` when a capability the mobile program needs does not exist yet. Claims
carrying `[re-verified P0]` were re-read directly while writing this document. Claims
carrying `[discovery]` were produced by the three parallel Phase 0 Explore agents against
the same SHA and are cited by file, not necessarily re-read line-by-line in this pass —
treat their line numbers as approximate until a phase that touches that file re-verifies them.

## 1. Monorepo shape

- npm workspaces: `EasyMod-backend` (Express, **JavaScript**, not TypeScript), `EasyMod-frontend`
  (React 18.3.1 + Vite), `EasyMod-growth`. Root `package.json` pins Node 20 via `engines` /
  `.nvmrc`. `[discovery]`
- Rule (documented in `.easymod/standards/`): no cross-module imports between the three apps;
  each has its own Dockerfile building from its own context and its own lockfile. `[discovery]`
- `AGENTS.md` / `CONTRIBUTING-AI.md` define repo-wide agent conduct rules (PR template sections:
  Purpose, Architecture Impact, Tests, Meta Policy, Rollback, Risk, Migration). `[discovery]`

## 2. CI/CD and isolation

- `.github/workflows/ci-cd.yml` and `security-scan.yml` trigger only on `push`/`pull_request` to
  `main` (plus `workflow_dispatch`). `growth-os.yml` triggers on push-to-main path filters and
  `workflow_call`. **Nothing in the existing workflow set runs for `feature/mobile-app` or
  `mobile/**` branches** — confirmed empirically: `origin/main`'s HEAD commit shows
  `"total_count":0` statuses via `GET /commits/{sha}/status`, and after pushing
  `feature/mobile-app` `gh run list --branch feature/mobile-app` returned zero runs. `[re-verified P0]`
- Production deploy requires `workflow_dispatch` + `ref=main` + `PRODUCTION_DEPLOY_ENABLED=true`
  (currently `false`) + a `DEPLOY-<sha>` marker. `[discovery]`
- The repository is **private on GitHub Free**: `gh api repos/.../branches/main/protection` and
  the rulesets endpoint both return `403`. `main` has no server-side branch protection; the
  `production` environment's "protected branches only" deployment rule therefore currently admits
  **any** branch, not just `main`. `[re-verified P0 in the discovery phase, still true at baseline]`
- Several SSH-target workflows (`grant-*`, `backfill-*`, `purge-*`, `qdrant-migration`, and the
  `ci-cd.yml` `target=probe` job) are dispatch-triggered with no `if: github.ref == 'refs/heads/main'`
  guard — if dispatched against a non-main ref they would run that ref's copy of the job. **Mitigation
  for this program: never dispatch any existing workflow, on any ref, for any reason.** `[discovery]`
- `security-scan.yml`'s gitleaks step scans full history across **all** branches
  (`--log-opts=--all`). A single committed secret-shaped file on any `mobile/*` branch (e.g. a
  `google-services.json`, a keystore, a `.env`) would fail the required Security Scan check for
  every future PR into `main`, including unrelated ones. **Mitigation: module-local `.gitignore`
  (ADR M-001) plus a local gitleaks pre-push check on every mobile branch push, forever.** `[discovery]`
- `.gitignore` at repo root does not exclude `google-services.json`, `*.keystore`, `*.jks`, `android/`,
  `ios/`, `.expo/`, or `*.apk`/`*.aab`. `.gitattributes` does not exist / lacks `* text=auto`, so
  `git diff --check` can fail on CRLF content mixed into a diff. Both must be added at the
  `EasyMod-mobile/` module level (M-001), not root, so the change is invisible to the rest of the repo. `[discovery]`

## 3. Native auth blocker (governs ADR M-004)

- `authenticate` (`src/middleware/auth.middleware.js:12-26`) already accepts a Bearer token
  (`:18-19`) before falling back to the `access_token` cookie (`:20-21`) — the read path is not
  the blocker. `[re-verified P0]`
- `signin`/`signup`/`refresh` never return tokens in the JSON body: `auth.controller.js:54`
  destructures `accessToken`/`refreshToken` out of the response payload before sending it
  (`const { accessToken, refreshToken, ...safeResult } = result;`), and both are set as httpOnly
  cookies via `setAuthCookies` (`:22`, `:52`, `:80`). A native client with no cookie jar cannot
  obtain a token from these endpoints today. `[re-verified P0]`
- `refresh` reads the refresh token from the `refresh_token` cookie only and 400s if absent
  (`auth.controller.js:71-75`); there is no body-based refresh path (comment at `:71` states this
  is deliberate, to prevent CSRF abuse of a body-supplied token). `[re-verified P0]`
- `csrf-middleware.js`'s `doubleCsrfProtection` is applied to every non-GET/HEAD/OPTIONS request
  that is not in an explicit exemption set (`:73-159`); the double-submit token is bound to the
  Express session, which a native client also does not have. `[re-verified P0]`
- The `anonymousAuthPaths` exemption set (`csrf-middleware.js:93-100`) covers `signup`, `signin`,
  `refresh`, `forgot-password`, `reset-password`, `2fa/verify` — but gates all of them behind
  `isTrustedAuthOrigin` (`:12-17`, `:101-106`), which in production requires `Origin` to equal the
  configured web app or growth origin. A native request (no `Origin` header, or a non-web origin)
  is rejected with 403 in production. **This is the root cause of the earlier native-reply
  rejection referenced in program memory**, and the reason M-004 proposes new endpoints rather
  than reusing the web ones. `[re-verified P0]`
- `cors-options.js:20` allows any request with **no** `Origin` header through
  (`if (!origin || routeOrigins.includes(origin)) return callback(null, true);`) — CORS itself is
  not the blocker for a native client (native HTTP clients don't send `Origin` the way browsers
  do); the CSRF Origin check above is the actual gate. `[re-verified P0]`
- `session.middleware.js:14` sets `saveUninitialized: true` (documented as required for CSRF
  token stability) and `sameSite: 'lax'`, 7-day cookie (`:19`). Native has no use for this session
  cookie at all if it never hits the CSRF-protected surface.
- Refresh token storage is a **single non-rotating slot per user**: `auth.service.js:224` and
  `:364` both do `user.update({ refresh_token: hashedRefreshToken })` — a second concurrent login
  (e.g., phone app while the web session is active) overwrites the one slot and silently logs the
  other session out on its next refresh. `[re-verified P0]`
- A `Session`/`user_sessions` model, service, controller, and route file already exist
  (`src/modules/auth/session.entity.js`, `session.service.js`, `session.controller.js`,
  `session.routes.js`) but are **not wired into any login path**: `auth.service.js` never imports
  `session.service.js`'s `createSession`, so the table is never populated. The route is additionally
  double-mounted — `auth.routes.js:137` does `router.use('/sessions', require('./session.routes'))`,
  and `session.routes.js` itself defines `/sessions` again, so the live path is
  `/api/auth/sessions/sessions/*`, not `/api/auth/sessions/*`. This table and its multi-device
  concurrency limit (`MAX_CONCURRENT_SESSIONS = 3`, `session.service.js:9`) are genuinely dead
  code today — safe for M-004 to extend for native per-device sessions, but the existing
  route-mount bug is a real (low-severity, self-service-only) defect. Reported, not in Track D
  scope (nothing calls the broken path from the web UI as verified; no customer-facing or
  financial impact). `[re-verified P0]`
- Rate limits: auth endpoints ~10 requests/min/IP; global default ~500/15 min. `[discovery]`

## 4. Tenancy

- Every authenticated request's `shopId` comes from the JWT claim, not from any request header.
  `X-Shop-ID` (where sent by the web client) is used for logging/correlation only, never for
  authorization. `[discovery]`
- `user_shops` supports one user belonging to multiple shops via multiple rows, but in practice
  each account owns exactly one shop today; multi-shop membership exists structurally for staff
  accounts added to an existing shop. `[discovery]`
- The web frontend calls `/api/shop/switch` on its shop-switcher UI; **this endpoint does not
  exist in `EasyMod-backend`** (`NOT FOUND`). Reported as a pre-existing web defect, out of Track
  D scope (not customer/financial-impact; a multi-shop staff account simply cannot switch shops
  from the web today). `[discovery]`
- Roles: `owner`, `admin`, `staff` on `user_shops.role`. `removeUserFromShop`
  (`src/modules/shop/shop.service.js:254-288`) requires the requester to be `owner`/`admin`
  (`:264`), refuses to remove an `owner` (`:280-282`), and **only** sets `is_active: false`
  (`:285`) — it does not revoke the removed user's existing access/refresh tokens or push
  subscriptions (see §8). A documented fine-grained RBAC permission matrix exists in the codebase
  but is not consulted by the route guards, which check role equality directly — dead
  configuration, not a security hole by itself. `[re-verified P0 for shop.service.js:254-288; matrix dead-code claim: discovery]`

## 5. Orders

- `GET /api/order` (list) has no status filter and returns no total/count field for pagination.
  `[discovery]`
- Manual order creation is not idempotent by default: a unique index on
  `orders(shop_id, idempotency_key)` exists, but only the AI-draft creation path populates
  `idempotency_key`; the manual/merchant-created path leaves it null. `[discovery]`
- The order state machine's declared states, the states actually validated on transition, and the
  states actually written by mutating code paths are inconsistent with each other (three
  different vocabularies were found across the module). `[discovery]`
- Confirming an order auto-books a courier as a side effect of the confirm transition, rather than
  as an explicit separate action. `[discovery]`
- Order cancellation is permitted even after the order has reached a delivered state; hard delete
  is permitted for any authenticated shop role, not just owner/admin. `[discovery]`

## 6. Courier / COD (governs Track D #2, #3 and ADR M-012/P5 scope)

- Booking is implemented for all three providers (Pathao, Steadfast, RedX) via
  `POST /api/order/:orderId/courier`, using a claim row from
  `courier-dispatch-claim.service.js`. `[discovery, endpoint path]`
- **Cross-provider double-booking (Track D #3):** the dispatch claim's `findOrCreate` is scoped to
  `{ shop_id: shopId, order_id: orderId, provider }` (`courier-dispatch-claim.service.js:44-46`).
  Because `provider` is part of the claim key, calling booking twice for the same order with two
  different `provider` values creates two independent "committed" claim rows — nothing prevents a
  second, different courier from being booked for an order that already has an active dispatch
  with a first courier. `[re-verified P0]`
- **Prepaid orders still charged full COD (Track D #2):** `buildCourierOrderData`
  (`src/modules/order/order.service.js:1119-1181`) computes `total = numericOr(order?.total, 0)`
  (`:1132`) and sets `cod_amount: total` unconditionally (`:1166`) — it never reads
  `order.payment_status`, despite an `isCodOrder(paymentStatus)` helper existing elsewhere in the
  same file (`:105`, used at `:297` for a different purpose). All three provider adapters then
  consume this value as the amount to collect on delivery: Steadfast
  (`providers/provider.registry.js:189`, `cod_amount: orderData.total || 0`), Pathao-style
  (`:79`, `amount_to_collect` falls back through `orderData.total`), RedX (`:276-283`,
  `cash_collection_amount` falls back through `orderData.total`/`orderData.cod_amount`). A
  customer who already paid via bKash/Nagad and has an order order.payment_status of `paid` is
  still invoiced the full order total as cash-on-delivery by every courier. `[re-verified P0]`
- No cancel-booking capability; no scheduled polling of provider status (webhook-only); the
  Steadfast webhook's order lookup key does not match the key used at booking time in at least one
  code path (reported, not yet in Track D); RedX webhook validation uses one shared token across
  all shops rather than a per-shop/per-integration secret (reported). `[discovery]`
- No tracking-history or problem-parcel query surface for the merchant; the `INDETERMINATE`
  dispatch state (used when the claim service can't tell if a provider call succeeded) has no
  reconciliation path today — it is a dead end that a human must resolve out-of-band. `[discovery]`
- COD settlement/verdict capability by provider: Steadfast **PARTIAL** (unscheduled reconciliation
  only), Pathao **DEFERRED** (not implemented), RedX **DEFERRED** (not implemented). No provider
  gives mobile a reliable, current "what did the courier actually collect" answer. **Consequence
  for the mobile product: any on-device "expected COD" figure must be labelled and computed as
  order-derived only, never presented as settlement/reconciled cash** (see ADR M-012, Phase 5 scope). `[discovery]`
- A separate reported (non-Track-D) defect: a webhook path can write a payment-confirmed state on
  an order whose delivery later fails, producing a phantom "paid" record. Reported for later
  triage; not in the four Track D fixes the user selected.

## 7. Inbox / Conversation

- Conversation list exposes `needs_merchant_reply` with a reason code, `ai_is_replying`, and
  `hitl` (human-in-the-loop pause) state — good projections mobile can consume directly, no new
  server logic needed for the "Needs Me" filter beyond query parameters. `[discovery]`
- No server-side filter/sort for "needs reply" or "unread" on the list endpoint today — mobile's
  Inbox filters will need either new query params (additive) or client-side filtering of an
  unfiltered list; ADR to be written in P3 on which. `[discovery]`
- Reply is idempotent via an `Idempotency-Key` header (errors are cached under the same key too,
  not just successes) — safe to reuse verbatim from mobile (M-006). `[discovery]`
- The 24-hour Meta messaging window is enforced server-side (`templateRequired.rule.js`), not
  client-side — mobile does not need to reimplement this, only surface the resulting error. `[discovery]`
- Reply returns HTTP 201 even when provider delivery fails, with `delivery_state: FAILED` in the
  body — mobile must treat 201 as "accepted for delivery," not "delivered," and branch on
  `delivery_state`. `[discovery]`
- Attachments are base64-encoded inside the JSON body, capped at 25 MB. SSE
  (`GET /api/conversation/events`) supports reconnection replay via the `Last-Event-ID` header,
  buffering the last 50 events / 10 minutes — React Native's SSE client will need a polyfill that
  supports sending this header (the built-in `EventSource` on RN does not always expose it). `[discovery]`
- `PUT /api/shop/ai-settings` (AI automation mode: manual/draft/auto) is owner-role-only. `[discovery]`

## 8. Push notifications (governs ADR M-007 and Track D #4)

- Channels already implemented server-side: in-app, web push (VAPID), FCM (firebase-admin),
  Telegram, email. `[discovery]`
- Events already emitted: `new_order`, `ai_hitl` (per-shop deduped), `customer_waiting`,
  `courier_booking_failed`, `courier_setup_required`, `daily_sales_summary`. `[discovery]`
- **Push membership targeting (Track D #4):** `push-notification.service.js:128` sends to
  `PushSubscription.findAll({ where: { shop_id: shopId } })` — every subscription row for the
  shop, with no join against `user_shops.is_active`. Registration
  (`push-subscription.routes.js:15-88`) only requires a valid JWT (`authenticate`, `:17`); it does
  not re-check that `req.userId` is currently an active member of `shopId`. Critically,
  `removeUserFromShop` (`shop.service.js:254-288`) only flips `user_shops.is_active` to `false`
  (`:285`) — it never deletes or deactivates that user's `push_subscriptions` rows. **Net effect:
  a staff member removed from a shop keeps receiving every order/customer push notification for
  that shop indefinitely**, until their access token separately expires (which does not stop push,
  since push delivery does not check the JWT at all). `[re-verified P0]`
- `push_subscriptions.type` is `web` or `fcm`; `POST /api/notifications/subscriptions` already
  accepts an FCM device token in the exact shape `getDevicePushTokenAsync()` produces, so M-007
  needs no new registration endpoint. `[discovery]`
- FCM sending is currently disabled in production because `FIREBASE_SERVICE_ACCOUNT_JSON` is not
  present in the production env allowlist (`NOT FOUND` in the deployed environment; present in
  code). This must be provisioned as a **human gate** (Firebase project + service account) before
  P2 push can be tested end-to-end against production-shaped config; until then, P1/P2 testing
  uses a disposable backend with a stubbed FCM sender. `[discovery]`

## 9. Products

- `GET /api/product` list is unpaginated. `[discovery]`
- Product variants cannot be written individually (no per-variant update endpoint). `[discovery]`
- `POST /api/product/ai-extract` exists today and is the endpoint the mobile "Photo → Draft" flow
  (P6) should reuse rather than building a second extraction path. `[discovery]`
- `product.low_stock_threshold` column exists but nothing in the codebase currently reads it — the
  mobile "low stock" attention signal (M-008) will be the first consumer. `[discovery]`
- **Cross-tenant mass assignment (Track D #1):** `product.validator.js`'s `createProduct` and
  `updateProduct` Joi schemas both end in `.unknown(true)`, so any extra body field passes
  validation unfiltered. `product.service.js`'s create path does
  `Product.create({ shop_id: shopId, ...productData }, { transaction })` — because `shop_id` is
  spread from `productData` **after** the object literal's own `shop_id` key in source order does
  not matter for object spread semantics here (later key wins), a client-supplied `shop_id` in the
  request body silently overrides the tenant the product is created under. The update path calls
  `product.update(updateData)` with the same unfiltered body, allowing an authenticated user of
  Shop A to move or overwrite a product belonging to Shop B if they can guess/enumerate its ID and
  include `shop_id` in the PATCH body. Verified directly (see prior verification note) against
  `product.validator.js` and `product.service.js`. `[re-verified in Phase 0 discovery, prior to this document]`

## 10. Dashboard

- `GET /api/dashboard` returns `ordersToday`, `cashPosition`, and related aggregates.
  `GET /api/dashboard/queue` counts order statuses that no code path currently writes — it always
  returns zero/empty in practice (`NOT FOUND` — the statuses it filters on are unreachable).
  "Today" throughout the dashboard module is computed in UTC, not `Asia/Dhaka`, so a Bangladeshi
  merchant's "today" rolls over at 6:00 AM local time, not midnight — this makes the existing
  dashboard's daily figures unreliable for the mobile Home/Today surface (M-008 defines a new,
  Dhaka-correct `today` projection rather than reusing this one). `[discovery]`

## 11. Contracts and API surface

- Six distinct error response envelope shapes exist across the API surface; most unhandled 4xx
  responses default to `code: INTERNAL_ERROR`, which is misleading for client-side error branching
  (M-003's normalizer must special-case on HTTP status, not solely on `code`). `[discovery]`
- `openapi.yaml` is stale relative to the actual route set and is not exercised by any test — it
  cannot be trusted as a contract source; supertest-based contract tests against the real Express
  app are the only reliable source of truth (ADR M-003). `[discovery]`
- Request correlation: `x-request-id` header is honored end-to-end into `AuditService.logOperation`
  metadata; there is no separate "source" column on `audit_logs` — mobile attribution (M-005) must
  go into the existing `metadata` JSON field. `[discovery]`
- `src/config/config.js` exposes `growthOsEnabled` plus the five `MOBILE_*` flags introduced by
  ADR M-010. Mobile flags have safe defaults and remain independently gateable; current values are
  verified in the source rather than inferred from this historical discovery note. `[reconciled 2026-09-16]`
- The production environment variable renderer is a strict allowlist (adding a new env var to
  production requires a deliberate, separate change to that allowlist — not just setting a value)
  — relevant to every human-gated secret this program will eventually need (Firebase, mobile push
  keys) but is explicitly **out of scope** for the mobile program to touch; provisioning those
  values is a human gate, not something an agent does. `[discovery]`

## 12. Frontend (web) reference points mobile should stay visually/behaviorally consistent with

- React 18.3.1, Vite, TanStack Query 5.90.21, axios, zod 4.3.6. `[discovery]`
- i18next with `bn` (Bengali) as the default language; ~1,800 translation keys exist in both `en`
  and `bn` resource files today — mobile should extend the same key namespace rather than starting
  a parallel translation set. `[discovery]`
- Bangladeshi phone validation regex used across the web app: `/^01[3-9]\d{8}$/`. `[discovery]`
- Brand tokens: `--brand: #00A651`, a darker `#008040` variant, near-black `#030213` text, red
  `#d4183d` for destructive actions, off-white `#F9FAF8` background, `10px` corner radius; font
  Hind Siliguri; icon set `lucide-react`. Source logos live at
  `EasyMod-frontend/public/icon-1024.png`, `icon-maskable-512.png`, `public/brand/mark.svg`. `[discovery]`
- Error monitoring via `@sentry/react`; test stack is Vitest (unit) + Playwright (E2E, only 1 of
  roughly 12 specs currently runs in CI — the rest exist but are not wired into any pipeline). `[discovery]`

## 13. Environment / workstation inventory (for ADR M-001, Phase 1 scaffold)

- Expo's current stable release is **SDK 57** (React Native 0.86, React 19.2.3), which requires
  **Node ≥ 22.13**, targets Android 7+ (API 24) at runtime with compile/target SDK 36, and needs
  JDK 17 for local Gradle builds. `[discovery, verified against Expo's published SDK 57 changelog]`
- Workstation has Android SDK at `D:/Android/Sdk` (platforms 36 + build-tools 36 + NDK + emulator
  images for API 24/30/37), JDK 17 at
  `C:/Program Files/Java/jdk-17` (`JAVA_HOME` currently points elsewhere — must be set per-session,
  not globally, see ADR M-001/§5 of the program plan), global Node is v25.6.1 (too new for the
  root workspace's Node 20 pin and not what Expo SDK 57 was validated against), Docker 29, GitHub
  CLI 2.88, `LongPathsEnabled=1` (needed for `node_modules` depth under Android/Gradle tooling).
  Missing and to be provisioned session-locally (never globally): a pinned Node 22 LTS, a pinned
  Node 20 LTS for backend parity, Maestro, and `ANDROID_HOME`/`adb` on `PATH`. `[discovery]`
- **Correction from Phase 2 (2026-09-15):** `Nexus_5_API_24` now exists, boots with WHPX, and is
  the primary low-end target. Native Gradle installation remains unverified because the current
  deep Windows worktree triggers the documented `react-native-reanimated` CMake object-path limit.
  `[re-verified P2]`

## 14. Meta / production-safety constraint (applies to every phase with an authenticated-write test)

- The Meta app backing EasyModerator's Page connection holds **zero** Page permission scopes
  (`pages_show_list`, `pages_messaging`, `pages_manage_metadata` are all absent — not denied, not
  submitted, simply never granted), is in `dev_mode`, and has never been submitted for App Review.
  A single production outbound send attempt on a real Page **disables that Page's channel**
  (Meta returns error code 190; the app's own auto-recovery then marks
  `meta_channels.status = TOKEN_EXPIRED` and every inbound webhook for that Page is parked until a
  human reconnects via interactive OAuth). **No phase of this program may perform a live outbound
  send against a real Meta Page.** All Inbox/reply testing (P3) uses a disposable backend with the
  Meta provider stubbed, or the existing internal Meta E2E harness — never the production Page.

## 15. Files this program must never touch (pilot-isolation boundary)

"Additive" in this program means either (a) a brand-new file/route/column, or (b) a new
conditional branch inside an existing shared file that is provably inert for every existing
caller — e.g. a check that only activates for tokens carrying a claim no existing token has, or a
code path only reached when a new flag defaulting to `false` is on. Both categories require an
integration test proving the pre-existing behavior is unchanged for callers that don't opt in.
Any edit that changes what an existing caller experiences today is out of scope, full stop.

Root `package.json` / root lockfile · `EasyMod-backend/**`, `EasyMod-frontend/**`,
`EasyMod-growth/**` outside the additive categories above (per the ledger in
`MOBILE_EXECUTION_STATE.md`) · `Dockerfile`s and `docker-compose*.yml` ·
`Caddyfile` / any reverse-proxy config · `.github/workflows/ci-cd.yml`, `security-scan.yml`,
`growth-os.yml`, or any other pre-existing workflow file · any production environment variable
allowlist · any Meta app configuration or webhook subscription · any courier provider credential
or webhook secret · any billing/subscription code path · any production database migration that
is not purely additive (new nullable column/table, guarded by a flag).

## 16. Removal procedure (must remain true at every phase gate)

Deleting `EasyMod-mobile/`, `.github/workflows/mobile-ci.yml`, and `docs/mobile/`, then reverting
the additive backend delta — new `modules/auth/native/*` routes, new `modules/mobile/*` route
file, five `MOBILE_*` flags defaulting false, `X-EM-Client` header read, the `sid`-revocation
branch in `authenticate` (`auth.middleware.js`), the Bearer-only CSRF-skip branch in
`csrf-middleware.js`, and the native session wiring into `session.service.js`/`session.routes.js`
— must
leave the web application, workers, Facebook automation, orders, billing, courier integrations,
and production deployment behaving exactly as they do at the baseline SHA above. This is verified
per-phase by `git diff origin/main...HEAD --stat` scoped outside `EasyMod-mobile/`, `docs/mobile/`,
and `mobile-ci.yml`, plus the existing backend/frontend/growth test suites run at unchanged counts.

## 17. Platform audit reconciliation (2026-09-21)

This appendix supersedes the Phase 0 baseline for release decisions without
rewriting the historical claims or receipts above.

- Current integration branch: `origin/feature/mobile-app@04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6`.
- Current main: `origin/main@cf57db1e4706c9d7b3b32f180e1dbede3b64e7c4`.
- PR #126 (`mobile/p2-android-build-infra`) is still open against
  `feature/mobile-app`, at head `a4bf7c018788d000f022fcaad3995d697631a59`.
  Its Mobile CI result is validation evidence only; `.github/workflows/mobile-ci.yml`
  intentionally defines no Android Gradle, APK install/launch, emulator, or device
  E2E job. Native production-grade build proof is therefore `NOT_VERIFIED`.
- The historical Phase 1 Android receipt and the later Windows path-length failure
  correction are both retained as history. A future native gate must use a shallow,
  deterministic checkout with session-scoped Node/JDK/Android tooling and must prove
  the required ABI build plus APK install/launch and device flows.
- GitHub currently reports `main` as unprotected and exposes no repository rulesets
  through the available API. The production environment has a branch-policy rule,
  but this is not equivalent to protected-main enforcement. Do not treat the old
  baseline statement that rulesets returned `403` as current evidence.
- Mobile CI remains isolated: no production secrets, environment, SSH, registry push,
  or main trigger. Superseded mobile validation runs are now cancelled by branch/PR
  concurrency; this does not cancel a release or deployment action because none exists.

## 18. Wave 2.5 completion state (2026-09-25)

This appendix supersedes §17 where they differ.

- The integration branch is `feature/mobile-app`. PR #165 integrated:
  - the formerly uncommitted Wave 2 work, archived byte-for-byte at
    `archive/mob-wave2-snapshot-2026-09-25`;
  - PR #152's Home tests;
  - the 2026-09-20 audit fixes;
  - E2E fixtures and 15 Maestro flows;
  - the ADR M-011 offline cache;
  - the Android release proof.
- `main` still carries no mobile code. It moved on independently (Growth work), and this program did
  not change it.
- **Rulesets.** §17's "`main` is unprotected" no longer holds. `main` has two active rulesets:
  - `main-require-pull-request` (23832821)
  - `platform-audit-main-probe` (23753830), required CI checks
  `feature/mobile-app` has no branch rules. Mobile CI's own `Mobile CI` gate is its merge bar.
- **Native build proof now exists.** The `android-release` job builds APK + AAB for
  `armeabi-v7a, arm64-v8a, x86, x86_64` on Linux, verifies them with
  `scripts/verify-android-artifact.js`, and installs and cold-launches the APK on an API 24 emulator.
  The `mobile-e2e` job runs every Maestro flow on an API 34 emulator. `DEV_SETUP.md` §11 has the
  commands; `MOBILE_EXECUTION_STATE.md` has the receipts.
- **Production-grade signing is still missing.** No release keystore or EAS credentials exist, and CI
  may not hold secrets (ADR M-009). The release artifact is signed with the debug certificate and
  labelled `NOT_DISTRIBUTABLE`.
- **Physical-device proof is still missing.** Everything above ran on emulators.

## 19. Integration into `main` and release closure (2026-09-26, PR #172)

This appendix supersedes §18 where they differ.

- **Mobile is on `main`.** PR #172 merged `feature/mobile-app@e4bd2702` together with `main@aea32ddd`.
  `feature/mobile-app` is retired; mobile PRs now target `main`.
- **Mobile API on in production (2026-09-26).** `MOBILE_API_ENABLED` is rendered from its repository
  variable (PR #180) and was switched on by owner instruction. It was proven by
  `mobile-production-proof.yml` run 36237374273. The four Wave 3 `MOBILE_*` flags stay off and are
  never rendered. See [`MOBILE_API_ACTIVATION_RUNBOOK.md`](../deployment/MOBILE_API_ACTIVATION_RUNBOOK.md).
- **Production deploy is gated separately.** `PRODUCTION_DEPLOY_ENABLED=false` on 2026-09-26, so
  merging does not deploy.
- **§15 boundary.**
  - No pre-existing workflow, root manifest, Dockerfile, proxy config, migration or web/billing path
    was edited by this program.
  - The merge resolutions in `auth.middleware.js` and `auth.service.js` keep `main`'s behaviour for
    every web caller. The native branch stays inert for web tokens (no `sid`).
- **§16 removal procedure additions.** Removing the program also means:
  - deleting `.github/workflows/mobile-release.yml`;
  - deleting `EasyMod-mobile/release-signing.json`;
  - deleting the `mobile-release` GitHub environment and its two secrets.
- **Signing exists** (ADR M-013).
  - An RSA-4096 upload key lives only in the main-only `mobile-release` environment. The pinned
    certificate SHA-256 is `9d8e323c…046a382b`.
  - Signed APK/AAB come only from `mobile-release.yml` on `main`, verified against that fingerprint.
  - Mobile CI still holds no secrets.
- **R8 is on** for every release build, and the Maestro flows run against it.
