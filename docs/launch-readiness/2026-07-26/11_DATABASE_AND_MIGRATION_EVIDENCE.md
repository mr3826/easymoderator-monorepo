# 11 — Database and Migration Evidence (Workstream J)

**Verdict for this workstream: BLOCKED for fresh re-verification; PASS on recorded
evidence and static review.**

## What could not be re-run, and why

The brief requires an isolated up/down/up migration test. **Docker is installed
(v29.3.0) but the daemon is not running:**

```
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine;
check if the path is correct and if the daemon is running
```

There is no other PostgreSQL 15 instance available to this environment, and the brief
forbids destructive migration tests against production. `npm run migrate:status` requires
a live `DATABASE_URL` and was therefore **not** run against production.

**Status: BLOCKED.** The migration evidence below is inherited from PR #74's recorded run
and is explicitly *not* independently re-verified in this audit.

## Recorded evidence from PR #74 (historical, not re-verified)

Runtime: `postgres:15-alpine`, server version PostgreSQL **15.18**, disposable synthetic
database, starting schema an exact archive of the `3f878e3` production-truth baseline. No
production data or secrets.

Sequence executed:

```
node src/database/migrate.js up                     # baseline
node scripts/validate-meta-compliance-postgres.js seed-baseline
npm run migrate            → verify-up
npm run migrate:down       → verify-down
npm run migrate            → verify-reapply
```

Reported results:

| Check | Result |
|---|---|
| Compliance tables + columns | 2 tables, all 28 columns |
| Named indexes | 5 |
| Foreign keys (with delete behaviour) | 3 |
| Unique controls | 3, incl. duplicate entity-write rejection |
| Enum labels | `PENDING`, `PROCESSING`, `IDENTITY_NOT_RESOLVED`, `COMPLETED`, `FAILED` |
| Defaults | mapping source/time, request status, attachment paths |
| Sequelize entity CRUD | compatible |
| **Down migration** | full public-schema diff vs pre-up snapshot matched **exactly** — only the 2 new tables and the enum removed |
| **Re-apply (second up)** | all schema + CRUD checks passed → re-deployable |
| Post-migration boot | API `/health/ready` 200 (db + redis connected); worker health 200 |

The synthetic deletion removed 2 customers, 2 conversations, 2 messages, preference/
delivery mappings, and 2 server-owned attachments; anonymized 1 retained order including
legacy `delivery_area`/`notes` PII while preserving order number, amounts, payment and
delivery status. Remote attachment references were correctly not treated as server-owned.

This is unusually thorough migration evidence. Its only weakness is that it is a *report*,
and this audit could not reproduce it.

## Static review (performed fresh)

| Requirement | Status | Receipt |
|---|---|---|
| Migration count / ordering | 30 timestamped migrations + `archive/`; lexicographic order is consistent | `ls src/database/migrations/` |
| Latest migration | `20260723_001_meta_compliance_identity_and_deletion.js` | — |
| Down migration support | present for the new migration | verified in PR evidence |
| PostgreSQL 15 compatibility | validated on 15.18 | PR evidence |
| **Message idempotency** | `messages.external_id VARCHAR(255) UNIQUE` + partial index `idx_msgs_ext` | `20260520_000_initial_schema.js:440,448` |
| **Order idempotency** | dedicated migration | `20260611_001_order_session_metadata_orders_idempotency.js` |
| Channel uniqueness | partial unique index `WHERE is_current_connection = true` on `meta_user_identities`; multi-Page indexes | `20260522_012`, `20260723_001` |
| Tenant-scoping constraints | `shop_id` FKs with `onDelete: CASCADE` | `meta-channel.entity.js:30-32` |
| Token encryption columns | `page_access_token_ct` (ciphertext) | `meta-channel.entity.js` |
| Data-deletion schema support | `meta_data_deletion_requests` with hashed IDs, counters, stage checkpoints, `processing_token` | `20260723_001` |
| Instagram cleanup | legacy channels disconnected | `20260624_001_disconnect_instagram_channels.js` |
| Queue/job idempotency | Redis `msg:dedup:{shopId}:{externalId}` claim | `message-worker.js:292` |
| Backup/restore compatibility | plain `pg_dump | gzip` — standard, restorable | `backup.yml` |

## Migration execution during deployment

PR #74 moved migrations to run **from the candidate image before service replacement**.
This is the correct ordering (schema first, then rollout) and is a genuine improvement.

**It has never executed in production** — the deploy has not run since the merge.

## Findings

| ID | Sev | Finding |
|---|---|---|
| F-21 | P2 | Migration up/down/up could not be re-verified this audit (no Docker daemon); the launch candidate's schema evidence rests on a single unreproduced run |
| F-35 | P2 | Production migration status is unknown — `migrate:status` was not run against production, so it is unconfirmed whether `20260723_001` is applied there (it should **not** be, since the deploy never ran) |
