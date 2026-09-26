# ADR-M-006: Reuse Existing Idempotency Middleware for Mobile Mutations

Status: Accepted<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator

## Context

`audit/idempotency.middleware.js` already implements `Idempotency-Key` semantics used today by
Inbox reply: an in-flight duplicate returns 409, a replay with a different body under the same key
returns 422, a successful (or errored) response is cached and replayed for 24 hours under the same
key. `CURRENT_STATE.md` §5 notes manual order creation does not populate
`orders.idempotency_key` even though the unique index `(shop_id, idempotency_key)` exists — only
the AI-draft path fills it. Mobile networking on real Bangladeshi mobile data is expected to retry
timed-out requests; without idempotency, a retried "confirm order" or "book courier" could double-fire.

## Decision

Apply the existing `audit/idempotency.middleware.js` to every mobile-invoked mutation that changes
money-adjacent or courier-adjacent state: order create, order confirm, order cancel, courier
book/retry, and stock/price updates. Manual order creation on both mobile and (as a byproduct) web
now populates `orders.idempotency_key`, closing the pre-existing gap for the manual path. The
mobile client generates one idempotency key per user-initiated intent (e.g., one tap of "Confirm
order") and only mints a new key after receiving a definitive terminal error — a timeout or network
drop retries with the **same** key.

No offline mutation queue is built. Per the brief's explicit constraint, order creation, order
cancellation, courier booking, and financial changes are never queued for later replay while
offline — idempotency protects against retry-while-online duplication, not against
queue-and-replay-later semantics.

## Assumptions

- The existing idempotency middleware's storage (already used in production by Inbox reply) has
  enough headroom for mobile's additional call volume without a capacity change — verified in
  Phase 4/5 load characteristics, not assumed indefinitely.
- "One key per user-initiated intent" is enforceable at the mobile UI layer (e.g., the key is
  generated once when a confirmation sheet opens, not once per HTTP call), and this is tested in
  Phase 4.

## Alternatives Rejected

- **A new, mobile-specific idempotency mechanism.** Rejected: the existing middleware already
  solves this exact problem correctly (including cached-error replay, which a naive
  read-before-write check would miss); building a second implementation would only add a place for
  the two to disagree.
- **Client-side de-duplication only (disable the button after tap).** Rejected as insufficient on
  its own: it does not protect against a genuine network-layer retry from the OS or an HTTP client
  library below the button's disabled state, which is the actual failure mode on flaky mobile data.

## Consequences

- Positive: mobile inherits a production-proven idempotency implementation with no new code to
  secure or test from scratch.
- Positive: fixes the pre-existing manual-order-creation idempotency gap as a side effect, for both
  mobile and web.
- Negative: every covered mutation now requires the client to manage key lifecycle correctly;
  a client bug that mints a new key on every retry silently reintroduces duplicate-mutation risk —
  covered by an explicit Phase 4 test (retry same intent twice, same key, assert single order).
