# EasyModerator monorepo cutover runbook

This is the authoritative cutover contract for the monorepo deployment path.
It is intentionally separate from the historical Cloud Run runbook in
`EasyMod-backend/docs/deployment-runbook.md`.

## Safety gates

Production deployment remains disabled until every gate below is evidenced:

- Repository variable `PRODUCTION_DEPLOY_ENABLED=false` during preparation.
- Required production configuration is present: database, Redis, JWT/session/
  CSRF/HMAC, Meta, payment/channel encryption, email, and at least one alert
  sink. Secret values must never be committed or printed.
- Required deployment credentials are present under the canonical names
  `DEPLOY_HOST` and `DO_SSH_PRIVATE_KEY`. The SSH contract is `root@host` and
  `/opt/easymod`.
- Production environment reviewers and main-branch restrictions are verified;
  if the GitHub plan cannot provide them, the cutover remains blocked.
- A fresh database backup and a restore check are recorded before the first
  migration against the live database.
- `npm ci`, backend security/unit tests, backend integration tests, frontend
  unit/build checks, GrowthOS build, and the historical secret scan are green.

Telegram is disabled by default. It is an optional integration and may be
enabled only by setting the `TELEGRAM_ENABLED` repository variable and adding
all three Telegram secrets. bKash is likewise disabled unless explicitly
enabled and fully configured.

## Non-deploy dry run

The safe dry run must not use SSH and must not alter the live droplet:

```bash
npm ci
npm run test:backend:integration:docker  # disposable Postgres 16 + Redis 7; Docker required
npm run test:backend
npm run test:frontend
npm run test:growthos
docker compose --env-file .env.prod -f docker-compose.prod.yml config
```

The final compose command is valid only with a local, untracked `.env.prod` and
the immutable image references supplied by the deployment job:
`GHCR_IMAGE_BACKEND` and `GHCR_IMAGE_FRONTEND`. The deployment workflow itself
does not run when `PRODUCTION_DEPLOY_ENABLED` is false. It renders and validates
the environment before SSH only when the operator later enables the guarded
deployment path.

`scripts/render-production-env.js` writes Docker-native `KEY=value` lines and
rejects newline/NUL injection. The runtime decodes legacy JSON-quoted values
before production validation so an older `.env.prod` fails safely only when its
underlying value is actually invalid; malformed quoting remains rejected.

When Docker is unavailable, CI is the authoritative integration execution: the
`meta-e2e` job provisions the same disposable PostgreSQL 16 and Redis 7 services
and runs `npm run test:integration` at Node 20. The integration suite deliberately
does not start Qdrant; it verifies the documented safe-empty vector degradation.

## Image and migration rules

- Application services must use the candidate SHA image tag or a captured
  `RepoDigest`, never a mutable `latest` fallback.
- Qdrant is pinned by digest in both Compose files.
- The candidate backend image is config-validated before service replacement.
- Only additive, backward-compatible migrations may run during cutover. Do not
  run `migrate:down` against production as a rollback mechanism.
- The deploy job must capture the currently running backend/frontend digests
  before replacement and keep the backup available until the health gate is
  complete.

## Automatic rollback

The deploy script has an exit trap. If validation, migration, service startup,
or the `/health/ready` gate fails, it restores the captured image references
with `docker compose up -d` and leaves `PRODUCTION_DEPLOY_ENABLED` unchanged.
This is an application rollback only; a schema rollback requires a reviewed
forward fix or a database restore after confirming data-loss impact.

Manual recovery, if the workflow runner is unavailable:

```bash
cd /opt/easymod
export GHCR_IMAGE_BACKEND='REPLACE_WITH_CAPTURED_BACKEND_REPODIGEST'
export GHCR_IMAGE_FRONTEND='REPLACE_WITH_CAPTURED_FRONTEND_REPODIGEST'
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-build --remove-orphans
curl --fail https://api.easymod.tech/health/ready
curl --fail https://api.easymod.tech/health
```

The rollback rehearsal is non-production and must use a disposable Compose
project or a shell-level contract harness. It must prove that captured
`previous_backend_image` and `previous_frontend_image` values are restored by
the `docker compose ... up -d --no-build --remove-orphans` command, followed by
both health checks. It must not run `migrate:down`: application rollback can
restore images, while a schema change requires a reviewed forward migration or
an isolated database restore. The current production source and its tags remain
the operator's rollback inputs; this repository must not be required to boot in
order to execute that recovery.

The placeholders above are operator inputs, not credentials and must never be
replaced in committed documentation.
