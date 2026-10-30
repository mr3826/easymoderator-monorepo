# 04 — Migration and recovery

## Migration dry-run

`MIGRATION_DRY_RUN=PASS` for application code SHA `6d6bc1dd056e09202b97d05e81f20308b15109ab`. The permanent command `npm run test:backend:migration-dryrun` ran against disposable Postgres in the isolated WSL Docker Engine and exited 0. The six phases covered:

1. Empty database and migration application.
2. Production-shaped seed of 3 shops, 3 customers, and 240 generated orders; two additional cross-shop shared-key idempotency fixtures were then inserted for the schema assertion, producing 242 catalog orders in that phase.
3. Canonical index reconciliation.
4. Refusal of duplicate IDs before unsafe uniqueness enforcement.
5. Repair and reapplication.
6. Down/up cycle on disposable test data.

The final run used a source snapshot synchronized to code SHA `6d6bc1dd056e09202b97d05e81f20308b15109ab`; tracked changed-source hashes were compared and matched. The fresh independent verifier reran the same six-phase command against the disposable migration project: `MIGRATION_DRYRUN_EXIT=0`, `PROD-SHAPED-MIGRATION-DRYRUN: PASS`. Original log: `D:\easymod-runtime\pilot-deployment-rehearsal-v1\migration-dryrun.log`; independent receipt: `migration-dryrun-independent-final.log`.

This dry-run does not exercise partial migration interruption, two concurrent migration processes, production-scale data, backup restore, or application rollback compatibility. The down/up cycle is disposable-schema evidence, not authority to run `migrate:down` against business data.

## Worker and Redis recovery

| Scenario | Initial state | Failure | Recovery | Observed state | Invariant evidenced | Receipt |
|---|---|---|---|---|---|---|
| Dedicated worker stop/restart | Isolated queue ready; worker stopped; no-send synthetic canary enqueued | Worker unavailable | Start dedicated worker | Job stayed waiting while stopped, then completed once as `{canary:true,ok:true}`; waiting/active/delayed/failed counts returned to zero | API does not consume jobs when embedded workers are disabled; dedicated worker resumes the pending synthetic job | Independent verifier: `worker-recovery-independent-final.log`, worker scenario exit 0 |
| Graceful Redis restart | Worker stopped; synthetic canary persisted in BullMQ | Graceful project-scoped Redis stop/start | Redis healthy, worker still stopped, then worker restarted | Job remained waiting across Redis restart and completed once after worker restart; counts returned to zero | Graceful Redis restart retained the pending synthetic job | Independent verifier: same log, Redis scenario exit 0 |
| Full application stack shutdown/restart | All eight rehearsal services running | Graceful stop of only `easymod-pilot-rehearsal-v1` | `docker compose up -d --wait` for only that project | Stop and restart commands exited 0; all eight services running after restart, with backend, worker, Growth, Postgres, Redis healthy | Graceful isolated stack lifecycle completed; no pending production work existed | Independent verifier: `compose-shutdown-restart-independent-final.log`, both exits 0 |
| Signed webhook replay/race harness | Dedicated throwaway Postgres/Redis project | Synthetic duplicate/replay race | Harness cleanup | 1 suite, 2 tests passed; dedicated project removed with its volumes and exit 0 | Harness idempotency/replay behavior passed for its synthetic fixture | `payment-webhook-race.log`, test exit 0 and cleanup exit 0 |

The main rehearsal project was not removed with `down --volumes`; its named data remains isolated. The temporary webhook project was a separate throwaway stack and its own volumes were removed. No external send or real payment/courier side effect occurred.

For handoff, after the independent verifier recorded the successful restart state, the main project was gracefully stopped with project-scoped `docker compose stop`. All eight containers are exited and the named volumes and distro are preserved.

## Not run

| Scenario | State | Remaining reason or limit |
|---|---|---|
| Partial migration failure and concurrent migrations | NOT RUN | No injected interruption or dual-migration race |
| Backend/database crash or database timeout | NOT RUN | No failure injection against app transaction processing |
| Abrupt worker crash after accepted business side effect | NOT RUN | No crash at an outbound/business commit boundary |
| Feature revocation during order/payment dispatch | NOT RUN | Only the conversation/per-shop synthetic stop cases and source interaction tests ran |
| Backup restore / point-in-time recovery | NOT RUN | No backup, restore, RPO, or RTO evidence |
| Failed deployment after migration / app-image rollback | NOT RUN | Prior-image compatibility with migrated schema not established |
| Pending real or externally actionable jobs | NOT RUN | Rehearsal used no-send synthetic queue canaries only |

## Rollback and disaster recovery

- The existing pilot runbook says deployment rollback does not execute `migrate:down`; its separate down-migration path is a human-gated pilot-abandonment procedure.
- The local disposable migration cycle passed, but previous-image compatibility with the resulting schema was not tested.
- No host backup, volume snapshot, restore, PITR, RPO, or RTO evidence is available.
- A code rollback cannot reverse a committed order, payment, message, or courier action.
- For a future live incident, stop new automation with the relevant kill switches, preserve queue/database/log state, follow the existing incident runbook, and recover forward or restore from an independently verified backup under owner authority.

`FAILURE_RECOVERY=PARTIAL` and `ROLLBACK_FEASIBILITY=PARTIAL`: worker ownership/restart, graceful Redis persistence, the disposable migration dry-run, and full graceful Compose stop/restart passed. Broader fault injection and production data recovery remain unknown/not run.
