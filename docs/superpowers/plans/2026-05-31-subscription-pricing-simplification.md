# Subscription Pricing Simplification — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax. This is a refactor of an existing large codebase: code is shown for NEW artifacts; for edits to existing files, read the file at edit time and apply the described change exactly. Commit after each phase. Run the relevant test suite before each commit.

**Goal:** Replace the 4-tier (Free/Package1/Package2/Partner) model with a single **GROWTH** plan (৳999/mo, hidden 300+50 conversation fair-use, top-ups) fronted by a card-less **14-day trial**, plus a chargeable **Partner** program (apply → approve → monthly bKash invoice → suspend), aligned across every FE/BE surface, then deploy.

**Architecture:** Trial is a *status* (`trialing`) on a GROWTH subscription — no separate plan. Features are always "all on"; AI on/off is driven by subscription `status` + the existing conversation-limit machinery. Partner is the only other plan (per-order billing). Plan definitions live in two synced files (BE `subscription.plans.js`, FE `subscriptionPlans.ts`).

**Tech Stack:** Node/Express + Sequelize (Postgres prod / SQLite dev) + BullMQ jobs; React + Vite + Vitest + react-i18next; bKash via `bangladesh-payment.service`.

---

## Phase 0 — Backend plan-model source of truth

**Files:** Modify `EasyMod-backend/src/modules/subscription/subscription.plans.js`

- [ ] Replace `PRICING_TIERS` so only `GROWTH` (code `GROWTH`, flat_monthly, 999/9990, `conversationsLimit: 300`, all `BASE_FEATURES`, `analytics_days: 30`, `api_access:false`, `rate_limit_per_minute: 40`, `ai_settings_access: AI_SETTINGS_ALL`) and `PARTNER` (unchanged per-order) remain. Remove FREE / PACKAGE_1 / PACKAGE_2 tiers, `FREE_FEATURES`, `AI_SETTINGS_FREE`.
- [ ] Update `PlanCode` to `{ GROWTH, PARTNER }`.
- [ ] Rewrite `normalizePlanCode`: map legacy `FREE/STARTER/PRO/BUSINESS/PACKAGE_1/PACKAGE_2/GROWTH` → `GROWTH`; `PARTNER` → `PARTNER`. (Flips today's `'GROWTH'→PACKAGE_2`.)
- [ ] Keep `THRESHOLD_BUFFER = 50`, `TOPUP_PACKS`, `PARTNER_ORDER_TIERS`, `calculatePartnerCharge` unchanged.
- [ ] Verify: `node --check src/modules/subscription/subscription.plans.js`.
- [ ] Run existing suite: `npm test --prefix EasyMod-backend -- subscription` (note breakages to fix in later phases).
- [ ] Commit: `feat(pricing): collapse backend tiers to GROWTH + PARTNER`.

## Phase 1 — DB migration (status enum + data backfill)

**Files:** Create `EasyMod-backend/src/database/migrations/20260531_000_pricing_simplification.js`

- [ ] Add enum values `trialing`, `trial_expired` to `subscriptions.status` (Postgres `ALTER TYPE ... ADD VALUE IF NOT EXISTS`; SQLite is dynamic — guard by dialect). Wrap in try/catch for idempotency.
- [ ] Data backfill: `UPDATE subscriptions SET plan_code='GROWTH', plan_name='Growth', plan_price=999, billing_model='flat_monthly', conversations_limit=300 WHERE plan_code IN ('FREE','PACKAGE_1','PACKAGE_2') OR plan_code IS NULL`. Leave `PARTNER` rows untouched.
- [ ] Verify dev: `npm run db:migrate --prefix EasyMod-backend` (or the project's migrate command) against SQLite; confirm no error.
- [ ] Commit: `chore(db): migration collapses plans to GROWTH + adds trial statuses`.

## Phase 2 — Entity defaults + subscription service (trial creation + AI-active helper)

**Files:** Modify `subscription.entity.js`, `subscription.service.js`; read both first.

- [ ] Entity: change `plan_name` default `'Free'`→`'Growth'`; `conversations_limit` default `100`→`300`; ensure `status` ENUM lists `active, inactive, cancelled, suspended, trialing, trial_expired`.
- [ ] Reconcile overage field: standardize on `extra_charge` (entity) everywhere; fix the two jobs that write `extra_charges` (Phase 3/6).
- [ ] Service: wherever a subscription is created at signup, set `plan_code='GROWTH'`, `status='trialing'`, `trial_ends_at = now + 14d`, `conversations_limit=300`, `plan_price=999`, `billing_cycle='monthly'`, `billing_model='flat_monthly'`, period/next-billing dates = trial end.
- [ ] Add exported helper `isAiActive(sub)` returning `sub.status === 'active' || sub.status === 'trialing'` (limit enforcement stays in middleware). Place in `subscription.service.js` (or a small `subscription.access.js`).
- [ ] Test: `EasyMod-backend/src/modules/subscription/__tests__/access.test.js` — `isAiActive` true for active/trialing, false for trial_expired/suspended/cancelled.
- [ ] Run: `npm test --prefix EasyMod-backend -- subscription`.
- [ ] Commit: `feat(subscription): trial-as-status creation + isAiActive gate`.

## Phase 3 — Conversation-limit middleware reconcile

**Files:** Modify `EasyMod-backend/src/middleware/conversation-limit.middleware.js`

- [ ] Remove the `isFreeTier` 402 special-case block (no FREE plan).
- [ ] Keep effective-limit + 75/90/100 + +50 buffer + hard-block logic. Buffer remains a free grace.
- [ ] Update `recordConversation`/context unchanged.
- [ ] Run existing usage-tracking test: `npm test --prefix EasyMod-backend -- usage-tracking`.
- [ ] Commit: `refactor(limits): drop FREE special-case; +50 buffer is free grace`.

## Phase 4 — Notifier copy + trial nudges + trial-expiry job

**Files:** Modify `conversation-limit-notifier.service.js`; Create `EasyMod-backend/src/jobs/trial-expiry.job.js`; register in the job scheduler.

- [ ] Notifier: change `CONV_LIMIT_EXCEEDED` copy from "deducted from next package" → "+৫০ free buffer; top up or upgrade to keep AI replying." Add `TRIAL_ENDING` (days left) + `TRIAL_EXPIRED` types.
- [ ] Trial-expiry job (BaseJob): daily — (a) `trialing` with `trial_ends_at <= now` → `status='trial_expired'` + `TRIAL_EXPIRED` push; (b) `trialing` with 1–3 days left → `TRIAL_ENDING` push (once).
- [ ] Register the job in the scheduler/queue-manager next to invoice/overage jobs.
- [ ] Test: `EasyMod-backend/src/jobs/__tests__/trial-expiry.job.test.js` — expired flips status; nudge fires once.
- [ ] Run: `npm test --prefix EasyMod-backend -- trial`.
- [ ] Commit: `feat(trial): expiry job + ending nudges + corrected buffer copy`.

## Phase 5 — AI gate wiring (auto-reply respects status)

**Files:** Modify `EasyMod-backend/src/modules/integration/meta-webhook-events.handler.js` (and/or `ai-chatbot.controller.js`); read each first.

- [ ] Before generating/sending an AI reply, load the shop subscription and skip AI when `!isAiActive(sub)` (trial_expired/suspended/cancelled/inactive). Inbound message + manual replies still persist (no block on the inbox).
- [ ] Log a structured event when AI is skipped for billing status.
- [ ] Test: a focused unit test asserting AI send is skipped when status is `trial_expired`/`suspended` but the conversation/message is still recorded.
- [ ] Run the relevant webhook handler and AI reply tests.
- [ ] Commit: `feat(ai-gate): pause AI auto-reply for inactive/expired subscriptions`.

## Phase 6 — Partner program (persist → approve → bill → collect → suspend)

**Files:** Create `partner-application.entity.js`, modify `partner-apply.routes.js`, create admin approval (`partner-admin.routes.js` + `scripts/approve-partner.js`), modify `invoice-generator.js` + `daily-overage-calculator.js`, register entity.

- [ ] New `partner_applications` table/model: `id, shop_id (nullable), business_name, phone, page_link, status ENUM(pending,approved,rejected) default pending, reviewed_by, reviewed_at, created_at`. Add to entities index + migration (extend Phase 1 file or new migration).
- [ ] `partner-apply.routes.js`: persist the application (still email admin best-effort). Keep validation.
- [ ] Approval: protected admin endpoint `POST /api/admin/partner/:id/approve` + CLI `scripts/approve-partner.js <appId>` → set application `approved`, and set that shop's subscription `plan_code='PARTNER', plan_name='Partner', billing_model='per_order', status='active', conversations_limit=-1`.
- [ ] `invoice-generator.js`: for `billing_model='per_order'` shops, set invoice amount = `calculatePartnerCharge(deliveredOrdersInPeriod)` (count delivered orders from the Order table for the billing period) + 15% VAT; metadata records delivered count + tier. Fix `extra_charges`→`extra_charge` read. Remove the blanket FREE skip (no FREE) but skip rows with zero charge.
- [ ] `daily-overage-calculator.js`: gate so **flat plans are never auto-billed** (only run for nothing now — effectively disable conversation overage for GROWTH); fix `extra_charges`→`extra_charge` write. (Keep file; no scheduled effect for flat plans.)
- [ ] Suspend-on-nonpayment: in invoice-generator or a small step, when a partner has a `pending` invoice past `due_date`, set subscription `status='suspended'` (AI pauses via Phase 5 gate). Paying the invoice (existing payment flow) restores `status='active'`.
- [ ] Tests: partner charge invoice math (e.g., 600 delivered → 500×15 + 100×12 = 8,700 + VAT); approval flips plan; suspend on overdue.
- [ ] Run: `npm test --prefix EasyMod-backend -- partner invoice overage`.
- [ ] Commit: `feat(partner): persist applications, approval, monthly per-order bKash invoicing + suspend`.

## Phase 7 — Frontend alignment (plans, gating, pages, copy, i18n)

**Files:** Modify `subscriptionPlans.ts`, `useSubscriptionFeatures.ts`, `Pricing.tsx`, `LandingPage.tsx`, `Subscription.tsx`, `Signup.tsx`, `OnboardingWizard.tsx`, `ConversationAlertBanner.tsx`, `billing/UsageMeter.tsx`, i18n locale files; read each first.

- [ ] `subscriptionPlans.ts`: array = `[growth, partner]` only. Growth: 999/9990, `limits.conversations: 300`, all features true, highlights emphasize "all features / 14-day free trial / no card", **no "300" in name/description headline**. Update `findPlanByCode`/aliases as needed. Remove `popular` juggling (Growth is the one plan).
- [ ] `useSubscriptionFeatures.ts`: default + matched features all-true (no advanced_ai:false path); keep fail-open. Surface trial state (status/trial_ends_at) if available from the subscription API for banners.
- [ ] `Pricing.tsx`: render Growth as the hero card with "Start 14-day free trial — no card"; keep Partner apply modal; fix the FAQ ("new shops start on PACKAGE_1" → "14-day free trial of Growth"); fair-use line ("~300 AI chats/mo, top up anytime").
- [ ] `LandingPage.tsx`: pricing/positioning copy → one price ৳999 + trial.
- [ ] `Subscription.tsx`: show trial banner (days left + Activate ৳999 bKash CTA), current usage X/300 via UsageMeter, top-up purchase still working, Partner status if applicable.
- [ ] `Signup.tsx` / `OnboardingWizard.tsx`: messaging "14-day free trial, no card"; remove plan-picker if it forces Free/Package choice.
- [ ] `ConversationAlertBanner.tsx` / `UsageMeter.tsx`: copy aligned to grace+top-up (not overage billing).
- [ ] i18n: update/remove stale keys (PACKAGE_1/2/Free, "ai er jonno upgrade"); add trial keys. Bengali default.
- [ ] Run: `npx vitest run` in `EasyMod-frontend` (fix any plan-shape test fallout, e.g. existing pricing/subscription tests).
- [ ] Commit: `feat(pricing-ui): single Growth plan + 14-day trial + fair-use framing across all surfaces`.

## Phase 8 — Dev-mode verification (subscription page + top-up + notify)

- [ ] Start backend + frontend in dev; sign up a fresh shop → confirm `status='trialing'`, `trial_ends_at` ~14d, Subscription page shows trial banner + usage 0/300.
- [ ] Exercise top-up purchase path (dev/mock bKash) → `topup_balance` increments, effective limit rises, invoice row created.
- [ ] Force usage to ≥75/≥90/≥100 (seed/update sub) → confirm notifications fire and +50 buffer grants, then hard-stop.
- [ ] Confirm Partner apply persists a `partner_applications` row + admin email attempt; run `scripts/approve-partner.js` against a test shop → plan flips to PARTNER.
- [ ] Note any gaps; fix; re-run suites (FE `npx vitest run`, BE `npm test`).
- [ ] Commit any fixes: `test(pricing): dev-mode verification fixes`.

## Phase 9 — Deploy (bundle prior work)

- [ ] Confirm working tree includes prior uncommitted MVP-2 + inbox fixes; review `git status`/`git diff` and stage intentionally.
- [ ] Ensure branch is `mvp-2-feature`; push and follow the project's deploy path (CI/CD on merge, or the droplet docker-compose path per production-origins memory). Confirm with user before the outward-facing deploy step.
- [ ] Post-deploy smoke: signup→trial, subscription page, top-up, partner apply on the live origin (https://easymod.tech).

---

## Self-review notes
- **Spec coverage:** §1 decisions → Phases 0–7; §3 cap machinery → P3; §4 trial → P2/P4/P5; §5 partner → P6; §6 surfaces → P7; deploy → P9. ✓
- **Two-file sync:** P0 (BE) + P7 (FE) keep plan defs in lockstep. ✓
- **Known bug fixes folded in:** `extra_charges`/`extra_charge` (P2/P6), `normalizePlanCode` GROWTH mapping (P0), stale FAQ (P7), timestamp accessor watch (P2/P7). ✓
