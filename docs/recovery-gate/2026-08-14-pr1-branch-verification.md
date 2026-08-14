# Recovery gate — PR #1 branch verification (2026-08-14/15)

This report answers a narrower, harder question than the same-day report it
supersedes for cutover-readiness purposes: **does the code actually sitting on
`easymod/monorepo-migration` (PR #1), not a description of it, reproduce the
previously-proven recovery behavior?** The prior report's evidence was real,
but it was gathered by running `main`'s *old* backup workflow via a secret
alias (`DO_HOST`) — it never actually exercised this branch's committed
`backup.yml`, `restore-database.js`, or `backup-runner` image. This report
does.

```text
RECOVERY_CURRENT_BRANCH=PASS
BRANCH_VERIFIED=easymod/monorepo-migration @ 0004e72
PR=#1 (mr3826/easymoderator-monorepo)

OFFHOST_BACKUP=PASS
BACKUP_FROM_CURRENT_PR_CODE=PASS — triggered via `gh workflow run backup.yml
  --ref easymod/monorepo-migration`, confirmed by headSha on every run, not
  the default-branch workflow definition
DB_RESTORE=PASS
MEDIA_RESTORE=PASS
CHECKSUM=PASS
QDRANT_REBUILD_OR_RESTORE=PASS (classification re-validated, not rebuilt live
  — see "Qdrant / Redis" below)
REDIS_RECOVERY_CLASSIFICATION=PASS (ephemeral, no restore needed)

RPO=MEASURED — see below
RTO=MEASURED — see below

PRODUCTION_DEPLOY_ENABLED=false
PRODUCTION_SWITCHED=NO
```

## What actually happened (this was not a clean first pass)

Triggering `backup.yml` against this branch's real ref — for the first time
ever — surfaced **three real, previously-undetected bugs**, all now fixed and
committed to this branch:

1. **`DO_TOKEN` GitHub secret was stale.** The droplet's fail-closed DO API
   probe returned `403`. The token in my local environment was valid (`200`
   against `/v2/account`); the GitHub secret wasn't. Fixed by updating the
   secret to the valid value — not a code change, an operational one.
2. **`pg_restore -l - < file` cannot read a custom-format archive from
   stdin.** `backup.yml`'s own dump-sanity-check failed with `could not open
   input file "-"`, misreporting a genuine 328KB/102-table dump as "0 tables
   — treating as failed." Fixed by copying the dump into the container as a
   real file before listing it (`085ee2d`).
3. **The orphan-media-sweep step aborted the whole backup job.**
   `cleanup-product-media.js` (added in an earlier commit, never deployed
   because `PRODUCTION_DEPLOY_ENABLED=false`) doesn't exist in the droplet's
   currently-running backend image, so `MODULE_NOT_FOUND` under
   `set -euo pipefail` killed the job before it ever reached the off-site
   upload. Fixed by making this housekeeping step best-effort (`c31d027`) —
   it's orthogonal to backup/restore correctness and must not block the
   backup this job exists to produce.
4. **The `backup-runner` image's `pg_restore` had silently drifted to v18.4**
   (Alpine's rolling repo aged PG15 client packages out entirely), which
   emits `SET transaction_timeout = 0` — a GUC that doesn't exist before
   PG17 — against the actual PG15 production server, failing every real
   restore even though the backup itself was fine. Fixed by pinning the
   Dockerfile to `node:20-alpine3.19`, whose repo snapshot still carries
   `postgresql15-client` (`0004e72`).

None of these were visible from code review alone — all four were only
discoverable by actually running the pipeline against this branch's real
code, which is the entire point of this exercise.

## Evidence

**Off-site backup** (final successful run, against `headSha=c31d027`, after
fixes 1–3 above):

- `gh run view 31827209173` → `conclusion: success`, all steps green.
- `Starting backup: /opt/easymod/backups/easymod-20260814-180758.dump`
- `Dump: 328900 bytes custom format, 102 table entries` — `Backup complete: 324K`
- `Uploads backup complete: 176K`
- Orphan sweep: `MODULE_NOT_FOUND` → `::warning::` (non-fatal, as designed) —
  correctly did NOT abort the job.
- `Off-site upload OK: db/easymod-20260814-180758.dump.enc`
- `Off-site upload OK: uploads/easymod-uploads-20260814-180758.tar.gz.enc`
- Bucket ACL check (no `AllUsers`/`AuthenticatedUsers` grants) and lifecycle
  check both passed silently (job would `exit 1` otherwise) → `Off-site
  upload complete.`

**Isolated restore rehearsal** (against `headSha=0004e72`, after fix 4 above;
throwaway Docker infra only — nothing on the droplet or in production was
touched):

- Downloaded `db/easymod-20260814-180758.dump.enc` (328928B) and
  `uploads/easymod-uploads-20260814-180758.tar.gz.enc` (179712B) plus their
  `.sha256` sidecars from `s3://easymod-backups-prod`. Both checksums
  matched.
- Decrypted both with `openssl enc -d -aes-256-cbc -pbkdf2` using
  `BACKUP_ENCRYPTION_KEY`; the uploads archive passed `gzip -t`; the DB file
  was independently confirmed as `PostgreSQL custom database dump - v1.14-0`
  via `file`.
- Built the real `backup-runner` image from this commit's Dockerfile.
  `pg_restore --version` inside it: `15.15` (was `18.4` before fix 4).
- Threw away Postgres (`postgres:15-alpine`, role name `easymod_user` to
  match production's `OWNER TO` statements) on an isolated Docker network.
  `restore-database.js restore` → `✅ Database restored successfully!` /
  `✅ Database restore verified successfully!`
- Independently re-queried the isolated database directly (not just trusting
  the tool's own message): `SELECT count(*) FROM information_schema.tables`
  → **51**. Sample row counts: `shops=1`, `products=1`, `audit_logs=2097`.
- Restored media via the unmodified `restore-media.js` inside a
  `node:20-alpine` container (Linux, matching production) →
  `{"status":"PASS","target":"/target","entryCount":4}`.
- Verified a representative file via the tool's own `verify` command:
  `{"status":"PASS", ..., "sha256":"0aacf8b8be2bcea2d892993704c248c93682bf640be4a22990cc2d66c302020b"}`.
- Torn down: isolated Postgres container, network, and both intermediate
  `backup-runner` test images all removed after verification.

## RPO / RTO

```text
BACKUP_TIMESTAMP=2026-08-14T18:07:58Z
RESTORE_START_UTC=2026-08-14T18:08:48Z
RESTORE_END_UTC=2026-08-14T18:33:11Z
OBSERVED_RTO_THIS_REHEARSAL=24m23s (1463s)
```

That 24-minute figure is honestly reported but **not the steady-state
number** — most of it was spent diagnosing and fixing bugs 2–4 above
(rebuilding Docker images, restarting Docker Desktop, etc.), not the restore
mechanics themselves. The actual data-path steps (download two files
totaling ~500KB, checksum, decrypt, `pg_restore` a 328KB dump, extract a
176KB tarball) each completed in low single-digit seconds once the correct
tooling was in place. A repeat rehearsal against this now-fixed code should
land close to the prior session's clean measurement of **4m49s (289s)** for
the same category of operation — this will be confirmed the next time this
rehearsal is run, rather than asserted here.

`RPO`: this is the **second-ever** successful off-site backup produced by
this pipeline (the first was the prior session's run against `main`'s old
workflow). There still isn't a second real inter-backup gap to measure from
a steady weekly/daily cadence — re-measure after this branch's scheduled
cadence has run at least twice post-merge.

## Qdrant / Redis classification (re-validated, not redone)

- `git show 3a0101d --stat` (and the two commits after it) touch neither
  Redis config nor Qdrant code.
- `EasyMod-backend/src/scripts/reindex-qdrant.js` is present and unchanged;
  `npm run reindex:qdrant` is still wired in `package.json`. Classification
  holds: **Qdrant is regenerable from PostgreSQL**, not independently backed
  up, and nothing about this branch's changes requires re-proving the
  rebuild live (no data-loss scenario exists locally to rehearse against).
- Redis remains **ephemeral by design** (ONLY cache/session state) — nothing
  in this branch's changes alters that.

## What this report does NOT claim

- It does not claim the *scheduled* (cron) backup run is fixed — only that a
  manually-triggered run against this branch's exact code succeeds. The
  schedule itself only starts running this code once PR #1 merges to `main`.
- It does not claim a repeat rehearsal will hit the same 24-minute figure —
  see RTO note above.
- It does not touch `PRODUCTION_DEPLOY_ENABLED` or perform any action against
  the live production database, media, or DNS.
