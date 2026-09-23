# Production Truth — EasyModerator

The single record of **what is running in production** and **how it got there**.
Update the "Current production state" table on every production deploy.

## Rules (launch freeze, effective 2026-07-23)

1. `origin/main` is the only deployable source of truth. Main pushes run
   verification and image publication; the production cutover happens **only**
   via `.github/workflows/ci-cd.yml` manual `workflow_dispatch` from `main`
   with the bounded deploy confirmation.
2. No manual code changes on the droplet. `/opt/easymod` holds only `docker-compose.prod.yml`, `Caddyfile`, and `.env` — all rendered by CI.
3. `docker-compose.prod.yml` is the single production process definition. The PM2 path (`ecosystem.config.js`, `commerce-ai.service`) is retired — Docker Compose services (`backend`, `worker`, `frontend`, `postgres`, `redis`, `qdrant`, `caddy`) are the only supported runtime.
4. Image tags are the version identity: CI tags every changed image with the full commit SHA (`ghcr.io/mr3826/easymod-{backend,frontend}:<full-sha>`). Backend and worker share one image (different commands), so worker version == backend image tag. Frontend build version == frontend image tag. Production deployment must not use `:latest`.

## Current production state

| Field | Value | Verified |
|---|---|---|
| Production commit SHA | Runtime is `81437a6aacbf9e2d519816d5824a18ecfe7d332b`; current `origin/main` is intentionally read dynamically because later workflow/docs/test commits are not deployed. Public `/api/version` and `/health/ready` report the deployed runtime SHA. | 2026-09-23 deployment [Actions run 35862031156](https://github.com/mr3826/easymoderator-monorepo/actions/runs/35862031156) |
| Latest migration on `main` | `20260914_001_add_temporary_password_controls`; production reports 56 migrations, threshold values were preserved, and the schema audit reported `No drift found.` | 2026-09-23 deploy log and public `/api/version` |
| Backend / worker version | Exact immutable image and in-container version verified by deployment run `35862031156`. | 2026-09-23 deployment receipt |
| Frontend build version | Exact immutable image verified by deployment run `35862031156`; public frontend origin returned HTTP 200. | 2026-09-23 deployment receipt |
| Growth image version | Existing running Growth image was carried forward; `GROWTH_BOOTSTRAP_DIGEST` was empty, so the running Growth digest remains `NOT_VERIFIED`. Public Growth readiness returned HTTP 200. | 2026-09-23 deploy log and public smoke check |
| Deployment workflow | Exact-SHA manual production deploy succeeded after the configured `production` environment approval. Candidate migrations, schema audit, service replacement, health, and version checks passed. `PRODUCTION_DEPLOY_ENABLED` was restored to `false`. | [Actions run 35862031156](https://github.com/mr3826/easymoderator-monorepo/actions/runs/35862031156) |
| Phase 1 security branch | `codex/phase1-security-compliance` is review-only: not merged and not deployed | 2026-07-23 |

## Verification limits

The receipt above proves the GitHub deployment target, candidate image pulls,
database authentication, migration ordering, schema audit, backend version
identity, backend readiness, and public backend/frontend/Growth HTTP smoke
responses. It does not yet prove frontend asset-digest identity, the running
Growth image digest, worker canary behavior, media restore, Qdrant recovery,
Redis recovery, or a live rollback. The deployment uses a fail-closed
`/api/version.gitSha` check before reporting success.

## Commercial model rollout status

The rollback-safe runtime and current Growth control-plane migrations are deployed
by main commit `81437a6aacbf9e2d519816d5824a18ecfe7d332b`. The
2026-09-23 production migration and schema audit completed successfully with no
drift; the earlier repair-ledger evidence remains preserved in the dated audit
history.

## Post-deploy verification (run on the droplet after each deploy)

```bash
# What is actually running, and since when
docker ps --format '{{.Names}}\t{{.Image}}\t{{.CreatedAt}}'

# Cross-check against the canonical monorepo main ref
git ls-remote https://github.com/mr3826/easymoderator-monorepo.git refs/heads/main

# Application-reported release and migration ledger summary. This is not schema proof.
curl --fail --silent --show-error https://api.easymod.tech/version

# Entity-backed schema contract (read-only; must return no drift)
docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm --no-deps -T \
  -e RUN_MIGRATIONS_ON_STARTUP=false backend npm run schema:audit
```

## Launch-freeze exception log

| Date | Exception | Resolution |
|---|---|---|
| 2026-07-23 | Prod had been running `f1c7ee5` from unmerged branch `codex/messenger-production-recovery` | PR #73 merged as `3f878e3`; the canonical `main` deployment workflow completed successfully and restored the source-of-truth invariant |
