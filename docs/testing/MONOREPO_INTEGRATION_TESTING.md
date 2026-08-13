# Monorepo integration test contract

The backend integration gate is the Meta-shaped E2E suite. It uses a
disposable PostgreSQL database and Redis instance, runs migrations and the real
webhook → queue → worker → retrieval → grounding path, and captures only the
external LLM and Graph API transports. It does not use production credentials
or a production database.

## Fresh clone

Use Node 20 and install from the committed root lockfile:

```bash
git clone https://github.com/mr3826/easymoderator-monorepo.git
cd easymoderator-monorepo
npm ci
```

Start disposable services with Docker or Podman. PostgreSQL must expose a
database named `easymod_e2e`; Redis must listen on `6379`:

```bash
docker run --rm --name easymod-e2e-postgres \
  -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=easymod_e2e \
  -p 5432:5432 postgres:16-alpine

docker run --rm --name easymod-e2e-redis -p 6379:6379 redis:7-alpine
```

In a second shell, run:

```bash
$env:DATABASE_URL='postgres://e2e:e2e@127.0.0.1:5432/easymod_e2e'
$env:REDIS_URL='redis://127.0.0.1:6379'
npm run test:backend:integration
```

The CI equivalent is the `meta-e2e` job in
`.github/workflows/ci-cd.yml`; it creates the same disposable PostgreSQL 16
and Redis 7 services and runs `npm ci` before the gate. Qdrant is deliberately
not required by this suite: vector retrieval is tested as a safe empty-tier
degradation, while keyword knowledge retrieval and persistence remain real.

## Boundaries

- This suite is a deterministic integration gate, not proof of live Meta
  credentials, external LLM delivery, or production persistence.
- The full default Jest suite remains a separate unit/security gate; tests that
  require a real database or long-running infrastructure must not be silently
  folded into it.
- Frontend browser E2E is not part of this backend contract and remains a
  separate, currently unverified launch gate.
