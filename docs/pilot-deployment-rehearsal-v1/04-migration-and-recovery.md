# 04 — Migration and recovery

## Gate status

MIGRATION_DRY_RUN=BLOCKED for the rehearsal candidate. The permanent gate command, npm run test:backend:migration-dryrun, was not run against fresh Docker-backed production-shaped data because the local Docker engine failed with snapshot I/O errors and a read-only metadata store.

The frozen readiness document records a prior six-phase production-shaped migration dry-run PASS at code tip c164a042. That is historical evidence for the frozen candidate, not a fresh run on rehearsal SHA 714be007. The rehearsal branch did not change the migration implementation, but this fact does not substitute for the mandated rerun.

## Database and worker recovery matrix

| Scenario | Initial state | Failure injection | Recovery | Observed state | Business invariant |
|---|---|---|---|---|---|
| Fresh database | Empty disposable Postgres schema | NOT RUN | NOT RUN | NOT OBSERVED | No duplicate order; schema/entity parity |
| Existing database | Production-shaped pre-migration schema | NOT RUN | NOT RUN | NOT OBSERVED | Preserve committed order truth |
| Duplicate order IDs / pre-existing indexes | Historical duplicate fixture and index present | NOT RUN | NOT RUN | NOT OBSERVED | Migration refuses unsafe duplicates loudly |
| Partial migration failure | Disposable schema mid-step | NOT RUN | NOT RUN | NOT OBSERVED | Retry is idempotent; no partial business write |
| Migration concurrency | Two migration attempts | NOT RUN | NOT RUN | NOT OBSERVED | Only one migration proceeds safely |
| Backend crash | Accepted action and DB transaction | NOT RUN | NOT RUN | NOT OBSERVED | No unauthorized or duplicate order |
| Worker crash | Job claimed before or after side-effect boundary | NOT RUN | NOT RUN | NOT OBSERVED | No duplicate outbound message or courier booking |
| Redis interruption / pending jobs | BullMQ jobs queued | NOT RUN | NOT RUN | NOT OBSERVED | No silent loss or duplicate execution |
| Duplicate webhook / delayed provider response | Signed synthetic callback | NOT RUN | NOT RUN | NOT OBSERVED | Correct payment truth; no duplicate booking |
| Flag revocation during dispatch | In-flight synthetic action | Source-level tests only for interaction choices; commerce worker race NOT RUN | NOT RUN | NOT OBSERVED | Disabled operation stays disabled |
| Failed deployment after migration | Previous app image plus migrated schema | NOT RUN | NOT RUN | NOT OBSERVED | Safe forward recovery or compatible app rollback |

No database or worker recovery row above is a runtime PASS. Focused tests did exercise the interaction resolver's SENT-only and revoked-flag branches, but they do not exercise a persistent queue, real transaction boundary, or process restart.

## Rollback and disaster recovery

- The pilot operations runbook says the deploy rollback does not run migrate:down. Its separate migrate:down instruction warns that it deletes pilot data and is only for abandoning a pilot after the required human gate.
- Application-image rollback is only feasible when the previous image is compatible with the already-applied schema. That compatibility was not tested here.
- No host backup, volume snapshot, restore, point-in-time recovery, RPO, or RTO evidence was available. RPO and RTO remain NOT_MEASURED.
- Do not claim that a code rollback restores a database or reverses a real payment, order, message, or courier action.
- The safe operator plan for any future live issue is stop new automation with the relevant kill switches, preserve logs and queue/database state, use the existing incident runbook, and recover forward or restore from an independently verified backup after owner approval.

ROLLBACK_FEASIBILITY=PARTIAL at the documentation/source-procedure level; production database rollback and recovery remain UNKNOWN and NOT VERIFIED.
