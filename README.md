# EasyModerator

EasyModerator is a production-focused Messenger sales and order automation platform for Bangladeshi f-commerce sellers. The current launch scope is intentionally narrow: merchants connect Facebook Pages and use EasyModerator for Messenger DM handling, draft and automatic replies, product-grounded order capture, manual inbox work, COD/RTO risk support, and billing.

> Source of truth: `main` is the production branch. Keep short-lived feature/fix branches only while active, then merge or delete them. Do not keep stale local branches, remote branches, or stashes as parallel product history.

---

## Repository Layout

| Path | Purpose |
|---|---|
| `EasyMod-backend/` | Express API, worker, scheduler, Sequelize models/migrations, Meta webhook handling, AI/order services. |
| `EasyMod-frontend/` | React/Vite merchant dashboard, marketing pages, inbox, products, orders, first-time setup, and legal pages. |
| `GrowthOS/` | Independent React/Vite platform-operations frontend using the `/api/internal/growth-os/*` namespace. |
| `.github/workflows/` | Canonical CI/CD, GrowthOS publish, backup, administration, purge, and load-testing workflows. |
| `docker-compose.prod.yml` | Production service composition used on the DigitalOcean droplet. |
| `Caddyfile` | Production reverse proxy/static serving configuration. |
| `docs/` | Launch, App Review, operational, and audit documentation. |
| `package.json` | Root npm workspace orchestration; module package manifests remain authoritative for dependencies. |

---

## Production Scope

- Live channel: Facebook Page Messenger DMs.
- Out of current launch scope: Instagram, WhatsApp, Telegram as a customer/inbox channel, public comment automation, cold-DM automation, and broadcast campaigns.
- Merchant alert channels: browser push, in-app notification center, and one-way Telegram group alerts through the global EasyModerator bot.
- AI starts in Draft/Suggest mode for safer merchant review before auto-send is explicitly enabled.
- Messenger conversations outside Meta's 24-hour reply window are blocked until an approved compliant template path exists.
- Product/order flows must remain grounded in live product, shop, customer, and order data.
- Public pricing lives at `/pricing` and is the detailed Growth/Partner application page; the landing page pricing section stays the primary conversion surface.
- Business Info includes an optional owner-written "additional info" field. It is stored with the shop profile, used in reply context immediately, and included in the scheduled business-info search index.
- Payment and delivery defaults come from the live shop operating context; FAQs are optional shop-specific knowledge, not required starter setup.
- FAQ management lives under `Manage Shop -> FAQs` (`/manage-shop/faqs`). The retired `/knowledge` page redirects there for old bookmarks. FAQ create/update/delete operations sync the matching `faq-<id>` search record immediately so reply answers do not wait for the scheduled auto-index job. Low-confidence and unknown reply turns are captured as knowledge gaps for FAQ improvement.
- Courier providers supported in the merchant delivery settings are Pathao, Steadfast, and RedX; a provider must be connected and then activated before it is used for courier booking.
- Facebook Page reconnects use fresh Meta OAuth as the current ownership proof. Page discovery uses `/me/accounts` only and does not request `business_management`; the callback intersects those Pages with Meta `debug_token` granular permission target IDs so the app picker shows only Pages selected/authorized in Facebook. Stale legacy channel rows are released before a Page is connected to a new shop, while modern active claims from a different EasyModerator user remain blocked and webhooks route only to the active `CONNECTED` channel.

---

## First-Time Setup Dashboard

New shops receive the Growth trial automatically after signup; there is no self-service package picker before account creation. After signup, merchants land in Business Setup before seeing the normal dashboard.

The setup source of truth is `GET /api/setup/status`. The UI only uses localStorage for presentation state: whether the merchant has started the welcome screen and whether the final completion celebration was dismissed for that shop.

Required completion rules:

- At least one connected Facebook Page channel.
- Minimal shop profile: shop name, support contact, delivery info, and payment methods.
- At least one active product; three or more active products are recommended.
- Reply settings exist with an automation mode and confidence threshold. Draft mode remains the default and is recommended for first launch verification.
- AI auto-reply is derived from the business automation mode: Draft holds replies as merchant-visible suggestions, Manual disables AI generation, and Auto can send after policy and confidence gates pass. Per-Page channel toggles only opt a Page in or out of that business reply mode.

The checklist does not lock navigation. Merchants can use the sidebar and settings pages while setup is incomplete. When all required items pass, EasyModerator shows a one-time "Your shop is ready" completion screen before the normal dashboard. Set `VITE_ENABLE_FIRST_TIME_SETUP_DASHBOARD=false` only as an operational fallback.

---

## Local Development

Backend:

```sh
cd EasyMod-backend
npm install
npm test
npm run dev
```

Frontend:

```sh
cd EasyMod-frontend
npm install
npm run test:unit
npm run build
npm run dev
```

From the repository root, the workspace provides `npm run install:all`,
`npm run test:all`, and `npm run build:all`, plus module-specific test/build
commands. See [Monorepo Architecture](docs/infrastructure/MONOREPO_ARCHITECTURE.md)
for the boundary and rollback rules.

See [EasyMod-backend/README.md](EasyMod-backend/README.md) and [EasyMod-frontend/README.md](EasyMod-frontend/README.md) for module-specific setup, environment variables, testing, and architecture.

Launch-critical Meta deletion/deauthorization behavior, the authenticated/public
route inventory, webhook guarantees, external-media policy, required production
configuration, and rollback instructions live in
[docs/security/PHASE1_SECURITY_COMPLIANCE.md](docs/security/PHASE1_SECURITY_COMPLIANCE.md).

---

## Deployment

Production deploys are driven by pushes to `main` through `.github/workflows/ci-cd.yml`:

1. Detect backend/frontend changes.
2. Run the test/build gate.
3. Build and push GHCR images.
4. SSH to the DigitalOcean droplet.
5. Sync `/opt/easymod`, run Docker Compose, run migrations, and verify `/health/ready`.

The backend configuration preflight runs before traffic is served and before CI
replaces a production container. For Phase 1 changes, run the merge-blocking
security suite plus full backend and frontend verification:

```bash
cd EasyMod-backend
npm run test:security
npm test -- --runInBand

cd ../EasyMod-frontend
npm run test:unit
npm run build
```

Manual production changes should not bypass this path unless there is an incident and the workaround is documented afterward.

The manual workflow input `wipe_db_first=WIPE` is destructive and is reserved for confirmed production resets. It drops and recreates the runtime database named by production `DATABASE_URL`, flushes Redis queues/cache/session state, clears backend uploads, removes the active Qdrant vector-store volume, recreates services, bootstraps schema, seeds migration history, and verifies `/health/ready`.

The manual workflow input `seed_admin=SEED` creates or updates the production review account from `SEED_ADMIN_*` environment values. The seed grants `SUPER_ADMIN`, ensures an owner shop, resets the configured password, and keeps that shop on an active Growth subscription paid through the next 12 months. The password is supplied by GitHub Secrets, never committed.

Production has three canonical origins: `https://easymod.tech` for marketing/legal pages, `https://app.easymod.tech` for merchant authentication and product routes, and `https://api.easymod.tech` for API/webhook/upload traffic. Build the SPA with `VITE_API_BASE_URL=https://api.easymod.tech`, `VITE_APP_URL=https://app.easymod.tech`, and `VITE_MARKETING_URL=https://easymod.tech`. Keep `COOKIE_DOMAIN` unset so auth cookies remain API-host-only; `LEGACY_COOKIE_DOMAIN=easymod.tech` is a temporary cleanup control for cookies issued before the split. See [Domain and Route Architecture](docs/infrastructure/DOMAIN_AND_ROUTE_ARCHITECTURE.md).

### Telegram alert bot

Telegram is notification-only. It is not a customer inbox, AI reply surface, or second support channel.

Required production env names:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_WEBHOOK_SECRET`

Configure BotFather/setWebhook to deliver Telegram updates to `https://api.easymod.tech/webhooks/telegram` with the same `secret_token` value as `TELEGRAM_WEBHOOK_SECRET`. The API hostname is the public namespace; do not add `/api` to provider-facing production URLs. Do not commit token values.

Supported merchant alert events are new order, AI human-handoff, customer waiting too long, courier booking failure, payment/subscription issue, and daily sales summary.

---

## Working Agreement

- Keep the repo clean: no dead feature branches, stale stashes, abandoned generated assets, or obsolete specs in the active tree.
- README/docs updates are part of done when behavior, setup, deployment, or operational workflows change.
- Prefer small, reviewable commits by product slice: backend behavior, frontend UI, docs, and deployment changes should be separated when practical.
- Before deployment, run focused tests for touched modules plus the frontend build; rely on CI/CD for the final production gate.
