# Easy Moderator

Easy Moderator is a production-focused AI inbox and order assistant for Bangladeshi f-commerce sellers. The current launch scope is intentionally narrow: merchants connect Facebook Pages and use Easy Moderator for Messenger DM handling, AI-assisted replies, product-grounded order capture, manual inbox work, COD/RTO risk support, and billing.

> Source of truth: `main` is the production branch. Keep short-lived feature/fix branches only while active, then merge or delete them. Do not keep stale local branches, remote branches, or stashes as parallel product history.

---

## Repository Layout

| Path | Purpose |
|---|---|
| `EasyMod-backend/` | Express API, worker, scheduler, Sequelize models/migrations, Meta webhook handling, AI/order services. |
| `EasyMod-frontend/` | React/Vite merchant dashboard, marketing pages, inbox, products, orders, onboarding, and legal pages. |
| `.github/workflows/ci-cd.yml` | Canonical CI/CD pipeline for test, image build, GitHub Container Registry push, and production deploy. |
| `docker-compose.prod.yml` | Production service composition used on the DigitalOcean droplet. |
| `Caddyfile` | Production reverse proxy/static serving configuration. |
| `docs/` | Launch, App Review, operational, and audit documentation. |

---

## Production Scope

- Live channel: Facebook Page Messenger DMs.
- Out of current launch scope: Instagram, WhatsApp, Telegram as a customer/inbox channel, public comment automation, cold-DM automation, and broadcast campaigns.
- Merchant alert channels: browser push, in-app notification center, and one-way Telegram group alerts through the global EasyModerator bot.
- AI starts in Draft/Suggest mode for safer merchant review before auto-send is explicitly enabled.
- Messenger conversations outside Meta's 24-hour reply window are blocked until an approved compliant template path exists.
- Product/order flows must remain grounded in live product, shop, customer, and order data.
- Courier providers supported in the merchant delivery settings are Pathao, Steadfast, and RedX; a provider must be connected and then activated before it is used for courier booking.

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

See [EasyMod-backend/README.md](EasyMod-backend/README.md) and [EasyMod-frontend/README.md](EasyMod-frontend/README.md) for module-specific setup, environment variables, testing, and architecture.

---

## Deployment

Production deploys are driven by pushes to `main` through `.github/workflows/ci-cd.yml`:

1. Detect backend/frontend changes.
2. Run the test/build gate.
3. Build and push GHCR images.
4. SSH to the DigitalOcean droplet.
5. Sync `/opt/easymod`, run Docker Compose, run migrations, and verify `/health/ready`.

Manual production changes should not bypass this path unless there is an incident and the workaround is documented afterward.

### Telegram alert bot

Telegram is notification-only. It is not a customer inbox, AI reply surface, or second support channel.

Required production env names:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_USERNAME`
- `TELEGRAM_WEBHOOK_SECRET`

Configure BotFather/setWebhook to deliver Telegram updates to `https://<api-domain>/api/webhooks/telegram` with the same `secret_token` value as `TELEGRAM_WEBHOOK_SECRET`. Do not commit token values.

Supported merchant alert events are new order, AI human-handoff, customer waiting too long, courier booking failure, payment/subscription issue, and daily sales summary.

---

## Working Agreement

- Keep the repo clean: no dead feature branches, stale stashes, abandoned generated assets, or obsolete specs in the active tree.
- README/docs updates are part of done when behavior, setup, deployment, or operational workflows change.
- Prefer small, reviewable commits by product slice: backend behavior, frontend UI, docs, and deployment changes should be separated when practical.
- Before deployment, run focused tests for touched modules plus the frontend build; rely on CI/CD for the final production gate.
