# 00 — Remediation Executive Summary

**Date:** 2026-07-26 · **Branch:** `codex/fix-launch-blockers-secrets-health` (from `origin/main` @ `8394a44`)
**Nature:** execution task — resolve confirmed launch blockers, reconcile secrets, prepare the hardened release. This is the follow-up to the 2026-07-26 readiness audit (`docs/launch-readiness/2026-07-26/`).

---

## What changed

| Finding | Before | After |
|---|---|---|
| **F-01** payment-key rotation hazard | preflight rejects the non-hex key; a naive fix (fresh hex) would silently destroy stored credentials | `render-production-env.js` normalizes to `sha256(value)` — the **same** key the runtime already derives; hex passes through untouched; value never printed |
| **F-02** unknown/non-connected Page drops messages | logged and dropped, Meta told `200` | durable `meta_webhook_receipts` receipt written **before** ack; unknown Page → `IDENTITY_NOT_RESOLVED`, retried by a reconciler, PII-free alert, no cross-tenant association |
| **F-03** message-store failure swallowed | caught, logged, `200` | durable `RETRY_PENDING`/`MESSAGE_STORE_FAILED`, bounded backoff, DLQ on exhaustion, alert; receipt never marked processed |
| **F-05** health/launch gates false-PASS | `/health/*` hit the nginx stub; `dlq \|\| 0` | Caddy routes `/health*` → `backend:3000`; nginx stubs removed; every response must carry `service:"easymod-backend"`; counters fail closed (no `\|\|0`) |
| **F-06** alerting reaches nobody | neither backend sink set | workflow `SENTRY_DSN` falls back to `VITE_SENTRY_DSN` (shared project); admin-only `POST /admin/ops/test-alert` self-test added |
| **F-07** hardening not deployed | deploy died at preflight | preflight now passes with current secrets + the new `CSRF_SECRET`; ready to merge & deploy |
| **F-04** co-located backups | local only | encrypted off-site upload implemented behind guarded config — **BLOCKED_EXTERNAL_CREDENTIAL** (needs Spaces/S3 creds + a preserved `BACKUP_ENCRYPTION_KEY`) |
| bKash pilot posture | `BKASH_ENABLED:"true"`, live money, no creds | disabled by default (`vars.BKASH_ENABLED \|\| 'false'`); validator/render make bKash creds conditional; service fails closed (503) on every entry point; frontend hides all purchasing |

## Secrets

- **Created:** `CSRF_SECRET` (repository/actions scope, generated with `openssl rand -hex 32`, set via `gh secret set` over stdin — value never printed). See `03_SECRET_CHANGES.md`.
- **No external credential was fabricated.** Missing external secrets: `SENTRY_DSN`, `SLACK_ALERT_WEBHOOK_URL`, all `BKASH_*`, all object-storage (`SPACES_*`/`AWS_*`/`BACKUP_*`), `BACKUP_ENCRYPTION_KEY`.
- **`PAYMENT_ENCRYPTION_KEY` left unchanged** in GitHub; only normalized at render time.

## Test posture (all local, green)

- Backend Jest: **111 suites / 1307 tests**, exit 0
- Backend security suite: **24 suites / 150 tests**, exit 0
- Frontend: `tsc --noEmit` exit 0 · Vitest **50 files / 446 tests** · `vite build` exit 0
- Migration up → down → up on a real PostgreSQL 15 container: clean and reversible
- Infra config validation: Caddy `Valid configuration`, nginx `test is successful`, `docker compose config` exit 0
- Security self-review of the full diff: no issues

## Verdicts (see `12_FINAL_READINESS_VERDICT.md`)

- Meta App Review code readiness: **GO** (F-02/F-03 closed, scope unchanged and clean)
- Production hardened deployment: **NOT_DEPLOYED** at time of writing — code is ready and preflight passes; the merge-to-`main` production deploy is the next step and is an irreversible production action pending the operator's go-ahead
- Controlled pilot: **NO-GO** — blocked on off-site backup + human-verified restore (F-04) and confirmed alert receipt (F-06), both founder-owned
- Public launch: **NO-GO** — pilot prerequisites plus canary history, activation, and marketing-claim corrections
