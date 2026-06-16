# EasyModerator — Full Codebase Audit

**Date:** 2026-06-16
**Method:** Fresh, read-only review. The codebase was split into 7 independent domains and each was audited from scratch by a dedicated `em-orchestrator` agent. Prior project memory was deliberately *not* used as ground truth — every claim was checked against current code. A sample of the highest-impact "live bug" findings was independently re-verified by the orchestrator (results noted inline as ✅ VERIFIED).
**Scope:** `EasyMod-backend/` (~512 JS files, modular monolith) + `EasyMod-frontend/` (~230 files, React/TS) + infra (Docker Compose, Caddy, GitHub Actions).
**Mandate:** Find gaps and suggest improvements *within existing features* — no net-new features proposed.

> Note on AI model IDs: one finding questions whether `gemini-3.1-*` model IDs are valid. This was based on a possibly-stale model list. It is recorded as **"verify against the live API,"** not "confirmed wrong." Do not act on it as fact without checking the Gemini endpoint.

---

## 1. Executive Summary

The codebase is well-structured (clean modular monolith, consistent middleware chain, real policy/consent layers, idempotent migration runner, distributed job locking). The problems are not architectural — they are **correctness and money-integrity gaps inside otherwise-complete features**, plus a layer of **dead/orphaned code whose stale behavior conflicts with the live path**.

The single most alarming cluster is **billing & money**: the self-serve paid conversion is silently broken end-to-end, and the top-up purchase flow can be exploited to get paid conversations for ৳1. These are revenue-affecting today.

### Severity tally (as rated by domain auditors)

| Domain | Critical | High | Medium | Low |
|---|---|---|---|---|
| Security & Auth | 0* | 4 | 6 | 5 |
| Meta Integration | 1 | 3 | 4 | 3 |
| AI Engine | 2 | 5 | 6 | 4 |
| Commerce | 2 | 4 | 6 | 3 |
| Billing & Money | 3 | 4 | 3 | 3 |
| Platform/Data/Infra | 2 | 3 | 6 | 5 |
| Frontend | 2 | 5 | 6 | 5 |
| **Total** | **12** | **28** | **37** | **28** |

\* Security had no item *labeled* Critical, but the forgeable payment callback (HIGH) is critical-class — see §3.

### The recurring patterns (read these first — they explain most individual bugs)

1. **Silent failure / swallowed errors.** Fail-open `catch` blocks, never-checked return values, and orphaned functions mean breakage doesn't surface. Examples span every domain (RAG ingest, stock check, notification approval, payment callback).
2. **Dead code that contradicts the live path.** Multiple fully-built modules are never called, and several reference stale model IDs, wrong model names, or non-existent entities. A future dev wiring them in would ship a regression. (`llm-tier-selection`, `conversation-context`, `recordConversation`, `chargePartnerOrder`, legacy `order-session.service`, FE `ProtectedRoute`/`AdminRoute` guards.)
3. **Function-signature / typo breakage.** Single-character or arg-order mistakes silently disable whole flows: `appvePayment` (✅), `processPaymentCallback` arg mismatch (✅), `extra_charges` vs `extra_charge`.
4. **`camelCase` (FE) vs `snake_case` (BE) boundary.** No global normalizer; a per-call `normalizeOrder()` is applied inconsistently. One missing call = blank UI fields. (✅ `order.ts:183`.)
5. **Concurrency assumed away.** In-process `Map`s used for state that must be cross-instance (notification throttles, ops-alert throttle); TOCTOU on stock and order cancellation; idempotency check outside its transaction.
6. **A cache layer in front of live-grounded data.** The intent cache serves stale prices for 30 min, undoing the RAG live-price work.

---

## 2. Cross-Cutting Recommendations (highest leverage)

These each fix a *class* of bugs rather than one instance:

- **C1 — Adopt a single response serializer at the API boundary.** Standardize BE output (or a FE response interceptor) so `camelCase`↔`snake_case` is handled once, not per-call. Removes finding class #4 permanently. *(FE: `shared/lib/http/client.ts`; BE: a Sequelize toJSON transform.)*
- **C2 — Delete or quarantine dead modules now.** They carry conflicting model IDs and broken imports. Either remove or add an explicit `@deprecated DO NOT IMPORT` header + a test that fails if they're imported. *(See §3 "Dead code" list.)*
- **C3 — Ban fail-open `catch` in money/stock/consent paths.** Audit every `catch (e) { return { available: true } }` / `return allow:true` and convert to fail-closed or explicit error propagation where money, stock, or consent is involved.
- **C4 — Move all cross-instance state to Redis.** Notification thresholds, ops-alert throttle, intent cache invalidation. The droplet runs `backend` + `worker` as separate processes today; any in-process `Map` is already wrong.
- **C5 — Wrap multi-statement money/order writes in DB transactions** with row locks (`SELECT … FOR UPDATE`) — top-up credit, stock decrement, order cancel.
- **C6 — Enforce migration/deploy compatibility contract** (see §3 INFRA-1): run migrations *before* `up -d`, and require additive-only DDL within a single deploy.

---

## 3. Fix-First List (ranked by business risk)

> These are the items to address before anything else. File:line references are to current `main`.

### 🔴 Money & Revenue
1. **BKash top-up amount is never verified — pay ৳1, receive a ৳1,200 pack.** `subscription/topup.service.js:122` — `completeTopup` checks BKash `status === 'completed'` but never asserts `verification.amount >= rows.amount_bdt`. ✅ VERIFIED. **Fix:** add the amount assertion; reject + mark `failed` on mismatch. Also wrap the two `UPDATE`s (credit + status) in one `sequelize.transaction()` — currently a crash between them double-credits or loses the credit.
2. **Self-serve paid conversion is dead: `updatePlan()` never sets `status:'active'`.** `subscription/subscription.service.js` (no `status:'active'` literal exists in the file). ✅ VERIFIED (absence). A trialing/`trial_expired` shop that pays stays blocked by the `isAiActive` gate forever. **Fix:** on a confirmed paid plan change, set `status:'active'` and clear `trial_ends_at`.
3. **BKash webhook callback is dead due to arg mismatch.** `payment/bangladesh-payment.controller.js:105` calls `processPaymentCallback(payment_method, callbackData)`; `bangladesh-payment.service.js:134` declares `processPaymentCallback(callback_data)`. The string `'bkash'` binds to `callback_data`; every callback returns `{success:false}`. **Fix:** correct the signature *or* remove the dead route — but if you revive it, see SEC-3 (it's also unauthenticated/forgeable).
4. **`confirmOrder` books couriers with hardcoded `item_quantity: 1`.** `order/order.service.js:745` — a 5-unit order is dispatched as a 1-unit parcel, breaking courier weight tiers and COD amounts. **Fix:** sum real item quantities (the pattern already exists at `dispatchParcel`, line ~1115).
5. **`topup_balance` is never decremented.** `middleware/conversation-limit.middleware.js:55-57` adds it to the effective limit but no path subtracts on consumption — top-ups act as a permanent limit increase. **Fix:** decrement atomically once plan quota is exhausted.
6. **`extra_charge` overwritten, not accumulated** (`subscription.service.js:355`) and **`threshold_conversations` never reset at rollover** (`jobs/monthly-usage-reset.js:131`). Both silently mis-bill / inflate allowances each month.
7. **`chargePartnerOrder()` is never called** (`subscription.service.js:741`) — Partner per-order billing has no real-time signal; only a month-end re-count saves it. Either wire it to the `order_status → 'delivered'` transition or delete the dead accumulator fields.

### 🔴 Security
8. **Bangladesh payment callbacks are forgeable.** `payment/bangladesh-payment.routes.js:69` — `POST /callback/:payment_method` skips the `paymentCallbackAuth` chain (IP allowlist + HMAC) that `payment.routes.js` builds but never actually applies to a callback. An attacker can POST a fake "paid" event. **Fix:** apply HMAC/signature + IP allowlist before processing. (Latent today only because of bug #3 — fixing #3 without this opens a live injection surface.)
9. **`paymentGatewayIpAllowlist` trusts raw `X-Forwarded-For`.** `middleware/payment-callback-auth.middleware.js:24` — bypasses Express's proxy-corrected `req.ip` and parses the client header directly → spoofable. **Fix:** use `req.ip`.
10. **Unauthenticated tenant write.** `analytics/analytics.routes.js:71` — `POST /api/analytics/knowledge-gap` has no `authenticate` and trusts a caller-supplied `shop_id`. **Fix:** add `authenticate`; use `req.user.shopId`.
11. **2FA logins bypass token revocation.** `auth/totp.controller.js:67` issues JWTs without `tokenVersion`; `auth.middleware.js:41` then skips the revocation check. A password reset won't kill a 2FA session. **Fix:** include `tokenVersion: user.token_version`.
12. **Audit-log IDOR.** `audit/audit.controller.js:44` — `GET /api/audit/resource/:type/:id` has no `shop_id` filter; any tenant can read another's audit logs. **Fix:** scope by `shopId`.
13. **FE cross-tenant shop-ID leak risk.** `shared/context/ShopContext.tsx:65` switches shop but never calls `httpClient.setShopId()`; if any component switches via `useShop()` instead of `authService`, subsequent requests carry the old `X-Shop-ID`. **Fix:** route all shop switches through `authService`, or have `ShopContext.switchShop` set the HTTP client shop ID.

### 🔴 Correctness / Data Integrity
14. **Order cancel double stock-restore.** `order/order.service.js:829` `cancelOrder` has no `order_status === 'cancelled'` guard before restoring stock → a double-click / retry inflates inventory. ✅ (signature/flow confirmed). **Fix:** guard on current status; note the existing `order-cancel-inventory.test.js` passes for the wrong reason (mock returns the guarded state the real service lacks).
15. **Stock oversell race.** `order/order.service.js:134` reads `Product` under default `READ COMMITTED` with no row lock; two concurrent orders can both pass the check and drive quantity negative. **Fix:** `lock: t.LOCK.UPDATE` or atomic `UPDATE … WHERE quantity >= N RETURNING`.
16. **Webhook routes to dead channels.** `channel-providers/meta-channel.service.js:230` `findByMetaAssetId` has no `status` filter; DISCONNECTED/TOKEN_EXPIRED channels are treated as connected, so AI jobs are dispatched that can only fail at send. **Fix:** filter `status:'CONNECTED'`.
17. **Deploy runs containers before migrations.** `.github/workflows/ci-cd.yml:363` does `docker compose up -d` (new code, live traffic) then `exec … npm run migrate` seconds later — the documented cause of a prior ~7-min outage. **Fix:** run migrations in a `docker compose run --rm` one-off *before* `up -d`; enforce additive-only DDL per deploy.
18. **Analytics time-window SQL is broken.** `analytics/analytics-enhanced.service.js:45,76,110` — `:days` is bound *inside* a string literal `INTERVAL ':days days'`; `getPeakHours`/`getIntentBreakdown`/`getConfidenceDistribution` may silently return the wrong window. **Fix:** `NOW() - (:days * INTERVAL '1 day')` + tests.
19. **FE `cancelOrder` skips `normalizeOrder`.** `api/domains/order.ts:183` returns raw `response.data.data` ✅ VERIFIED → status pills blank, courier check breaks until refresh. **Fix:** wrap with `normalizeOrder(...)`.
20. **Payment-approval notification always throws.** `notification/owner-notification.service.js:114` calls `this.appvePayment` (typo); method is `approvePayment` at line 304. ✅ VERIFIED → every manual BKash approval silently fails. **Fix:** one-character rename.

### 🟠 Meta Policy & AI Safety
21. **Comment-to-DM with empty keyword list DMs *every* commenter.** `commentToDm/comment-to-dm.service.js:195` treats `keywords.length === 0` as "match all" — a viral post → thousands of unsolicited DMs → Meta spam restriction. **Fix:** empty list = feature disabled; require ≥1 keyword.
22. **The AI guardrail chain is never called.** `ai/guardrail.service.js` (RTO-fraud / output prompt-injection / hallucination / coherence / toxicity) is fully built and tested but absent from `jobs/message-worker.js`. Replies go straight to send. **Fix:** call `validateResponse(...)` between `processNewIntent` and store; promote price-hallucination from MEDIUM→HIGH so it escalates to HITL.
23. **Intent cache serves stale prices for 30 min.** `ai/intent-router.service.js:62` keys on message text only; a live-grounded price answer is cached and returned after the price/stock changes. **Fix:** invalidate on product/FAQ update, or exclude price-bearing answers from cache.
24. **PII reaches the LLM/logs unscrubbed in the order flow.** `scrubPII` runs in `intent-router.service.js:351` but `handleOrderFlow` (which takes priority, `message-worker.js:291`) passes raw phone/address straight into the step machine. **Fix:** scrub in the order-session path too.
25. **IG comment echo filter never matches** (`commentToDm/comment-to-dm.webhook-handler.js:77`) → shop's own IG replies re-processed as customer comments. **Fix:** compare against the channel's IG account id, not `pageOrAccountId`.
26. **Verify Gemini model IDs.** `ai/llm.service.js:26` defaults `gemini-3.1-flash-lite` / `gemini-3.1-pro-preview`. If these don't resolve on the live API, all traffic silently fails over to OpenAI (cost) or fails entirely. **Action: confirm against the live Gemini model list** (not assumed wrong). Also note `gemini-cache.service.js:108` builds caches against a *different* default model — Gemini caches are model-specific, so a mismatch silently voids caching.

---

## 4. Detailed Findings by Domain

The full per-domain reports follow. Each finding: **[severity] title — `file:line` — problem — fix.**

### 4.1 Security & Auth
**Purpose:** auth lifecycle (signup/signin/JWT/2FA/reset), tenant isolation middleware, CSRF, audit logging, consent, security config. Request chain: Helmet → CORS → rate-limit → body/raw → XSS sanitize → cookies → session → CSRF → routes; `authenticate` verifies HS256 JWT + blacklist + `token_version`; `verifyShopAccess` reads `shopId` from JWT only.

- **[HIGH] 2FA omits `tokenVersion`** — `auth/totp.controller.js:67` — see Fix-First #11.
- **[HIGH] Unauthenticated knowledge-gap write** — `analytics/analytics.routes.js:71` — see #10.
- **[HIGH] BD payment callbacks lack IP allowlist + HMAC** — `payment/bangladesh-payment.routes.js:69` — see #8.
- **[HIGH] `X-Forwarded-For` trusted raw** — `middleware/payment-callback-auth.middleware.js:24` — see #9.
- **[MEDIUM] Audit-log IDOR** — `audit/audit.controller.js:44` — see #12.
- **[MEDIUM] Audit cleanup guard reads non-existent `req.user.role`** — `audit/audit.controller.js:102` — guard is permanently true; nobody can run cleanup. Use `requirePlatformAdmin`.
- **[MEDIUM] TOTP key derives from `JWT_ACCESS_SECRET` fallback, scryptSync on hot path** — `auth/totp.service.js:18,23` — shared entropy + ~50-100ms/verify. Require dedicated `TOTP_ENCRYPTION_KEY`; derive once at startup.
- **[MEDIUM] `saveUninitialized:true` allocates a Redis session per anon visitor** — `middleware/session.middleware.js:14` — needed for CSRF stability but grows with scanner traffic; add session cleanup cron.
- **[MEDIUM] `shop_name` unvalidated** — `auth/auth.service.js:149` — not in `signupValidator`; confirm controller passes the *validated* body, else add `Joi.string().max(100)`.
- **[MEDIUM] `hasConsent` treats "no record" as consent** — `consent/consent.service.js:74` — `undefined?.opted_out_at` is falsy → passes. Require positive `opted_in:true`.
- **[LOW] `X-Request-ID` echoed unvalidated** (`middleware/request-context.middleware.js:16`); **auth limiter disabled in dev** (`app.js:141`); **dead `jwtResetSecret` fallback** (`config.js:89`); **`trust proxy` prod-only** (`app.js:57`); **delivery creds use AES-256-CBC (no auth tag)** (`delivery/delivery-integration.entity.js:50`) — migrate to GCM like Meta tokens/TOTP.

**Top 3:** (1) 2FA `tokenVersion`; (2) secure BD payment callbacks + XFF; (3) authenticate the knowledge-gap endpoint.

### 4.2 Meta Integration
**Purpose:** inbound webhooks (HMAC-verified, 120/min), channel/provider registry, comment-to-DM state machine, outbound via policy engine → Graph API, OAuth token lifecycle, GDPR data-deletion/deauthorize. **Policy assessment:** user-initiated trigger, no cold outreach, opt-out (STOP), 24h window/tags, dedup, data-deletion — all PASS. **Risks:** empty-keyword comment-to-DM, IG echo filter.

- **[CRITICAL] `findByMetaAssetId` no status filter** — `channel-providers/meta-channel.service.js:230` — see #16.
- **[HIGH] consent/opt-out rules ALLOW when `customer` null** — `policy/rules/consentRequired.rule.js:24`, `messengerOptedOut.rule.js:17` — `webhook.service.sendMessage` proceeds with `customer=null` on lookup failure. Ensure the worker always passes a resolved customer.
- **[HIGH] Empty keyword list → DM all commenters** — `commentToDm/comment-to-dm.service.js:195` — see #21.
- **[HIGH] IG echo filter never matches** — `commentToDm/comment-to-dm.webhook-handler.js:77` — see #25.
- **[MEDIUM] `appvePayment` typo** — `notification/owner-notification.service.js:114` — see #20. ✅
- **[MEDIUM] Token-refresh job skips non-expiring page tokens** — `jobs/meta-token-refresh.job.js:59` — `token_expires_at IS NULL` (the common OAuth case) never refreshed; revocations surface only at send. Add a lightweight `/me?fields=id` health pass that sets `TOKEN_EXPIRED`.
- **[MEDIUM] Comment private-reply bypasses policy engine** — `comment-to-dm.service.js:376` — no 24h/rate-limit/opt-out preflight. Add one.
- **[MEDIUM] OAuth returns long-lived user token to FE** — `channel-providers/meta-oauth.service.js:76,248` — replace `tempToken` with an opaque Redis-backed reference id.
- **[MEDIUM] Idempotency check outside the transaction (TOCTOU)** — `integration/meta-webhook-events.handler.js:196` — Meta retries can double-store/double-dispatch. Move check inside txn with a lock, or rely on a DB unique constraint on `external_id` (confirm it exists).
- **[LOW] IG comment `occurredAt` uses `Date.now()`** (`providers/MetaInstagramProvider.js:307`); **STOP keyword list incomplete vs policy spec** (`consent/consent.service.js:36`); **`handleDmOpened` not channel-scoped** (`comment-to-dm.service.js:408`).

**Top 3:** (1) fix `appvePayment`; (2) `status:'CONNECTED'` filter; (3) require ≥1 comment-to-DM keyword.

### 4.3 AI Conversational Engine
**Purpose:** burst-coalesce → deterministic order-flow state machine (LLM-free) → intent router (cache → order lookup → greeting → BanglaBERT → keyword FAQ → live-grounded LLM) → policy gate → send.

- **[CRITICAL] Dead services with conflicting model IDs** — `ai/llm-tier-selection.service.js`, `ai/conversation-context.service.js` (the latter imports a non-existent `ConversationMessage`, would throw if ever called). Never imported. Delete or quarantine (C2).
- **[CRITICAL] Verify Gemini model IDs** — `ai/llm.service.js:26` — see #26.
- **[HIGH] Hallucination detector is a stub** — `ai/hallucination-detector.service.js:25` — only one weak regex, no cross-check vs grounded context, rated MEDIUM so it still sends. See #22.
- **[HIGH] Guardrail chain never wired in** — `ai/guardrail.service.js` — see #22.
- **[HIGH] Intent cache stale prices** — `ai/intent-router.service.js:62` — see #23.
- **[HIGH] PII scrub bypassed in order flow** — `message-worker.js:291` — see #24.
- **[HIGH] Sentiment-escalation can half-update state** — `message-worker.js:233-262` — if the `hitl:true` update fails mid-way the customer is silently abandoned. Wrap hitl-update + auto-reply atomically.
- **[MEDIUM] Gemini cache model mismatch** — `ai/gemini-cache.service.js:108` vs `llm.service.js` — caches built for a different model are silently void.
- **[MEDIUM] Order-number reply hardcoded English** — `intent-router.service.js:156` — ignores detected customer language.
- **[MEDIUM] Image-only burst → empty LLM text** — `burst-coalescer.js:147` / `message-worker.js:161` — synthesize an `[image]` placeholder.
- **[MEDIUM] Prompt-injection check only on input, not AI output** — `guardrail.service.js:44`.
- **[MEDIUM] Two divergent `detectLanguage` implementations** — `language-switcher.service.js` vs `conversation-state-standalone.service.js:386` — can disagree (mixed vs bn). Unify.
- **[MEDIUM] RAG `ingestData` swallows Qdrant errors** — `rag/rag.service.js:198` — on-demand callers don't check `success`; knowledge lands in DB but not vector store. Log/surface.
- **[LOW] FAQ stage still makes an LLM call even on strong match** (`intent-router.service.js:242`); **BanglaBERT no cache** (`bert-client.service.js`); **CLIP candidate load `limit:50`** (`image-product-matcher.service.js:157`); **`queryKnowledge`/`rag.controller` 500 on Qdrant outage** (`knowledge.service.js:617`).

**Top 3:** (1) verify model IDs + delete dead tier-selection; (2) wire guardrail + promote hallucination to HIGH; (3) intent-cache invalidation for prices.

### 4.4 Commerce (Orders/Products/Delivery/Customer)
**Purpose:** product catalog + stock, two order-creation paths (manual Joi → `_createOrderCore`; chatbot 8-step state machine → same core), delivery zone detection + courier dispatch (Pathao/Steadfast/RedX), RTO screening, cancel with stock restore.

- **[CRITICAL] `cancelOrder` no double-cancel guard** — `order/order.service.js:829` — see #14.
- **[CRITICAL] `confirmOrder` hardcoded `item_quantity:1`** — `order/order.service.js:745` — see #4.
- **[HIGH] Stock oversell race** — `order/order.service.js:134` — see #15.
- **[HIGH] Float money math, no rounding** — `order/order.service.js:158-183` & `generateOrderSummary:1589` — summary total can differ from stored `order.total` by ~1 BDT. Use integer-paisa or `Math.round(x*100)/100` consistently.
- **[HIGH] COD amount may double-charge delivery fee** — `order/order.service.js:736-765` (& `dispatchParcel:1108`) — `amount_to_collect` passes `order.total` (incl. embedded delivery fee) while Pathao adds its own. Decide subtotal vs total.
- **[HIGH] Pathao `createOrder` uses cached token, never refreshes** — `delivery/.../pathao.provider.js:111` — expired token → unretried 500. Preflight `issueToken()` / persist refreshed token.
- **[MEDIUM] `startOrderSession` resumes stale sessions by `last_activity_at`, not `expires_at`** — `order-session-standalone.service.js:241` — diverges from `getActiveSession`. Unify on `expires_at`.
- **[MEDIUM] Multi-item add fail-open on stock error** — `order-session-standalone.service.js:1462` — out-of-stock item silently added, fails only at summary. Distinguish API error (fail-open) from qty=0 (fail-closed).
- **[MEDIUM] `cancelOrder` returns stale instance** — `order.service.js:860` — `return order` without `reload()` → API may show old status.
- **[MEDIUM] `deleteOrder` leaks stock** — `order.service.js:640` — hard delete of a non-cancelled order doesn't restore stock.
- **[MEDIUM] Two invoice tables diverge** — `invoices` (manual `confirmOrder`) vs `order_invoices` (chatbot) — no reconciliation. Consolidate or document.
- **[MEDIUM] Product full-text search uses `to_tsvector('english')` on Bengali names** — `product/product-search.service.js:88` — Bengali queries get zero FTS hits. Use `'simple'`.
- **[MEDIUM] `bookCourier` reads shop id from `x-shop-id` header** — `order/order.controller.js:666` — fragile auth bypass; derive from `req.user.shopId` only.
- **[LOW] Summary omits tax** (`order-session-standalone.service.js:1589`); **`checkStock` ignores `allow_backorder`** (`product-search.service.js:188`) — chatbot vs manual inconsistency; **legacy `order-session.service.js` still present** (starts at `COLLECTING_NAME`) — remove.

**Top 3:** (1) cancel guard + atomic stock decrement; (2) fix `item_quantity:1` + COD amount; (3) `'simple'` tsvector for Bengali search.

### 4.5 Billing & Money
**Purpose:** Growth ৳999 flat + Partner per-order, 14-day card-less trial, conversation quota gate (`isAiActive`), BKash top-ups, monthly invoices, dunning, Steadfast COD reconciliation.

- **[CRITICAL] BKash amount unverified** — `subscription/topup.service.js:122` — see #1. ✅
- **[CRITICAL] `updatePlan` never activates** — `subscription/subscription.service.js:216` — see #2. ✅
- **[CRITICAL] BKash callback arg mismatch (dead)** — `payment/bangladesh-payment.controller.js:105` vs `service.js:134` — see #3.
- **[HIGH] `extra_charge` overwritten** — `subscription.service.js:355` — see #6.
- **[HIGH] `topup_balance` never decremented** — `middleware/conversation-limit.middleware.js:55` — see #5.
- **[HIGH] `chargePartnerOrder` never called** — `subscription.service.js:741` — see #7.
- **[HIGH] `threshold_conversations` never reset** — `jobs/monthly-usage-reset.js:131` — see #6.
- **[MEDIUM] `NOTIF_CACHE` is in-process** — `conversation-limit.middleware.js:26` — multi-process duplicate limit notifications. Move to Redis (C4).
- **[MEDIUM] `completeTopup` no transaction** — `topup.service.js:137-166` — see #1.
- **[MEDIUM] 15% VAT billed on top of advertised ৳999** — `jobs/invoice-generator.js:229` — ৳999 advertised, ৳1,148.85 billed. Disclose "৳999 + VAT" or set base to ৳869.
- **[MEDIUM] Orphaned `recordConversation()`** — `conversation-limit.middleware.js:124` — would double-count if ever called. Remove.
- **[MEDIUM] Proration invoice created with no collection mechanism** — `subscription.service.js:196`.
- **[LOW] BKash token fetched every call** (`bangladesh-payment.service.js:28`) — cache 55-min; **callback no HMAC** (overlaps #8); **`monthly-usage-reset.js:84` logs `extra_charges` (plural)** — always undefined.

**Top 3:** (1) amount verification + txn in `completeTopup`; (2) `updatePlan` must activate; (3) `topup_balance` depletion + `threshold` reset.

### 4.6 Platform, Data & Infra
**Purpose:** Sequelize/Postgres data layer + custom `migrate.js` runner (~80 raw-SQL idempotent migrations), BullMQ jobs (8 cron + message-worker + burst-coalescer, distributed locks via `BaseJob`), Docker Compose single-droplet + Caddy + GitHub Actions, admin/dashboard/analytics.

- **[CRITICAL] Deploy: `up -d` before migrate** — `ci-cd.yml:363` — see #17.
- **[CRITICAL] Broken `INTERVAL ':days days'` SQL** — `analytics/analytics-enhanced.service.js:45,76,110` — see #18.
- **[HIGH] Worker has no healthcheck / no `depends_on` on backend** — `docker-compose.prod.yml:75` — crashes are invisible except the 15-min pipeline canary. Wire the existing `worker.js:17` health port into a Docker healthcheck; add `depends_on: backend: service_healthy`.
- **[HIGH] No container resource limits** — `docker-compose.prod.yml` — one runaway query can OOM the whole droplet (incl. Postgres/Redis). Add `mem_limit` per service; **pin `qdrant:latest` to a version**.
- **[HIGH] `getFailed()` loads all failed jobs** — `failed-jobs.routes.js:88,109` — use `getJobFromId(req.params.id)`.
- **[MEDIUM] `MonthlyUsageReset` only processes `active`** — `monthly-usage-reset.js:53` — trial usage carries into the paid period. Include `trialing` or reset at trial expiry.
- **[MEDIUM] Admin role cache 60s** — `platform-admin.middleware.js:22` — role revocation lag in emergencies; lower TTL to ~10s.
- **[MEDIUM] Qdrant no healthcheck / no version pin** — `docker-compose.prod.yml:137`.
- **[MEDIUM] `opsAlert` throttle in-process** — `utils/ops-alert.js:34` — Slack spam on restart loops. Redis NX key.
- **[MEDIUM] `DailyOverageCalculator` overwrites `extra_charge`** — `jobs/daily-overage-calculator.js:161` — only last day billed (same class as #6).
- **[MEDIUM] Burst coalescer hard-caps at 30 messages** — `burst-coalescer.js:168`.
- **[MEDIUM] `migrate.js` no per-migration transaction** — `migrate.js:118` — partial multi-statement failures leave intermediate schema (DDL can't be transactional in PG, but DML/index can).
- **[LOW] worker health port 8080 unmapped** (`worker.js:17`); **`drainChannelJobs` scans all jobs** (`message-queue.js:69`); **admin dashboard uses un-scoped cache** (`admin.service.js:53`); **`BaseJob.checkExistingExecution` JSONB scan with no GIN index** (`base-job.js:176`) — add `gin(audit_logs.metadata)`; **Caddy no `encode gzip`**.

**Top 3:** (1) migrations before `up -d`; (2) fix analytics INTERVAL SQL; (3) worker healthcheck + resource limits + Qdrant pin.

### 4.7 Frontend
**Purpose:** React 18 + TS + Vite SPA for BD shop owners; Meta OAuth, real-time SSE inbox, orders, products/customers/subscription, PWA; default Bengali via react-i18next; httpOnly-cookie auth with in-memory access token; axios singleton with CSRF + 401-refresh queue.

- **[CRITICAL] `cancelOrder` skips `normalizeOrder`** — `api/domains/order.ts:183` — see #19. ✅
- **[CRITICAL] OAuth handler triple-duplication + listener/BroadcastChannel leak** — `app/components/ChatSettings.tsx:183-515` — 3 near-identical ~60-line blocks; unmount-race leaves a dangling `message` listener; `handleReconnect` (line 483) calls the per-platform callback even though unified is default. Extract a single `useOAuthPopup` hook.
- **[HIGH] `ShopContext` shadows `authService` shop id** — `shared/context/ShopContext.tsx:65` — see #13.
- **[HIGH] `useInboxSSE` stale `shopId` capture** — `app/lib/useInboxSSE.ts:29` — reads `getCurrentShopId()` at render before async auth init resolves; SSE never connects until navigation. Read inside the effect / subscribe to `authService`.
- **[HIGH] Hardcoded BN+EN strings in Orders detail modal** — `app/components/Orders.tsx:586,738,1036,1057,1091,1183-1220` — bypass `t()`.
- **[HIGH] Legal pages fully English** — `PrivacyPolicy.tsx`, `TermsOfService.tsx` — language toggle has no effect; Meta-review + DSA risk.
- **[HIGH] ChatSettings connected-state labels English-only + dev note leaks** — `ChatSettings.tsx:123,402,608,728,750…` — line 750 shows users `"…(one popup)"`.
- **[MEDIUM] `loadConversations` stale closure on SSE new-message** — `UnifiedInbox.tsx:163` — full refetch clobbers optimistic state.
- **[MEDIUM] `filterStatus → fulfillment_status` mismatch** — `Orders.tsx:155` — BE uses `order_status`; "cancelled" filter fetches all then filters client-side, hiding page-2+ matches.
- **[MEDIUM] Timestamps hardcoded `en-US`** — `inbox/InboxThreadDetail.tsx:56` — no Bengali numerals.
- **[MEDIUM] Service worker caches `/app` shell, never bumps `CACHE_VERSION`** — `public/sw.js:53` — stale authed shell on flaky networks; inject build hash.
- **[MEDIUM] Role-casing mismatch** — `ShopContext.tsx:22` (`OWNER`) vs `auth.ts:292` (lowercases) — silent permission denial if mixed.
- **[MEDIUM] Vestigial RBAC guards** — `shared/components/guards/ProtectedRoute.tsx` — duplicate auth model vs the real `protectedLoader`/`PlatformAdminRoute`; renders non-i18n "Access Denied". Consolidate/remove.
- **[LOW] `dangerouslySetInnerHTML` in `ui/chart.tsx:83`** (safe today, validate colors); **dead `bd_lite` i18n keys** (`locales/bn.json:1381`, `en.json:1387`); **`useSubscriptionFeatures` module cache not reset on logout** (`useSubscriptionFeatures.ts:21`); **CSP `connect-src` keeps legacy `api.easymod.tech`** (`nginx.conf:49,108`); **Orders loads ALL products client-side** (`Orders.tsx:134`).

**Top 3:** (1) `cancelOrder` normalize; (2) consolidate OAuth into one hook + fix leak; (3) i18n completeness on orders/channels/legal.

---

## 5. Suggested Sequencing

1. **Hour-1 hotfixes (1-char / 1-line, high impact, low risk):** #20 `appvePayment`, #19 FE `normalizeOrder`, #11 2FA `tokenVersion`, #16 channel status filter.
2. **Revenue integrity (this week):** #1, #2, #3, #5, #6 — the billing cluster. Pair with C5 (transactions).
3. **Security hardening:** #8, #9, #10, #12, #13.
4. **Correctness/concurrency:** #14, #15, #18, and C4 (Redis state).
5. **Deploy safety:** #17 + INFRA worker healthcheck/limits/Qdrant pin.
6. **Meta policy & AI safety:** #21, #22, #23, #24, #25; verify #26.
7. **Debt sweep:** C1 (serializer), C2 (delete dead modules), i18n completeness, legacy `order-session`.

## 6. Caveats & Verification Notes

- Findings were produced by independent agents reading current `main`. A sample (✅) was re-verified directly: `appvePayment` typo, BKash amount gap + missing txn, absence of `status:'active'` in `updatePlan`, FE `cancelOrder` raw return. The remainder are evidence-based but un-re-verified — confirm `file:line` before fixing.
- #26 (Gemini model IDs) is **"verify," not "confirmed wrong"** — check the live API.
- Some items note that an existing test "passes for the wrong reason" (e.g. `order-cancel-inventory.test.js`) — re-validate tests when fixing the underlying code.
