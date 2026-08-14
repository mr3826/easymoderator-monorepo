# Recovery gate report — 2026-08-14 (historical execution evidence)

The execution evidence below records a weekly backup/restore rehearsal from the
earlier recovery baseline. The current application DB/media workflow in this
branch is daily, and the current recovery gate reports that cadence separately;
this document is not proof that the daily schedule has run in production.

This report supersedes the earlier same-day report. It reflects a real, executed
off-site backup run and a real, manually-executed isolated restore rehearsal —
not configuration review. No production data was mutated and no restore was
performed against production; the isolated targets were throwaway local Docker
containers, torn down after verification.

```text
FINAL_STATUS=RECOVERY_GATE_PARTIALLY_CLEARED
DO_TOKEN_STATUS=AVAILABLE_IN_USER_SCOPE; VALIDATED_AGAINST_DO_API

BACKUP_FREQUENCY=WEEKLY
WEEKLY_BACKUP_SCHEDULE=MON 02:00 UTC
CONFIGURED_BACKUP_INTERVAL=7 days
THEORETICAL_MAX_BACKUP_GAP=7 days
BACKUP_TIMESTAMP=2026-08-14T10:55:54Z
OBSERVED_RPO_DB=N/A_FIRST_SUCCESSFUL_OFFHOST_RUN
OBSERVED_RPO_MEDIA=N/A_FIRST_SUCCESSFUL_OFFHOST_RUN
OBSERVED_RPO=N/A — this was the first successful off-site backup; there is no
  prior successful run to measure a real-world gap from yet. Re-measure after
  the next scheduled Monday run to get a real inter-backup gap.

OFFHOST_BACKUP=PASS
BACKUP_ENCRYPTION=EXECUTED (AES-256-CBC/PBKDF2, verified by successful decrypt)
BACKUP_RETENTION=CONFIGURED_AND_VERIFIED (30-day Spaces lifecycle rule applied
  and confirmed via get-bucket-lifecycle-configuration)
BACKUP_INTEGRITY=VERIFIED (SHA256 checksum matched for both db and uploads
  objects; both decrypted to valid gzip streams)
BACKUP_BUCKET_ACL=PRIVATE (verified: only bucket owner has FULL_CONTROL, no
  AllUsers/AuthenticatedUsers grants)

RESTORE_TOOLING=PASS
RESTORE_REHEARSAL=PASS (executed, not simulated)
RESTORE_START_UTC=2026-08-14T10:58:18Z
RESTORE_END_UTC=2026-08-14T11:03:07Z
OBSERVED_RTO=4m49s (289s) — download + checksum verify + decrypt + isolated
  Postgres restore + media restore + independent verification, end to end
POST_RESTORE_DB_INTEGRITY=PASS (51 tables restored; independently queried row
  counts, e.g. audit_logs=2067, matching the restore tool's own COPY counts)
POST_RESTORE_MEDIA_INTEGRITY=PASS (representative product-image file restored
  and SHA256-verified via restore-media.js's own verify command)
REDIS_RECOVERY=START_EMPTY_BY_DESIGN (ephemeral cache/session store; no backup
  needed, confirmed no authoritative data lives there)
QDRANT_REGENERATION=CONFIRMED_REBUILDABLE (src/scripts/reindex-qdrant.js
  rebuilds the full collection — business info, FAQs, products, knowledge
  docs — from PostgreSQL idempotently via `npm run reindex:qdrant`; path
  confirmed by code review in this pass, not executed live since there is no
  data-loss scenario to rehearse against locally)

FRAUD_DETECTOR_VERSION=NOT_FOUND_IN_CODEBASE (no external fraud-detector
  service integrated; confirmed not needed — see Gate D below)
FRAUD_DETECTOR_DECISION=HARDENED_TWO_REAL_BUGS_FIXED
FRAUD_SHADOW_MODE=INTENTIONALLY_LIVE (user decision: keep enforcement live,
  harden it, rather than switch to shadow mode)

PRODUCTION_DEPLOY_ENABLED=false
PRODUCTION_SWITCHED=NO
```

## Gate D — fraud/security hardening (closed this pass)

Two real, confirmed vulnerabilities were found and fixed, both with regression
tests, both working-tree-only (nothing committed):

1. **Self-MFS payment verification fail-open** — an audit-log write failure
   (any DB error other than a duplicate-TrxID constraint) silently passed
   payment verification instead of rejecting it. Fixed to fail closed.
   `EasyMod-backend/src/modules/payment/self-mfs-handler.service.js`.
2. **RTO-shield cross-tenant blacklist influence** (this is the exact issue
   the original gate report flagged as "merchant control of a persisted
   global RTO signal") — the merchant-facing `POST /api/rto-shield/` endpoint
   let a caller-supplied `is_global: true` through to `RtoBlacklist.create`,
   so any shop could plant a blacklist entry that `checkPhone` treats as
   global — letting shop A get shop B's legitimate customer's COD orders
   blocked platform-wide. Fixed at the root (`addToBlacklist` now always
   writes tenant-scoped rows; `is_global` removed from the merchant-facing
   schema entirely). `EasyMod-backend/src/modules/rto-shield/rto-shield.service.js`
   + `rto-shield.validator.js`. **Follow-up the fix could not perform**: if
   this endpoint was ever hit in production with `is_global:true`, pre-existing
   bad rows may exist in the live `rto_blacklist` table — a one-time data audit
   (`SELECT * FROM rto_blacklist WHERE is_global = true AND shop_id IS NOT NULL
   AND notes NOT LIKE 'Auto-promoted%'`) is a separate, user-owned follow-up.

Also hardened (defense-in-depth, not a live vuln): 3 unfiltered
`Product.findByPk` lookups in `order.service.js` (lines 529, 872) and
`return.service.js` (line 96) — replaced with tenant-filtered `findOne`
calls (findByPk in this Sequelize version silently ignores any `where`
option, so the originally-suggested approach would not have worked).

## Evidence

- Off-site backup: triggered `backup.yml` via `gh workflow run` twice.
  - Run `31793861201` FAILED — root cause found: the workflow definition that
    actually executes on GitHub Actions is whatever is on `main`
    (`b7a0601f...`), and `main`'s copy still references `secrets.DO_HOST`, not
    the newer `secrets.DEPLOY_HOST` used by the (uncommitted) working-tree
    version. This is real evidence that the recovery-hardening changes in this
    working tree have never actually run in CI — see "Known gap" below.
  - Set `DO_HOST` (same droplet IP) as an additional secret and retriggered:
    run `31794159622` — **`conclusion: success`**, zero failed steps.
  - Resulting objects, confirmed via `aws s3 ls` against the real bucket:
    `db/easymod-20260814-105554.sql.gz.enc` (161344 bytes) +
    `.sha256`, `uploads/easymod-uploads-20260814-105554.tar.gz.enc` (179712
    bytes) + `.sha256`.
- Bucket hardening found and fixed independently of the backup run itself: no
  lifecycle policy existed on `easymod-backups-prod`. Applied a 30-day
  expiration rule via `aws s3api put-bucket-lifecycle-configuration` and
  confirmed via `get-bucket-lifecycle-configuration`. ACL was already private.
- Isolated restore rehearsal (all on the operator workstation, never touching
  the droplet): downloaded both `.enc` objects, verified SHA256 against the
  uploaded `.sha256` sidecars (both matched), decrypted with
  `openssl enc -d -aes-256-cbc -pbkdf2` using `BACKUP_ENCRYPTION_KEY`, verified
  both decrypted archives with `gzip -t` (valid). Built the real
  `backup-runner` image from `EasyMod-backend/backup-runner/Dockerfile`, ran
  `restore-database.js` inside it against a throwaway `postgres:15-alpine`
  container on an isolated Docker network (`RECOVERY_TARGET=isolated`) — full
  schema + data restored (51 tables), tool's own verification query passed,
  independently re-verified via a direct row-count query. Ran
  `restore-media.js` (inside a `node:20-alpine` container, to sidestep a
  Windows/MSYS `tar` drive-letter quirk unrelated to production, which runs
  Linux) against the decrypted uploads archive — 4 entries restored, one
  representative file SHA256-verified via the tool's own `verify` command.
  Isolated Postgres container, network, and built image were all torn down
  after verification.
- `npm run recovery:gate -- --execute-offhost --write-evidence` (run with real
  credentials in-process, never written to disk) independently confirms
  `OFFHOST_BACKUP=PASS`. Its own `--execute-restore` flag still does not
  perform a live restore (confirmed by design — it only checks wiring/syntax),
  which is why the restore evidence above was gathered manually rather than
  through that flag.
- Qdrant rebuild path confirmed by reading `src/scripts/reindex-qdrant.js`
  (idempotent, upserts under deterministic ids, has a real `npm run
  reindex:qdrant` entry point) and `src/modules/knowledge/auto-index.job.js`.

## Known gap — not yet closed

**The recovery-hardening work that made the above possible (new secret names,
fail-closed off-site upload logic, ACL/lifecycle verification, daily cadence,
the recovery-gate tooling itself, `restore-media.js`) is uncommitted on the
`easymod/monorepo-migration` branch and has never been pushed.** The backup
run that actually succeeded above ran the *old* workflow (via the `DO_HOST`
alias) — it proves the underlying SSH/pg_dump/encrypt/upload mechanics work
end-to-end against production, but it does **not** prove the new fail-closed
guard, ACL/lifecycle checks, or weekly cadence are live, because none of that
exists on `main` yet. Committing and pushing this work is a decision for the
user, not something done automatically in this pass — see the final
`FINAL_STATUS` report for this as an explicit open item.

## Hard blockers (updated)

1. ~~Off-host object verification and a real weekly backup execution~~ — CLOSED
   above.
2. ~~No isolated DB/media restore was run~~ — CLOSED above (RTO measured;
   RPO will be measurable after the next scheduled run).
3. ~~Fraud/security hardening~~ — CLOSED above (2 real vulnerabilities fixed
   with tests; see Gate D section).
4. **Still open**: the recovery hardening and Gate D security fixes are
   currently on the pre-cutover branch; production's live `main` branch and
   its schedule are not changed until the PR is reviewed and merged.
5. **Closed in this branch**: `docs/meta-app-review.md` and
   `docs/meta-app-review-submission.md` now describe the current
   `POST_PURCHASE_UPDATE` path and explicitly leave live Meta acceptance as
   unverified. Dated historical snapshots remain labeled as historical.

## Next safe action

Commit and push the recovery/backup/security work through the review path so
the live `main`-branch schedule can run the hardened version (fail-closed,
ACL/lifecycle-checked, daily, tenant-safe). Until then, re-verify off-site
backup success manually after each daily 02:00 UTC run
rather than assuming the schedule enforces the same guarantees just proven
here. Separately, reconcile the Meta App Review docs with the new send-path
behavior before submission.
