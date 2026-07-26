# 02 — GitHub Secret Inventory

**Names and statuses only. No values were read or printed. GitHub Actions secrets are write-only.**

Scopes inspected: repository (`gh secret list`), `production` environment (`gh secret list --env production`), organization (`gh secret list --org mr3826` → HTTP 404, not an org / no access), Actions variables (`gh variable list` → none; `--env production` → none).

## Secret matrix (relevant subset)

| Name | Required by | Repo secret | Env(production) secret | Org secret | Variable | Status |
|---|---|---:|---:|---:|---:|---|
| `PAYMENT_ENCRYPTION_KEY` | deployment/runtime | yes | no | no | no | present (normalized at render) |
| `CSRF_SECRET` | backend | **yes** | no | no | no | **present (created this task)** |
| `DELIVERY_ENCRYPTION_KEY` | runtime | yes | no | no | no | present |
| `CHANNEL_ENCRYPTION_KEY` | runtime | yes | no | no | no | present |
| `PAYMENT_CALLBACK_HMAC_SECRET` | runtime | yes | no | no | no | present |
| `SENTRY_DSN` | backend alerts | no | no | no | no | **missing** (backend falls back to `VITE_SENTRY_DSN`) |
| `SLACK_ALERT_WEBHOOK_URL` | backend alerts | no | no | no | no | **missing** |
| `VITE_SENTRY_DSN` | frontend + backend fallback | yes | no | no | no | present |
| `BKASH_APP_KEY` | bKash | no | no | no | no | missing (not required — bKash disabled) |
| `BKASH_APP_SECRET` | bKash | no | no | no | no | missing (not required) |
| `BKASH_BASE_URL` | bKash | no | no | no | no | missing (not required) |
| `BKASH_USERNAME` | bKash | no | no | no | no | missing (not required) |
| `BKASH_PASSWORD` | bKash | no | no | no | no | missing (not required) |
| `BKASH_WEBHOOK_SECRET` | bKash webhook | no | no | no | no | missing (now conditional; not required while disabled) |
| Meta: `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_OAUTH_REDIRECT_URI`, `META_WEBHOOK_APP_SECRET`, `VITE_META_APP_ID` | Meta integration | yes | no | no | no | present |
| Deployment: `DEPLOY_HOST`, `DO_HOST`, `DO_SSH_PRIVATE_KEY` | deployment | yes | no | no | no | present |
| Deployment (env): `SERVER_HOST`, `SERVER_USER`, `SSH_PRIVATE_KEY`, `DEPLOY_PATH`, `FRONTEND_PATH` | deployment | no | yes | no | no | present |
| Backup off-site: `SPACES_*` / `AWS_*` / `BACKUP_BUCKET` / `BACKUP_ENCRYPTION_KEY` | backup (F-04) | no | no | no | no | **missing (external — BLOCKED)** |

## Observations

- The deploy workflow reads repository-scope secrets and the `production` environment secrets. The `production` environment holds only SSH/host/path values; the CI/CD deploy job actually uses the repository-scope `DO_HOST`/`DEPLOY_HOST`/`DO_SSH_PRIVATE_KEY`.
- `META_APP_ID` is sourced from `VITE_META_APP_ID` in the render step (there is no standalone `META_APP_ID` secret) — verified correct in `ci-cd.yml`.
- No organization secrets are accessible; nothing is inherited from an org scope.
- Full repository secret-name list is captured in the session evidence; only the launch-relevant subset is reproduced here.
