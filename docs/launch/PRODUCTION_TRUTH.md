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
| Production commit SHA | Runtime is `61f92dbc60b6dbde80357b143d47961ef65120e0`; current `origin/main` is `0eb614a1d3769d03f770b22829e2b8e996f2c0d0`, a documentation-only receipt commit created after deployment. Public `/api/version` and `/health/ready` report the deployed runtime SHA. | 2026-09-25 deployment [Actions run 36145507046](https://github.com/mr3826/easymoderator-monorepo/actions/runs/36145507046) and public probes |
| Latest migration on `main` | `20260925_001_growth_os_followup_cancel_event_type`; production reports 57 migrations and public `/version` reports this as the latest migration. | 2026-09-25 deployment and public `/version` |
| Backend / worker version | Exact merged SHA image and in-container version verified by deployment run `36145507046`; backend and worker use the deployed backend image. | 2026-09-25 deployment receipt |
| Frontend build version | Frontend was not changed by PR #159 and was not rebuilt by the backend-only deploy; public Growth origin returned HTTP 200. | 2026-09-25 public probe; prior immutable frontend receipt remains historical |
| Growth image version | Existing running Growth image was carried forward; `GROWTH_BOOTSTRAP_DIGEST` was empty, so the running Growth digest remains `NOT_VERIFIED`. Public Growth readiness returned HTTP 200. | 2026-09-23 deploy log and public smoke check |
| Deployment workflow | Exact-SHA manual production deploy succeeded after the configured `production` environment approval. Candidate migrations, schema audit, service replacement, health, and version checks passed. `PRODUCTION_DEPLOY_ENABLED` was restored to `false`. | [Actions run 36145507046](https://github.com/mr3826/easymoderator-monorepo/actions/runs/36145507046) |
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

## 2026-09-25 follow-up lifecycle deployment receipt

- `MERGED_SHA`: `61f92dbc60b6dbde80357b143d47961ef65120e0` from PR #159.
- `DEPLOYMENT_RUN`: `36145507046` — exact-SHA manual production deployment
  completed successfully after `production` environment approval.
- `MIGRATION`: `20260925_001_growth_os_followup_cancel_event_type` applied;
  public `/version` reports it as migration 57, the latest migration.
- `VERSION_PROBE`: HTTP 200; `gitSha` exactly matches `61f92dbc`.
- `BACKEND_READINESS`: HTTP 200; database and Redis readiness reported by the
  backend probe.
- `GROWTH_READINESS`: `https://growth.easymod.tech/health/ready` returned HTTP
  200 with `app=growth-os`; the Growth root returned HTTP 200.
- `AUTHORIZATION_BOUNDARY`: unauthenticated Growth session and prospect API
  requests returned HTTP 401.
- `DEPLOYMENT_GATE`: `PRODUCTION_DEPLOY_ENABLED=false` restored at
  2026-09-25T14:26:46Z.
- `UNVERIFIED`: authenticated Growth operator walkthrough, Growth image digest,
  Sentry receipt, and live rollback execution remain external/unavailable proof
  boundaries; no claim is made for them.
