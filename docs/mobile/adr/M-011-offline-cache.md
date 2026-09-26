# ADR-M-011: Read-Only, Time-Boxed Offline Cache — No Mutation Queue

Status: Accepted<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator

## Context

The brief explicitly prohibits queuing order creation, order cancellation, courier booking, or any
financial change for later replay while offline. Bangladeshi mobile connectivity is inconsistent
enough that some offline affordance is still valuable for a merchant checking "what's going on"
without a queue-and-replay risk.

## Decision

TanStack Query's cache is persisted to disk for an explicit allowlist of read queries only (Home
attention list, order list/detail, product list, customer quick-view) with a 24-hour max age,
purged entirely on logout, on session revoke, and on shop switch. No message bodies or attachment
content are persisted (matching the program's "never log/persist private message content
unnecessarily" constraint). When the device is offline, the UI shows an explicit, persistent
offline banner and disables every mutating action (order confirm/cancel, courier book, reply send,
stock update) rather than queuing it — the action is unavailable, not silently deferred.

## Assumptions

- A merchant seeing a stale (up to 24h old) read-only view while offline is acceptable product
  behavior; if product feedback later demands fresher offline reads, the cache TTL is what changes,
  not the no-mutation-queue rule.
- Purging on shop switch is necessary because a multi-shop staff account must never see shop A's
  cached data rendered as if it were shop B's, even for a moment.

## Alternatives Rejected

- **Offline mutation queue with optimistic UI, reconciled on reconnect.** Rejected outright by the
  brief's explicit constraint — a queued "confirm order" or "book courier" that later fails or
  double-fires against a real customer/courier is exactly the class of risk this program is built
  to avoid. Not a close call.
- **No offline behavior at all (blank/error screen when offline).** Rejected: strictly worse
  product experience than a clearly-labeled stale read-only view, for no safety benefit — reads
  carry no mutation risk regardless of staleness.

## Consequences

- Positive: the highest-risk mobile-specific failure mode (a queued write firing twice, or firing
  against state that has since changed) is architecturally impossible, not just discouraged.
- Positive: no message content ever touches on-device persistent storage, simplifying the privacy
  posture of a lost/stolen device.
- Negative: a merchant who confirms an order while briefly offline sees the action fail/be
  disabled rather than "just work later" — an explicit, documented product trade-off, communicated
  in the empty/offline UI copy itself (Phase 1's offline pattern), not left for the merchant to
  discover by surprise.
