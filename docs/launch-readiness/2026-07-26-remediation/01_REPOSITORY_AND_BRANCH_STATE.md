# 01 — Repository and Branch State

| Item | Value |
|---|---|
| Repository root | `D:/hexabyte/easy-moderator` |
| Owner/name | `mr3826/easymod-backend` |
| Default branch | `main` |
| Base commit (`origin/main`) | `8394a44335cf71708bfa55e8aff2d7ea75e26c92` |
| Working branch | `codex/fix-launch-blockers-secrets-health` |
| Branch created from | latest `origin/main` (not a stale feature branch) |
| `gh auth` | authenticated as `mr3826`, scopes `gist, read:org, repo, workflow` |

## Failed pre-remediation run

`gh run view 30189476291` — CI/CD on `main` (merge of PR #74). Jobs: Detect ✓, Test & Build ✓, Docker build ✓, **Deploy ✗** at *"Render and validate .env.prod"*.

Redacted failure line:
```
Error: Unsafe production configuration
  (missing: BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_BASE_URL, BKASH_PASSWORD,
   BKASH_USERNAME, BKASH_WEBHOOK_SECRET, CSRF_SECRET,
   SENTRY_DSN|SLACK_ALERT_WEBHOOK_URL; invalid: PAYMENT_ENCRYPTION_KEY)
```
No secret value appeared in the log. This is the mechanism of **F-07**: the deploy died at the preflight before contacting the droplet, so production still serves the pre-merge image.

## How each blocker in that line is now resolved

- `CSRF_SECRET` — **created** (Category B, this task).
- `SENTRY_DSN|SLACK_ALERT_WEBHOOK_URL` — workflow now falls back to `VITE_SENTRY_DSN` (present), so the backend gets a Sentry sink.
- `PAYMENT_ENCRYPTION_KEY` invalid — render-time normalization to 64-hex (F-01).
- All `BKASH_*` — no longer required: bKash disabled for the pilot, credentials made conditional.

## Open PRs / worktrees

- No open PRs at start (`gh pr list --state open` → empty). PR #74 already MERGED as `8394a44`.
- Single worktree, no stashes.

## Cleanliness

The branch adds only remediation code, tests, and docs. The prior audit directory `docs/launch-readiness/2026-07-26/` is preserved unchanged (not overwritten). No `.env`, rendered env, or secret file is tracked; `.env.prod` is gitignored and never written to the working tree except a transient empty file used once for `docker compose config` validation and immediately removed.
