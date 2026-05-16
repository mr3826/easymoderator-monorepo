---
name: em-devops-skill
description: "EasyModerator DevOps skill. Use for Docker Compose, GitHub Actions CI/CD, DigitalOcean deployment, Redis/PostgreSQL/BullMQ in production, secrets management, health checks, monitoring dashboards, zero-downtime deployments."
---

# DevOps Skill — EasyModerator Infrastructure & Deployment

## ROLE
Senior DevOps Engineer for EasyModerator — Docker + DigitalOcean deployment, PostgreSQL + Redis + BullMQ in production.

## INFRA OVERVIEW

- **Hosting:** DigitalOcean Droplet (minimum 2vCPU / 4GB RAM)
- **Repos:** `EasyMod-backend` (Node.js/Express) + `EasyMod-frontend` (React/Vite)
- **Containerization:** Docker + Docker Compose
- **Services:** backend API, frontend (Nginx serve), PostgreSQL 15, Redis 7, BullMQ worker

---

## DOCKER COMPOSE STRUCTURE

```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: easymod
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build: ./EasyMod-backend
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    env_file: .env
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  worker:
    build: ./EasyMod-backend
    command: node src/jobs/message-worker.js
    environment:
      RUN_WORKER: "true"
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
    env_file: .env
    restart: unless-stopped

  frontend:
    build: ./EasyMod-frontend
    ports:
      - "80:80"
      - "443:443"
    depends_on:
      - backend

volumes:
  postgres_data:
  redis_data:
```

---

## REQUIRED ENVIRONMENT VARIABLES

Complete checklist — all must be set before deployment:

### Database
- `DATABASE_URL` — `postgresql://user:pass@postgres:5432/easymod`
- `DB_USER` / `DB_PASSWORD` / `DB_NAME`

### Redis
- `REDIS_URL` — `redis://redis:6379`

### Auth
- `JWT_SECRET` — 64+ character random string
- `JWT_EXPIRES_IN` — `7d`
- `TOTP_SECRET` — for 2FA

### Meta / Facebook
- `META_APP_ID`
- `META_APP_SECRET` — for webhook HMAC-SHA256 verification
- `META_WEBHOOK_VERIFY_TOKEN`

### AI / LLM
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`

### Vector DB (one of:)
- `PINECONE_API_KEY` + `PINECONE_ENV` + `PINECONE_INDEX`
- OR `QDRANT_URL` + `QDRANT_API_KEY`

### BKash
- `BKASH_APP_KEY`
- `BKASH_APP_SECRET`
- `BKASH_WEBHOOK_SECRET` — for webhook HMAC verification
- `BKASH_SANDBOX` — `true` / `false`

### Email
- `RESEND_API_KEY`
- `EMAIL_FROM`

### Delivery Providers (per shop — stored in DB, but default fallback keys):
- `PATHAO_CLIENT_ID` + `PATHAO_CLIENT_SECRET`
- `STEADFAST_API_KEY` + `STEADFAST_SECRET_KEY`
- `REDX_API_KEY`

### Encryption
- `CHANNEL_ENCRYPTION_KEY` — 32 bytes hex, for encrypting channel access tokens at rest

### Alerts
- `SLACK_WEBHOOK_URL` — for `ops-alert.service.js` circuit breaker + error alerts

### Frontend
- `VITE_API_BASE_URL` — backend API URL
- `VITE_SENTRY_DSN` — Sentry error tracking

---

## GITHUB ACTIONS CI/CD

### Backend CI (`backend-ci.yml`):
```yaml
name: Backend CI/CD
on:
  push:
    branches: [main]
    paths: ['EasyMod-backend/**']
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
      redis:
        image: redis:7-alpine
        options: --health-cmd "redis-cli ping"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '18' }
      - run: cd EasyMod-backend && npm ci
      - run: cd EasyMod-backend && npm test -- --coverage
      - run: cd EasyMod-backend && npm run lint

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to DigitalOcean
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DO_HOST }}
          username: ${{ secrets.DO_USER }}
          key: ${{ secrets.DO_SSH_KEY }}
          script: |
            cd /app
            git pull origin main
            docker-compose -f docker-compose.prod.yml up -d --build backend worker
            docker-compose -f docker-compose.prod.yml exec backend npm run db:migrate
```

### Frontend CI (`frontend-ci.yml`):
```yaml
name: Frontend CI/CD
on:
  push:
    branches: [main]
    paths: ['EasyMod-frontend/**']
jobs:
  build-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '18' }
      - run: cd EasyMod-frontend && npm ci
      - run: cd EasyMod-frontend && npm run lint
      - run: cd EasyMod-frontend && npm run build
      - run: cd EasyMod-frontend && npx vitest run
      - name: Deploy frontend
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DO_HOST }}
          username: ${{ secrets.DO_USER }}
          key: ${{ secrets.DO_SSH_KEY }}
          script: |
            cd /app
            git pull origin main
            docker-compose -f docker-compose.prod.yml up -d --build frontend
```

---

## HEALTH CHECKS

### `/health` endpoint requirements:
```js
// Must check: DB connection, Redis connection, BullMQ worker state
router.get('/health', async (req, res) => {
  const checks = {
    postgres: false,
    redis: false,
    llm_circuit: null
  }
  try {
    await sequelize.authenticate()
    checks.postgres = true
  } catch {}
  try {
    await cacheRedis.ping()
    checks.redis = true
  } catch {}
  checks.llm_circuit = await cacheRedis.get('llm_circuit_status') || 'closed'

  const healthy = checks.postgres && checks.redis
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks })
})
```

---

## SECRETS MANAGEMENT

- All secrets in `.env` file on server — never committed to git
- `.env.example` committed with placeholder values (never real values)
- Secret rotation procedure:
  1. Update `.env` on server
  2. Rolling restart: `docker-compose up -d --no-deps backend worker`
  3. Verify `/health` returns 200
  4. Update `CHANNEL_ENCRYPTION_KEY` requires re-encrypting all channel tokens (migration job)

---

## MONITORING

### Circuit breaker alert (`ops-alert.service.js`):
Fires Slack webhook when:
- LLM circuit breaker opens (3 consecutive failures)
- SSE `llm_outage` event triggered
- BullMQ job failure rate exceeds threshold

### Logs:
- All structured logs via `createLogger('ModuleName')` → stdout → log aggregator
- Log levels: `error` (always alert), `warn` (monitor), `info` (standard), `debug` (dev only)

### BullMQ monitoring:
- Bull Board dashboard at `/admin/queues` (admin-only route)
- Monitor: job failure rate, queue depth per group, processing latency

---

## ZERO-DOWNTIME DEPLOYMENT

```bash
# Backend deploy (no downtime via rolling restart):
docker-compose -f docker-compose.prod.yml up -d --no-deps --build backend
# Worker restart (brief queue pause acceptable):
docker-compose -f docker-compose.prod.yml up -d --no-deps --build worker
# DB migrations before backend restart:
docker-compose exec backend npm run db:migrate
```

---

## ALWAYS

- Run `db:migrate` before deploying new backend version
- Verify `/health` after every deployment
- Keep `.env.example` up to date with all required variables
- Test Docker build locally before pushing to main
- Use `--no-deps` flag when restarting only one service

## NEVER

- Commit `.env` or any real credentials to git
- Deploy directly from main without CI passing
- Skip DB migrations when schema changes are included
- Restart postgres or redis without verifying backup exists
