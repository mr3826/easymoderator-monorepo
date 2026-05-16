# EasyMod Backend

Node.js/Express API server for Easy Moderator — an AI-powered f-commerce moderation platform for Bangladesh merchants. Handles automated customer conversations across Facebook, WhatsApp, Instagram, and other channels; subscription billing via BKash; order management; and RAG-based product knowledge.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Digital Ocean Droplet (2vCPU / 4GB)                           │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌─────────────┐  │
│  │ backend  │  │  worker  │  │ scheduler │  │  frontend   │  │
│  │ :3000    │  │ (BullMQ) │  │ (cron)    │  │   :8080     │  │
│  └────┬─────┘  └────┬─────┘  └─────┬─────┘  └─────────────┘  │
│       │              │              │                           │
│  ┌────▼──────────────▼──────────────▼──────┐                  │
│  │        Redis :6379 (BullMQ + sessions)   │                  │
│  └──────────────────────────────────────────┘                  │
│  ┌──────────────────────────────────────────┐                  │
│  │        PostgreSQL :5432                   │                  │
│  └──────────────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────────────┘
```

### Services (docker-compose.prod.yml)

| Service | Image | Role |
|---|---|---|
| `backend` | `ghcr.io/.../easymod-backend` | Express API on port 3000 |
| `worker` | same image | BullMQ message processor (`src/jobs/worker.js`) |
| `scheduler` | same image | Daily cron runner (`src/jobs/job-runner.js`) |
| `frontend` | `ghcr.io/.../easymod-frontend` | nginx serving React SPA on port 8080 |
| `postgres` | postgres:15-alpine | Primary database |
| `redis` | redis:7-alpine | BullMQ queue + rate-limit store |

### Entry Points

- **`server.js`** — bootstraps secrets, DB connection, Redis, migrations, then starts Express
- **`src/app.js`** — Express app: middleware stack (helmet, cors, csrf-csrf, morgan, rate-limit)
- **`src/modules/routes.js`** — mounts all domain routers under `/api/*`
- **`src/jobs/worker.js`** — standalone BullMQ worker (runs as separate container in prod)
- **`src/jobs/queue-manager.js`** — schedules recurring BullMQ jobs

### Module Layout

```
src/
├── app.js                      # Express app factory
├── config/
│   ├── config.js               # All env vars with defaults
│   └── secrets-loader.js       # DO secrets → process.env (no-op in dev)
├── database/
│   ├── migrate.js              # Sequelize-based migration runner
│   └── migrations/             # Timestamped migration files (YYYYMMDD_NNN_*.js)
├── jobs/                       # Background jobs (BullMQ + cron)
├── middleware/                 # Auth, rate-limit, conversation-limit, CSRF
├── modules/                    # Domain modules (see below)
│   ├── routes.js               # Central router registry
│   └── entities.js             # Sequelize model registry
├── scripts/                    # One-time admin scripts (seed-admin, etc.)
└── utils/
    ├── database/               # Sequelize setup, sync
    └── redis-client.js         # ioredis singleton
```

---

## Features

### Authentication (`/api/auth`)

JWT-based auth with short-lived access tokens (15m) and long-lived refresh tokens (30d) stored as HttpOnly cookies. Token version incremented on password change to invalidate all sessions.

- `POST /auth/signup` — register + create shop in one transaction
- `POST /auth/signin` — returns access token + sets refresh cookie
- `POST /auth/refresh` — rotates refresh token
- `POST /auth/logout` — clears cookies
- `GET  /auth/me` — current user + shop context

**One-shop-per-user rule:** signup atomically creates exactly one shop. There is no shop-switch.

---

### Shop (`/api/shop`)

Shop is the central entity. Every other resource (products, orders, conversations, channels) belongs to a shop.

- CRUD for shop settings (name, address, business info)
- `GET /shop/context` — returns shop + current subscription plan + conversation usage (used by frontend on every load)
- `POST /shop/platform-priority` — saves `payment_platform_priority` and `delivery_platform_priority` JSONB arrays (drag-to-reorder in UI)

---

### Channels (`/api/channel`)

Merchants connect communication channels. All channels are available on all plans — no channel limits.

Supported channels: **Facebook Page**, **WhatsApp Business**, **Instagram**, **Webchat**, **Telegram**.

- `POST /channel/connect/meta` — initiates Meta OAuth (Facebook/Instagram/WhatsApp)
- `GET  /channel` — list connected channels with status
- `DELETE /channel/:id` — disconnect channel
- WhatsApp connected via permanent WABA token (WABA ID + Phone Number ID) — no OAuth flow required

Token refresh check runs daily via scheduler (`src/jobs/token-refresh-check.job.js`).

---

### Conversations & AI Chatbot (`/api/conversation`, `/api/ai-chatbot`)

Core feature. Incoming messages from Meta webhooks → BullMQ queue → worker processes with AI.

**Flow:**
1. Meta Webhook → `POST /webhooks/meta` → push to BullMQ `message-queue`
2. Worker (`message-worker.js`) picks up job → `ConversationStateSandalone` resolves conversation state
3. `IntentRouter` classifies intent (ORDER_TAKING, PAYMENT_INQUIRY, SUPPORT, etc.)
4. `AutoApprove` service decides draft/auto-send
5. Response sent back via Meta Graph API

**Conversation state machine:** `new` → `active` → `handoff` → `resolved`

- `GET  /conversation` — paginated inbox with filters
- `POST /conversation/:id/handoff` — escalate to human agent
- `POST /conversation/:id/resolve` — close conversation
- `POST /ai-chatbot/send` — manual agent message
- Conversation limit middleware (`src/middleware/conversation-limit.middleware.js`) blocks new conversations when monthly quota is exceeded (with 50-conversation threshold buffer)

---

### Orders & Order Sessions (`/api/order`, `/api/order-session`)

Orders created from conversation context. An `OrderSession` tracks the in-progress order negotiation within a conversation.

- Order lifecycle: `pending` → `confirmed` → `processing` → `shipped` → `delivered` / `cancelled` / `returned`
- `POST /order` — create order (from agent or AI)
- `PATCH /order/:id/status` — update status
- `GET  /order` — list with filters (status, date range, customer)
- `GET  /order/stats` — aggregate stats for dashboard

**RTO Shield** (`/api/rto-shield`): ML-based return-to-origin prediction. Scores each order at creation; high-risk orders flagged in inbox.

---

### Products & Categories (`/api/product`, `/api/category`)

Standard catalog management. Products are indexed into the knowledge base for RAG.

- Full CRUD for products (name, price, variants, images, stock)
- Category hierarchy (category → subcategory)
- `POST /product/:id/sync-knowledge` — manually trigger RAG index for a product
- Auto-index job (`src/modules/knowledge/auto-index.job.js`) runs on schedule

---

### Subscription & Billing (`/api/subscription`)

**Plans:**

| Plan | Price | Conversation Limit |
|---|---|---|
| `PACKAGE_1` | 750 BDT/month | 500/month |
| `PACKAGE_2` | 1,950 BDT/month | 1,500/month |
| `PARTNER` | 0 BDT upfront | Unlimited — billed per delivered order |

**PARTNER billing tiers** (per delivered order/month):
- 1–500 orders: 15 BDT/order
- 501–1,000 orders: 12 BDT/order
- 1,001+: 10 BDT/order

**Top-up packs** (BKash only):

| Pack | Conversations | Price |
|---|---|---|
| TOPUP_100 | +100 | 150 BDT |
| TOPUP_250 | +250 | 350 BDT |
| TOPUP_500 | +500 | 650 BDT |
| TOPUP_1000 | +1,000 | 1,200 BDT |

- `POST /subscription/upgrade` — switch plan (BKash payment initiated)
- `POST /subscription/topup` — purchase conversation pack
- `GET  /subscription/usage` — current month conversation count + limit
- PDF invoices generated via pdfkit (`src/modules/subscription/invoice.service.js`)

---

### Payment (`/api/payment`, `/api/payment/bangladesh`)

**BKash only.** No other payment gateways. Do not add Nagad or Rocket without re-implementing the full webhook + verification layer.

Payment webhook: `POST /webhooks/bkash/callback` → verifies signature → updates subscription/topup record → triggers invoice generation.

---

### Knowledge Base & RAG (`/api/knowledge`, `/api/rag`)

Merchant product/policy documents stored as vector embeddings (Qdrant). Injected into AI context for all non-analytics queries.

- `POST /knowledge` — upload document (PDF, DOCX, text)
- `GET  /knowledge` — list documents
- `DELETE /knowledge/:id` — remove + un-index
- Auto-index job re-indexes all products nightly
- RAG retrieval via `src/modules/rag/rag.service.js` → Qdrant vector search → top-K chunks injected into LLM system prompt

---

### Analytics & Dashboard (`/api/analytics`, `/api/dashboard`)

- Conversation volume, resolution rate, AI accuracy by day/week/month
- Order stats (GMV, fulfillment rate, RTO rate)
- Customer lifetime value (CLV)
- Top products by order frequency
- Google Sheets sync job (`google-sheets-sync.job.js`) — exports daily order data

---

### Delivery (`/api/shop/delivery`)

Delivery zone configuration. Supports: Pathao, Steadfast, Redx, PaperFly, Sundarban, E-courier.

- `GET  /shop/delivery/zones` — list configured zones
- `POST /shop/delivery/zones` — add/update zone + courier mapping
- `platform_priority` JSONB array on shop determines preferred courier order

---

### Notifications (`/api/notifications`)

Web Push notifications (Firebase FCM) for:
- New conversation assigned
- Order status changes
- Conversation limit threshold warnings (75%, 90%, 100%)

`conversation-usage-notifier.js` job checks daily and sends push if threshold crossed.

---

### Admin (`/api/admin/users`, `/api/admin/failed-jobs`)

Internal admin endpoints (role: `admin`):
- User management (list, role assignment)
- Failed BullMQ job inspection and retry

---

### Background Jobs

| Job file | Trigger | Purpose |
|---|---|---|
| `message-worker.js` | BullMQ consumer | Process incoming messages via AI |
| `queue-manager.js` | Startup | Schedules all recurring BullMQ jobs |
| `invoice-generator.js` | Monthly | Generate subscription invoices |
| `monthly-usage-reset.js` | 1st of month | Reset conversation_usage counters |
| `conversation-usage-notifier.js` | Daily | Push notifications for quota warnings |
| `daily-overage-calculator.js` | Daily | Calculate PARTNER plan overages |
| `token-refresh-check.job.js` | Daily 08:00 UTC | Re-auth expiring Meta tokens |
| `courier-reconciliation.job.js` | Daily | Reconcile delivery statuses |
| `google-sheets-sync.job.js` | Daily | Export orders to Google Sheets |
| `failed-payment-reconciler.js` | Daily | Retry/flag failed BKash payments |

---

## Database

PostgreSQL 15. Sequelize ORM. Migrations in `src/database/migrations/` (filename: `YYYYMMDD_NNN_description.js`).

**Key tables:**

| Table | Purpose |
|---|---|
| `users` | Merchant accounts |
| `shops` | One shop per user |
| `subscriptions` | Active plan + BKash txn ref |
| `conversation_usage` | Monthly conversation count per shop |
| `topup_transactions` | Top-up pack purchases |
| `conversations` | All conversations across channels |
| `messages` | Individual messages (inbound + outbound) |
| `orders` | Placed orders |
| `order_sessions` | In-progress order negotiations |
| `products` | Product catalog |
| `channels` | Connected channel credentials |
| `knowledge_documents` | RAG document metadata |

Run migrations:
```sh
npm run migrate          # apply pending
npm run migrate:down     # rollback latest
npm run migrate:status   # show applied/pending
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in values. Key variables:

```env
# Server
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL=postgres://user:pass@localhost:5432/easymod

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=
JWT_REFRESH_SECRET=

# BKash
BKASH_APP_KEY=
BKASH_APP_SECRET=
BKASH_USERNAME=
BKASH_PASSWORD=
BKASH_BASE_URL=https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized

# Meta / Facebook
META_APP_ID=
META_APP_SECRET=
META_WEBHOOK_VERIFY_TOKEN=

# WhatsApp
WABA_ID=
WA_PHONE_NUMBER_ID=
WA_PERMANENT_TOKEN=

# AI
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# Vector DB (Qdrant)
QDRANT_URL=
QDRANT_API_KEY=

# Email
RESEND_API_KEY=

# Firebase (Push Notifications)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Sentry
SENTRY_DSN=

# Feature flags
RUN_MIGRATIONS_ON_STARTUP=true   # set false in prod (CI runs migrate step)
START_EMBEDDED_WORKERS=false     # set true only for single-process dev
```

---

## Local Development

```sh
# Install
npm install

# Start postgres + redis via Docker
npm run docker:up

# Run migrations
npm run migrate

# Seed admin user
npm run seed:admin

# Start dev server (nodemon)
npm run dev

# Start BullMQ worker (separate terminal)
npm run start:worker
```

---

## Testing

```sh
npm test               # Jest with coverage
npm run test:watch     # watch mode
```

Tests in `tests/` and `src/**/__tests__/`. Integration tests hit a real SQLite in-memory DB (not mocked).

---

## Deployment

### GitHub Actions (`.github/workflows/deploy.yml`)

Triggered on push to `main` or manual `workflow_dispatch` (with target: `all | backend | frontend`).

**Pipeline stages:**
1. **Detect changes** — `dorny/paths-filter` checks if `EasyMod-backend/` or `EasyMod-frontend/` changed
2. **Backend tests** — `npm test` against Redis service container
3. **Build & push** — Docker images built and pushed to `ghcr.io` tagged with commit SHA + `:latest`
4. **Deploy via SSH** — SSH into DO droplet → pull new images → `docker compose up -d` → `npm run migrate` → health check on `/health/ready`

**Required GitHub Secrets:**

| Secret | Description |
|---|---|
| `DO_HOST` | Droplet IP |
| `DO_SSH_PRIVATE_KEY` | SSH key with root access |
| `VITE_API_BASE_URL` | e.g. `https://api.easymod.tech` |
| `VITE_META_APP_ID` | Meta App ID |
| `VITE_SENTRY_DSN` | Sentry DSN (optional) |

### Droplet Setup

The droplet expects:
- `/opt/easymod/docker-compose.prod.yml` — production compose file (copy from repo)
- `/opt/easymod/.env.prod` — all production env vars

Images pull from `ghcr.io` on each deploy. The backend `Dockerfile` is multi-stage, Node 20 alpine.

### Health Checks

- `GET /health/ready` — 200 when DB + Redis connected (used by CI health check)
- `GET /health/live` — 200 always (container liveness probe)

---

## Key Design Decisions

- **BullMQ over in-process workers** — message processing decoupled from HTTP; worker container scales independently
- **One-shop-per-user** — enforced at signup; no shop-switch route or service exists
- **BKash-only payments** — Nagad and Rocket fully removed; do not re-add without implementing webhook verification
- **Conversation limits** — the only plan enforcement mechanism; all channels are accessible on every plan
- **Threshold buffer** — 50 extra conversations granted after plan limit, charged to next cycle
- **RAG on every AI response** — product context always injected into LLM; not a toggle
- **Migrations as source of truth** — never use `db:sync` in production; always run `migrate`
- **Plan codes** — use `PACKAGE_1`, `PACKAGE_2`, `PARTNER`; `STARTER`/`GROWTH` are rejected by the validator
