# Easy Moderator — Backend

AI customer-service and order-automation API for Bangladeshi f-commerce sellers. Merchants connect their **Facebook Page** and **Instagram** account; Easy Moderator answers inbound DMs and comments with a Bengali/Banglish-capable AI agent, captures orders from conversations, routes them to couriers, and bills the merchant on a simple monthly plan.

> **Channels:** Facebook Messenger + Instagram Direct only. WhatsApp, Telegram and other providers were removed from the product. The `telegram`/`webchat`/`manual` values that still appear in some enums and validators are legacy taxonomy retained for stored historical conversations — they are **not** connectable channels.

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Module / Route Map](#module--route-map)
- [AI & RAG Pipeline](#ai--rag-pipeline)
- [Meta Integration & Compliance](#meta-integration--compliance)
- [Billing Model](#billing-model)
- [Background Jobs](#background-jobs)
- [Database](#database)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Testing](#testing)
- [Deployment](#deployment)
- [Operational Endpoints](#operational-endpoints)
- [Project Conventions](#project-conventions)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 (alpine in prod) |
| Web framework | Express 4 |
| ORM / DB | Sequelize 6 + PostgreSQL 15 (`pg`, `pg-hstore`) |
| Queue / cache | BullMQ 5 + Redis 7 (`ioredis`) |
| Vector store | Qdrant (`@qdrant/qdrant-js`) — RAG retrieval |
| AI / LLM | Google Gemini (primary) + OpenAI (fallback) |
| Auth | JWT (`jsonwebtoken`) + `bcryptjs`, HttpOnly refresh cookies, CSRF (`csrf-csrf`) |
| Security | `helmet`, `cors`, `express-rate-limit` + `rate-limit-redis`, XSS sanitiser, HMAC webhook verification |
| Validation | `joi` + `express-validator` |
| Notifications | `web-push` + `firebase-admin` (FCM), `resend` (transactional email) |
| Docs / invoices | `pdfkit` |
| Observability | Sentry (`@sentry/node`, profiling), structured logger, ops/Slack alerts |
| Process mgmt | PM2 (`ecosystem.config.js`), Docker Compose |
| Tests | Jest 30 + Supertest, SQLite in-memory DB |

---

## Architecture

Easy Moderator is a **modular monolith**. One codebase and one Docker image run in three process roles in production:

```
                         Meta Graph API (FB / IG)
                                  │  webhooks (HMAC-signed)
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  Digital Ocean Droplet                                            │
│                                                                    │
│   ┌───────────┐     ┌────────────┐      ┌────────────┐            │
│   │   api     │     │   worker   │      │ scheduler  │            │
│   │ Express   │     │ BullMQ     │      │ cron       │            │
│   │ :3000     │     │ consumer   │      │ runner     │            │
│   └─────┬─────┘     └─────┬──────┘      └─────┬──────┘            │
│         │   (same image, different entrypoint)                    │
│         └─────────────────┼───────────────────┘                  │
│                           ▼                                       │
│   ┌────────────┐   ┌────────────┐   ┌────────────┐               │
│   │ PostgreSQL │   │   Redis    │   │  Qdrant    │               │
│   │  :5432     │   │  :6379     │   │  :6333     │               │
│   └────────────┘   └────────────┘   └────────────┘               │
│                                                                    │
│   ┌────────────┐                                                  │
│   │  frontend  │  nginx-served React SPA (separate image)         │
│   └────────────┘                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Why a queue?** Inbound webhooks must return `200` to Meta within seconds. The API enqueues each event to BullMQ and returns immediately; the **worker** does the slow AI/LLM work. This decouples Meta's latency budget from our processing time and lets the worker scale independently.

### Entry points

| File | Role |
|---|---|
| `server.js` | Boots secrets → DB → Redis → migrations, then starts Express. Optionally starts an embedded worker in dev. |
| `src/app.js` | Express app factory: middleware stack + route mounting. |
| `src/modules/routes.js` | Central router registry — mounts every domain router under `/api/*`. |
| `src/jobs/worker.js` | Standalone BullMQ worker (separate prod container). |
| `src/jobs/job-runner.js` | Cron scheduler for recurring jobs. |
| `src/jobs/queue-manager.js` | Registers repeatable BullMQ jobs. |

### Source layout

```
src/
├── app.js                  # Express app factory
├── config/                 # config.js (env), secrets-loader, redis, sentry
├── constants/
├── database/
│   ├── migrate.js          # Sequelize migration runner
│   ├── migrations/         # YYYYMMDD_NNN_*.js  (+ archive/ for superseded ones)
│   └── seed*.js
├── jobs/                   # BullMQ workers + cron jobs (see Background Jobs)
├── middleware/             # auth, csrf, rate-limit, shop-access, validation, …
├── modules/                # Domain modules (see Module / Route Map)
│   ├── routes.js           # central router registry
│   └── entities.js         # Sequelize model registry
├── routes/                 # health.routes.js (liveness / readiness / SSE)
├── scripts/                # one-off ops scripts (seed-admin, reindex-qdrant, …)
├── uploads/                # local upload scratch dir
└── utils/                  # sequelize setup, redis-client, structured-logger, …
```

Each domain module is self-contained: `*.routes.js` → `*.controller.js` → `*.service.js`, with `*.entity.js` (Sequelize model), `*.validator.js` (Joi), and `__tests__/`.

---

## Module / Route Map

All routers mount under `/api`. Source of truth: `src/modules/routes.js`.

| Mount | Module | Responsibility |
|---|---|---|
| `/auth` | `auth` | Signup (atomically creates one shop), signin, refresh, logout, 2FA, password reset |
| `/shop` | `shop` | Shop profile, business info, `GET /shop/context` (plan + usage), platform-priority ordering |
| `/shop/delivery` | `delivery` | Courier zones & mapping (Pathao, Steadfast, RedX, PaperFly, …) |
| `/channels/meta` | `channel-providers` | Meta OAuth (Business Login), connect/disconnect FB & IG, per-channel health, token refresh |
| `/conversation` | `conversation` | Unified inbox: list, filter, assign, handoff, resolve |
| `/ai-chatbot` | `conversation` | Manual agent send, AI draft/suggest endpoints |
| `/customer` | `customer` | Customer records across channels |
| `/order`, `/order-session` | `order` | Order lifecycle + in-conversation order capture |
| `/product`, `/category` | `product`, `category` | Catalog (indexed into RAG) |
| `/knowledge` | `knowledge` | Merchant FAQ/policy docs → vector index |
| `/rag`, `/delivery/rag` | `rag`, `delivery` | Retrieval-augmented context for replies |
| `/payment`, `/payment/bangladesh`, `/payment-methods` | `payment` | bKash tokenized checkout + payment config |
| `/subscription` | `subscription` | Plan, usage, top-ups, invoices |
| `/partner`, `/admin/partner` | `subscription` | Partner-plan application + admin approval |
| `/dashboard`, `/analytics` | `dashboard`, `analytics` | KPIs, GMV, resolution rate, growth metrics |
| `/notifications` | `notification` | Web-push subscriptions + delivery |
| `/audit` | `audit` | Audit log of sensitive actions |
| `/rto-shield` | `rto-shield` | Return-to-origin / fake-order risk scoring |
| `/comment-to-dm` | `commentToDm` | Comment-keyword → DM automation state machine |
| `/templates` | `template` | Canned response templates |
| `/language`, `/voice`, `/sentiment` | `language`, `ai` | Banglish handling, voice-note transcription, sentiment |
| `/admin/failed-jobs` | `admin` | Inspect & retry dead-lettered BullMQ jobs |
| `/public` | `public` | Unauthenticated marketing stats |
| `/webhooks/meta` | `integration` | Inbound Meta webhooks (mounted in `app.js`, outside `/api`) |

---

## AI & RAG Pipeline

Inbound message → reply, end to end:

1. **Webhook in** — `POST /webhooks/meta` verifies the `x-hub-signature-256` HMAC, then enqueues the event to the `message-queue` (returns `200` immediately).
2. **Burst coalescing** — `burst-coalescer.js` waits for a short window (`AI_BURST_WINDOW_MS`, default 8s) so a customer who splits one thought across several quick messages (or a photo + a caption) gets **one** combined reply, not many.
3. **Worker** — `message-worker.js` resolves conversation state, enforces policy guards, and builds context.
4. **Intent routing** — `intent-router.service.js` classifies the message (order, payment, support, …) and decides whether to retrieve product/FAQ context.
5. **RAG** — `rag.service.js` embeds the query and queries **Qdrant** (per-tenant collection) for the top-K product/knowledge chunks; live prices are read from Postgres so the model never quotes a stale price.
6. **LLM failover chain** (`llm.service.js`):
   1. `gemini-3.1-flash-lite` — primary (fast, cheap)
   2. `gemini-3.1-pro-preview` — fallback / high-stakes
   3. `gpt-4.1-mini` — final fallback
   A circuit breaker (`circuit-breaker.service.js`) trips a provider after repeated failures.
7. **Safety** — prompt sanitiser, guardrail service, hallucination/quality gate, and a confidence threshold decide auto-send vs. human handoff.
8. **Attribution** — AI replies carry a configurable marker (default ` 🤖`) so customers know the message was automated (**Meta Platform Policy 4.2**). Toggle with `AI_BOT_ATTRIBUTION_ENABLED`.
9. **Send** — the reply goes back via the Meta Graph API on the originating page/IG account.

**Embeddings:** controlled by `EMBEDDING_PROVIDER`. Use `openai` or an `http`/TEI server in production. The `local` n-gram fallback is **dev-only** — it produces near-random retrieval and is surfaced as `embedding.semantic = false` on `GET /health/detailed`.

---

## Meta Integration & Compliance

This product is built for **Meta App Review**. Relevant code and guarantees:

- **OAuth (Business Login):** `channel-providers/meta-channel.*` — short-lived state stored in Redis for multi-instance safety; per-page/IG access tokens stored **AES-256 encrypted** at rest (`CHANNEL_ENCRYPTION_KEY`).
- **Webhook verification:** `integration/meta-webhook.routes.js` — `GET` challenge with a constant-time verify-token compare; `POST` rejected unless the HMAC-SHA256 signature matches `META_APP_SECRET` (timing-safe).
- **Data Deletion Callback:** `integration/meta-webhook-gdpr.handler.js` — validates Meta's `signed_request`, hard-deletes all records for the affected user (idempotent), returns the confirmation code. Mounted at `POST /webhooks/meta/data-deletion`.
- **Deauthorize callback:** same handler — disconnects the channel when a user removes the app.
- **Consent + policy engine:** `consent/` records inbound consent; the policy engine blocks cold outreach, honours opt-outs, enforces the 24-hour messaging window, and rate-limits outbound DMs per page.
- **Reviewer docs:** see `../.easymod/meta-app-review/` (permission justifications, compliance checklist, data-deletion flow, screencast storyboards, test-user credentials).

Requested permissions: `pages_messaging`, `pages_read_engagement`, `pages_manage_engagement`, `instagram_basic`, `instagram_manage_messages`. Each is justified in `permissions-justification.md`.

---

## Billing Model

Source of truth: `src/modules/subscription/subscription.plans.js`.

| Plan | Price | Limit | Notes |
|---|---|---|---|
| **Growth** | ৳999 / month (৳9,990 / year) | 300 AI conversations/mo + 50 grace buffer | Every feature included. Fronted by a **card-less 14-day trial** (a `trialing` status, not a separate plan). |
| **Partner** | ৳0 upfront | Unlimited conversations | Billed per **delivered order**, tiered: ≤500 → ৳15, ≤1,000 → ৳12, 1,000+ → ৳10. Apply → admin approves. |

**Top-up packs** (bKash): `TOPUP_100` ৳150, `TOPUP_250` ৳350, `TOPUP_500` ৳650, `TOPUP_1000` ৳1,200.

Conversation limits are enforced by `conversation-limit.middleware.js` across all connected channels. When the AI gate is off (inactive/expired subscription) auto-reply pauses but the inbox stays usable.

**Payments: bKash only.** No other gateway is wired. Adding one requires implementing its full tokenized-checkout + webhook-verification path.

---

## Background Jobs

`src/jobs/` — workers (BullMQ consumers) and cron jobs (registered by `job-runner.js` / `queue-manager.js`):

| File | Type | Purpose |
|---|---|---|
| `message-worker.js` | Worker | Process inbound messages through the AI pipeline |
| `burst-coalescer.js` | Helper | Debounce rapid message bursts into one reply |
| `comment-to-dm.worker.js` | Worker | Drive the comment-keyword → DM flow |
| `comment-to-dm-expiry.job.js` | Cron | Expire stale comment-to-DM sessions |
| `meta-token-refresh.job.js` | Cron | Re-auth Meta tokens nearing expiry |
| `trial-expiry.job.js` | Cron | End trials + send ending nudges |
| `monthly-usage-reset.js` | Cron | Reset conversation counters on the 1st |
| `conversation-usage-notifier.js` | Cron | Push notifications at usage thresholds |
| `daily-overage-calculator.js` | Cron | Compute Partner-plan per-order charges |
| `invoice-generator.js` | Cron | Generate subscription/partner invoices (PDF) |
| `failed-payment-reconciler.js` | Cron | Retry/flag failed bKash payments |
| `courier-reconciliation.job.js` | Cron | Reconcile courier delivery statuses |
| `pipeline-canary.job.js` | Cron | Synthetic auto-reply canary + DLQ watchdog → ops alert |
| `knowledge/auto-index.job.js` | Cron | Re-index product/knowledge embeddings |

---

## Database

PostgreSQL 15 via Sequelize. **Migrations are the source of truth** — never `db:sync` in production.

```sh
npm run migrate          # apply pending migrations
npm run migrate:down     # roll back the latest
npm run migrate:status   # show applied / pending
```

Migration files live in `src/database/migrations/` (`YYYYMMDD_NNN_description.js`); superseded ones are moved to `migrations/archive/`. Key tables include `users`, `shops`, `subscriptions`, `conversation_usage`, `topup_transactions`, `conversations`, `messages`, `orders`, `order_sessions`, `products`, `meta_channels`, `knowledge_documents`, `customers`, `audit_logs`.

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker (for Postgres, Redis, and optionally Qdrant)
- A Gemini API key and/or OpenAI API key for the AI pipeline

### Setup

```sh
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env        # then fill in secrets

# 3. Start Postgres + Redis (+ Qdrant)
npm run docker:up

# 4. Run migrations
npm run migrate

# 5. Seed an admin user
npm run seed:admin

# 6. Run the API (nodemon)
npm run dev

# 7. (Optional) run the worker in a second terminal
npm run start:worker
```

For a fully self-contained local run, set `START_EMBEDDED_WORKERS=true` to run the worker inline with the API.

---

## Environment Variables

Copy `.env.example` (the authoritative list) to `.env`. Highlights:

```env
# Core
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://user:pass@localhost:5432/easymod
REDIS_URL=redis://localhost:6379
CORS_ORIGINS=http://localhost:5173
FRONTEND_URL=http://localhost:5173

# Auth & crypto
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
SESSION_SECRET=...
PAYMENT_ENCRYPTION_KEY=...            # 32 bytes
CHANNEL_ENCRYPTION_KEY=...            # 64-hex (32 bytes) — encrypts Meta tokens at rest

# Meta (Facebook / Instagram)
META_APP_ID=...
META_APP_SECRET=...
META_OAUTH_REDIRECT_URI=http://localhost:5173/app/channels/oauth-callback
META_WEBHOOK_VERIFY_TOKEN=...         # App Dashboard webhook handshake
META_APP_SECRET=...                   # OAuth and HMAC signature secret from Meta App Settings

# AI / LLM
GEMINI_API_KEY=...
OPENAI_API_KEY=...
LLM_PROVIDER=gemini

# Vector DB (Qdrant) + embeddings
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
QDRANT_COLLECTION=knowledge_documents
QDRANT_PER_TENANT=true
EMBEDDING_PROVIDER=openai             # openai | http | local(dev-only)
QDRANT_VECTOR_SIZE=384

# Email, push, errors, ops
RESEND_API_KEY=...
EMAIL_FROM=Easy Moderator <no-reply@easymod.tech>
SENTRY_DSN=...
SLACK_ALERT_WEBHOOK_URL=...
ADMIN_EMAIL=hello@hexabyte.co

# AI behaviour
AI_BOT_ATTRIBUTION_ENABLED=true
AI_BURST_WINDOW_MS=8000
```

See `.env.example` for the full annotated set (Redis multi-DB allocation, canary tuning, embedding retry/backoff, etc.).

---

## Testing

```sh
npm test               # Jest with coverage (--forceExit --detectOpenHandles)
npm run test:watch     # watch mode
```

Tests live in `src/**/__tests__/` and `tests/`. Integration tests run against a **real SQLite in-memory database** (not mocked), so they exercise actual Sequelize queries.

> **Current state:** the full backend suite is green — **836 tests / 52 suites passing**.

> **Monorepo note:** `EasyMod-backend/` may contain a stale nested `.git`. Always run git from the repository root (`git -C <repo-root>`). When running Jest from the root, wrap it in a subshell: `(cd EasyMod-backend && npm test)`.

---

## Deployment

CI/CD via GitHub Actions (`.github/workflows/ci-cd.yml`):

1. **Detect changes** — only rebuild the package that changed.
2. **Test** — backend Jest suite against a Redis service container.
3. **Build & push** — Docker images to GHCR, tagged with the commit SHA + `:latest`.
4. **Deploy** — SSH into the droplet, pull images, `docker compose up -d`, run `npm run migrate`, health-check `/health/ready`.

The droplet runs `docker-compose.prod.yml` with the `api`, `worker`, `scheduler`, `frontend`, `postgres`, and `redis` services from a single backend image. The backend `Dockerfile` is multi-stage on Node 20 alpine. Process layout for non-Docker hosts is described in `ecosystem.config.js` (PM2).

**Required GitHub secrets:** droplet host/SSH key, `VITE_API_BASE_URL`, `VITE_META_APP_ID`, and the production `.env` values delivered to the droplet.

---

## Operational Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /health/live` | none | Liveness — always 200 if the process is up |
| `GET /health/ready` | none | Readiness — 200 when DB + Redis are reachable (CI gate) |
| `GET /health/detailed` | yes | Queue depths, infra topology, key presence, `embedding.semantic` |
| `GET /health/sse` | — | Server-Sent Events stream for live inbox updates |

---

## Project Conventions

- **One shop per user** — signup atomically creates exactly one shop; there is no shop-switch.
- **Migrations over sync** — production schema changes always go through `npm run migrate`.
- **bKash-only payments** — do not re-add other gateways without their full verification path.
- **RAG always on** — product/knowledge context is injected on every relevant reply; it is not a toggle.
- **Plan codes** — only `GROWTH` and `PARTNER` are canonical; legacy/unknown codes normalise to `GROWTH` (fail-safe to full AI rather than lock-out).
- **AI attribution is policy** — keep the bot marker on for Meta compliance unless you have a documented reason.
