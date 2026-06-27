# Subscription Pricing Simplification — Design Spec

**Date:** 2026-05-31
**Owner:** Founder/PM (Hexabyte) · author: Claude
**Status:** Approved for implementation
**Context:** Pre-launch re-evaluation of EasyModerator (BD f-commerce FB/IG SaaS) pricing. Collapse a confusing 4-tier model into a single paid plan with a real trial, honest "fair-use" framing, working top-ups, and a chargeable Partner program.

---

## 1. Business decisions (locked)

| Decision | Choice |
|---|---|
| Trial entry | **Card-less.** Instant full Growth access; pay only at day 14. |
| Trial end (unpaid) | **AI pauses, manual inbox stays, data retained, upgrade nudge.** |
| Partner billing | **Monthly post-paid invoice via bKash; suspend AI on non-payment.** |
| Partner access | **Apply → we approve** (eligibility 300+ delivered orders/mo). |

## 2. Target model

Retire `FREE`, `PACKAGE_1`, `PACKAGE_2`. New world = **`GROWTH` + `PARTNER`**, with the 14-day trial expressed as a *status* on a GROWTH subscription (not a separate plan).

### Offerings

**14-day Trial (on-ramp, not a plan)**
- Signup → `plan_code='GROWTH'`, `status='trialing'`, `trial_ends_at = now + 14d`, no payment captured.
- Full Growth: every feature, 300-conv fair-use + 50 grace buffer, top-ups allowed.

**Growth — ৳999/mo (or ৳9,990/yr, "2 months free")**
- All features, no feature restrictions. Headline never states "300".
- Hidden fair-use: **300 AI conversations/mo, +50 free grace buffer**, then AI hard-stops → top-up or wait for monthly reset.
- Top-up packs unchanged: 100/250/500/1000 @ ৳150/350/650/1200.

**Partner — ৳10–15/delivered order (per-order, apply + approve)**
- Tiered rate (existing `PARTNER_ORDER_TIERS`: 15/12/10 by monthly volume).
- Eligibility 300+ orders/mo; apply → approve → plan switches to per-order.
- Monthly post-paid invoice via bKash; suspend AI on non-payment.

## 3. Conversation-cap machinery (reuse + reconcile)

Kept as-is: `effective = conversations_limit + topup_balance + threshold_conversations`; 75/90/100 push alerts; +50 buffer at 100%; hard-block when exhausted.

Changes:
- `GROWTH` `conversations_limit = 300`; `THRESHOLD_BUFFER = 50` (grace).
- **+50 buffer is a FREE grace, not billed overage.** Fix notifier copy ("top up to continue", drop "deducted from next package").
- **Disable `daily-overage-calculator` auto-billing for flat plans** (we monetize via top-ups, not surprise overage). Keep the job/code but gate it so flat plans are never billed ৳2.5/conv.
- Remove the `FREE`-tier 402 special-case in `conversation-limit.middleware.js`.
- **Bug to fix:** jobs write `extra_charges`; the entity column is `extra_charge`. Reconcile the field name end-to-end.

## 4. Trial lifecycle (new)

- **Status states:** `trialing` → (pay) `active`; (no pay by `trial_ends_at`) `trial_expired`. Add `trialing` + `trial_expired` to the `subscriptions.status` enum via migration.
- **AI gate helper** `isAiActive(sub)` = `status ∈ {active, trialing}` AND within conversation limit. Wire into the Messenger auto-reply path (meta-webhook handler / ai-chatbot). On `trial_expired` or `suspended`: AI stops; manual inbox fully works; data retained.
- **Trial-expiry job (daily):** flip overdue `trialing` → `trial_expired`, fire "trial ended — upgrade ৳999" push. Add day-11 / day-13 "trial ending" nudges (reuse notifier).
- **Subscription page:** trial banner (days left) + "Activate ৳999" bKash CTA.

## 5. Partner: apply → approve → bill → collect → suspend

Today only step 1 exists (best-effort admin email). Build the spine:
- **Persist applications** in a new `partner_applications` table (status pending/approved/rejected); keep the admin email notification.
- **Approval action:** protected admin endpoint + a CLI script for launch (full admin UI deferred to phase 2). Approval sets `plan_code='PARTNER'`, `billing_model='per_order'`, `status='active'`.
- **Accrual:** `invoice-generator` for `billing_model='per_order'` shops counts *delivered* orders in the billing period and bills `calculatePartnerCharge(count)` + 15% VAT. Compute-from-orders avoids per-order race conditions; retire/repurpose the half-built `partner_orders_this_week` / `partner_pending_invoice_amount` weekly fields.
- **Collect:** invoice `pending` (7-day due) → bKash checkout (reuse `BKashCheckout`) → `paid`.
- **Suspend:** unpaid past due → `status='suspended'` → AI pauses (same gate as §4). Pay → reactivate.

## 6. Surfaces to align ("all places")

**Frontend:** `subscriptionPlans.ts`, `useSubscriptionFeatures.ts`, `Pricing.tsx`, `LandingPage.tsx`, `Subscription.tsx`, `Signup.tsx`, `OnboardingWizard.tsx`, `ConversationAlertBanner.tsx`, `billing/UsageMeter.tsx`, `billing/BKashCheckout.tsx`, i18n strings (stale FAQ says "new shops start on PACKAGE_1").

**Backend:** `subscription.plans.js`, `subscription.entity.js` defaults, `subscription.service.js`, `normalizePlanCode` (today `'GROWTH'→PACKAGE_2` — flip it), `conversation-limit.middleware.js`, `invoice-generator.js`, `daily-overage-calculator.js`, `partner-apply.routes.js`, notifier copy, `seed.js`, + a data migration mapping existing test subs → GROWTH.

**Positioning (marketing):** *"Your full AI sales team — one simple price. ৳999/mo. Start free for 14 days, no card."* Fair-use stated honestly but quietly: *"Comfortably covers a typical growing shop (~300 AI chats/mo). Need more? Add a top-up anytime."*

## 7. Scope guardrails (YAGNI)

**Not doing now:** full admin approval UI (script + endpoint suffices for launch), mid-cycle proration, multi-currency, dunning sequences beyond trial/limit pushes.

**Baked-in defaults:** yearly Growth ৳9,990 (2 months free); top-up packs unchanged; +50 buffer = free grace; 300 hidden from headlines but shown in in-app usage meter + fine print; 15% BD VAT retained.

## 8. Risks / watch-items

- Status-enum migration must be backward-safe (Postgres prod + SQLite dev).
- Plan definitions live in **two** files (FE `subscriptionPlans.ts` + BE `subscription.plans.js`) — keep them in lockstep.
- `underscored: true` timestamp accessor gotcha (see inbox-audit memory) — verify any new serializer reads `createdAt`/`updatedAt`.
- Existing test subscriptions must migrate cleanly; confirm whether to wipe test data instead.
- Deploy bundles previous uncommitted MVP-2 work + inbox fixes — sequence the deploy carefully.
