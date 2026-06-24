# Easy Moderator — Final Launch-Readiness Audit

> **⚠️ SUPERSEDED (2026-06-24, later same day):** This document predates the **bKash subscription
> billing system** (PR #47, `e004f73`). The authoritative whole-company audit is now
> **`docs/launch/CLEVEL_FINAL_AUDIT_2026-06-24.md`** (C-level board review: CTO/CISO/CFO/CEO/COO).
> The billing paragraph in §5 below was corrected in place; everything else here remains accurate
> for the IG-removal / frontend / channel-scope topics it covers.

**Date:** 2026-06-24
**Author:** Engineering (Claude Code)
**Scope:** Whole-product readiness for the initial **Facebook-only** public launch.
**Production HEAD:** `main` @ `e004f73` (was `1f9416d` at time of writing) — deployed to the
DigitalOcean droplet, `/health/ready` = `200`.

This is the consolidated final audit. It supersedes and references the deeper, single-topic
audit `docs/instagram-removal-and-launch-readiness-audit-2026-06-24.md` (Instagram removal
detail) — read that for the file-by-file IG removal evidence.

---

## 1. Executive summary

Easy Moderator is **code-ready to launch as a Facebook-Pages-only** AI customer-service and
order-automation SaaS for Bangladeshi f-commerce sellers. In the run-up to launch the team:

1. **Removed Instagram end-to-end** (PR #43) — narrowed the Meta App Review surface from
   **8 scopes → 5** (Facebook only), deleted the IG provider/flows/tests/UI, kept multi-page
   Facebook connect intact, applied a non-destructive data-safety guard migration.
2. **Shipped the Shared Inbox outbound-attachment** path (PR #44) — agents can now reply with
   images and files that persist on the droplet and are publicly reachable for Meta Messenger,
   plus customer-profile enrichment and template CRUD.
3. **Fixed the last pre-launch frontend gaps** (PR #45, this session) — one mobile-responsive
   bug and the global-navigation translation gap.

**Test state (green):** Backend **999 tests / 66 suites**; Frontend **428 unit tests / 43 suites**;
frontend `tsc` build gate passing. CI `Test & Build Gate` green on every merge to `main`.

**Remaining launch blockers are non-code, founder-owned** (Meta App Review submission + the
10-shop activation smoke test). See §7.

---

## 2. What shipped this cycle

| PR | Title | Effect | State |
|----|-------|--------|-------|
| #43 | Remove Instagram — Facebook-only launch + Meta review trim | 8→5 scopes; IG code/UI/tests removed; multi-page FB preserved; guard migration | Merged `d9d2674`, deployed, verified |
| #44 | Shared Inbox outbound attachments + profile enrichment + template CRUD | Image/file replies persisted + public; profile enrichment; templates | Merged `0708682`, deployed, verified |
| #45 | Mobile-responsive Products table + i18n sidebar nav | Table no longer clips on mobile; global nav now i18n-driven | Merged `1f9416d`, deployed, verified |

---

## 3. Channel scope — Facebook only (locked)

- **Connectable channel:** Facebook Pages (Messenger DMs + comment-to-DM). Nothing else.
- **Meta App Review surface — 5 scopes:** `pages_show_list`, `pages_messaging`,
  `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_engagement`.
  Webhook fields: `messages` + `feed`. `business_management` is **not** requested.
- **Multi-page connect preserved:** uniqueness is on `(shop_id, meta_asset_id)`; the picker
  loops `selectedPageIds`, so a seller can connect one **or several** Pages. Verified by the
  multi-page connect test added in PR #43.
- **Legacy taxonomy retained, not connectable:** the `instagram`/`telegram`/`webchat`/`manual`
  enum values still present in some DB columns/validators are read-only historical taxonomy.
  No code path can create a new non-Facebook channel. The Postgres
  `enum_meta_channels_platform` value `instagram` and the orphan `linked_fb_page_id` column
  were intentionally **left in place** (dropping enum values on Postgres is risky); a 0-row
  idempotent guard migration disconnects any stray IG row. Optional cleanup deferred.

---

## 4. Frontend readiness — responsive + i18n

### 4.1 Mobile responsiveness — PASS (one fix applied)

The dashboard shell is already mobile-first: sidebar↔bottom-nav swap at `md`, single-pane
inbox via `mobilePanelOpen`, safe-area insets. The audit found **one** real clipping bug:

- **Products list table** (`Products.tsx`) was wrapped in `overflow-hidden`, cutting off the
  right-hand columns on phones with no way to reach them. **Fixed** (PR #45): wrapper →
  `overflow-x-auto`, table → `min-w-[720px]`, so it scrolls horizontally like every other
  data table. Orders/Customers tables already used this pattern.

No other components were found to clip, overflow, or break layout at 360px.

### 4.2 Translation (bn/en) — gap closed on the highest-visibility surface

- **Fixed (PR #45):** `DashboardLayout` (the shell on *every* screen) hardcoded its
  sidebar/bottom-nav labels in Bengali, so English-mode users still saw Bengali navigation.
  All labels moved to a new top-level **`nav.*`** i18n namespace (Bengali wording preserved
  1:1; English equivalents added).
- **"Missing key" findings were dead keys, not bugs:** a diff of `en.json` ↔ `bn.json` surfaced
  ~8 asymmetric keys (e.g. `orders.createModal.division/district/upazila`,
  `manageShop.paymentSettings.contactUs*`). These are **unused** — the live order modal reads
  `orders.form.*`. No user-facing impact; safe to delete in a later cleanup.
- **Tracked backlog (not a launch blocker):** ~200 hardcoded-Bengali strings remain across
  onboarding/settings/pricing/subscription screens (top offenders: `OnboardingWizard`,
  `ChatSettings`, `Pricing`, `Orders`, `Subscription`, `AISettingsForm`). They render correctly
  for the **default Bengali audience** but do not switch to English. Recommend migrating
  opportunistically when touching those screens; not worth a risky pre-launch bulk refactor.

---

## 5. Backend & platform readiness

- **Architecture:** modular monolith, one image in three roles (api / worker / scheduler) +
  Postgres / Redis / Qdrant; inbound webhooks enqueue to BullMQ and return `200` fast.
- **AI pipeline:** webhook → burst-coalesce → worker → intent routing → RAG (Qdrant, live
  prices from Postgres) → Gemini→OpenAI failover with circuit breaker → safety/confidence gate
  → AI-attribution marker → send. Embeddings via `openai` in prod (`local` is dev-only).
- **Meta compliance:** HMAC-verified webhooks (timing-safe), Business-Login OAuth with
  AES-256-encrypted page tokens at rest, GDPR data-deletion + deauthorize callbacks, consent +
  24-hour-window policy engine. Reviewer docs in `.easymod/meta-app-review/`.
- **Billing (updated by PR #47):** single **Growth** ৳999/mo all-in (VAT rate 0; 300 + 50-grace
  conversations) behind a card-less 14-day trial, plus **Partner** per-delivered-order tiers;
  bKash one-time-checkout renewals + bKash top-ups. **Conversations are the sole charge and are
  now metered at the live FB webhook chokepoint** (`meta-webhook-events.handler.js` →
  `trackUsage`, idempotent per 24h window; top-up balance drawn down before overage). It is a
  **soft meter**, not a hard block — the dead `conversation-limit.middleware.js` is DEPRECATED.
  Unpaid renewal invoices have a **3-day due window**, after which the failed-payment reconciler
  suspends the subscription and the AI pauses (manual inbox unaffected); paying reactivates.
- **Shared Inbox attachments (PR #44):** outbound images/files persist on the `backend_uploads`
  Docker volume and are served over HTTPS for Meta Messenger. Pre-launch volume/round-trip
  check is **Gate 9** in `LAUNCH_GATE_CHECKLIST.md`.

---

## 6. Test & CI evidence

| Suite | Result |
|-------|--------|
| Backend (Jest) | **999 passed / 66 suites** |
| Frontend unit (Vitest) | **428 passed / 43 suites** |
| Frontend build (`tsc` + Vite) | green (hard CI gate) |
| CI `Test & Build Gate` on `main` | green at `1f9416d` |
| Prod `/health/ready` | `200` |
| Prod homepage `/` | `200` |

---

## 7. Launch gate status (from `LAUNCH_GATE_CHECKLIST.md`)

| # | Gate | Status |
|---|------|--------|
| 1 | CI green on `main` | ✅ |
| 2 | Infra up (`/health/ready` 200) | ✅ |
| 3 | DB + Redis + Qdrant healthy | ✅ (verify `/health/detailed` on droplet) |
| 4 | DLQ empty (`message-dlq` = 0) | ⏳ verify on droplet via `launch:check` |
| 5 | Auto-reply canary fresh | ⏳ verify via `launch:check` |
| 6 | Canary green 7 straight days | ⏳ founder — watch ops channel for a week |
| 7 | ≥10 shops activated | ⏳ founder — 10-shop smoke test |
| 8 | Alerting reaches a human (Slack/Sentry) | ⏳ founder — trigger a test alert |
| 9 | Shared Inbox attachment round-trip | ⏳ founder — live FB tester upload smoke test |

**Code gates (1–3) are green. Gates 4–9 are operational/founder tasks**, not code work.

### Meta App Review — founder action items (non-code)
1. Submit the **5-scope Facebook-only** review with the trimmed permission justifications and
   FB-only screencast (button label "Facebook Page সংযুক্ত করুন", multi-page select shown).
2. Provide a Facebook Page test user / roster for the reviewer.
3. Record the screencast following `.easymod/meta-app-review/screencast-storyboards.md`.
4. Run the live attachment round-trip (Gate 9) with a Page tester.

---

## 8. Residual risks & deferred items

- **Hardcoded-Bengali backlog (~200 strings):** English mode is incomplete outside the shell.
  Low risk for a Bengali-first launch; migrate opportunistically. *(tracked)*
- **Dead i18n keys (~8):** harmless; delete in a later cleanup. *(tracked)*
- **Postgres enum value `instagram` + `linked_fb_page_id` column:** intentionally retained
  (safe). Optional hard cleanup deferred — would require a careful enum migration. *(deferred)*
- **Re-enabling Instagram later** = re-add provider/scopes/UI **and a second Meta App Review**.
  Not a regression risk now; a known cost if scope expands. *(deferred)*
- **Bundle size:** `react-vendor` / `mammoth-vendor` chunks exceed 500 kB (intentional vendor
  split). Tighten `manualChunks` only if first-load latency becomes a concern. *(informational)*
- **Repo hygiene:** stray nested `.git` dirs under `EasyMod-backend/` and `EasyMod-frontend/`
  remain — always run git from the repo root (`git -C <root>`). Cleanup left for the founder.

---

## 9. Conclusion

The codebase is **launch-ready for a Facebook-only release**. Everything within engineering's
control is shipped, tested, and live on `main` @ `1f9416d`. The only remaining launch blockers
are the founder-owned Meta App Review submission and the operational 10-shop activation smoke
test (gates 4–9). No code work is required to flip the launch switch once those pass.
