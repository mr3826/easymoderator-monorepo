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
| Production commit SHA | `cf57db1e4706c9d7b3b32f180e1dbede3b64e7c4` — GitHub production deployment record targets the `main` workflow SHA. GitHub currently reports `main` unprotected; runtime `/api/version` read-back was not present in this deployment receipt. | 2026-09-20 deployment `6559205914`; [Actions run 35545761329](https://github.com/mr3826/easymoderator-monorepo/actions/runs/35545761329) |
| Latest migration on `main` | No new migration was applied during this cutover; the candidate reached `20260908_001`, preserved the repair ledger threshold, and reported `No drift found.` | 2026-09-20 deploy log; schema audit and migration ledger checks |
| Backend / worker version | `ghcr.io/mr3826/easymoderator-backend@sha256:9e046b07177a5514d39649fdf14a6012d4c4edc3ef5ccfc0378c090e98258ffd` | 2026-09-20 candidate build/pull receipt; runtime read-back pending |
| Frontend build version | `ghcr.io/mr3826/easymoderator-frontend@sha256:097b0a93b73d2b0730ed0aa01e1b7619ea8916f0cabca27fe7e53188084e514c` | 2026-09-20 candidate build/pull receipt; runtime read-back pending |
| Growth image version | Existing running Growth image was carried forward; `GROWTH_BOOTSTRAP_DIGEST` was empty, so no independent current digest receipt exists. | 2026-09-20 deploy log; `GROWTH_IMAGE_DIGEST=NOT_VERIFIED` |
| Deployment workflow | Manual production deploy succeeded at `2026-09-20T23:59:13Z`; candidate migration completed before service replacement. The deploy gate was restored to `PRODUCTION_DEPLOY_ENABLED=false` on 2026-09-21. | [Actions run 35545761329](https://github.com/mr3826/easymoderator-monorepo/actions/runs/35545761329) |
| Phase 1 security branch | `codex/phase1-security-compliance` is review-only: not merged and not deployed | 2026-07-23 |

## Verification limits

The receipt above proves the GitHub deployment target, candidate image pulls,
database authentication, migration ordering, schema audit, and backend
readiness for that run. It does not yet prove public `/api/version` identity,
frontend/Growth/Caddy/TLS read-back, worker canary behavior, media restore,
Qdrant recovery, Redis recovery, or a live rollback. The platform audit tracks
those as `NOT_VERIFIED`; the next deployment uses a fail-closed backend
`/api/version.gitSha` check before reporting success.

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
