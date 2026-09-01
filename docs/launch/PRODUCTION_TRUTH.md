# Production Truth — EasyModerator

The single record of **what is running in production** and **how it got there**.
Update the "Current production state" table on every production deploy.

## Rules (launch freeze, effective 2026-07-23)

1. `origin/main` is the only deployable source of truth. Production deploys happen **only** via `.github/workflows/ci-cd.yml` on push to `main` (or manual `workflow_dispatch` from `main`).
2. No manual code changes on the droplet. `/opt/easymod` holds only `docker-compose.prod.yml`, `Caddyfile`, and `.env` — all rendered by CI.
3. `docker-compose.prod.yml` is the single production process definition. The PM2 path (`ecosystem.config.js`, `commerce-ai.service`) is retired — Docker Compose services (`backend`, `worker`, `frontend`, `postgres`, `redis`, `qdrant`, `caddy`) are the only supported runtime.
4. Image tags are the version identity: CI tags every changed image with the full commit SHA (`ghcr.io/mr3826/easymod-{backend,frontend}:<full-sha>`). Backend and worker share one image (different commands), so worker version == backend image tag. Frontend build version == frontend image tag. Production deployment must not use `:latest`.

## Current production state

| Field | Value | Verified |
|---|---|---|
| Production commit SHA | `6b556eb332d64f5ded0926e7e957c17dd5abad7f` — live `/version` and `/health` report this commit. | 2026-09-01 live probe; GitHub Actions run `33442831720` |
| Latest migration on `main` | `20260828_004_commercial_model` (`45` migration entries reported by live `/version`). | 2026-09-01 live `/version` and `migrations` query |
| Backend / worker version | `ghcr.io/mr3826/easymoderator-backend@sha256:444b68e0cad9aca348dc5df44eb10d9c54f980d7dcab11d899482cb6fa423597` | 2026-09-01 live Docker inspect |
| Frontend build version | `ghcr.io/mr3826/easymoderator-frontend@sha256:6a4c7d5bc821427d5c880e58d4d65b9ef46e1e1cff1d4b8c801378c595f299a0` | 2026-09-01 live Docker inspect |
| Deployment workflow | Main deployment succeeded at `2026-08-31T22:24:52Z`; candidate migration completed before service replacement. | [Actions run 33442831720](https://github.com/mr3826/easymoderator-monorepo/actions/runs/33442831720) |
| Phase 1 security branch | `codex/phase1-security-compliance` is review-only: not merged and not deployed | 2026-07-23 |

## Commercial model rollout status

The Shuru/Growth/Partner commercial model is deployed by main commit
`6b556eb332d64f5ded0926e7e957c17dd5abad7f`. The public plan endpoint returns the
three expected plans, but the live entity/schema audit on 2026-09-01 found
three latent missing columns: `orders.metadata`,
`subscriptions.threshold_debt`, and `subscriptions.usage_reset_at`. The
commercial release is therefore not incident-clear until the forward repair
migration and post-migration schema audit pass in production.

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
