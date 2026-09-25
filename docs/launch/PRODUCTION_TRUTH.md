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
| Production commit SHA | Runtime is `bbc1024af831549436afb074ca5037925137d402`; current `origin/main` is `e5d6f973ae55ab497801d2c4e4f09c5690db5769` after workflow-only PRs #167 and #169. The Growth application image remains pinned to the already-built PR #166 image. | 2026-09-25 deployment [Actions run 36185036774](https://github.com/mr3826/easymoderator-monorepo/actions/runs/36185036774), public `/version`, and current `origin/main` |
| Latest migration on `main` | `20260925_001_growth_os_followup_cancel_event_type`; production reports 57 migrations and public `/version` reports this as the latest migration. | 2026-09-25 deployment and public `/version` |
| Backend / worker version | Backend and worker use the exact `bbc1024a` candidate image; public `/version` reports `bbc1024af831549436afb074ca5037925137d402`. | 2026-09-25 deployment receipt and public probe |
| Growth frontend build version | Growth SPA build-info reports `50b659bb4949afaec78a462818b3573d0f99e3e0`, the runtime-affecting PR #166 merge SHA. Workflow-only PRs #167 and #169 did not change Growth source, so the existing published Growth artifact was reused intentionally. | 2026-09-25 deployment, public `build-info.json`, and published digest |
| Growth image version | `ghcr.io/mr3826/easymoderator-growth-os@sha256:c54a14e4d426ed8908592093bf5147462ed8cd562fa5dc7f4d7dd2aefeb7f942`; deployment used explicit `growth_image_override`, recreated `easymod-growth-frontend-1`, and public `build-info.json` now reports `50b659bb`. | 2026-09-25 deployment run `36185036774` and public probe |
| Deployment workflow | Exact-SHA manual production deploy succeeded with the explicit Growth digest override. Candidate DB authentication, migrations, schema audit, service replacement, health, version, and rollback checks passed. `PRODUCTION_DEPLOY_ENABLED` was restored to `false`. | [Actions run 36185036774](https://github.com/mr3826/easymoderator-monorepo/actions/runs/36185036774) |
| Phase 1 security branch | `codex/phase1-security-compliance` is review-only: not merged and not deployed | 2026-07-23 |

## Verification limits

The latest receipt proves the GitHub deployment target, candidate image pulls,
database authentication, migration ordering, schema audit, backend version
identity, backend readiness, the explicit Growth image digest, and public
backend/frontend/Growth HTTP smoke responses. It does not prove a privileged
authenticated operator walkthrough, Sentry human-visible receipt, worker
canary behavior, media restore, Qdrant recovery, Redis recovery, or a live
production rollback. The deployment uses a fail-closed `/api/version.gitSha`
check before reporting success.

## 2026-09-25 owner discovery and work queues deployment receipt

- `MERGED_SHA`: `ccae4b97af3eeb4765c5e78911d74a817ff750a2` from PR #162.
- `DEPLOYMENT_RUN`: `36156435580` — exact-SHA `target=all` deployment completed
  successfully.
- `MIGRATION`: no schema changes; production remains at migration count 57 with
  latest `20260925_001_growth_os_followup_cancel_event_type`.
- `VERSION_PROBE`: HTTP 200; `gitSha` exactly matches `ccae4b97`.
- `BACKEND_READINESS`: HTTP 200; database and Redis report connected.
- `GROWTH_READINESS`: HTTP 200; Growth root returned HTTP 200.
- `AUTHORIZATION_BOUNDARY`: unauthenticated Growth session and prospect API
  requests returned HTTP 401.
- `DEPLOYMENT_GATE`: `PRODUCTION_DEPLOY_ENABLED=false` restored at
  2026-09-25T17:16:30Z.
- `UNVERIFIED`: authenticated Growth operator walkthrough, frontend/Growth
  image digest, Sentry receipt, and live rollback remain external or separate
  proof boundaries; no claim is made for them.

## 2026-09-25 Growth OS MVP-1 final engineering deployment receipt

- `IMPLEMENTATION_MERGE_SHA`: `50b659bb4949afaec78a462818b3573d0f99e3e0` from PR #166.
- `DEPLOY_CONTRACT_MERGE_SHA`: `bbc1024af831549436afb074ca5037925137d402` from PR #167;
  workflow-only change adding the explicit `growth_image_override` dispatch input.
- `BOOTSTRAP_WORKFLOW_FIX`: PR #169, merged as
  `e5d6f973ae55ab497801d2c4e4f09c5690db5769`; the audited role grant now
  executes inside the running backend container without requiring Compose image
  variables from `.env.prod`.
- `GROWTH_IMAGE`: `ghcr.io/mr3826/easymoderator-growth-os@sha256:c54a14e4d426ed8908592093bf5147462ed8cd562fa5dc7f4d7dd2aefeb7f942`.
- `DEPLOYMENT_RUN`: `36185036774` — exact-SHA `target=all` deployment completed
  successfully with `growth_image_override` set to the published digest.
- `MIGRATION`: no schema changes; production remains at migration count 57 with
  latest `20260925_001_growth_os_followup_cancel_event_type`.
- `VERSION_PROBE`: HTTP 200; backend `gitSha` exactly matches `bbc1024a`.
- `GROWTH_BUILD_PROBE`: HTTP 200; public `build-info.json` reports the intended
  runtime-affecting Growth SHA `50b659bb`.
- `BACKEND_READINESS`: HTTP 200; database and Redis overall readiness report
  connected. Optional/lazy Redis subclient flags remain mixed and are not
  treated as a required-readiness failure.
- `GROWTH_READINESS`: HTTP 200 with `app=growth-os`; Growth root returned HTTP 200.
- `AUTHORIZATION_BOUNDARY`: unauthenticated Growth session requests returned
  HTTP 401.
- `DEPLOYMENT_GATE`: `PRODUCTION_DEPLOY_ENABLED=false` restored at
  2026-09-25T20:34:24Z.
- `ROLLBACK_STATUS`: `MECHANISM_VERIFIED`; deployment workflow completed its
  protected rollback checks, but no live production rollback was executed.
- `AUTHENTICATED_PRODUCTION`: `BLOCKED_EXTERNAL_CREDENTIAL`; no operator
  identity, MFA proof, or `GROWTH_BOOTSTRAP_ACTOR_EMAIL` was available.
- `SENTRY`: `BLOCKED_EXTERNAL_CREDENTIAL`; DSN provisioning and human-visible
  event receipt remain unavailable.
- `BOOTSTRAP_PROOF`: the corrected audited workflow reached the production role
  service. `info@easymod.tech` was rejected because it has an active merchant
  membership; `founder@easymod.tech` and `growth@easymod.tech` were not found.
  No role grant or manual data mutation was performed. A real existing shop-less
  target identity is still required.

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
