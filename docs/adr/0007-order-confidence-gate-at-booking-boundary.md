# ADR-0007: RTO Shield v2 Acts Inside the Canonical Courier Booking Boundary

Status: Accepted
Date: 2026-09-27
Owners: Engineering

## Context

RTO Shield v1 refuses COD orders from `block`-tier phones at order creation.
Its `verify` tier was only logged.

`orderService.bookForOrder` is the single booking entry point for four callers:

- the manual route;
- confirming a draft;
- chatbot auto-dispatch (with an Action Gate `BOOK_COURIER` authorization);
- payment-webhook fulfilment.

Exactly-once booking is guaranteed by the `courier_dispatch` claim: UNIQUE
`(shop_id, order_id)`, owner-token CAS, and provider timeouts becoming
INDETERMINATE.

## Decision

Add `orderConfidence.checkBookingGate(order, shopId, { trigger })` inside
`bookForOrder`:

- **after** the already-booked short-circuit, courier resolution, data
  completeness and Action Gate authorization;
- **before** the durable claim.

The gate:

- reloads the order, evaluates deterministic rules (`order-confidence/1.0.0`),
  and persists the decision with CAS;
- in `enforce`, holds anything that is not effectively READY. It sets the
  operational marker `delivery_status='confidence_hold'`, sends a deduplicated
  merchant notification, and returns `{blocked, status:'confidence_hold'}`
  **without creating a claim or calling the provider**;
- in `shadow`, records "would hold" and allows;
- in `off`, does nothing.

An existing **COMMITTED** claim is always allowed through, so a parcel that was
really booked can reconcile. A cancelled or refunded order is never bookable.

The manual route maps a hold to **409 `ORDER_CONFIDENCE_HOLD`**. Resolution is
explicit:

- **verify**: any shop role, covers VERIFY;
- **approve**: owner or admin, covers MANUAL_REVIEW and VERIFY.

Both are audited and bound to the order's material-fact fingerprint.

## Alternatives rejected

- **Blocking at order creation.** It loses the order and the customer. v1
  already refuses the worst COD cases there; verification needs the order to
  exist.
- **A UI badge only.** It is bypassable through the API and the automatic
  paths.
- **A separate booking service or queue.** It duplicates the claim and
  idempotency logic, which is the proven part.

## Consequences

- One enforcement point covers every booking path. A boundary test pins its
  position.
- No deadlock: every held order has a server-side route to READY (verify or
  approve), and `mode=off` restores v1 instantly.
- A paused automatic booking is not retried by itself after verification. The
  merchant clicks Book courier. This is deliberate for the pilot, to avoid a
  new background dispatcher.
