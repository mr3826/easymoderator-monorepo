# ADR-0010: Order Confidence Concurrency — CAS Version, Fact Fingerprint, Existing Claim

Status: Accepted
Date: 2026-09-27
Owners: Engineering

## Context

For one order, several writers can overlap:

- concurrent booking attempts (retries, a merchant double-click, automatic
  plus manual);
- re-evaluation from a panel read;
- verification or approval by different merchants;
- late courier webhooks.

A losing or stale writer must never overwrite a newer committed outcome, and
a clearance must never apply to facts it was not made for.

## Decision

1. **One row per order.** `order_confidence.order_id` is UNIQUE. A concurrent
   first insert that loses re-reads the winner.
2. **Compare-and-set on `version`** for **material** changes (decision, the
   set of reason codes and severities, fingerprint, rules version) and for
   resolutions: `UPDATE … SET …, version = version+1 WHERE id=? AND version=?`.
   Evidence-only refreshes (the same reasons with newer numbers, such as a
   network count) and mode changes are version-guarded but **not**
   version-bumping.
   - A 0-row update means another writer won. Evaluators re-read (they
     computed the same decision from the same facts). Merchants get 409
     `DECISION_CHANGED` with the fresh decision.
   - Gate bookkeeping (last result, held count, release snapshot) is
     version-guarded **but does not bump** the version, so an automatic retry
     cannot invalidate an approval the merchant is typing.
3. **Change detection compares a key-sorted canonical form of reasons.** JSONB
   reorders object keys, so a naive `JSON.stringify` comparison would see a
   change on every read and bump the version forever. PostgreSQL integration
   caught exactly that. The material check uses the sorted `code:severity` set,
   so evidence movement never invalidates a merchant review in progress.
4. **Fingerprint-bound resolutions.** The fingerprint is sha256 over
   normalised phone, normalised address, total, payment status and method,
   customer id and items. Order status is excluded: confirming a draft is not
   a change in what was approved.
   - A resolution applies only while `resolution_fingerprint` equals the
     current fingerprint **and** its level covers the current decision.
   - The gate also refuses when the caller's in-memory order differs from the
     stored order (`snapshotStale`), so the decision is always about what would
     be shipped.
5. **Exactly-once booking stays with the existing `courier_dispatch` claim.**
   The gate runs before it and never replaces it. A COMMITTED claim is always
   allowed to reconcile.
6. **Resolution and its audit row commit in one transaction**
   (`logOperation(…, { transaction, required: true })`).
7. **Outcome is written once**: `UPDATE … WHERE outcome IS NULL`.

## Alternatives rejected

- **`SELECT … FOR UPDATE` around evaluation and the provider call.** It holds
  row locks across a network call to the courier. A provider timeout would
  hold the lock for its whole duration.
- **Redis locks.** Whether a Redis outage fails open (booking without the
  gate) or closed (no booking at all) is ambiguous, and they add a dependency
  to a path that is PostgreSQL-only today.
- **Last-writer-wins upserts.** They allow exactly the stale-overwrite the
  requirement forbids.

## Consequences

- Proven against PostgreSQL 16 (`order-confidence.integration.test.js`):
  - concurrent booking books exactly once;
  - concurrent evaluations converge;
  - two concurrent approvals give exactly one 200 and one 409, with one audit
    row;
  - an edit after approval re-holds the order;
  - provider timeout then retry books one parcel;
  - a replayed delivered webhook is recorded once.
