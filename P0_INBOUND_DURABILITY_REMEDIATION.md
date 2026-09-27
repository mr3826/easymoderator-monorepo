# P0 Inbound Durability Remediation Evidence

This artifact records the bounded inbound webhook durability remediation. It
does not change the historical pilot audit and does not claim the overall pilot
is ready. The other four P0 blockers remain open.

```text
BASE_SHA=e876644b8cdc1a6704defbe0b331d3757a33ce29
REMEDIATION_BRANCH=remediation/p0-inbound-durability
REMEDIATION_HEAD=015a355c
PR_NUMBER=195
PR_URL=https://github.com/mr3826/easymoderator-monorepo/pull/195
```

## Root Cause

The webhook path already inserted an encrypted database receipt before its HTTP
response, but `markQueued()` treated a BullMQ enqueue as terminal acceptance:

```text
provider webhook
  -> receipt row
  -> message persistence
  -> BullMQ enqueue
  -> receipt status QUEUED
  -> encrypted replay body cleared
  -> provider 2xx
```

If Redis lost the BullMQ job after enqueue and before worker completion, the
receipt was not eligible for reconciliation and no encrypted body remained to
reconstruct work. Burst-job replacement could also leave an older receipt ID
unassociated with the replacement job.

## Architecture Before

- PostgreSQL receipt existed before acknowledgement.
- Redis/BullMQ was treated as the terminal handoff boundary.
- `QUEUED` was included in terminal receipt statuses.
- `payload_encrypted` was cleared by `markQueued()`.
- The reconciler considered retry/identity failures but not `QUEUED` receipts.
- Worker completion did not settle webhook receipts.
- Burst-job replacement did not carry receipt identities forward.

## Architecture After

- PostgreSQL remains the authoritative inbound durability boundary.
- `QUEUED` is recoverable, not terminal.
- Encrypted replay payload remains until worker completion or terminal failure.
- `queue_job_id` is retained in the receipt via additive migration.
- Reconciliation inspects live, completed, missing, and failed BullMQ jobs.
- Missing/failed jobs are replayed through the existing provider-shaped handler.
- Live jobs are deferred without releasing the receipt fence.
- Completed jobs settle the receipt as `PROCESSED`.
- Worker terminal failures settle the receipt as `DEAD_LETTERED` with replay
  payload retained for the existing dead-letter policy.
- Burst replacement merges all receipt IDs into the replacement job.
- Detailed health exposes bounded inbound counters without logging payloads.

## Durability Boundary

```text
DURABILITY_BOUNDARY=PostgreSQL meta_webhook_receipts + persisted message state
ACK_BOUNDARY=HTTP 2xx only after the durable receipt path has accepted the event
REDIS_ROLE=transport and acceleration; never the only accepted-event state
```

The existing route rejects invalid signatures before parsing. A database receipt
insert failure remains a non-accepted error. Queue failure after receipt
acceptance remains recoverable through `RETRY_PENDING`/reconciliation. Redis
loss after queue acceptance leaves the encrypted receipt body and queue identity
available for recovery.

## State and Recovery

| State | Meaning after remediation | Recovery behavior |
| --- | --- | --- |
| `RECEIVED` | Receipt accepted before processing | Claim through the existing fence and process. |
| `RETRY_PENDING` / `MESSAGE_STORE_FAILED` / `IDENTITY_NOT_RESOLVED` | Durable receipt needs bounded retry | Existing backoff/reconciler path. |
| `QUEUED` | Payload is durable and a BullMQ handoff was recorded, but worker settlement is pending | Inspect `queue_job_id`; defer live jobs, settle completed jobs, replay missing/failed jobs. |
| `PROCESSED` | Worker or safe terminal reconciliation completed | Payload and queue identity are cleared. |
| `DEAD_LETTERED` | Terminal processing failure after bounded attempts | Payload remains under existing encrypted dead-letter retention. |
| `SKIPPED` | Valid terminal no-dispatch outcome | Payload and queue identity are cleared. |

The reconciler uses an existing optimistic processing token. A `QUEUED` receipt
with a live BullMQ job is returned to `QUEUED` with a future retry time; it is
not concurrently replayed. A missing Redis job is replayed through the same
tenant/page/channel resolution path as the original event.

## Migration

```text
MIGRATIONS=EasyMod-backend/src/database/migrations/20260927_001_meta_webhook_queue_recovery.js
MIGRATION_TYPE=additive nullable VARCHAR(191) queue_job_id
DESTRUCTIVE_SCHEMA_CHANGE=NO
```

The migration is forward-compatible with old application code because old code
does not reference the new nullable column. New code should be deployed after
the migration. The column must not be dropped while new application instances
are running. No production migration was executed during this audit.

## Tests

```text
FOCUSED_DURABILITY_TESTS=PASS; 134 tests across receipt durability, handler, coalescing, health, cipher rotation, and production-env rendering
WORKER_METRICS_TESTS=PASS; affected worker/health/metrics tests
SECURITY_TESTS=PASS; 54 suites, 700 assertions
BACKEND_BUILD=PASS; node --check server.js
SYNTAX_CHECKS=PASS; changed JavaScript and migration files
TEST_DISCOVERY=PASS; 275 tracked tests, 275 with one execution home, 273 coverage-counted, 2 quarantine debt
META_SHAPED_E2E=PASS on PR CI after updating the existing assertion to require retained encrypted replay state and queue identity
REAL_POSTGRES_REDIS_INTEGRATION=PASS; PR CI run 36328918457 used disposable PostgreSQL/Redis and passed the recovery integration
```

The added provider-shaped integration test uses the existing disposable
PostgreSQL/Redis harness, sends the real signed webhook route, flushes the
dedicated queue database, invokes recovery, asserts one durable message, and
settles the recovered receipt. It requires CI or an approved disposable
environment to provide the services.

## Security Review

- Signature verification remains before payload parsing.
- Recovery resolves page/channel/shop again and does not trust replay payload
  tenant fields for authorization.
- Receipt uniqueness and the existing claim fence remain database-backed.
- Queue outages use a durable `QUEUED` recovery state instead of consuming the
  finite message-store retry/dead-letter ladder.
- Provider-rate-limit delay transitions raise BullMQ `DelayedError`, so a
  delayed job is not mistaken for a completed job by receipt settlement.
- Receipt settlement and burst rebinding require the same shop/channel and
  queue-job identity, preventing stale jobs from settling replacement work.
- Replayable events reject before receipt insertion when encryption is
  unavailable; an optional previous key supports controlled key rotation.
- Queue IDs and receipt IDs are operational identifiers; payloads are not
  logged.
- Encrypted payload retention is extended from queue handoff to worker
  settlement; existing encrypted retention/dead-letter policy applies.
- No production failure-injection toggle or arbitrary replay endpoint was added.

## Independent Review

```text
INDEPENDENT_REVIEW=PENDING_FINAL_REVIEW
```

The separate review pass is required before changing this value to `PASS`.

## Remaining Risks

1. Real PostgreSQL/Redis crash-window execution is not locally available and
   must run in CI or an approved disposable environment.
2. Worker settlement is asynchronous; if both the worker and Redis disappear,
   the durable receipt remains replayable and the reconciler is the recovery
   authority.
3. The additive migration includes a database trigger that preserves replay
   payloads when old handlers clear them during a mixed-version rollout. The
   queue-job identity is still unavailable to old handlers, so reconciliation
   replays those rows conservatively.
4. This remediation does not solve global order idempotency, entitlement
   fail-open behavior, JWT/session redesign, push ownership, SSE replay,
   courier callback races, or analytics SQL.

## Rollback Considerations

Application rollback without dropping the additive column is safe. A schema
rollback that removes `queue_job_id` must wait until all remediation-version
instances are stopped and the old application is serving. Existing receipts
remain processable by the old code, but the new replay guarantee is not present
after application rollback.

```text
BLOCKER_STATUS=FIXED_IN_PR
```
