# Pilot Intelligence — Implementation Plan

Date: 2026-09-27 · Branch: `feat/pilot-customer-rto-intelligence` · Base: `main` @ `e876644b`
Discovery record: [00-current-state.md](00-current-state.md)

This plan was written before implementation. The final behavior is described in
[02-product.md](02-product.md) through [07-operations-runbook.md](07-operations-runbook.md).
Where the implementation diverged from this plan, the divergence is recorded
in §17 of this document.

## 1. Product objectives

| Merchant problem | Pilot response | Business lever |
| --- | --- | --- |
| "Who is this person and have they bought before?" means scrolling the Inbox and Orders. | **Customer 360 Lite**: one merchant-scoped record per customer, with orders, delivery outcomes, delivered value, a lifecycle state, and a relationship timeline. | Retention, and faster, better decisions |
| Price, size, and COD questions that never became orders are invisible. | **Sales Opportunities**: deterministic, explainable, deduplicated detection of purchase-intent conversations with no order, followed up manually through the Inbox. | Conversion |
| RTO Shield computes a `verify` tier and throws it away. Couriers get booked for orders that should have been confirmed first, and returns cost delivery fees both ways. | **RTO Shield v2 / Order Confidence**: an explainable READY / VERIFY / MANUAL_REVIEW decision enforced at the single courier booking boundary, with audited merchant resolution and recorded delivery outcomes. | Loss reduction, workflow reliability |

## 2. Non-goals (pilot)

The pilot does not include:

- a full CRM, tags, segments builder, campaigns, email marketing, or a workflow builder;
- automatic follow-up sending (see [ADR-0008](../adr/0008-manual-follow-up-only.md));
- customer merge or unmerge;
- cross-merchant identity;
- expansion of the existing cross-shop RTO network (it is consumed read-only, as it is today);
- ML scoring, numeric lead scores, lifetime-value prediction, or recommendations;
- payment-based verification (advance payment);
- new courier providers;
- catalog sync;
- redesign of unrelated pages.

## 3. Architecture challenge (summary)

The full alternatives are in the ADRs. Each row below records the question,
the options compared, and the decision.

| # | Question | Alternatives compared | Decision |
| --- | --- | --- | --- |
| 1 | What is a Customer? | (A) reuse `customers` rows with Page-scoped identity; (B) a new canonical `customer_profiles` table plus identity links and merge; (C) write-time auto-link or merge by phone | **A.** `customers` already carries DB-enforced Page-scoped uniqueness. B duplicates it and forces merge semantics the pilot excludes. C mutates the order write path and risks wrong merges. Unlinked orders are associated **at read time** by exact normalized phone, and labelled as such. ([ADR-0005](../adr/0005-customer-identity-and-computed-state.md)) |
| 2 | Persist or compute customer state? | (A) compute on read from orders and opportunities; (B) persisted counters and state maintained by hooks | **A.** There are more than 6 order-mutation paths (manual, bulk, chatbot, payment webhook, courier webhook, returns). Hooks drift, and a backfill would be required. At pilot scale, a page of 20 customers costs a few indexed queries. The trigger to materialize is documented. |
| 3 | How are opportunities detected? | (A) a scheduled sweep using the deterministic Stage-2 classifier plus order-session facts; (B) a hook in webhook ingestion; (C) a hook after the worker's Stage-2 shadow; (D) LLM classification | **A.** B touches the inbound durability path, which is under active remediation, and cannot know that a conversation "stopped". C never runs for MANUAL-mode shops. D adds cost and prompt-injection exposure and is non-deterministic. ([ADR-0006](../adr/0006-opportunity-detection-sweep.md)) |
| 4 | Where does RTO v2 act? | (A) a gate inside `bookForOrder`, before the dispatch claim; (B) refusing order creation; (C) a UI badge | **A.** It is the single booking boundary for all 4 callers. B loses orders (the existing block tier already refuses COD at creation). C is bypassable. ([ADR-0007](../adr/0007-order-confidence-gate-at-booking-boundary.md)) |
| 5 | How does the decision stay correct under races? | (A) a CAS `version` column, a material-fact fingerprint, and the existing dispatch claim; (B) `SELECT … FOR UPDATE` across the provider call; (C) Redis locks | **A.** B holds row locks across a network call. C makes it ambiguous whether a Redis outage fails open or closed. ([ADR-0010](../adr/0010-order-confidence-concurrency.md)) |
| 6 | Follow-up automation? | (A) manual follow-up via Inbox, with a reply-window indicator; (B) automatic templated follow-up | **A.** Meta forbids sales messages outside 24h, a failed send has disabled a live Page before, and the existing manual path already enforces the policy engine. ([ADR-0008](../adr/0008-manual-follow-up-only.md)) |
| 7 | Where do pilot flags live? | (A) a dedicated `shop_pilot_features` table, SUPER_ADMIN-only; (B) `shops.settings`; (C) env booleans | **A.** B is writable by any shop member (tamper and self-enable). C is global-only and needs a redeploy through the env renderer. ([ADR-0009](../adr/0009-pilot-feature-flags-table.md)) |

### Pre-mortem: "It's the end of the pilot and this failed. Why?"

Each failure mode is paired with the mitigation built into the plan.

1. **Merchants drown in low-value opportunities.** Mitigations: at most one live
   opportunity per customer, enforced by a partial unique index. A qualification
   rule requires either a strong signal (explicit purchase intent, checkout
   started) or two distinct medium signals. A cursor stops a dismissed
   opportunity from coming back without new customer messages. Auto-expiry
   runs at 7 days.
2. **Order Confidence holds good orders, and merchants disable it.** Mitigations:
   shadow mode first, so decisions are recorded and merchants see what *would*
   have been held. Rules are monotonic and few (10). Verification is one click
   for staff, approval one click for owner/admin. Outcome-by-decision metrics
   let the hold rate be judged on evidence.
3. **Held orders silently never ship.** Mitigations: a hold marks
   `delivery_status='confidence_hold'`, sends a deduplicated merchant
   notification, and puts a panel with the action on the order detail. Manual
   recovery always exists, and admin mode `off` restores legacy behavior
   instantly.
4. **A stale approval ships a changed order.** Mitigation: every resolution is
   bound to the order's material-fact fingerprint. The gate re-evaluates on
   every call, and a fingerprint change voids the resolution.
5. **Double parcels under retries.** Mitigations: the gate sits *before* the
   existing `courier_dispatch` claim and never replaces it. A committed claim is
   always allowed to reconcile.
6. **Customer 360 shows another customer's orders.** Mitigations: every query is
   `shop_id`-scoped. Phone association applies only to orders with
   `customer_id IS NULL`, and is labelled "matched by phone".

### Red team: adversary vectors and defenses

1. **Staff self-approves MANUAL_REVIEW.** Defense: approve requires
   `owner|admin` server-side, and the resolution level is recorded.
2. **A merchant writes `settings.pilot_features` to toggle enforcement.**
   Defense: flags are not stored in `shops.settings`.
3. **The client sends a forged `decision_version`.** Defense: the version is
   only a precondition. The server re-evaluates, and a mismatch returns 409; it
   cannot grant anything.
4. **Direct `POST /order/:id/book-courier` on a held order.** Defense: the gate
   runs inside `bookForOrder`, and the route returns 409 `ORDER_CONFIDENCE_HOLD`.
5. **Cross-shop IDOR on customer, opportunity, or order IDs.** Defense: every
   lookup includes the JWT `shopId`, and a miss returns 404 with no existence
   oracle.
6. **Identity poisoning.** A customer claims someone else's phone in chat to
   inherit their "trusted" history. Defense: rules never *relax* on history
   (they are monotonic), so history can only add caution. Phone association
   never merges customer rows.
7. **Prompt injection via message text.** Defense: detection is regex-only, with
   no LLM involved.

## 4. Architecture

```
                       ┌──────────────────────────── EasyMod-backend ────────────────────────────┐
 Meta webhook ─▶ meta-webhook-events.handler (unchanged) ─▶ customers / conversations / messages
                                                            │
 worker: opportunity-detector.job (every 10 min, per enabled shop, pg advisory lock)
            │ reads messages + order_sessions ─▶ stage2-rules.classify() ─▶ opportunity-signals
            └────────────▶ customer_opportunities (OPEN/ACTIONED/CONVERTED/DISMISSED/EXPIRED)
                                                            ▲ convert (order hook + sweep)
 order.service._createOrderCore ──(post-commit, best effort)┘
 order.service.bookForOrder ─▶ orderConfidence.checkBookingGate ─▶ order_confidence (CAS)
            │ allowed ─▶ courier_dispatch claim ─▶ provider (unchanged)
            │ held    ─▶ delivery_status=confidence_hold + notification (no claim, no provider call)
 delivery-tracking.handleDeliveryWebhook ─▶ orderConfidence.recordOutcome (idempotent)
 customer-intelligence API ─▶ Customer 360 read models (computed) + opportunities
 order-confidence API ─▶ decision read, verify, approve, summary
 admin API (SUPER_ADMIN) ─▶ shop_pilot_features
                       └──────────────────────────────────────────────────────────────────────────┘
 EasyMod-frontend: Customers (360 list + detail + opportunities tab), Orders detail confidence
 panel + 409 hold handling, Inbox ?conversation= deep link, Admin shop pilot toggles.
```

### New backend modules

| Module | Responsibility |
| --- | --- |
| `modules/pilot-features/` | `shop_pilot_features` entity, `getPilotFeatures(shopId)`, admin set/disable-all, `pilot-metrics` counters |
| `modules/customer-intelligence/` | `order-outcome` classifier and phone variants (pure), `customer-state` (pure), `customer-360.service` (list/detail), `opportunity-signals` (pure), `opportunity.service` (detect/convert/expire/actions/list), controller/routes/validator |
| `modules/order-confidence/` | `order-confidence.rules` (pure evaluate + fingerprint), `order-confidence.service` (facts, CAS persist, gate, verify, approve, outcome, summary), controller/routes/validator |
| `jobs/opportunity-detector.job.js` | Scheduled sweep: detect, convert, expire |

### Existing code touched (surgical)

| File | Change |
| --- | --- |
| `order.service.js` `bookForOrder` | Gate call before the claim; hold marker and notification. The committed-claim reconcile path stays open. |
| `order.service.js` `_createOrderCore` | Post-commit best-effort opportunity conversion, same pattern as funnel events |
| `order.controller.js` `bookCourier` | Map `confidence_hold` to 409 `ORDER_CONFIDENCE_HOLD` |
| `delivery-tracking.service.js` | Best-effort `recordOutcome` on terminal status |
| `queue-manager.js`, `jobs/index.js`, `job-runner.js` | Register and schedule the detector |
| `modules/routes.js` | Mount the two routers |
| `admin.routes.js` / controller | Pilot feature endpoints |
| `health.routes.js` | `pilotIntelligence` counters |
| `openapi.yaml` | New paths |

## 5. Data model

A new migration, `20260927_001_pilot_customer_rto_intelligence.js`, adds three
new tables and one index on an existing table.

- `shop_pilot_features`:
  - `shop_id` PK and FK to `shops`, ON DELETE CASCADE;
  - `customer_intelligence` BOOL, default false;
  - `order_confidence_mode` VARCHAR(10), CHECK in (`off`, `shadow`, `enforce`), default `off`;
  - `order_confidence_config` JSONB `{}`;
  - `updated_by`, `created_at`, `updated_at`.
- `customer_opportunities`:
  - `id`, `shop_id` FK, `customer_id` FK CASCADE, `conversation_id` FK SET NULL,
    `order_session_id` (nullable), `status`, `strength` (`HIGH` / `MEDIUM`);
  - `reasons` JSONB, `signals` JSONB (message IDs and intent IDs, **no raw text**),
    `product_refs` JSONB;
  - `first_signal_at`, `last_signal_at`, `detected_at`, `detector_version`;
  - `actioned_at` / `actioned_by`;
  - `converted_order_id` FK SET NULL;
  - `resolved_at` / `resolved_by` / `resolution_reason`;
  - timestamps.
  - Indexes:
    - UNIQUE `(shop_id, customer_id) WHERE status IN ('OPEN','ACTIONED')`;
    - `(shop_id, status, last_signal_at DESC)`;
    - `(shop_id, customer_id, last_signal_at DESC)`.
- `order_confidence`:
  - `id`, `shop_id` FK, `order_id` FK CASCADE **UNIQUE**, `customer_id` FK SET NULL;
  - `decision`, `reasons` JSONB, `rules_version`, `input_fingerprint`, `evaluated_at`;
  - `mode`;
  - `resolution` (`VERIFIED` / `APPROVED`), `resolution_level`,
    `resolution_fingerprint`, `resolution_method`, `resolution_note`,
    `resolved_by`, `resolved_at`;
  - `last_gate_result`, `last_gate_at`, `held_count`;
  - `released_decision` JSONB, `released_at`;
  - `outcome`, `outcome_at`;
  - `history` JSONB (bounded), `version` INT;
  - timestamps.
  - Indexes: `(shop_id, decision)`, `(shop_id, last_gate_result)`, `(shop_id, released_at)`.
- `orders`: new index `idx_orders_shop_customer_phone (shop_id, customer_phone)`.
  It serves phone-history reads. The migration is transactional, so this is a
  plain `CREATE INDEX`: a brief write lock on a pilot-sized table. It is
  documented in [05-data-model-and-migrations.md](05-data-model-and-migrations.md).

Rollback: `down` drops the three tables and the index. No existing column is
altered and no backfill is required.

## 6. Identity model

1. The customer is the existing `customers` row: `(shop, channel_type, Page, PSID)`
   uniqueness is DB-enforced. Webhook replay is already deduplicated by
   receipts and `external_id`.
2. An order belongs to a customer when `orders.customer_id` equals it, with the
   same `shop_id`.
3. An order with `customer_id IS NULL` is *associated* with a customer when its
   phone normalizes (`normalizePhone`) to the customer's normalized phone. This
   is read-time only, labelled `PHONE_MATCH`, and never written back. It never
   crosses shops, and it never joins two customer rows.
4. There is no merge. Name equality is never used.

## 7. State machines

**Customer lifecycle** (derived, rules `customer-state/1.0.0`). The first
matching rule wins, and each carries reasons.

1. `AT_RISK`: returns > 0 and returns ≥ successful deliveries.
2. `INACTIVE`: last activity more than 90 days ago.
3. `REPEAT_BUYER`: 2 or more deliveries.
4. `BUYER`: at least one non-cancelled order.
5. `INTERESTED`: a live opportunity exists.
6. `NEW`: none of the above.

**Opportunity**:
- `OPEN` → `ACTIONED` (merchant marked contacted) → `CONVERTED` / `DISMISSED` / `EXPIRED`.
- `OPEN` can also go directly to `CONVERTED`, `DISMISSED`, or `EXPIRED`.
- Terminal states are final. New intent after a terminal state creates a new
  opportunity.

**Order confidence**:
- The computed `decision` is `READY` | `VERIFY` | `MANUAL_REVIEW`.
- A resolution is `VERIFIED` (covers VERIFY; any shop role) or `APPROVED`
  (covers MANUAL_REVIEW and VERIFY; owner/admin), bound to a fingerprint.
- The effective state is READY when `decision=READY`, or when a resolution
  covers the decision level with a matching fingerprint.
- A cancelled or refunded order is never bookable through the gate in enforce
  mode.

## 8. Order Confidence rules v1 (`order-confidence/1.0.0`)

All rules are deterministic and use only data the system already records.
Evidence never contains phone, address, or name.

| Code | Severity | Condition |
| --- | --- | --- |
| `ORDER_CANCELLED` | block | `order_status` in cancelled/refunded. Not overridable. |
| `RTO_SHIELD_BLOCK` | REVIEW | Existing `checkPhone` tier `block` (own list or global) |
| `REPEATED_RETURNS` | REVIEW | Shop history: returned ≥ 2 and returned > delivered |
| `RTO_SHIELD_VERIFY` | VERIFY | Existing `checkPhone` tier `verify` (network or list) |
| `PRIOR_RETURN` | VERIFY | Returned ≥ 1 and returned ≥ delivered (when REPEATED_RETURNS does not apply) |
| `POSSIBLE_DUPLICATE_ORDER` | VERIFY | Another active order for the same phone in this shop within 24h |
| `PHONE_INVALID` | VERIFY | Missing or not a valid BD mobile after normalization |
| `ADDRESS_TOO_SHORT` | VERIFY | Normalized address shorter than `address_min_length` (default 15) |
| `ORDER_NOT_CONFIRMED` | VERIFY | `order_status` in draft/pending |
| `HIGH_VALUE_FIRST_COD` | VERIFY | Unpaid and total ≥ `high_value_cod_threshold` (default ৳10,000) and no prior delivery |
| `INPUT_UNAVAILABLE` | VERIFY | The RTO Shield or history lookup failed (fail closed to verification) |
| `DELIVERY_HISTORY`, `PREPAID`, `NEW_CUSTOMER` | info | Supporting context only |

The decision is `MANUAL_REVIEW` if any REVIEW reason applies, otherwise
`VERIFY` if any VERIFY reason applies, otherwise `READY`.

## 9. Opportunity detection v1 (`opportunity-detector/1.0.0`)

Parameters:

- Lookback: 72h.
- Quiet period: 30 min since the customer's last message. A conversation that
  is still live is not flagged.
- Batch limits: 200 conversations and 5,000 messages per shop per run.

Signals come from `stage2-rules.classify()`:

| Strength | Intents / facts |
| --- | --- |
| Strong | `PURCHASE_INTENT_START`, `ORDER_SESSION_CHECKOUT`, `CART_EDIT_OR_ADD_MORE`, and the `order_sessions` fact (cart without an order): `CHECKOUT_STARTED` with its step |
| Medium | `PRODUCT_AVAILABILITY`, `PRODUCT_ATTRIBUTE`, `DELIVERY_CHARGE`, `DELIVERY_POLICY`, `PAYMENT_METHODS` |
| Weak | `PRODUCT_INQUIRY`, `PRODUCT_PHOTO_LOOKUP` |
| Suppressing | the latest relevant message is `ORDER_SESSION_CANCEL` or `STOP_OPT_OUT`; the customer is opted out |

Qualification:

- `HIGH` if any strong signal is present.
- `MEDIUM` if there are at least 2 distinct reason codes, including at least
  one medium.
- Otherwise the conversation does not qualify.

The cursor is the latest of: the lookback start, the customer's last
opportunity `last_signal_at`, and the customer's last order `created_at`.

Conversion happens when an order for the customer (linked, or phone-matched
unlinked) is created at or after `first_signal_at`. This runs through the
post-commit hook and again through the sweep, idempotently.

Expiry: `OPEN` after 7 days of no new signals, `ACTIONED` 14 days after it was
actioned.

## 10. API contracts (new; nothing existing changes shape)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/customer-intelligence/status` | member | `{ customer_intelligence, order_confidence_mode }` |
| GET | `/api/customer-intelligence/customers` | member | `page`, `pageSize` ≤ 50, `search`, `view=all\|opportunities` |
| GET | `/api/customer-intelligence/customers/:customerId` | member | 360 detail |
| GET | `/api/customer-intelligence/opportunities` | member | `status`, pagination |
| POST | `/api/customer-intelligence/opportunities/:id/contacted` | member | OPEN → ACTIONED |
| POST | `/api/customer-intelligence/opportunities/:id/dismiss` | member | `{ reason }`, audited |
| GET | `/api/order-confidence/orders/:orderId` | member | Fresh decision (idempotent refresh) |
| POST | `/api/order-confidence/orders/:orderId/verify` | member | `{ decision_version, method, note? }` |
| POST | `/api/order-confidence/orders/:orderId/approve` | owner/admin | `{ decision_version, note }` |
| GET | `/api/order-confidence/summary` | owner/admin | Decision × outcome counts |
| GET/PATCH | `/api/admin/shops/:shopId/pilot-features` | SUPER_ADMIN | Pilot flags |
| POST | `/api/admin/pilot-features/disable-all` | SUPER_ADMIN | Global kill switch |

Modified behavior: `POST /api/order/:orderId/book-courier` can now return 409
`ORDER_CONFIDENCE_HOLD`, but only for shops in `enforce` mode.

## 11. UI

- **Customers**: `/customers` shows the 360 list when enabled, or the legacy
  page (with the field-mapping fix) otherwise. It has "All" and "Sales
  opportunities" tabs. Detail lives at `/customers/:customerId`, with summary,
  identity, commerce metrics, timeline, opportunities, and the RTO Shield
  signal.
- **Orders detail**: a confidence panel showing decision, reasons, evidence,
  resolution, and history, with Verify and Approve actions. The courier modal
  handles a 409 hold.
- **Inbox**: `?conversation=<id>` selects the conversation.
- **Admin shop detail**: pilot feature toggles.

Labels are neutral ("Needs verification", "Needs review", "Return history").
Both en and bn locales are provided, and layouts work at mobile widths.

## 12. Security and privacy

- `shopId` comes only from the JWT. `verifyShopAccess` runs on every route.
- Joi schemas use `allowUnknown: false` and validate UUIDs.
- `approve` requires owner/admin; admin endpoints require SUPER_ADMIN.
- Opportunities store no raw message text. Confidence evidence contains no PII.
  Logs carry only IDs and reason codes.
- Every resolution and dismissal writes to `audit_logs`.
- Customer deletion cascades to opportunities. The confidence
  `customer_id` is set null on customer delete.
- No new outbound send path. A boundary test forbids the new modules from
  importing Meta send, provider, or webhook send code.

## 13. Failure modes

| Failure | Behavior |
| --- | --- |
| Duplicate webhook | Existing receipt and `external_id` dedup, so no duplicate customer; the detector keys on message ID |
| Detector runs twice | `pg_try_advisory_xact_lock` per shop, plus the partial unique index and CAS |
| Redis down | No scheduled jobs (pre-existing limitation for all jobs). The API, gate, and conversion hook are DB-only. |
| Gate evaluation throws | `enforce`: hold (`ENGINE_UNAVAILABLE`). `shadow`: allow. Admin can switch the shop to `off`. |
| Evaluation race | CAS on `version`; the loser re-reads. Evaluation is deterministic, so both compute the same decision. |
| Override versus re-evaluation race | Approve requires a current `decision_version` and a current fingerprint, otherwise 409 |
| Provider timeout or lost response | Existing `INDETERMINATE` claim, never re-booked blindly; the gate does not change it |
| Duplicate terminal courier webhook | `recordOutcome` uses `WHERE outcome IS NULL` |
| Order edited after approval | Fingerprint changes, the resolution is void, and the order is re-held |
| Order cancelled after approval | The `ORDER_CANCELLED` hard block applies |

## 14. Observability

- In-process counters are exposed on `/health/detailed` under `pilotIntelligence`:
  - opportunities created, updated, converted, expired, dismissed, and actioned;
  - detector runs and failures;
  - confidence evaluations by decision, holds, shadow would-holds, releases,
    verifications, approvals, stale resolutions, engine failures, and outcomes
    by decision.
- Structured log events: `opportunity.*` and `order_confidence.*`, carrying
  IDs, codes, and latency only.
- `GET /api/order-confidence/summary` gives outcome-by-decision per shop.

## 15. Testing strategy

| Layer | What |
| --- | --- |
| Unit (Jest) | Phone variants, outcome classifier, customer state, opportunity signals and qualification, confidence rules and fingerprint, gate resolution logic, controllers (RBAC, validation), `bookForOrder` hold mapping, metrics |
| Integration (real Postgres + Redis) | Migration up/down/up, unique constraints, concurrent detector upserts, conversion idempotency, shop isolation, CAS races, override race, stale fingerprint, verify then book, READY books exactly once under concurrency, provider timeout then retry, duplicate outcome webhook, API routes with a real DB (auth, RBAC, cross-shop 404) |
| Meta-shaped E2E | Signed webhook through the real route: customer created once under replay, the detector yields an opportunity, a created order converts it, and no provider send happens from this feature |
| Frontend (Vitest) | Customer 360 list and detail states, opportunity actions, confidence panel, hold handling |
| Playwright (mock-only, CI) | Journeys 1–10 from the task, including a 375px mobile viewport |
| Security | Boundary test (no send imports), RBAC and tenant tests, added to `test:security` |

## 16. Rollout and rollback

- **Rollout.** Deploy with all shops `off`, since the table defaults are off.
  SUPER_ADMIN then enables `customer_intelligence` and sets
  `order_confidence_mode='shadow'` for pilot shops. After at least 7 days of
  shadow data with an acceptable hold rate, switch to `enforce`.
- **Rollback.** Set the mode to `off` or call `disable-all` (instant, no
  deploy). A code revert is safe: the new tables are unused by old code, and
  migration `down` drops them.

## 17. Divergences recorded during implementation

See [08-test-evidence.md](08-test-evidence.md) §"Plan divergences".

## 18. Acceptance criteria

These are pass/fail. Each maps to a test named in the evidence document.

1. A Messenger participant becomes exactly one Customer under webhook replay.
2. Another shop's customer, opportunity, or order ID returns 404.
3. Customer detail matches that shop's orders and outcomes.
4. A customer with at least 2 deliveries has state `REPEAT_BUYER`.
5. A high-intent conversation with no order produces one OPEN opportunity with
   reasons, and re-running the detector creates no duplicate.
6. A subsequent order converts it, and repeated conversion is a no-op.
7. The feature introduces no provider send, which the boundary test proves.
8. A READY order books exactly once under concurrent requests.
9. A VERIFY order is not booked automatically, and is booked after verification.
10. A MANUAL_REVIEW order needs owner/admin approval, and staff get 403.
11. Every resolution writes an audit row with actor, time, note, version, and
    fingerprint.
12. A material edit after approval re-holds the order.
13. Concurrent and retried requests create no duplicate parcel.
14. A terminal courier outcome is recorded once on the confidence row and is
    visible in Customer 360.
