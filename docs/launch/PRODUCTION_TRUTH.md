# Production Truth — EasyModerator

The single record of **what is running in production** and **how it got there**.
Update the "Current production state" table on every production deploy.

## Rules (launch freeze, effective 2026-07-23)

1. `origin/main` is the only deployable source of truth. Production deploys happen **only** via `.github/workflows/ci-cd.yml` on push to `main` (or manual `workflow_dispatch` from `main`).
2. No manual code changes on the droplet. `/opt/easymod` holds only `docker-compose.prod.yml`, `Caddyfile`, and `.env` — all rendered by CI.
3. `docker-compose.prod.yml` is the single production process definition. The PM2 path (`ecosystem.config.js`, `commerce-ai.service`) is retired — Docker Compose services (`backend`, `worker`, `frontend`, `postgres`, `redis`, `qdrant`, `caddy`) are the only supported runtime.
4. Image tags are the version identity: CI tags every image with the commit short SHA (`ghcr.io/mr3826/easymod-{backend,frontend}:<short-sha>`) plus `:latest`. Backend and worker share one image (different commands), so worker version == backend image tag. Frontend build version == frontend image tag.

## Current production state

| Field | Value | Verified |
|---|---|---|
| Production commit SHA | `f1c7ee5` (`codex/messenger-production-recovery`) — **not on `main` at time of freeze; corrected by the launch PR, after which prod SHA == merge SHA on `origin/main`** | 2026-07-23 audit |
| Latest migration on `main` | `20260704_001_telegram_notification_bindings` | 2026-07-23 (`git ls-tree origin/main`) |
| Backend / worker version | image tag of `ghcr.io/mr3826/easymod-backend` currently on droplet | run command below |
| Frontend build version | image tag of `ghcr.io/mr3826/easymod-frontend` currently on droplet | run command below |
| Deployment timestamp | container creation time on droplet | run command below |

## Post-deploy verification (run on the droplet after each deploy)

```bash
# What is actually running, and since when
docker ps --format '{{.Names}}\t{{.Image}}\t{{.CreatedAt}}'

# Cross-check against origin/main — the short SHA in the image tags must be an ancestor of origin/main
git ls-remote https://github.com/mr3826/easymod-backend.git refs/heads/main

# Migration state (runner is idempotent: npm run migrate)
docker exec easymod-backend-1 npm run migrate -- --status 2>/dev/null || \
  docker exec easymod-backend-1 ls /app/src/database/migrations | tail -3
```

## Launch-freeze exception log

| Date | Exception | Resolution |
|---|---|---|
| 2026-07-23 | Prod running `f1c7ee5` from unmerged branch `codex/messenger-production-recovery` | Launch PR merges `codex/final-production-readiness-fixes` (contains `f1c7ee5` + 3 readiness fixes) into `main`; redeploy from `main` restores the invariant |
