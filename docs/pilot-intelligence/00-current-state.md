# Pilot Intelligence — Current State (pre-implementation)

Date: 2026-09-27
Baseline: `origin/main` @ `e876644b8cdc1a6704defbe0b331d3757a33ce29`
Scope: Customer 360 Lite + Sales Opportunities + RTO Shield v2 / Order Confidence

This is the discovery record made before any code changed. It states what
existed on `main` at the baseline, with file and symbol evidence. The
implementation plan is [01-plan.md](01-plan.md).

## 1. Runtime boundaries

| Layer | Technology | Evidence |
| --- | --- | --- |
| Backend API | Node 20, Express 4, Sequelize 6, PostgreSQL 16 | `EasyMod-backend/package.json`, `src/app.js` |
| Background jobs | BullMQ on Redis, separate `worker` service in production | `src/jobs/queue-manager.js`, `docker-compose.prod.yml` (`worker`) |
| Frontend | Vite + React 18 SPA, react-router 7, i18next (en/bn), Tailwind + Radix | `EasyMod-frontend/package.json`, `src/app/routes.ts` |
| Tests | Jest (unit), Jest + real Postgres/Redis (`*.integration.test.js`), Meta-shaped E2E (`tests/meta-e2e`), Vitest, Playwright (mock-only in CI) | `jest*.config.js`, `.github/workflows/ci-cd.yml` |

There is no NestJS or Next.js in the affected paths.

## 2. Customer identity today

- `customers` (`src/modules/customer/customer.entity.js`) is one row per
  shop-scoped channel identity. It has `shop_id`, `channel_type`,
  `channel_user_id` (the Page-scoped PSID), `meta_channel_id`, `phone`, `email`,
  `messaging_consent` (JSONB, per-platform `last_inbound_at` / opt-out), and
  `metadata`.
- Database invariants, from the migration chain rather than the entity file:
  - `idx_customers_shop_channel_page` is UNIQUE on
    `(shop_id, channel_type, meta_channel_id, channel_user_id) WHERE meta_channel_id IS NOT NULL`
    (`20260904_001_inbox_message_delivery_state.js`).
  - `idx_customers_shop_phone` is UNIQUE on `(shop_id, phone) WHERE phone IS NOT NULL`.
  - `idx_customers_shop_email` is UNIQUE on `(shop_id, email) WHERE email IS NOT NULL`
    (`20260520_000_initial_schema.js`).
- Inbound Messenger resolution goes through `findOrAdoptCustomer()`
  (`src/modules/integration/meta-webhook-events.handler.js`). It runs inside the
  message-store transaction, relies on the Page-scoped unique index to win
  concurrent creates, and adopts legacy unpinned rows with a conditional
  (CAS) update. Replay safety comes from the durable receipt claim
  (`receiptService.claimProcessing`) and `external_id` deduplication.
- There is **no cross-shop customer entity** and no merge function. Phone is
  stored in whatever format was entered (`017…`, `+88017…`). It is normalized
  only inside RTO Shield (`normalizePhone`, `src/utils/validators/phone.validator.js`).
- Chatbot orders set `orders.customer_id` from the Page-scoped session customer
  (`OrderSessionService.createOrderFromSession` → `findScopedSessionCustomer`).
  Dashboard manual and bulk orders do **not** send `customer_id`
  (`EasyMod-frontend/src/api/types/order.ts` `CreateOrderPayload`), so those
  orders are unlinked to any customer row.
- `customers.last_active` exists but no code path maintains it.

## 3. Existing customer-facing surfaces and defects

- REST: `GET/POST/PATCH/DELETE /api/customer` plus legacy and external variants
  (`customer.routes.js`). The list is flat and paginated with no commerce data.
- `customer_preferences` (`customer-memory.service.js`) is a per-customer AI
  personalisation summary. Its `updateFromOrder` is a read-modify-write, and a
  repo-wide search finds no production caller.
- Frontend `Customers.tsx` has three defects:
  - It reads `customer.number` / `customer.channel`, but the API returns
    `phone` / `channel_type`, so phone shows "—" and channel badges fall back.
  - It calls `POST/DELETE /api/customer/:id/blacklist`, which **does not
    exist** on the backend. The block-list toggle always fails.
  - It shows `rto_risk` / `rto_count` / `blacklisted`, which the API never
    returns.

## 4. Conversation and intent signals

- `conversations` + `messages` (`conversation.entity.js`). Inbound messages carry
  `sender='customer'`, `external_id`, and the event `created_at`.
  `conversations.updated_at` is advanced to the inbound event time.
- Deterministic intent classifier: `src/modules/ai/intent/stage2-rules.js`
  `classify()` (ruleset `1.1.0`). It handles Bangla, Banglish, and English, is
  negation-aware, and emits registered intents (`docs/ai/AGENT_INTENT_REGISTRY.md`):
  `PURCHASE_INTENT_START`, `ORDER_SESSION_CHECKOUT`, `CART_EDIT_OR_ADD_MORE`,
  `PRODUCT_AVAILABILITY`, `PRODUCT_ATTRIBUTE`, `DELIVERY_CHARGE`,
  `DELIVERY_POLICY`, `PAYMENT_METHODS`, `PRODUCT_INQUIRY`,
  `PRODUCT_PHOTO_LOOKUP`, `ORDER_SESSION_CANCEL`, `STOP_OPT_OUT`, and others.
- It runs only as a read-only shadow inside the AI worker
  (`src/jobs/message-worker.js`, "Stage 2 is a read-only shadow"). That happens
  *after* the HITL, MANUAL-mode, billing, and sentiment guards, so a
  MANUAL-mode shop never produces a classification.
- `order_sessions` (`order-session.entity.js`) records the checkout step
  machine: `ACTIVE | COMPLETED | CANCELLED | ABANDONED`, `current_step`,
  `step_data.cart`, `product_info`, and `created_order_id`. A session with a cart
  and no `created_order_id` is the strongest "checkout started, not finished" fact.
- Nothing in the codebase has an "opportunity", "lead", or lifecycle-state
  concept (repository search for `opportunit|lead_|lifecycle`).

## 5. RTO Shield today

- Module: `src/modules/rto-shield/`.
  - `rto_blacklist`: per-shop entries, system-promoted `is_global` entries, and
    `WHITELIST_APPEAL` sentinels.
  - `customer_delivery_stats`: per-(shop, phone) attempt and RTO counters.
  - `rto-network-settings.js`: the shop's `contribute` / `enforce` choice for the
    cross-shop network, stored in `shop.settings.rto_network`.
- `RtoShieldService.checkPhone()` returns
  `{ flagged, risk_score, tier: block|verify|clear, network }`.
- Behavior at order creation (`order.service.js` `_createOrderCore` →
  `runRtoShieldCheck`): a COD order with `risk_score ≥ 70` is **refused** (422).
  The `verify` tier is **only logged**; it is not persisted and does **not**
  gate courier dispatch. **This is the main gap RTO Shield v2 closes.**
- The chatbot phone step (`order-session-standalone.service.js`,
  `COLLECTING_PHONE`) refuses flagged phones. It calls `checkPhone` without the
  shop's network `enforce` setting.
- Outcome feedback: `delivery-tracking.service.js` `handleDeliveryWebhook` calls
  `trackDeliveryOutcome()`. That is a read-modify-write counter with no
  idempotency, so duplicate concurrent terminal webhooks can double count.
  `failed_delivery` (a non-terminal attempt) also counts as an RTO.
- Other consumers that must keep working: `mobile/attention.service.js`
  (`collectRtoVerifyOrders`) and `ai/guardrail.service.js`.

## 6. Courier booking boundary

- `orderService.bookForOrder()` (`src/modules/order/order.service.js`) is the
  **single canonical booking entry point**. It has these callers:
  1. manual `POST /api/order/:orderId/book-courier` and `/courier`
     (`order.controller.js` `bookCourier`);
  2. merchant confirm of a draft (`confirmOrder`);
  3. chatbot auto-dispatch (`OrderSessionService.dispatchParcelWithRetry` →
     `dispatchParcel`, with an Action Gate `BOOK_COURIER` authorization);
  4. payment webhook fulfilment (`payment-webhook.controller.js`).
- A repository search finds no other `deliveryService.createDeliveryOrder`
  caller.
- Idempotency comes from `courier_dispatch`, which is UNIQUE on
  `(shop_id, order_id)`. The claim is `claimCourierDispatch()` (findOrCreate
  with an owner token), and transitions are CAS on `(id, owner_token, status)`
  (`courier-dispatch-claim.service.js`). Provider timeouts become
  `INDETERMINATE` and are never blindly retried. Only a definitive 4xx
  (`FAILED`) can be re-claimed. A PostgreSQL race test exists in
  `order/__tests__/courier-dispatch-ownership.integration.test.js`.
- `bookForOrder` does not check `order_status`, so a cancelled order can be
  booked through the manual route. This is pre-existing.

## 7. Outbound messaging policy

- `src/modules/policy/policy.engine.js` is the mandatory outbound gate. Its
  rules cover opt-out, consent, the 24-hour window, template/tag, rate limit,
  business hours, draft mode, and content sanitising. Every decision is
  persisted to `policy_decisions`.
- Manual merchant replies go through the Inbox send path, which applies the
  same engine.
- Operational hazard, recorded 2026-09-22: a single failing outbound send has
  previously flipped a live Page to `TOKEN_EXPIRED`. Unnecessary automated
  sends carry real channel risk.

## 8. Tenancy, RBAC, audit, flags

- `authenticate` takes `shopId` from the JWT and re-checks active membership.
  `verifyShopAccess` (`middleware/shop-access.middleware.js`) sets
  `req.userRole` to `owner | admin | staff`. `requireOwnerOrAdmin` exists.
- `role-permission.js` `requirePermission` has **no callers**.
- Audit is `AuditService.logOperation` → `audit_logs`, with a secret-redacting
  sanitiser.
- Feature flags: there is **no flag system**. The existing patterns are global
  env booleans in `config.js` (rendered from an allowlist by
  `scripts/render-production-env.js`) and per-shop JSON under
  `shops.settings`.
- **`shops.settings` is merchant-writable.** Any active member, staff included,
  can `PATCH /api/shop/:id` with a `settings` patch.
  `mergeAndSanitizeSettings` keeps any key already present
  (`shop-settings.validator.js` `sanitizeSettings(…, preservedSettings)`). A
  platform-controlled pilot flag stored there could therefore be self-enabled
  or self-disabled.
- The platform admin API (`src/modules/admin/admin.routes.js`) has SUPER_ADMIN
  per-shop operations, for example `POST /shops/:shopId/ai/emergency-off`.

## 9. Observability

- Structured JSON logs come from `utils/structured-logger.js`.
- In-process counters surface on `/health/detailed`, for example
  `meta-webhook-metrics.js` → `webhookMalformed`.
- There is no Prometheus client in the backend.

## 10. Test and CI facts that constrain the work

- CI required contexts are `PR Merge Gate` (which aggregates Test & Build,
  frontend Playwright, Meta E2E, integration, deployment config, Docker build,
  and Growth OS) and `Security Scan`.
- The integration job runs `npm run migrate` then `npm run schema:audit` on real
  Postgres, then `npm run test:integration`. `schema:audit` fails on
  entity-versus-schema drift.
- The Playwright CI job runs an explicit spec list, so new specs must be added
  to it.
- Migrations run inside a transaction (`src/database/migrate.js`), so
  `CREATE INDEX CONCURRENTLY` is unavailable.

## 11. Technical debt affecting these features

1. The verify tier is computed and then discarded. There is no dispatch gate
   and no audit.
2. `trackDeliveryOutcome` is non-idempotent and treats `failed_delivery` as RTO.
3. The Customers page has field-name and missing-endpoint defects (§3).
4. Manual orders are not linked to customers, and phone formats are
   inconsistent.
5. Merchant-writable `shops.settings` cannot hold platform-controlled flags.
6. `bookForOrder` does not refuse cancelled orders.
7. `_createOrderCore` accepts a `customer_id` without verifying it belongs to
   the shop. It does not leak data, because reads filter by `orders.shop_id`,
   but it is an integrity gap.
8. There is no inbox deep link to a conversation.

## 12. Reusable abstractions (reuse, do not duplicate)

- `customers` rows as the customer record, plus Page-scoped identity constraints.
- `stage2-rules.classify()` for purchase-intent signals.
- `order_sessions` for checkout-abandonment facts.
- `RtoShieldService.checkPhone()` + `getNetworkSettings()` as RTO Shield inputs.
- `bookForOrder()` + `courier_dispatch` claim for the booking boundary.
- `normalizePhone()` for deterministic phone normalisation.
- `AuditService.logOperation`, `verifyShopAccess`, `requireOwnerOrAdmin`, and
  `requirePlatformAdmin`.
- BullMQ `upsertJobScheduler` job pattern (`inbox-delivery-reconciler.job.js`).
- The Meta-shaped E2E harness (`tests/meta-e2e/harness.js`) and the
  disposable-database integration stack (`scripts/run-backend-integration.js`).
