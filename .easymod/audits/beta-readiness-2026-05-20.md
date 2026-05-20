# Beta Readiness Audit — EasyModerator
**Date:** 2026-05-20
**Auditor:** EM-Orchestrator (Claude Sonnet 4.6)
**Scope:** Full codebase — backend `EasyMod-backend/`, frontend `EasyMod-frontend/`, infra, Meta policy
**Context loaded:**
- `.easymod/context/` — 4 files (business-flow, easymoderator-feature-map, ai-architecture, delivery-provider-notes)
- `.easymod/standards/` — coding-standards, tdd-rules, git-workflow, meta-safe-rules
- `.easymod/memory/` — execution-history, architecture-decisions, meta-policy-risks, failures, growth-insights
- `.easymod/skills/meta-policy-skill.md` — mandatory Meta compliance gate
- `claude-skills/` — no "motion" or "ux-ui-pro-max" skill found by exact name. Closest loaded: `claude-skills/product-team/ux-researcher-designer/` and `claude-skills/product-team/ui-design-system/`. Frontend section uses these + coding-standards principles.

---

## EXECUTIVE SUMMARY (< 300 words)

EasyModerator is in **strong structural shape** for beta. The Meta redesign (Phases 1–5.1) landed a proper policy engine, provider abstraction, opt-out enforcement, data deletion endpoint, and 24-hour window guard — things that would have been hard P0 blockers are now solved at the architecture level. Auth is fixed post-PR #5. The comment-to-DM state machine and consent audit trail exist.

**What stands between you and a safe beta launch:**

1. **P0 — Three future-dated migrations haven't run yet** (20260524, 20260527, 20260603, 20260610). The drop-legacy-tables migration in particular is dated June 10 — the DB still has `meta_integrations` and `channel_configs` tables if it was last synced pre-redesign. Run `migrate up` on staging now to confirm parity.

2. **P0 — Privacy Policy and meta-policy-skill still reference WhatsApp.** The platform dropped WhatsApp but the Privacy Policy page has 8+ WhatsApp mentions, the meta-policy-skill lists `whatsapp_business_messaging` as "Active", and subscription.plans.js still gates `whatsapp_channel: true`. This is a Meta App Review liability — the permission list must exactly match what you request.

3. **P0 — `InventorySyncLog` is imported in `inventory-sync-product.service.js` but is not exported from `entities.js`.** This will throw at runtime when any sync endpoint is hit.

4. **P1 — 14 backend modules have zero test coverage** (delivery, payment, reconciliation, rto-shield, invoice, analytics, among others). CI is `build → deploy` with no test gate — regressions ship silently.

5. **P1 — BD-Lite is a skeleton.** `BDSellerShell.tsx` is 30 lines, no `/bd-lite/inbox` or `/bd-lite/orders` pages exist as real components, `BDInbox` and `BDOrders` are missing from the route tree entirely.

6. **P2 — WhatsApp/Telegram references litter customer.entity.js, notification service, order creation flow** — channel ENUM still includes whatsapp, creating schema/validator drift.

Estimated P0 fix time: 4–6 hours. Proceed to beta after P0 + P1 are resolved.

---

## 1. Architecture & Module Map

### Backend Module Topology (Modular Monolith)

```
EasyMod-backend/
├── src/
│   ├── app.js                  Express app setup
│   ├── server.js               HTTP server + shutdown
│   ├── config/                 config.js, redis.js (multi-DB: 0=session,1=cache,2=rate,3=SSE)
│   ├── database/               migrate.js + 52 migrations
│   ├── jobs/                   BullMQ workers (message-worker, queue-manager, scheduled jobs)
│   ├── middleware/              auth, CSRF, rate-limit, session, conversation-limit
│   ├── utils/                  SSE bus, structured-logger, AppError, sse-manager, validators
│   └── modules/
│       ├── [Domain modules]    auth, shop, user, channel-providers, ...
│       ├── integration/        Meta webhook routes, inventory-sync, BKash webhook
│       ├── webhooks/           webhook.service.js shim (9 call sites)
│       ├── commentToDm/        Phase 4 state machine
│       ├── consent/            Phase 5 consent service
│       ├── policy/             Phase 3 policy engine + 8 rules
│       └── entities.js         Sequelize model barrel
├── services/
│   ├── banglish-bert/          Standalone BERT service
│   └── clip-similarity/        CLIP image similarity service
```

### Module Health Table

| Module | Purpose | Health | Notes |
|--------|---------|--------|-------|
| `auth` | JWT + 2FA + CSRF | GREEN | PR #5 fixed all 11 bugs |
| `channel-providers` | MetaChannel entity, Messenger/IG providers, consent events | GREEN | Phase 1–5 redesign complete |
| `commentToDm` | Comment-to-DM state machine | GREEN | Phase 4 — state machine, webhook handler present |
| `consent` | Per-channel consent tracking | GREEN | Used by policy engine and 24h window rule |
| `policy` | 8-rule outbound policy pipeline | GREEN | Persists decisions, hard-denies opt-out/24h violations |
| `webhook` (shim) | Send compatibility shim → providerRegistry | GREEN | Phase 5 updated — now routes through policy engine |
| `conversation` | Unified inbox, SSE, HITL | GREEN | Redis pub/sub bridge in Phase 4 |
| `order` | Order lifecycle | YELLOW | No `__tests__` dir; order-session-standalone.service.js is a duplicate? |
| `delivery` | Pathao/Steadfast/RedX providers | YELLOW | No `__tests__` dir; DeliveryTracking entity in orphan `entities/` subfolder |
| `payment` | BKash OAuth + webhooks | YELLOW | BKash still sandbox; unknown gateway now correctly 401s |
| `subscription` | Plan management, usage counting | YELLOW | plans.js still lists `whatsapp_channel: true`; partner PARTNER eligibility logic not tested |
| `integration` | Meta webhook router + inventory sync | YELLOW | `InventorySyncLog` not in entities barrel (runtime crash risk) |
| `reconciliation` | PARTNER billing, failed-payment retry | YELLOW | No `__tests__` dir |
| `notification` / `notifications` | SSE push, owner alerts | YELLOW | Duplicate modules: `notification/` and `notifications/` — different concerns but confusing |
| `ai` | Intent router, LLM, guardrail | GREEN | Circuit breaker, tier selection, fallback chain all present |
| `shop` | Tenant entity, BD settings | YELLOW | WhatsApp phone regex duplicates still remain |
| `admin` | User management, failed jobs | YELLOW | No `__tests__` dir |
| `analytics` | Usage tracking | YELLOW | No `__tests__` dir |
| `rto-shield` | Phone blacklist, auto-flag | YELLOW | No `__tests__` dir |
| `entities/` subfolder | DeliveryTracking, OwnerNotification, Invoice, PaymentTransaction | RED | These 4 entities are in a flat `entities/` folder — they're registered in `entities.js` but live outside any domain module. Architectural orphans. |

### Frontend Module Topology

```
EasyMod-frontend/src/
├── api/
│   ├── domains/         auth, product, order, customer, conversation, dashboard,
│   │                    knowledge, audit, subscription, shop, payment, meta-channels,
│   │                    comment-to-dm
│   ├── index.ts         apiClient object — canonical API surface
│   └── types/           TypeScript types (AuthResponse, MetaChannel, Order, etc.)
├── app/
│   ├── components/      All page-level components (~35 files)
│   │   └── bd-lite/     BDSellerShell (30 lines), TodayQueueDashboard, BottomNavBD
│   ├── lib/             auth.ts (authService), utils.ts
│   └── routes.ts        React Router v6 createBrowserRouter
├── features/            auth (AuthProvider, hooks), categories, channels, customers,
│                        dashboard, knowledge, products, reports, settings, shop,
│                        subscription, support, users
├── i18n/locales/        en.json (1313 lines), bn.json (1307 lines)
├── shared/              components/guards, lib/http (HttpClient), utils
└── styles/              global CSS
```

### State Management Pattern
- Auth state: `AuthProvider.tsx` context + `authService` singleton
- Server data: TanStack Query (per-domain hooks in `features/*/`)
- Real-time: SSE via `sse-client.ts` → `EventSource` with Last-Event-ID replay

### Cross-Cutting Concerns

| Concern | Implementation | Health |
|---------|---------------|--------|
| BullMQ queues | `queue-manager.js` + `message-worker.js` + `jobs/index.js` | GREEN |
| SSE multi-instance | `sse-bus.js` Redis pub/sub on DB 3 | GREEN (Phase 4) |
| Webhooks (Meta) | `meta-webhook.routes.js` — 881 lines, does too much | YELLOW — needs split |
| Webhooks (BKash) | `webhooks/webhook.middleware.js` + `payment-webhook.routes.js` | GREEN |
| Scheduled jobs | `ecosystem.config.js` + PM2 cron or BullMQ delayed | YELLOW — no CI validation |
| Env validation | `config.js` requireEnv() at startup for 7 critical vars | GREEN |
| Migrations | 52 sequential migrations; 4 future-dated (up to June 10) unrun | RED — see P0 below |
| Token encryption | `meta-token-cipher.js` AES-256-GCM v2 | GREEN |

---

## 2. Redundant / Dead Code to Delete

### SAFE TO DELETE (no verification needed)

| File/Path | Reason |
|-----------|--------|
| `EasyMod-backend/src/modules/services.js` | Empty barrel — `module.exports = {}` with just a comment. Never populated. |
| `EasyMod-backend/src/modules/integration/inventory-sync.service.js` | Superseded by `inventory-sync-product.service.js`; needs confirmation they don't co-exist on distinct code paths |
| `EasyMod-backend/src/jobs/google-sheets-sync.job.js` | Google Sheets sync is not a beta feature; no frontend UI; references `InventorySyncLog` (which is broken anyway) |
| `EasyMod-backend/src/modules/integration/inventory-sync.routes.js` + `inventory-sync-product.controller.js` + `inventory-sync-product.service.js` | Inventory sync (Shopify/WooCommerce/Google Sheets) is not BD f-commerce beta scope; route registered in routes.js at `/inventory-sync` — dead weight for beta |
| `EasyMod-backend/database.sqlite3` (root) | SQLite dev artifact committed to repo; useless for production PostgreSQL setup |
| `EasyMod-backend/src/modules/entities/` subfolder (4 entity files) | `delivery-tracking.entity.js`, `invoice.entity.js`, `owner-notification.entity.js`, `payment-transaction.entity.js` live outside any domain module in a flat `entities/` subfolder. They belong in `delivery/`, `subscription/`, `notification/`, and `payment/` respectively. Low immediate risk but confusing for new contributors. |
| `EasyMod-backend/.env.staging` | Near-empty staging env (4 lines). No staging infra currently. |
| `EasyMod-backend/cookies.txt` | Dev debugging artifact with auth cookies — never belongs in a repo. |
| Root-level `*.md` audit/strategy files | `CODE_REVIEW_MASTER_REPORT.md`, `MARKETING_STRATEGY_REVIEW.md`, `MARKETING_EXECUTIVE_SUMMARY.md`, `PHASE_1_IMPLEMENTATION_SUMMARY.md`, `REDUNDANCY_CONSOLIDATION_PLAN.md`, `90DAY_EXECUTION_PLAN.md` — operational docs that should live in a `docs/` folder or be deleted to reduce repo noise |

### NEEDS VERIFICATION BEFORE DELETING

| File/Path | Risk | Verification Needed |
|-----------|------|---------------------|
| `EasyMod-backend/src/modules/order/order-session-standalone.service.js` | Appears to be a standalone copy of `order-session.service.js` for offline testing — confirm nothing imports it in production path | `grep -r "order-session-standalone"` |
| `EasyMod-backend/src/modules/conversation/conversation-state-standalone.service.js` | Same pattern — standalone copy | `grep -r "conversation-state-standalone"` |
| `EasyMod-backend/n8n-workflows/` directory | n8n is no longer orchestrating the message pipeline (BullMQ replaced it). The workflows are archived docs at this point. | Confirm no active n8n instance reads these |
| `EasyMod-backend/src/modules/ai/voice-processing.service.js` + `.controller.js` + `.routes.js` | Voice processing was for WhatsApp voice notes. WhatsApp is removed. FB/IG do not send voice notes as transcribable binary via webhooks in the standard consumer API. Confirm whether any Phase 4+ flow ever calls this. | `grep -r "voice-processing" src/modules/integration/` |
| `EasyMod-backend/src/modules/notification/owner-notification.service.js` lines 65, 233–246 | Still references `whatsapp` as a notification channel. Confirm the WhatsApp send path is dead code before deleting those branches. | Read lines 60–250 |
| `EasyMod-frontend/src/api/types/conversation.ts` | Still has `channel: 'telegram' | 'messenger' | 'facebook' | 'instagram' | 'web'` — should telegram be removed? | Check if any frontend component renders telegram-specific UI |

### Migration Squash Opportunity

With no real users, this is the ideal moment to squash. Recommendation:

- **Squash all 52 migrations into a single `000_initial_schema.sql`** generated by `sequelize sync --force` on a clean DB with all models loaded. This eliminates ~3,000 lines of migration scaffolding and removes the complex ordering dependency chain.
- Retain only `20260520_001_create_meta_channels.js` and forward as the "post-squash" history (i.e., squash everything before the Meta redesign, keep the redesign migrations as they are the current active schema).
- The `20260610_001_drop_legacy_channel_tables.js` migration eliminates `meta_integrations` and `channel_configs` — after squash, these tables simply wouldn't exist in the initial schema at all.

**Effort:** M (3–4 hours). **Payoff:** Eliminates the "which migrations have run?" maintenance burden permanently.

---

## 3. Suggested Improvements (Prioritized)

### P0 — Beta Blockers

| # | Problem | Recommendation | Effort | Module(s) |
|---|---------|---------------|--------|-----------|
| P0-1 | `InventorySyncLog` imported in `inventory-sync-product.service.js` but not exported from `entities.js` — runtime crash | Either add `InventorySyncLog` entity to entities barrel **or** (preferred) delete the entire inventory-sync subsystem from beta scope | S | `integration/`, `entities.js` |
| P0-2 | 4 future-dated migrations (20260524, 20260527, 20260603, 20260610) not yet confirmed as run on staging/prod DB | Run `migrate status` on staging. If pending, run `migrate up`. Validate DB matches Sequelize models. | S | `database/` |
| P0-3 | Privacy Policy page has 8+ WhatsApp references; meta-policy-skill.md lists `whatsapp_business_messaging` as Active; `subscription.plans.js` has `whatsapp_channel: true`, `whatsapp_catalog_sync: true` | Remove all WhatsApp references from Privacy Policy; update meta-policy-skill permissions table; remove WhatsApp feature flags from plans.js (or gate them as `false`) | S | `PrivacyPolicy.tsx`, `subscription.plans.js`, `.easymod/skills/meta-policy-skill.md` |
| P0-4 | `customer.entity.js` ENUM still includes `'whatsapp'` and `'telegram'` in `source_channel`; `customer.validator.js` lists them as `VALID_CHANNELS`; `order-session.routes.js` validates `channel` against `['messenger','instagram','whatsapp']` | Remove whatsapp/telegram from customer ENUM and validator arrays; update order-session validator; add migration to remove those ENUM values (or squash) | M | `customer/`, `order/`, migration |
| P0-5 | `cookies.txt` committed to repo (contains dev auth cookies) | `git rm EasyMod-backend/cookies.txt` and add to `.gitignore` | S | repo hygiene |

### P1 — High-Value Pre-Meta-Review

| # | Problem | Recommendation | Effort | Module(s) |
|---|---------|---------------|--------|-----------|
| P1-1 | CI pipeline is `build → deploy` — no test gate. Auth tests, policy tests, webhook tests all exist but never run in CI | Add back a scoped test job to `.github/workflows/deploy.yml` running only the fast, non-DB tests: `policy/__tests__/`, `webhook/__tests__/`, `channel-providers/__tests__/`, `consent/__tests__/`. Use jest `--testPathPattern` flag. Avoid the full suite that needs DB. | M | `.github/workflows/` |
| P1-2 | 14 backend modules have zero test coverage including delivery, payment, rto-shield, reconciliation | For beta, focus on the 3 highest-risk untested modules: (a) `payment/` — BKash webhook handler; (b) `rto-shield/` — fraud detection; (c) `subscription/` — conversation limit enforcement. Write unit tests for the service layer mocking Sequelize. | L | `payment/`, `rto-shield/`, `subscription/` |
| P1-3 | BD-Lite mobile shell is a skeleton — no `/bd-lite/inbox` or `/bd-lite/orders` components. Route tree lists `BDInbox` and `BDOrders` in the feature map but they don't exist | Either build minimal BD-Lite inbox (conversation list + reply) and order list, or remove the `/bd-lite/*` routes entirely from beta scope. Half-baked mobile shell hurts trust more than no shell. | L | `bd-lite/`, `routes.ts` |
| P1-4 | `meta-webhook.routes.js` is 881 lines — a mega-route file handling webhook verification, page events, Instagram events, GDPR data deletion, deauthorize, and comment-to-DM extraction | Split into: `meta-webhook-verify.routes.js`, `meta-webhook-events.routes.js`, `meta-webhook-gdpr.routes.js`. Improves testability and reduces cognitive load for Meta App Review explanation. | M | `integration/` |
| P1-5 | 9+ inline BD phone regexes remain after partial consolidation (customer.validator 3×, order.validator, rto-shield.validator, shop.validator, partner-apply.routes, order-session.service, conversation-state-standalone.service) | Full consolidation to `src/utils/validators/phone.validator.js` which already exists from the May 16 fix — just need to update the remaining 9 call sites | S | Various |
| P1-6 | `notification/owner-notification.service.js` still has WhatsApp send path (lines 65, 233–246) with `type: 'whatsapp'` — dead code that could mislead or cause runtime errors if a WhatsApp channel lookup is attempted | Remove WhatsApp branch from `sendNotification()` method | S | `notification/` |
| P1-7 | Auth tests (`auth.test.js`, `auth.security.test.js`, `totp.service.test.js`) are in `jest.config.js` ignore list due to "ordering/isolation bugs" — post PR #5 these should be fixable | Investigate the isolation issue (likely missing `beforeEach` DB cleanup or shared state). 2FA flow is now implemented — it needs a test | M | `auth/__tests__/` |
| P1-8 | `saveUninitialized: true` in session middleware creates a Redis session entry for every anonymous CSRF init. High anonymous traffic = session bloat | Change to `saveUninitialized: false`; ensure CSRF endpoint generates and sends a token without requiring a session save (use `crypto.randomUUID()` in memory for stateless CSRF) | S | `middleware/session.middleware.js` |

### P2 — Post-Launch / Nice-to-Have

| # | Problem | Recommendation | Effort |
|---|---------|---------------|--------|
| P2-1 | Voice processing service is WhatsApp-origin code, no FB/IG trigger | Either repurpose for FB/IG image-to-text alt path or mark as future roadmap and remove from beta routes | M |
| P2-2 | `meta-policy-skill.md` has `whatsapp_business_messaging` as Active permission — needs to be removed before App Review submission | Update the permissions table; add `pages_manage_metadata` if webhook subscription requires it | S |
| P2-3 | `entities/` subfolder (4 orphan entities) — move to proper domain modules | Refactor + update imports | M |
| P2-4 | `notification/` vs `notifications/` dual module naming — two different things (owner alert service vs conversation limit push service) but naming is confusing | Rename `notifications/` to `conversation-limit/` or `usage-notification/` to make intent explicit | S |
| P2-5 | nginx.conf security headers are repeated 4× (one per location block). A future location addition will silently drop headers | Extract to `include /etc/nginx/snippets/security-headers.conf;` — DRY | S |
| P2-6 | `CSP report-uri` is not configured — CSP violations in production are silent | Add `report-uri /api/csp-report` endpoint or use a Sentry CSP endpoint | S |
| P2-7 | `COOKIE_DOMAIN` env var is in config but not set — cookies are scoped to `api.easymod.tech` only. If frontend ever moves to a subdomain, auth breaks silently | Document this as a known config dependency; add a startup warning if `NODE_ENV=production` and `COOKIE_DOMAIN` is unset | S |

---

## 4. Meta Policy Compliance (App Review Readiness)

Applied `meta-policy-skill.md` checklist plus direct code review.

### Pre-Implementation 10-Point Checklist (System-wide)

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | User-initiated trigger | PASS | `meta-webhook.routes.js:235` — POST handler only processes `entry[].changes[]` (comment/message events). BullMQ job enqueued only on webhook receipt. |
| 2 | No cold outreach | PASS | `message-worker.js` guard chain requires a conversation with `customer.id` — no send to users who haven't messaged the page. |
| 3 | No fake engagement | PASS | No auto-like, auto-follow, or reaction automation found in codebase. |
| 4 | Consent present | PASS | `consent/consent.service.js` tracks `last_inbound_at` per platform. `consentRequired.rule.js` hard-denies if no inbound record exists. |
| 5 | Opt-out honored | PASS (Phase 5) | `policy/rules/messengerOptedOut.rule.js` — checks `customer.messaging_consent[platform].opted_out_at` and hard-denies. Policy engine runs on ALL outbound sends including the webhook shim. **BUT:** The migration `20260610_001_drop_legacy_channel_tables.js` (dated June 10, not yet run on all envs) is what removes the now-split `marketing_opt_out` column. Risk: if that migration has NOT run, the DB has the old column but code reads JSONB — ensure migration is applied. |
| 6 | Rate limit safe | PASS | `policy/rules/rateLimit.rule.js` enforces 170/hr soft limit; MetaMessengerProvider and MetaInstagramProvider consume the policy decision. Redis leaky bucket per pageId. |
| 7 | Message window valid | PASS | `policy/rules/twentyFourHourWindow.rule.js` sets `augment.within_window`; `templateRequired.rule.js` hard-denies if `within_window=false` + no approved tag. Providers pass `decision.augment.message_tag` to Graph API body. |
| 8 | Content appropriate | PASS | `guardrail.service.js` (5 guards) + `policy/rules/contentSanitizer.rule.js` on every AI reply. |
| 9 | Page ownership | PASS | `meta-webhook.routes.js` verifies `hub.verify_token` against `MetaChannel.webhook_verify_token` for the shop's OWN connected channel. Comment events filtered to `channel.page_id` matches. |
| 10 | Deduplication | PASS | `message-worker.js` Guard 1: Redis NX key `messageId+shopId`. BKash webhooks: `TrxIDLog.findOrCreate`. GDPR callbacks: Redis/memory idempotency key (`gdpr:processed:type:userId:date`). |

**Overall pre-implementation verdict: SAFE** with one conditional (migration P0-2 must be confirmed applied).

### Specific Meta Compliance Areas

#### Webhook Signature Verification
- **Status: PASS**
- `meta-webhook.routes.js:200` — `isValidSignature()` using `X-Hub-Signature-256` with `META_WEBHOOK_APP_SECRET`
- Fails closed: if `META_WEBHOOK_APP_SECRET` is not configured, returns `403` (not a silent pass)
- BKash: `webhooks/webhook.middleware.js:validateBkashSignature()` — timing-safe HMAC comparison
- Unknown gateway: now correctly returns `401` (ADR fix from 2026-05-16 applied)

#### Data Deletion Callback
- **Status: PASS**
- `GET /webhooks/meta/data-deletion` — returns status check URL per Meta spec (`meta-webhook.routes.js:334`)
- `POST /webhooks/meta/data-deletion` — signed_request verification + cascaded customer/message deletion (`meta-webhook.routes.js:353`)
- Idempotent via Redis 24h TTL key (`gdpr:processed:data-deletion:{userId}:{date}`)
- **Gap:** The deletion handler deletes customer rows but needs confirmation it also nullifies `policy_decisions` and `meta_channel_consent_events` that reference the customer. (Check FK cascade behavior.)

#### Deauthorize Callback
- **Status: PASS**
- `POST /webhooks/meta/deauthorize` — signed_request parsed + `customers.metadata.deauthorized = true` set (`meta-webhook.routes.js:433`)
- Idempotent via same Redis pattern

#### Token Storage Encryption
- **Status: PASS**
- `meta-channel.entity.js` — getter/setter on `page_access_token_ct` transparently decrypts/encrypts via `meta-token-cipher.js` AES-256-GCM v2
- `CHANNEL_ENCRYPTION_KEY` validated at startup (`config.js`)

#### Privacy Policy & Terms
- **Status: CAUTION**
- Pages exist at `/privacy-policy` and `/terms` — PASS for route presence
- Content is comprehensive (616 lines in PrivacyPolicy.tsx)
- **FAIL:** 8+ WhatsApp references remain in PrivacyPolicy.tsx (lines 32, 97, 98, 133, 154, 180, 183, 314). Since WhatsApp is not a platform you use or request permission for, this creates a discrepancy Meta reviewers will flag.
- **FAIL:** `whatsapp_business_messaging` still listed as an active permission in meta-policy-skill.md. If that list reflects what's actually requested in the Meta App Dashboard, this is a critical mismatch (requesting a permission for a removed channel).

#### 24-Hour Window Compliance
- **Status: PASS**
- Full rule pipeline in `policy.rules.js` order: `consentRequired → messengerOptedOut → twentyFourHourWindow → templateRequired`
- `POST_PURCHASE_UPDATE` tag is injected by `webhookService.sendMessage()` context for order/delivery messages (verify this in MetaMessengerProvider — the `decision.augment.message_tag` path is present at `MetaMessengerProvider.js:293`)

#### Permissions Requested vs Used

| Permission | Used In Code | Status |
|-----------|-------------|--------|
| `pages_messaging` | `MetaMessengerProvider.sendMessage()` | PASS |
| `pages_read_engagement` | `meta-webhook.routes.js` — comment event processing | PASS |
| `pages_manage_posts` | Comment reply (verify in MetaMessengerProvider) | NEEDS VERIFICATION |
| `instagram_basic` | `MetaInstagramProvider.js` | PASS |
| `instagram_manage_messages` | `MetaInstagramProvider.sendMessage()` | PASS |
| `whatsapp_business_messaging` | NO code uses it (WhatsApp removed) | **FAIL — remove from permission request** |

#### Business Verification & App Mode
- **Status: NOT VERIFIED** — Cannot confirm from code. Must be done in Meta Business Manager dashboard.
- App must be in LIVE mode (not Development) for production use.
- Business Verification must be complete for `pages_messaging` access at scale.

#### App Review Artifact Readiness

| Artifact | Status | Notes |
|---------|--------|-------|
| Privacy Policy URL | PASS | `/privacy-policy` live |
| Terms URL | PASS | `/terms` live |
| Data Deletion URL | PASS | `POST /webhooks/meta/data-deletion` |
| Deauthorize URL | PASS | `POST /webhooks/meta/deauthorize` |
| Screencast: Comment → DM flow | NOT DONE | Need test page + test user + screen recording |
| Screencast: User opt-out respected | NOT DONE | Required to show opt-out handling |
| Test user for reviewer | NOT SET UP | Must create a test Facebook account for Meta reviewer |
| Reviewer access notes | NOT WRITTEN | Plain-English explanation of automation flow |
| WhatsApp permission removed | FAIL | Must be done before submission |

---

## 5. Frontend Design Revamp Assessment

**Skills used:** Closest available — `claude-skills/product-team/ux-researcher-designer/`, `claude-skills/product-team/ui-design-system/`, coding-standards frontend section.
**Note:** No "motion" or "ux-ui-pro-max" skill found. Framer Motion is imported in `LandingPage.tsx` (confirmed `useMotionValueEvent` usage) but not systematically applied across the app.

### Component Library Status
- **Base:** Tailwind CSS + Radix UI primitives (Dialog, DropdownMenu, Select, Checkbox, Switch) — consistent
- **Icons:** Lucide React — consistent
- **Query:** TanStack Query — consistent
- **Inconsistency found:** Landing page uses Framer Motion (`framer-motion`) but dashboard/app screens use no animation library. The gap between the polished landing page and the functional-but-static dashboard is noticeable.
- **Spacing scale:** No custom Tailwind spacing scale defined — using default scale. Components mix `gap-2/3/4`, `p-3/4/6` freely without a design token baseline.
- **Typography:** No custom font defined in `index.html` or CSS — system font stack. For Bengali (bn) text rendered via i18n, system fonts may not render Kalpurush/Hind Siliguri glyphs well on low-end Android devices common in BD.

### 8 Highest-Leverage Screens to Redesign

#### 1. Onboarding Wizard (`OnboardingWizard.tsx` — 274 lines)
**Current friction:** 5-step wizard but no progress persistence. If user closes or refreshes, wizard starts over. Step 1 asks to "Connect Facebook" but no inline OAuth button — redirects to Channels page. Disconnects the guided experience.
**Redesign direction:** Persistent wizard state in `shop.settings.onboarding_step`. Step 1 should trigger OAuth inline (use `initiateMetaOAuth()` in the wizard itself, not a redirect). Add a "resume later" mechanism.
**Motion treatment:** Slide-in transition between steps (Framer Motion `AnimatePresence` + `x` offset). Checkmark animation on step completion.
**BD/Bengali considerations:** All wizard copy is already in Bengali — good. Add Bengali tooltips for "Handover Protocol" (not a familiar concept for BD SMEs). Use 44px minimum touch targets.

#### 2. Channel Connect (`Channels.tsx`)
**Current friction:** OAuth flow surface-exposes raw error states (sessionStorage `oauth_error` read on mount — fixed in PR #5 but UX is still a raw error string). The channel card shows technical details (page_id, status enum) not merchant-friendly language.
**Redesign direction:** Simplify to a single card per channel with a green/red status indicator + Bengali status text ("সংযুক্ত" / "সংযোগ বিচ্ছিন্ন"). Add a "Test webhook" button that calls `pingMetaChannel()` with a loading state.
**Motion treatment:** Connection success → confetti-style micro-animation (a single burst, not full-screen). Reconnect button with a rotate animation on the refresh icon.
**BD/Bengali:** "Reconnect" → "পুনরায় সংযুক্ত করুন" with a simple explanation: "আপনার Meta token মেয়াদ শেষ হয়েছে।"

#### 3. Conversation Inbox (`UnifiedInbox.tsx`)
**Current friction:** The inbox likely renders all conversations in a flat list. No visual distinction between HITL (needs human attention) and AI-handled threads. SSE connection state is not surfaced (user doesn't know if real-time is connected).
**Redesign direction:** Two-pane layout. Left: conversation list with HITL indicator (red dot), last message preview in the customer's language, time-since-last-message. Right: full chat thread. SSE connection status indicator (green dot = live, yellow = reconnecting).
**Motion treatment:** New message slides in from bottom of right pane. HITL notification badge pulses once.
**BD/Bengali:** Time display in Bengali numerals optional ("৫ মিনিট আগে"). Conversations with Banglish content should not be force-formatted.

#### 4. Automation Builder (currently dispersed across ChatSettings + Keyword management)
**Current friction:** Automation settings are spread across `ChatSettings.tsx` (AI config, tone), `ManageShop.tsx` → `AIConfig` (automation mode), and separate keyword management. A BD SME has to navigate 3 pages to configure a basic automation.
**Redesign direction:** Single "Automation" page that combines: (a) keyword triggers list with add/edit inline, (b) AI mode toggle (Manual/Draft/Auto) with Bengali explanations, (c) response preview sandbox ("এই keyword এর জবাবে AI কী বলবে?").
**Motion treatment:** Toggle state transitions with smooth slide. Preview panel slides in from right.
**BD/Bengali:** Mode names in Bengali: Manual = "হাতে লেখা", Draft = "AI খসড়া", Auto = "সম্পূর্ণ AI".

#### 5. Orders List (`Orders.tsx`)
**Current friction:** Orders page is likely a standard table. BD SME primary action is "dispatch" — this should be a one-tap action. RTO flags need visual prominence (not just a boolean column).
**Redesign direction:** Card-based layout on mobile. Primary CTA "এখনই পাঠান" (Dispatch) is the biggest button on each pending order card. RTO risk orders have an orange banner with Bengali warning. Filter by status tabs at top (not a dropdown).
**Motion treatment:** Dispatch success → card slides out. New order notification banner slides in from top.
**BD/Bengali:** Order number in Bengali numerals optional. Delivery provider logos (Pathao, Steadfast, RedX) instead of text names.

#### 6. Billing / Subscription (`Subscription.tsx`)
**Current friction:** 616 lines — heavy page. Conversation usage meter, top-up packs, plan comparison all compete for attention. BKash payment flow isn't clear (what happens after I click "Pay"?).
**Redesign direction:** Progressive disclosure. Primary view: usage meter + current plan + single "Upgrade / Top-Up" CTA. Secondary view (drawer): plan comparison table. BKash payment flow: show a "BKash payment link will be sent" confirmation before triggering — reduces abandoned payments.
**Motion treatment:** Usage meter fill animation on page load. Top-up pack selection → price number counts up.
**BD/Bengali:** "৳750/মাস" format is correct. Add "৳ = টাকা" label for first-time users. BKash logo in payment flow.

#### 7. Dashboard (`Dashboard.tsx`)
**Current friction:** Standard KPI card grid. BD SMEs need TODAY's numbers at a glance, not monthly totals.
**Redesign direction:** "আজকের সারাংশ" (Today's Summary) as the hero section: new orders today, conversations handled, pending dispatches. Monthly KPIs below the fold. RTO risk count as a standalone alert card.
**Motion treatment:** KPI numbers count-up animation on load (Framer Motion `useSpring`).
**BD/Bengali:** All numbers in BDT with ৳ prefix. Time in Asia/Dhaka.

#### 8. Landing Page (already uses Framer Motion — highest current design quality)
**Current state:** Already has scroll animations, gradient hero, feature cards, testimonials, pricing section. Best-designed page in the app.
**Gap:** Pricing section still shows placeholder prices or mismatched BDT values vs actual 750/1950 BDT. No Bengali language toggle on the landing page despite the app supporting bn.
**Recommendation:** Add Bengali toggle to nav. Confirm pricing section matches backend plans exactly. Add a "BD trusted sellers" social proof section with Bengali testimonials.

### Component Library Consolidation Needs

1. **Add a Bengali-safe font:** Include `Hind Siliguri` or `Kalpurush` as a Google Font for `lang="bn"` elements. System fonts on Android miss Bengali glyphs.
2. **Create a `<StatusBadge>` component:** Used in Orders, Conversations, Channels — currently each page rolls its own `className={cn(...)}` badge. Single source prevents drift.
3. **Create a `<BDPhoneInput>` component:** `pattern="01[3-9][0-9]{8}"`, hint text "01XXXXXXXXX", formatted display. Used in 4+ forms.
4. **Motion tokens:** Define a `transitions.ts` with 3 standard durations (fast: 150ms, normal: 250ms, slow: 400ms) and 2 easings (ease-out, spring). Prevents ad-hoc animation values.

---

## 6. Beta Launch Punch List

### CODE

- [ ] **P0** Run `migrate status` on staging DB; run `migrate up` for pending migrations (20260524, 20260527, 20260603, 20260610)
- [ ] **P0** Fix `InventorySyncLog` crash: add entity to `entities.js` OR delete inventory-sync subsystem from beta
- [ ] **P0** Remove `cookies.txt` from repo: `git rm EasyMod-backend/cookies.txt` + add to `.gitignore`
- [ ] **P0** Remove WhatsApp ENUM from `customer.entity.js` `source_channel` + `customer.validator.js` `VALID_CHANNELS` + add migration
- [ ] **P1** Add scoped test job to `EasyMod-backend/.github/workflows/deploy.yml` (policy + webhook + channel-providers tests only)
- [ ] **P1** Remove or build BD-Lite: decide if `/bd-lite/*` routes ship for beta or get deferred
- [ ] **P1** Remove dead WhatsApp send path from `owner-notification.service.js` (lines 233–246)
- [ ] **P1** Consolidate remaining 9 inline BD phone regexes to `phone.validator.js`
- [ ] **P1** Fix `saveUninitialized: true` session bloat in `session.middleware.js`
- [ ] **P2** Move `entities/` subfolder entities to their domain modules

### META APP REVIEW

- [ ] **P0** Remove `whatsapp_business_messaging` from Meta App permissions in developer.facebook.com dashboard
- [ ] **P0** Remove all WhatsApp references from `PrivacyPolicy.tsx` (8 locations)
- [ ] **P0** Update `meta-policy-skill.md` permissions table — remove WhatsApp entry
- [ ] **P0** Update `subscription.plans.js` — set `whatsapp_channel: false`, `whatsapp_catalog_sync: false`
- [ ] **P1** Verify `pages_manage_posts` is actually requested and used in MetaMessengerProvider comment replies
- [ ] **P1** Record screencast: full comment-to-DM flow (comment on test post → DM received)
- [ ] **P1** Record screencast: user sends "stop" → AI stops sending (opt-out respected)
- [ ] **P1** Create test Facebook Page + test user for Meta reviewer access
- [ ] **P1** Write 3-paragraph reviewer notes explaining: what the app does, what permissions are needed and why, where to test
- [ ] **P1** Confirm Meta Business Verification completed in Meta Business Manager
- [ ] **P1** Set app to LIVE mode (not Development) in Meta App Dashboard

### OPS / INFRA

- [ ] **P0** Confirm `META_WEBHOOK_APP_SECRET`, `CHANNEL_ENCRYPTION_KEY`, `META_APP_SECRET`, `META_APP_ID` are set in production `.env.prod`
- [ ] **P0** Confirm `BKASH_SANDBOX=false` in `.env.prod` for real payments (or explicitly confirm sandbox for beta)
- [ ] **P1** Add Redis session TTL monitoring — `saveUninitialized: true` bloat risk under anonymous traffic
- [ ] **P1** Set `OPS_ESCALATION_WEBHOOK_URL` in `.env.prod` for circuit breaker alerts
- [ ] **P1** Set `SENTRY_DSN` in both frontend `.env.production` and backend `.env.prod`
- [ ] **P2** Add `CSP report-uri` to nginx.conf for silent CSP violation detection
- [ ] **P2** Add `COOKIE_DOMAIN=.easymod.tech` note to `.env.example` as a known future config dependency

### CONTENT / LEGAL

- [ ] **P0** Purge WhatsApp from `PrivacyPolicy.tsx` — it's a legal document
- [ ] **P0** Review `TermsOfService.tsx` (336 lines) for any WhatsApp / removed-channel references
- [ ] **P1** Confirm Bengali copy in `bn.json` (1307 lines) matches feature set — specifically: subscription/billing section, HITL notification text, opt-out confirmations
- [ ] **P1** Add Bengali font (`Hind Siliguri`) to `index.html` for correct Bengali glyph rendering on mobile
- [ ] **P2** Landing page pricing section — verify 750/1950 BDT values are hardcoded correctly; add PARTNER plan description

### SUPPORT READINESS

- [ ] **P1** Set `ADMIN_EMAIL` in production to an actively monitored inbox
- [ ] **P1** Create a beta cohort onboarding document in Bengali (5 steps: signup → connect FB → add products → add FAQ → go live)
- [ ] **P1** Set up a Slack/Discord channel or WhatsApp group for beta seller support escalations
- [ ] **P2** Write an "AI didn't reply" troubleshooting guide for support — the most common beta complaint will be automation not triggering
- [ ] **P2** Create seller FAQ: "Why did my reply stop? (HITL activated)", "How do I send a message myself?", "What is RTO shield?"

---

## Memory Update

**Appended to `.easymod/memory/execution-history.md` after this audit.**

Key discoveries for future sessions:
1. `InventorySyncLog` is a runtime crash — P0 fix needed before any staging test
2. Privacy Policy + meta-policy-skill still reference WhatsApp (removed channel) — Meta App Review liability
3. `20260610_001_drop_legacy_channel_tables.js` is a future-dated migration (June 10) not yet confirmed executed
4. BD-Lite (`/bd-lite/*`) is a skeleton shell with no actual page implementations
5. 14 backend modules have zero test coverage; CI has no test gate post-May-17 fix
6. The policy engine (Phase 3) correctly enforces opt-out, 24h window, and rate limits — architecture is sound
7. `customer.messaging_consent` JSONB is the single source of truth for opt-out (not the old `marketing_opt_out` boolean column)
8. `cookies.txt` is committed to repo — security hygiene issue
