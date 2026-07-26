# 13 — Backups, Restore and Disaster Recovery (Workstream L)

**Verdict for this workstream: FAIL — market-launch blocker.**

Previous reports flagged co-located backups as a serious risk. Verified fresh from the
current workflow: **it is not fixed.**

## What actually exists — and it does run

`.github/workflows/backup.yml`, daily at 02:00 UTC (08:00 Bangladesh), plus manual
dispatch. It is genuinely executing:

| Run | Date | Result |
|---|---|---|
| `30189139485` | 2026-07-26T05:17Z | success, 10s |
| `30144761737` | 2026-07-25T04:52Z | success, 11s |
| `30068084673` | 2026-07-24T04:56Z | success, 13s |
| `29980984999` | 2026-07-23T05:00Z | success, 14s |

Both the database **and** the uploads volume are captured:

```bash
docker compose ... exec -T postgres pg_dump -U easymod_user easymod | gzip > "$BACKUP_FILE"
docker compose ... run --rm --no-deps --user root -v "$BACKUP_DIR":/backup \
  --entrypoint sh backend -c "cd /app/uploads && tar czf /backup/$UPLOADS_BACKUP_FILE ."
find "$BACKUP_DIR" -name "easymod-*.sql.gz" -mtime +7 -delete
```

That is a real, working, scheduled backup covering both data stores. Credit where due.

## ⛔ Finding F-04 (P1) — every copy lives on the machine it protects

The workflow's own header states it:

```
# Backups are stored on the droplet at /opt/easymod/backups/ (7-day retention).
```

`BACKUP_DIR=/opt/easymod/backups` — the **production droplet**. There is no `aws s3 cp`,
no `rclone`, no Spaces upload, no second host. The dump is written, gzipped, and left
beside the database it came from.

| Scenario | Outcome |
|---|---|
| Droplet lost / destroyed / deprovisioned | **Total loss** — production *and* all seven days of backups |
| Region outage | Total unavailability, no independent recovery path |
| Disk corruption or full disk | Likely loses both live data and backups |
| Ransomware / root compromise | Attacker has production and every backup in one directory |
| Accidental `DROP TABLE` | **Recoverable** (this is the one scenario it covers) |
| Corrupt migration | **Recoverable** |

The backup protects against *logical* failure only. It provides **no protection against
host loss**, which is the scenario disaster recovery exists for.

## Full assessment

| Requirement | Status | Detail |
|---|---|---|
| Automated PostgreSQL backup | **PASS** | daily, verified running |
| Upload/attachment backup | **PASS** | tarred in the same job |
| Backup frequency | PASS | daily |
| Retention period | PASS | 7 days |
| **Off-site object storage** | **FAIL** | none |
| **Encryption at rest** | **FAIL** | gzip only — not encryption. A plaintext dump of all merchant and customer PII sits on disk |
| Access controls | WEAK | root-owned directory on the droplet; anyone with droplet root has every backup |
| **Backup failure alerting** | **FAIL** | a failed run shows red in GitHub Actions; no configured notification. With `SENTRY_DSN` and `SLACK_ALERT_WEBHOOK_URL` both unset, nothing reaches a human |
| Last successful backup | PASS | 2026-07-26T05:17Z |
| Restore documentation | PARTIAL | `npm run backup:restore` exists (`scripts/backup-database.js`); no runbook ties it to the droplet backup layout |
| **Actual restore test** | **FAIL** | **no evidence a restore has ever been performed** |
| **RPO** | **UNDEFINED** | implicitly ≤24h for logical failure; **infinite** for host loss |
| **RTO** | **UNDEFINED** | no documented or measured recovery time |

## The brief's rule

> *"A backup is not considered verified until a restore has succeeded in an isolated
> environment. If backups remain only on the same server as production, classify this as
> a market-launch blocker unless an explicitly approved risk exception exists."*

Both conditions fail. No restore has been performed; backups are co-located. **No
documented risk exception exists in the repository.**

Classified **P1 — market-launch blocker**.

Note this is *not* a Meta App Review blocker. Meta does not assess disaster recovery. It
blocks verdicts C and D, not A or B.

## Remediation

1. **Off-site copy.** Add a DigitalOcean Spaces (or S3) upload to `backup.yml` after the
   dump. Requires new secrets (founder-owned): bucket, region, access key, secret key.
2. **Encrypt before upload.** `gpg --symmetric` or SSE-KMS. The dump contains full
   merchant and end-customer PII, including phone numbers and delivery addresses.
3. **Perform and document one real restore** into an isolated database. Until this
   happens, the backups are unproven artifacts, not a recovery capability.
4. **Alert on backup failure** — depends on gate 8 (`SENTRY_DSN` / `SLACK_ALERT_WEBHOOK_URL`).
5. **Write down RPO and RTO** and confirm the founder accepts them.

Steps 1-3 are the minimum to clear the blocker.
