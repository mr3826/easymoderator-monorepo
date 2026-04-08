# EasyMod Backend

Node.js/Express REST API for the EasyMod e-commerce moderation platform. Handles multi-tenant shop management, order processing, AI-assisted chat, payments, and Meta (WhatsApp/Facebook) integrations.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20, Express 4 |
| Database | PostgreSQL 15 (Sequelize ORM) |
| Cache / Sessions / Queues | Redis 7 (ioredis + Bull) |
| Vector DB | Pinecone (primary) / Qdrant (fallback) |
| Container | Docker + AWS ECR |
| Deployment | EC2 (`ubuntu@3.111.186.159`) via GitHub Actions |
| Secrets | AWS Secrets Manager (`easymod/production`, `ap-south-1`) |
| Process manager (local) | PM2 (`ecosystem.config.js`) |

---

## Local Development

### Prerequisites

- Node.js 20+
- Docker + Docker Compose

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env and fill in values
cp .env.example .env

# 3. Start infrastructure (Postgres + Redis)
docker compose up -d postgres redis

# 4. Run migrations
npm run migrate

# 5. Seed the admin user
npm run seed:admin

# 6. Start the dev server (hot reload)
npm run dev
```

The server listens on `http://localhost:3000` by default.

### Environment Variables

All variables are documented in `.env.example`. Required in every environment:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection URL |
| `JWT_ACCESS_SECRET` | ≥32 random bytes |
| `JWT_REFRESH_SECRET` | ≥32 random bytes |
| `JWT_RESET_SECRET` | ≥32 random bytes (password reset tokens) |
| `SESSION_SECRET` | ≥32 random bytes |
| `PAYMENT_ENCRYPTION_KEY` | Exactly 32 random bytes |
| `CORS_ORIGINS` | Comma-separated list of allowed origins |
| `FRONTEND_URL` | Frontend base URL |

**Production** secrets are stored in AWS Secrets Manager — see [Production Deployment](#production-deployment).

---

## Project Structure

```
src/
├── app.js                    Express app (middleware stack)
├── config/
│   ├── config.js             Env-validated config object
│   └── secrets-loader.js     AWS Secrets Manager fetch at startup
├── database/
│   └── migrations/           SQL migration files
├── jobs/
│   ├── queue-manager.js      Bull queue setup
│   └── worker.js             Background job processor
├── middleware/
│   ├── auth.middleware.js     JWT authentication
│   ├── shop-access.middleware.js  Shop membership + role check
│   ├── validate.middleware.js     Joi body validation
│   └── xss-sanitize.middleware.js XSS input scrubbing
├── modules/
│   ├── auth/                 Signup, signin, refresh, password reset
│   ├── shop/                 Multi-tenant shop management
│   ├── order/                Order lifecycle + RTO shield
│   ├── product/              Product catalog
│   ├── category/             Product categories
│   ├── customer/             Customer profiles
│   ├── payment/              bKash, Nagad, Rocket, COD
│   ├── subscription/         Usage tracking + billing
│   ├── conversation/         Chat threads
│   ├── channel/              WhatsApp / Facebook channels
│   ├── integration/          Meta webhook handler
│   ├── rag/                  Retrieval-augmented generation
│   ├── knowledge/            Vector knowledge base
│   ├── ai/                   AI service layer
│   ├── analytics/            Dashboard metrics
│   ├── delivery/             Pathao + Steadfast integrations
│   ├── audit/                Audit log
│   └── tenant/               Tenant management
├── routes/
│   └── health.routes.js      /health/live, /health/ready, /health/detailed
└── utils/
    ├── AppError.js            AppError class + global error handler
    ├── database/              Sequelize setup + sync
    ├── email.service.js       Nodemailer
    ├── jwt.util.js            Token generation / verification
    ├── password.util.js       bcrypt helpers
    └── redis-client.js        ioredis pool
```

---

## API

The OpenAPI spec is at [`openapi.yaml`](./openapi.yaml). Import into Postman or Swagger UI for interactive docs.

Base path: `/api`

Key endpoint groups:

| Prefix | Description |
|---|---|
| `/api/auth` | Authentication (signup, signin, refresh, logout, password reset) |
| `/api/shop` | Shop CRUD + switching |
| `/api/order` | Order management |
| `/api/product` | Product catalog |
| `/api/category` | Categories |
| `/api/customer` | Customer profiles |
| `/api/payment` | Payment gateway integrations |
| `/api/subscription` | Subscription and usage |
| `/api/conversation` | Conversation threads |
| `/api/channel` | Social channels |
| `/api/rag` | RAG queries |
| `/api/knowledge` | Knowledge base management |
| `/api/delivery` | Delivery provider integrations |
| `/api/analytics` | Dashboard metrics |
| `/api/audit` | Audit logs |
| `/webhooks/meta` | Meta (WhatsApp/Facebook) webhook |
| `/health` | Health probes (no auth) |

All authenticated routes require `Authorization: Bearer <access_token>` and `X-Shop-Id: <shop_uuid>`.

---

## Database Migrations

```bash
npm run migrate            # Apply all pending migrations
npm run migrate:down       # Revert last migration
npm run migrate:down:all   # Revert all migrations
npm run migrate:status     # List applied migrations
```

---

## Testing

```bash
npm test                   # Run tests with coverage
npm run test:watch         # Watch mode
```

Tests use in-memory mocks for Sequelize and Redis — no real DB connection required.

---

## Production Deployment

Deployments are fully automated via GitHub Actions (`.github/workflows/deploy.yml`).

**Flow:** push to `main` → run test suite → build Docker image → push to ECR → SSH to EC2 → run migrations → bring up backend + worker containers → post-deploy backend + worker health checks.

### First-time server setup

1. **AWS Secrets Manager** — secrets are stored at `easymod/production` in `ap-south-1`. Use `scripts/push-secrets-to-aws.js` to populate from a local `.env.production`:
   ```bash
   node scripts/push-secrets-to-aws.js
   ```

2. **EC2 IAM Role** — the instance must have the `easymod-ec2-secrets-reader` role attached (policy: `secretsmanager:GetSecretValue` on `easymod/production*`). The SDK uses instance metadata — no hardcoded AWS keys needed.

3. **GitHub Secrets** — set these in the repo's Settings → Secrets and variables → Actions:
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`
   - `EC2_SSH_KEY` (private key PEM content)
   - All application secrets (see `.env.example`), including `CHANNEL_ENCRYPTION_KEY`

### Manual deploy

```bash
# Build and push image
docker build -t easymod-backend .
docker tag easymod-backend <ecr-uri>/easymod-backend:latest
docker push <ecr-uri>/easymod-backend:latest

# On EC2
cd /home/ubuntu/easymod-backend
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

### Rollback (manual)

```bash
# On EC2: set previous known-good image tag in .env.prod
sed -i 's|^ECR_IMAGE=.*|ECR_IMAGE="<ecr-uri>/easymod-backend:<known-good-sha>"|' .env.prod

# Recreate app services with previous image
docker compose --env-file .env.prod -f docker-compose.prod.yml pull backend worker
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d backend worker

# Verify readiness
curl -fsS http://localhost:3000/health/ready
```

---

## Health Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health/live` | Liveness — is the process alive? |
| `GET /health/ready` | Readiness — DB + Redis connected? |
| `GET /health/detailed` | Full check: DB, Redis, Vector DB, queue depths |

Use `/health/ready` for load balancer health checks and uptime monitors (UptimeRobot, Betterstack, etc.).

---

## Background Jobs

The Bull queue worker runs separately from the API:

```bash
npm run start:worker       # Start queue worker process
```

Queue names: `dailyOverage`, `monthlyReset`, `invoiceGenerator`, `paymentReconciler`

In production, the worker runs as a separate Docker Compose service (`worker` in `docker-compose.prod.yml`).

---

## Security Notes

- JWT secrets, session secret, payment encryption key, and all API keys live exclusively in AWS Secrets Manager in production. Never commit `.env.*` files (pre-commit hook blocks this).
- The `shopId` used for tenant isolation is read exclusively from the verified JWT claim — never from request body or headers.
- Rate limiting is Redis-backed and shared across all instances.
- CSRF protection is enforced on all state-mutating routes except webhooks and auth.
