# ADR-0005: Customer Identity Reuses Page-Scoped Customers; Customer State Is Computed

Status: Accepted
Date: 2026-09-27
Owners: Engineering + Product
Context doc: [docs/pilot-intelligence/03-architecture.md](../pilot-intelligence/03-architecture.md)

## Context

Customer 360 Lite needs a merchant-scoped customer record, its commerce
history, and a lifecycle state.

- `customers` already exists. It holds one row per shop, channel, Page and PSID.
  - Uniqueness is DB-enforced: a partial unique index on
    `(shop_id, channel_type, meta_channel_id, channel_user_id)`.
  - Concurrent creation is resolved inside the webhook transaction.
- Chatbot orders link to it through `orders.customer_id`.
- Dashboard and manual orders are unlinked, and phones are stored in mixed
  spellings.
- Orders change state through at least six paths: manual edit, bulk import,
  chatbot, payment webhook, courier webhook, and returns.

## Decision

1. **Identity.** Reuse `customers` as the customer record. Add no new identity
   table and no merge.
2. **Order association.**
   - An order belongs to a customer through `orders.customer_id`.
   - An order with `customer_id IS NULL` is associated **at read time only**
     with customers whose phone normalises to the order phone (exact BD-mobile
     normalisation). It is labelled `PHONE_MATCH` and never written back.
   - Names are never used for identity.
3. **State.** Lifecycle state (`AT_RISK`, `INACTIVE`, `REPEAT_BUYER`, `BUYER`,
   `INTERESTED`, `NEW`) is **computed on every read** from recorded orders and
   opportunities, by a pure function with versioned rules
   (`customer-state/1.0.0`). Every state carries its reason codes.
4. **Outcomes.** One classifier (`order-outcome.js`) decides
   delivered / returned / cancelled / in-progress for both Customer 360 and
   Order Confidence.

## Alternatives rejected

- **A canonical `customer_profiles` table plus identity-link table and merge.**
  It duplicates the existing Page-scoped identity. It also forces merge and
  unmerge semantics, auditing and reversal that the pilot excludes, and it
  needs a backfill.
- **Write-time auto-linking or merging by phone** (set `orders.customer_id`
  from a phone match).
  - It changes the order write path for every shop.
  - A shared family phone would silently attach orders to the wrong person.
  - It is hard to reverse.
- **Persisted counters and state maintained by hooks.** Six or more mutation
  paths mean drift (an order returned through a path without a hook shows the
  wrong state), and it needs a backfill.

## Consequences

- There is no backfill and no drift: state is always consistent with orders.
- A **state filter or sort across all customers** is not offered, because state
  is computed per page. The list sorts by newest customer and shows state per
  row.
- **Trigger to revisit.** Materialise, for example as a `customer_insights`
  table maintained by the order hooks plus a nightly reconciliation, when
  either:
  - a merchant needs to filter or sort by state or value; or
  - a shop exceeds about 50k customers, making list latency above 500ms at
    p95.
- Ambiguous phone matches (one phone, several customers) are shown on each
  customer and counted (`customer.phone_match_ambiguous`), never merged.
