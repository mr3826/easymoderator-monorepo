# EasyModerator Internal Admin Panel — Phase 1 Design

**Date:** 2026-06-09
**Status:** Approved (design); pending implementation plan
**Scope:** Phase 1 only. Phase 2 (AI/Inbox health tab, Orders & Courier tab + retry, System Logs page, cost analytics) is previewed but **not** built here.

---

## 1. Goal

Give the EasyModerator operations team (not merchants) a safe, read-heavy internal
dashboard to monitor shops, debug the channel→inbox→AI→order→courier chain, and
control billing/trials/automation **without touching the database manually**.

This is an *operational* tool, not a product. Build only essentials. Reuse existing
services; never duplicate business logic.

---

## 2. Key codebase findings that shape this design

1. **No platform/operator role exists.** `user_shops.role` is `owner | admin | staff` —
   a *merchant's* team role inside their own shop. The frontend `AdminRoute` /
   `/app/admin/users` uses that tenant role. The only operator-level gate today is
   `partner-admin.routes.js`, which checks a static `x-admin-key` header.
   `failed-jobs.routes.js` has a literal TODO: "Add an isAdmin check here when the
   User model gains a role column." → We add a **distinct** platform role.

2. **Audit infrastructure already exists and matches the spec.** `AuditLog` entity
   (`user_id, shop_id, action, resource_type, resource_id, old_values, new_values,
   metadata, ip_address, user_agent`) + `AuditService.logOperation(...)`. **Reuse it.**
   No new audit table.

3. **Shop status lives on `Subscription`, not `Shop`.** `Subscription.status` ENUM:
   `active | inactive | cancelled | suspended | trialing | trial_expired | past_due`.
   `Shop` only has `is_active`. Dashboard "active/trial/suspended" buckets come from
   `Subscription.status`.

4. **Channel health is well-modeled.** `MetaChannel`: `platform`, `display_name`,
   `status` (`CONNECTED | TOKEN_EXPIRED | REVOKED | DISCONNECTED | ERROR`), `last_error`,
   `token_expires_at`, `webhook_last_verified_at`, `webhook_subscribed_fields`,
   `connected_at`, and the **encrypted** `page_access_token_ct` (must never leave the API).

5. **Billing mutations have reusable service functions:**
   - `subscription.service.updatePlan(shopId, userId, planData)` — plan upgrade/downgrade.
   - `subscription.service.grantBonusConversations(shopId, amount, reason)` — add credits.
   - Trial extension: write `Subscription.trial_ends_at` (+ keep `status='trialing'`) — thin new admin method.
   - Suspend/reactivate: set `Subscription.status` — thin new admin method.

6. **Auth caches that mutations must bust:**
   - `auth.middleware.checkSubscriptionStatus` caches `subscription:status` per shop for
     60s. Admin suspend/reactivate **must bust this cache** to take effect promptly.

7. **Emergency AI stop — the gate is channel-level.** The reply worker
   (`message-worker.js`) resolves AI settings as
   `{ ...getShopAISettings(shopId), ...getChannelAISettings(channel) }` — **channel
   overrides shop**. `MetaChannelSettings.automation_mode` is `NOT NULL DEFAULT 'AI_ACTIVE'`,
   so every channel row carries an explicit value that overrides shop-level. Two gates
   honor it: Guard 4 (`automation_mode === 'MANUAL'` → skip) and the Policy Engine's
   `draftMode.rule` (`NON_DELIVERING_MODES = {DRAFT, AI_SUGGEST_ONLY, MANUAL}` → block
   delivery). **Therefore an emergency stop must write `MANUAL` to every channel's
   settings, not just shop-level.** Reuse `metaChannelService.updateSettings(channelId,
   { automation_mode: 'MANUAL' })` ('automation_mode' is an allowed patch key).

---

## 3. Architecture & boundaries

- **New backend module** `src/modules/admin/` containing:
  - `admin.routes.js` — mounts all Phase 1 admin endpoints.
  - `admin.controller.js` — thin HTTP layer; validation, shaping, audit calls.
  - `admin.service.js` — read aggregations + thin mutations that **call existing services**.
  - (existing) `failed-jobs.routes.js` — folded under the same guard.
- **Mounted at `/api/admin`** in `src/modules/routes.js`. `authenticate` +
  `requirePlatformAdmin` applied at the **router level** so every endpoint is protected
  by default (no per-handler guard drift).
- **Admin keeps separate from merchant routes.** Admin endpoints never reuse the
  merchant `requireShop`/tenant-scoped middleware; they operate cross-tenant by design,
  gated solely by platform role.
- **Frontend:** lazy-loaded `/admin` section in the existing SPA (EasyMod-frontend),
  behind a new `PlatformAdminRoute` guard. Reuses the http client, CSRF, auth/session, i18n.

---

## 4. Admin authentication (foundation)

### 4.1 Data
- **Migration:** add nullable `platform_role` to `users`.
  Values: `SUPPORT_ADMIN | SUPER_ADMIN` (NULL = normal merchant user). Named distinctly so
  it can never collide with the tenant `user_shops.role`.

### 4.2 Token
- Add `platformRole` to the access-token payload at the single chokepoint
  `generateAccessToken(...)` (3 call sites in `auth.service.js` + 1 in `totp.controller.js`).
- `auth.middleware.authenticate` attaches `req.user.platformRole = decoded.platformRole`.
- `/me` (auth profile) response gains `platform_role` so the frontend guard knows.

### 4.3 Guard `requirePlatformAdmin(...allowedRoles)`
- New middleware `src/middleware/platform-admin.middleware.js`.
- Verifies `req.user.platformRole ∈ allowedRoles`.
- **Re-checks the DB value** (`users.platform_role`) with a 60s cache (same pattern as
  `token_version` in `auth.middleware`) so a revoked admin is locked out within ≤60s even
  with a still-valid JWT. High-privilege surface → worth the cheap lookup.
- **Policy:** reads → `[SUPPORT_ADMIN, SUPER_ADMIN]`; mutations → `[SUPER_ADMIN]`.
  (Confirmed with stakeholder: SUPPORT is read-only in Phase 1.)

### 4.4 Provisioning
- No self-service. Script `src/scripts/grant-platform-admin.js <email> <SUPPORT_ADMIN|SUPER_ADMIN>`
  sets/clears the column. Ops runs it once to bootstrap the first `SUPER_ADMIN`.

---

## 5. Audit (reuse)

Every mutation calls the existing
`AuditService.logOperation({ userId: <admin>, shopId: <target>, action, resourceType,
resourceId, oldValues, newValues, ipAddress: req.ip, userAgent: req.get('user-agent') })`.

Action namespace:
- `admin:suspend_shop`, `admin:reactivate_shop`
- `admin:extend_trial`
- `admin:add_credits`
- `admin:change_plan`
- `admin:mark_reconnect`
- `admin:emergency_ai_off`

`resourceType` ∈ `SHOP | SUBSCRIPTION | META_CHANNEL`. `before`/`after` carry the changed
fields only.

---

## 6. Dashboard — data sources (honesty matters)

**Phase 1 (real sources, shipped):**

| Metric | Source |
| --- | --- |
| total shops | `Shop.count()` |
| active shops | `Subscription` where `status = 'active'` |
| trial shops | `Subscription` where `status = 'trialing'` |
| suspended shops | `Subscription` where `status = 'suspended'` |
| messages today | `Message.count` (`created_at ≥ start-of-day`) |
| AI auto-replies today | `Message.count` where `sender = 'ai'` today |
| orders today | `Order.count` (`created_at ≥ start-of-day`) |

**Deferred to Phase 2 (no clean source yet → render as `—` with a "Phase 2" tooltip;
no fabricated numbers):** failed AI replies, courier-booking failures, estimated AI cost,
system error count.

Counts cached ~30s via `cacheService` (admin traffic is tiny). "Today" = UTC start-of-day
in Phase 1 (shop-timezone bucketing deferred).

---

## 7. Phase 1 endpoints (all under `/api/admin`, behind `requirePlatformAdmin`)

Reads (`SUPPORT_ADMIN` or `SUPER_ADMIN`):
- `GET /dashboard` — the metrics in §6.
- `GET /shops?search=&page=&limit=` — paginated; search by shop name / owner email.
  Each row: shop name, owner (name/email/phone via `UserShop role='owner'` → `User`),
  plan, trial end, status (`Subscription.status`), connected channel count
  (`MetaChannel` count), conversations used this month, created date.
- `GET /shops/:shopId` — **Overview**: shop info, owner info, subscription/trial status,
  usage summary (`conversations_used / conversations_limit`), onboarding status (from
  `shop.settings`).
- `GET /shops/:shopId/channels` — per `MetaChannel`: display name, platform, token status
  (`status` + `token_expires_at`), webhook status (`webhook_last_verified_at` +
  `webhook_subscribed_fields`), last message received (max `Message.created_at` on the
  channel's conversations), `last_error`. **`page_access_token_ct` is never returned.**
- `GET /shops/:shopId/billing` — plan, trial start/end, conversation quota, used,
  estimated cost (`—`, Phase 2).
- `GET /audit-logs?adminUserId=&shopId=&action=&startDate=&endDate=&page=&limit=` —
  all-shops audit feed with filters + pagination (new admin-scoped query in
  `audit.service` or `admin.service`).

Mutations (`SUPER_ADMIN` only; each writes an audit row):
- `PATCH /shops/:shopId/status` `{ status: 'suspended' | 'active' }` — sets
  `Subscription.status` + **busts `subscription:status` cache** for the shop.
- `PATCH /shops/:shopId/billing` `{ plan_code | plan_name | ... }` → `updatePlan(...)`.
- `POST /shops/:shopId/add-credits` `{ amount, reason }` → `grantBonusConversations(...)`.
- `POST /shops/:shopId/extend-trial` `{ days }` → advances `trial_ends_at`, keeps
  `status='trialing'`, busts `subscription:status` cache.
- `PATCH /shops/:shopId/channels/:channelId/reconnect` — mark reconnect required
  (`MetaChannel.status = 'TOKEN_EXPIRED'`).
- `POST /shops/:shopId/ai/emergency-off` — **EMERGENCY AI KILL SWITCH** (see §8).

**Deferred to Phase 2:** `GET /shops/:shopId/ai-health`, `GET /shops/:shopId/orders-health`,
`PATCH /shops/:shopId/ai-settings` (general OFF/DRAFT/AUTO + confidence threshold),
`GET /logs`, courier retry.

---

## 8. Emergency AI kill switch (Phase 1, SUPER_ADMIN only)

**Rationale:** if a merchant's AI starts replying incorrectly, support must stop
automation immediately without logging into the merchant app.

`POST /api/admin/shops/:shopId/ai/emergency-off`

Behavior:
1. For **every** `MetaChannel` of the shop, call
   `metaChannelService.updateSettings(channel.id, { automation_mode: 'MANUAL' })`.
   This is the authoritative stop — channel settings override shop settings in both the
   worker Guard 4 and the Policy Engine `draftMode` rule, and `MANUAL ∈ NON_DELIVERING_MODES`.
2. Also set **shop-level** `automation_mode = 'MANUAL'` (via the existing shop AI-settings
   update path) so the merchant's ChatSettings UI reflects the stopped state and any
   inherited path is consistent.
3. **Bust any AI-settings cache** the worker reads (shop AI settings cache in
   `shop.service`, and `metaChannelService.updateSettings` cache invalidation) so the stop
   takes effect on the next inbound message, not after a TTL.
4. Audit `admin:emergency_ai_off` with `before` = prior per-channel + shop modes,
   `after` = `MANUAL`.

Inbound messages still persist and the manual inbox still works — only **automated
delivery** is withheld. Re-enabling is intentionally **not** a one-click admin action in
Phase 1 (the merchant or a Phase 2 `ai-settings` PATCH restores the desired mode); this
keeps the emergency action unambiguous and prevents accidental re-enable.

---

## 9. Frontend (Phase 1, minimal)

Routes (inside the SPA, behind `PlatformAdminRoute`):
- `/admin` — dashboard cards (§6).
- `/admin/shops` — searchable, paginated table; row actions: view, suspend/reactivate.
- `/admin/shops/:shopId` — tabs:
  - **Overview** (shop/owner/subscription/usage/onboarding)
  - **Channels** (health table + "mark reconnect" + **"Emergency: stop AI"** button with a
    confirm dialog, SUPER_ADMIN only)
  - **Billing** (plan, trial, quota/used; actions: extend trial, add credits,
    upgrade/downgrade, suspend/reactivate)
  - **AI & Inbox** / **Orders & Courier** tabs are stubbed with a "Phase 2" placeholder.
- `/admin/audit-logs` — filterable, paginated audit feed.

New `src/api/domains/admin.ts` mirrors existing domain clients. Plain tables/cards reusing
existing UI primitives — no new design system, no fancy styling.

---

## 10. Tests (Phase 1)

**Authorization** (`platform-admin.middleware` + a representative route):
- Non-admin (NULL `platform_role`) → 403 on every admin route.
- `SUPPORT_ADMIN` → 200 on reads, 403 on mutations.
- `SUPER_ADMIN` → 200 on reads and mutations.
- Revoked admin (DB `platform_role` cleared) → 403 within the cache window despite a valid JWT.

**Critical mutations** (service + route):
- suspend → `Subscription.status='suspended'` **and** `subscription:status` cache busted **and** audit row written.
- extend-trial → `trial_ends_at` advanced by N days + audit row.
- add-credits → `grantBonusConversations` invoked with correct args + audit row.
- emergency AI off → `metaChannelService.updateSettings(..., {automation_mode:'MANUAL'})`
  called for **each** channel + shop-level set + audit row.

Jest runs in a `(cd EasyMod-backend && npx jest ...)` subshell — the repo has a nested
`.git` in `EasyMod-backend/` and root-level jest invocation hits the wrong tree.

---

## 11. README (deliverable)

`EasyMod-backend/src/modules/admin/README.md`:
- Permission matrix (SUPPORT_ADMIN read-only vs SUPER_ADMIN read+mutate; emergency action SUPER only).
- How to seed an admin (`grant-platform-admin.js`).
- Safe-operations guide (what each mutation does, what it touches, what it does NOT).
- What is masked / never exposed (encrypted tokens, secrets).

---

## 12. Phase 2 preview (not built now)

AI & Inbox health tab + general `ai-settings` PATCH (OFF/DRAFT/AUTO + confidence threshold),
Orders & Courier health tab + courier booking retry, System Logs page (webhook/AI/courier/
billing/queue-DLQ failures with filters), and cost analytics (estimated AI cost, error
counts) — all extend this same module + guard, and light up the dashboard `—` placeholders.

---

## 13. Non-goals (YAGNI)

- No separate admin app/deploy (lives in the existing SPA).
- No separate admin auth table (reuses `users` + `platform_role`).
- No new audit system (reuses `AuditService`).
- No direct DB writes from the frontend; all mutations go through guarded, audited endpoints.
- No one-click "re-enable AI" emergency action in Phase 1 (deliberate).
