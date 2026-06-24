# Instagram Removal & Facebook-Only Launch — Final Audit Report

**Date:** 2026-06-24
**Branch:** `chore/fb-only-launch-remove-instagram`
**Scope:** Remove Instagram end-to-end (code, UI, tests, docs), trim the Meta App Review
surface to a clean **Facebook-only 5-scope** set, purge dead code / redundant files / repo
cruft, preserve single-and-multiple Facebook Page connect, and get the app
review-ready + launch-ready.

---

## 1. Executive summary

| Outcome | Status |
|---|---|
| Instagram removed from backend (provider, OAuth, webhook, comment parser, entity, services) | ✅ Done |
| Instagram removed from frontend (Chat Settings redesign, types, components, i18n, legal pages) | ✅ Done |
| Meta App Review surface reduced **8 → 5 scopes** (FB-only); IG + `business_management` not requested | ✅ Done |
| **Single & multiple** Facebook Page connect preserved (multi-select picker) | ✅ Done + test |
| Backend tests | ✅ **66 suites / 989 tests green** |
| Frontend production build (CI gate) | ✅ green |
| Frontend unit tests for changed components | ✅ **19 tests green** (incl. multi-page connect) |
| Dead code / redundant docs / repo hygiene | ✅ Done |
| Data safety (no destructive enum drop; idempotent guard migration) | ✅ Done |

**Net diff:** 59 files modified, 21 files deleted, 2 new files (guard migration + this audit) —
**~2,300 insertions / ~7,900 deletions** (the large deletion count is stale-doc + IG-provider removal).

---

## 2. Scope reduction (the App Review surface)

**Before (8 scopes):** `pages_show_list`, `pages_messaging`, `pages_read_engagement`,
`pages_manage_metadata`, `pages_manage_engagement`, `instagram_basic`,
`instagram_manage_messages`, `instagram_manage_comments`.

**After (5 scopes — Facebook only):** `pages_show_list`, `pages_messaging`,
`pages_read_engagement`, `pages_manage_metadata`, `pages_manage_engagement`.

**Webhook fields:** `messages` + `feed` on the **page** object only. No Instagram object
subscription.

The single scope source is `MetaMessengerProvider.DEFAULT_SCOPES`. The OAuth service calls
`buildAuthUrl({ scopes: [] })`, which falls back to that list — so the consent dialog requests
**exactly** these 5 permissions. The "unified FB+IG one-popup" 8-scope flow and the Instagram
provider are deleted. Two regression tests enforce this (see §5).

Why kept FB comment-to-DM (per decision): `pages_read_engagement` + `pages_manage_engagement`
power the shipped Facebook comment auto-reply feature, so they remain in scope. Only the three
`instagram_*` scopes and the never-requested `business_management` are absent.

---

## 3. Backend changes

**Deleted**
- `src/modules/channel-providers/providers/MetaInstagramProvider.js` (the entire IG provider)
- `src/modules/channel-providers/__tests__/MetaInstagramProvider.test.js`
- `scripts/meta-implementation-audit.js` (orphaned generator for a deleted doc; not in CI/package.json)

**Narrowed / simplified (representative pattern: delete IG-only artifacts; narrow shared code to `'facebook'`)**
- `provider.registry.js` — registry now resolves `facebook` only; `getProvider('instagram')` throws.
- `meta-oauth.service.js` — deleted `initiateUnifiedOAuth` / `handleUnifiedCallback` + the hardcoded 8-entry `unifiedScopes`; removed all `platform === 'instagram'` ternaries and `linkedFbPageId` plumbing.
- `meta-oauth.controller.js` + `meta-channel.routes.js` — removed the two `/oauth/*-unified` handlers + routes.
- `meta-oauth.validator.js` — `PLATFORM = Joi.valid('facebook')`.
- `integration/meta-webhook.routes.js` + `meta-webhook-events.handler.js` — removed the `object: 'instagram'` dispatch branch and deleted `handleInstagramWebhook`.
- `commentToDm/comment-to-dm.webhook-handler.js` — removed the IG `comments`-field branch (FB `feed` kept).
- `channel-providers/meta-channel.entity.js` — `platform` ENUM narrowed to `'facebook'`; removed the `linked_fb_page_id` model attribute (DB column left as a harmless orphan — see §6).
- `meta-channel.service.js` + `meta-channel.controller.js` — dropped `linkedFbPageId` param / persistence / serialization.
- `providers/MetaMessengerProvider.js` — stopped fetching/exposing `instagram_business_account` in `listManagedAssets` (removes IG signal from `GET /me/accounts`).
- `webhook/webhook.service.js` — `normalizePlatform` collapses to `'facebook'`; removed IG channel_type mapping.
- `subscription/subscription.plans.js` — `instagram_channel: false`.
- `conversation/conversation.controller.js` — `META_CHANNEL_PLATFORM` map drops `instagram` (legacy IG conversation rows resolve to undefined → skipped, not a crash).
- `ai/voice-processing.service.js` — IG media host `graph.instagram.com/v18.0` → `graph.facebook.com/v22.0`.
- Validators narrowed: `notification.routes.js`, `analytics.routes.js`, `conversation/ai-chatbot.routes.js`, `order/order-session.routes.js`.

---

## 4. Frontend changes

- **`app/components/ChatSettings.tsx`** — rewritten to a single Facebook-only flow: one
  **"Facebook Page সংযুক্ত করুন"** button → one popup → a **multi-select** page picker
  (connect one or several Pages at once). Removed the Instagram icon/colors/permissions/health
  rows, the "unified" flow, and the `instagramAccount`/`linkedFbPageId` UI. Preserved health
  grid, consent activity, AI auto-reply toggle, reconnect/test/disconnect, purpose labels.
- **`api/domains/meta-channels.ts`** — `MetaPlatform = 'facebook'`; deleted `initiateMetaUnifiedOAuth`, `handleMetaUnifiedOAuthCallback`, `MetaUnifiedAsset`, `MetaUnifiedCallbackResult`, the `instagramAccount` field, and `linkedFbPageId`.
- **Type narrowing** — `api/types/{conversation,customer,messaging}.ts`, `api/domains/comment-to-dm.ts` (dropped `instagram` from the Meta-platform unions; unrelated legacy members like `telegram`/`webchat` retained).
- **Components** — `Customers.tsx`, `inbox/InboxThreadList.tsx`, `UnifiedInbox.tsx` (META_CHANNELS), `CommentToDm/*`, `lib/policy/deny-messages.ts`, `Pricing.tsx`, `lib/subscriptionPlans.ts`.
- **Legal pages (Meta-review-critical)** — `PrivacyPolicy.tsx` and `TermsOfService.tsx` rewritten to FB-only; the privacy-policy permissions table now lists **exactly the 5 Facebook scopes** (IG rows removed) so it matches the submission.
- **i18n** — `en.json` + `bn.json`: removed IG connect keys and changed "Facebook & Instagram" marketing/auth copy to Facebook-only (JSON validated).

---

## 5. Tests

**Backend (jest) — 66 suites / 989 tests green.**
- Deleted `MetaInstagramProvider.test.js`.
- `provider.registry.test.js` — asserts `listProviders() === ['facebook']` and `getProvider('instagram')` throws.
- `MetaMessengerProvider.test.js` — **new** `buildAuthUrl()` assertions: requests **exactly** the 5 FB scopes and **never** `instagram_*` or `business_management`; `listManagedAssets` no longer exposes `instagramAccount`.
- `meta-oauth.service.test.js` — kept the "never requests `business_management`" guard, added "never injects any `instagram_*` scope"; removed unified-flow tests.
- `meta-oauth.controller.test.js`, `meta-webhook.routes.test.js` (IG payload now acked-but-dropped), `comment-to-dm.webhook-handler.test.js`, `webhook.service.test.js`, `meta-channel.entity.test.js` — updated to FB-only.

**Frontend (vitest) — 19 tests green** across `ChatSettings.test.tsx`, `Channels.test.tsx`,
`Reports.test.tsx`, including a **new multi-page test** that selects two Pages and asserts
`connectMetaAsset` is called once per Page with `platform: 'facebook'`.

**Frontend build (CI gate):** `vite build` green.

---

## 6. Data safety (non-destructive)

- **No historical migrations edited** (already applied in prod).
- **No destructive enum/column changes.** The Postgres `enum_meta_channels_platform` value
  `'instagram'` and the `linked_fb_page_id` column are intentionally **left in place** (dropping
  Postgres enum values is risky). The narrowed Sequelize entity prevents any new IG writes.
- **New idempotent guard migration** `20260624_001_disconnect_instagram_channels.js` marks any
  `meta_channels` row with `platform = 'instagram'` as `DISCONNECTED`. Expected to affect **0
  rows** in production (Instagram never passed App Review, so no real merchant connected an IG
  channel). Re-runnable (`status <> 'DISCONNECTED'` guard); `down` is a no-op.

---

## 7. Dead code, redundant files & repo hygiene

**Deleted (stale / superseded / redundant, all tracked):**
- `docs/archive/*` (6 files — WhatsApp/Telegram/referral/marketing era).
- Point-in-time / generated audit snapshots: `docs/codebase-audit-2026-06-16.md`,
  `docs/meta-app-review-implementation-audit.md`,
  `docs/meta-app-review-readiness-audit-2026-06-23.md`,
  `docs/meta-implementation-audit.generated.md`.
- `docs/meta-app-review-manual-test-plan.md` (redundant with `docs/testing/manual-and-playwright-test-plan.md` + `meta-app-review.md` §3).
- Redundant duplicate doc tree: the entire **root** `.easymod/meta-app-review/` (7 files) — the
  canonical copy lives in `EasyMod-backend/.easymod/meta-app-review/` (referenced by the public docs).
- Orphaned `EasyMod-backend/scripts/meta-implementation-audit.js`.

**Repo hygiene:**
- Removed 3 stale git worktrees (`feat+admin-panel-phase1`, `tested-bosworth`, `emod-partner-card`).

**Grep gate:** no *functional* Instagram references remain in live code/UI/i18n. What remains is
**intentional and documented**: historical migration SQL (enum value + `linked_fb_page_id`
column), the legacy `instagram`/`telegram`/`webchat` taxonomy values in customer/conversation
enums and validators (retained so stored historical conversation rows still read/validate),
JSDoc comments, and FB-only test assertions that explicitly check IG is absent.

**Left untouched on purpose:**
- Untracked **user-authored** content: `docs/user-guides/` and `easymod_first_time_setup_checklist_spec.md`.
- `claude-skills/` — a separate project (not tracked by this repo).
- `EasyMod-backend/.easymod/meta-app-review/test-user-credentials.md` — rewritten FB-only on disk
  but **git-ignored** (`.gitignore:93`), which is correct for a credentials spec; it stays a
  founder-local file.

---

## 8. Meta App Review readiness

**Reviewer-facing docs rewritten to FB-only / 5 scopes:**
- `docs/meta-app-review.md` (reviewer guide — matrix, test flow, screencast, minimization).
- `docs/meta-app-review-submission.md` (copy-paste form, 5 permission boxes, page-only webhooks).
- `EasyMod-backend/.easymod/meta-app-review/permissions-justification.md` (5 scopes).
- `EasyMod-backend/.easymod/meta-app-review/dashboard-setup-walkthrough.md` (IG steps removed/banner).
- `docs/testing/manual-and-playwright-test-plan.md` (FB-only banner + connect rows).
- `PrivacyPolicy.tsx` / `TermsOfService.tsx` (live pages now list exactly the 5 scopes).

**Code readiness:** ✅ scopes requested = scopes documented = scopes in the privacy policy (5,
FB-only); webhook verify (`hub.challenge`), GDPR data-deletion + deauthorize endpoints, and the
hard-verified webhook subscription all intact and unchanged.

**Remaining founder (non-code) tasks before submitting:**
- [ ] Business verification + App Dashboard config (App Domains, Privacy/Terms URLs, callback URLs).
- [ ] Subscribe the **page** webhook object to `messages` + `feed`; click **Verify and Save**.
- [ ] Provision the 3 test assets (Page, merchant login, roster test customer) — see `test-user-credentials.md`.
- [ ] Record the ~2.5-min FB-only screencast (per `meta-app-review.md` §4).
- [ ] Add the test customer to **App Roles → Testers** (Dev-mode webhook gating).
- [ ] Submit with the 5 permission boxes + reviewer notes from `meta-app-review-submission.md`.

---

## 9. Residual risks & deferred items

- **Nested stray `.git` dirs NOT removed** (`EasyMod-backend/.git`, `EasyMod-frontend/.git`).
  On inspection these were **not** the "stale dup on main" they were described as —
  `EasyMod-backend/.git` is on branch `codex/fix-meta-instagram-connect` with local commits
  (`417b4ec`) and many uncommitted changes (largely the shared working tree). Deleting them is
  irreversible and could destroy unverifiable local history, so per "look before deleting" I
  **left them**. They do not affect this PR (all commits are made from the root repo). Recommend
  the founder review/remove them manually when convenient.
- **Postgres enum value `'instagram'` and `linked_fb_page_id` column** remain in the DB
  (deliberate; an optional follow-up migration could drop them once there's confidence no
  tooling depends on them).
- **Re-enabling Instagram later** = re-add the provider + scopes and run a **second** Meta App
  Review.
- **Legacy taxonomy** (`instagram`/`telegram`/`webchat` in some enums/validators) retained for
  historical data integrity; a future pass could prune these holistically.

---

## 10. Verification commands

```bash
# Backend (blocking CI gate)
cd EasyMod-backend && npm test            # 66 suites / 989 tests green

# Frontend (blocking CI gate + unit)
cd EasyMod-frontend && npm run build      # vite build green
npx vitest run src/app/components/ChatSettings.test.tsx src/test/Channels.test.tsx src/test/Reports.test.tsx  # 19 green

# Grep gate — no functional IG references in live code
rg -n "instagram_basic|instagram_manage|graph\.instagram|getProvider\(['\"]instagram|MetaInstagramProvider|initiateUnified" \
   EasyMod-backend/src EasyMod-frontend/src --glob '!**/__tests__/**' --glob '!**/migrations/**'
```

Deploy path: branch → PR to `main` → CI (`test` job) green → merge to `main` → `ci-cd.yml`
builds images, deploys to the DigitalOcean droplet, runs `npm run migrate` (the 0-row guard
migration), and health-checks `/health/ready`.
