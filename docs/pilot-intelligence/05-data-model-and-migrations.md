# Pilot Intelligence — Data Model and Migrations

The migration is `EasyMod-backend/src/database/migrations/20260927_001_pilot_customer_rto_intelligence.js`.

## Summary

- It is **additive**: three new tables and one new index on `orders`.
- No existing column is altered, dropped or backfilled.
- Existing entities are reused as they are: `customers`, `orders`,
  `conversations`, `messages`, `order_sessions`, `courier_dispatch`,
  `delivery_tracking`, `rto_blacklist` and `customer_delivery_stats`.

## New tables

### `shop_pilot_features`: platform-controlled flags

| Column | Type | Notes |
| --- | --- | --- |
| `shop_id` | UUID PK | → `shops(id)` ON DELETE CASCADE |
| `customer_intelligence` | BOOLEAN NOT NULL | default `false` |
| `order_confidence_mode` | VARCHAR(10) NOT NULL | default `'off'`; CHECK in (`off`, `shadow`, `enforce`) |
| `order_confidence_config` | JSONB NOT NULL | default `{}`; sanitised to `high_value_cod_threshold` (0–1,000,000) and `address_min_length` (0–100) |
| `updated_by` | UUID | the platform admin who last changed the row |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

A missing row means every feature is off. The table is written only by the
SUPER_ADMIN admin API ([ADR-0009](../adr/0009-pilot-feature-flags-table.md)).

### `customer_opportunities`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `shop_id` | UUID NOT NULL | → `shops` CASCADE |
| `customer_id` | UUID NOT NULL | → `customers` CASCADE (deleting a customer removes its opportunities) |
| `conversation_id` | UUID | → `conversations` SET NULL |
| `order_session_id` | UUID | the checkout session behind a `CHECKOUT_STARTED` signal |
| `status` | VARCHAR(20) | CHECK in (`OPEN`, `ACTIONED`, `CONVERTED`, `DISMISSED`, `EXPIRED`) |
| `strength` | VARCHAR(10) | CHECK in (`HIGH`, `MEDIUM`) |
| `reasons` | JSONB | reason codes |
| `signals` | JSONB | at most 10: `{code, strength, source, intent_id, rule, message_id \| order_session_id, attribute?, checkout_step?, at}`. **No message text.** |
| `product_refs` | JSONB | at most 5 `{product_id, name, quantity}` from the checkout cart |
| `first_signal_at`, `last_signal_at`, `detected_at` | TIMESTAMPTZ | |
| `detector_version` | VARCHAR(40) | `opportunity-detector/1.0.0` |
| `actioned_at`, `actioned_by` | | "Mark contacted" |
| `converted_order_id` | UUID | → `orders` SET NULL |
| `resolved_at`, `resolved_by`, `resolution_reason` | | `ORDER_CREATED`, a dismiss reason, `NO_ACTIVITY`, or `NO_ORDER_AFTER_FOLLOW_UP` |

Indexes:

- `idx_customer_opportunities_live`: **UNIQUE** `(shop_id, customer_id) WHERE status IN ('OPEN','ACTIONED')`. This is the dedupe invariant.
- `idx_customer_opportunities_shop_status`: `(shop_id, status, last_signal_at DESC)`, for the list.
- `idx_customer_opportunities_customer`: `(shop_id, customer_id, last_signal_at DESC)`, for the detector cursor and customer detail.

### `order_confidence`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID PK | |
| `shop_id` | UUID NOT NULL | → `shops` CASCADE |
| `order_id` | UUID NOT NULL | → `orders` CASCADE, **UNIQUE** |
| `customer_id` | UUID | → `customers` SET NULL |
| `decision` | VARCHAR(20) | CHECK in (`READY`, `VERIFY`, `MANUAL_REVIEW`) |
| `reasons` | JSONB | `{code, severity, source, evidence}`. Evidence holds counts and codes only: **no phone, address or name**. |
| `rules_version` | VARCHAR(40) | `order-confidence/1.0.0` |
| `input_fingerprint` | VARCHAR(64) | sha256 of the material order facts |
| `evaluated_at` | TIMESTAMPTZ | |
| `mode` | VARCHAR(10) | the mode at evaluation |
| `resolution` | VARCHAR(20) | CHECK NULL or in (`VERIFIED`, `APPROVED`) |
| `resolution_level` | VARCHAR(20) | the decision level the resolution covers |
| `resolution_fingerprint` | VARCHAR(64) | the facts the resolution was made for |
| `resolution_method`, `resolution_note`, `resolved_by`, `resolved_at` | | |
| `last_gate_result`, `last_gate_at`, `held_count` | | gate bookkeeping |
| `released_decision`, `released_at` | JSONB, TIMESTAMPTZ | a snapshot of the decision under which booking was allowed |
| `outcome`, `outcome_at` | VARCHAR(30), TIMESTAMPTZ | `DELIVERED` or `RETURNED`, first terminal outcome only |
| `history` | JSONB | the last 30 transitions, shown in the UI |
| `version` | INTEGER NOT NULL | CAS token ([ADR-0010](../adr/0010-order-confidence-concurrency.md)) |

Indexes:

- `idx_order_confidence_order` UNIQUE `(order_id)`;
- `(shop_id, decision)`;
- `(shop_id, last_gate_result)`;
- `(shop_id, released_at)`.

## Change to an existing table

`orders` gains the index `idx_orders_shop_customer_phone (shop_id, customer_phone)`.

- **Why.** Phone-history reads filter by shop and a phone's stored spellings:
  - Customer 360 phone association;
  - Order Confidence history;
  - duplicate-order detection.

  Without the index those reads scan the shop's orders.
- **Lock.** The runner wraps every migration in a transaction, so this is a
  plain `CREATE INDEX`: it blocks writes to `orders` while it builds.
  - At pilot scale (thousands of orders) that takes milliseconds.
  - If `orders` grows past about 1M rows before this ships, build it first,
    outside the runner, with
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_shop_customer_phone ON orders(shop_id, customer_phone);`.
    The migration's `IF NOT EXISTS` then no-ops.

## Order and dependencies

- The migration runs after `20260925_001_growth_os_followup_cancel_event_type`.
- It depends only on `shops`, `customers`, `conversations` and `orders`, which
  all exist since the initial schema.

## Backward and forward compatibility

- Old application code ignores the new tables. **A code rollback without a
  schema rollback is safe.**
- New code with a shop that has no flag row behaves exactly as before
  (`mode off`).
- There is no backfill.
  - Opportunities start from the first detector run after a shop is enabled,
    and look back 72 hours.
  - Customer state is computed on read, so history is covered immediately.
  - Order Confidence rows are created the first time an order is gated or
    viewed.

## Rollback

```bash
npm run migrate:down   # rolls back the LAST migration only; it must be this one
```

`down` drops `idx_orders_shop_customer_phone`, `order_confidence`,
`customer_opportunities` and `shop_pilot_features`. **This deletes pilot data:
opportunities, decisions, outcomes and flags.** Prefer the flag rollback in the
runbook. Drop the schema only when the pilot is abandoned.

## Verified (disposable PostgreSQL 16)

- `npm run migrate` applied the migration after the full chain.
- `npm run schema:audit` reported **No drift found**. One pre-existing warning
  (`push_subscriptions.user_id`) is unrelated.
- `migrate:down` then showed the 3 tables and the index absent. `migrate`
  re-applied them, and all 11 indexes were present as defined.
