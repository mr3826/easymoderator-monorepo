# EasyModerator Admin Panel (Phase 1)

Operator-only panel mounted at `/api/admin` (backend) and `/admin` (SPA). It lets the
EasyModerator team monitor shops and control billing/trials/automation **without touching
the database manually**. It is read-heavy and mutation-limited; every mutation is audited.

## Roles

| Role | Reads | Mutations | Emergency AI off |
| --- | --- | --- | --- |
| (none / normal merchant) | ✗ | ✗ | ✗ |
| `SUPPORT_ADMIN` | ✓ | ✗ | ✗ |
| `SUPER_ADMIN` | ✓ | ✓ | ✓ |

`platform_role` lives on `users` and is **distinct** from the tenant `user_shops.role`
(`owner`/`admin`/`staff`). The guard `requirePlatformAdmin` re-checks the DB value
(cached 60s) so revoking an admin takes effect within a minute even with a still-valid JWT.

## Seeding an admin

No self-service. An existing operator runs:

```bash
node src/scripts/grant-platform-admin.js <email> SUPER_ADMIN
node src/scripts/grant-platform-admin.js <email> SUPPORT_ADMIN
node src/scripts/grant-platform-admin.js <email> NONE   # revoke
```

The first `SUPER_ADMIN` must be bootstrapped this way (e.g. on the droplet).

## Endpoints

Reads (`SUPPORT_ADMIN` or `SUPER_ADMIN`):

- `GET /api/admin/dashboard`
- `GET /api/admin/shops?search=&page=&limit=`
- `GET /api/admin/shops/:shopId`
- `GET /api/admin/shops/:shopId/channels`
- `GET /api/admin/shops/:shopId/billing`
- `GET /api/admin/audit-logs?adminUserId=&shopId=&action=&startDate=&endDate=&page=&limit=`
- `GET /api/admin/failed-jobs` (BullMQ DLQ)

Mutations (`SUPER_ADMIN` only — each writes an audit row):

- `PATCH /api/admin/shops/:shopId/status` `{ status: 'suspended' | 'active' }`
- `PATCH /api/admin/shops/:shopId/billing` `{ plan_code | plan_name }`
- `POST  /api/admin/shops/:shopId/add-credits` `{ amount, reason }`
- `POST  /api/admin/shops/:shopId/extend-trial` `{ days }`
- `PATCH /api/admin/shops/:shopId/channels/:channelId/reconnect`
- `POST  /api/admin/shops/:shopId/ai/emergency-off`

## Safe operations

- **Suspend / reactivate** — sets `Subscription.status` and busts the 60s
  `subscription:status` cache. Suspended shops are blocked by `checkSubscriptionStatus`.
- **Extend trial** — advances `trial_ends_at` (1..90 days) and keeps status `trialing`.
- **Add credits** — calls `subscription.service.grantBonusConversations` (adds to `topup_balance`).
- **Change plan** — reuses `subscription.service.updatePlan` (no duplicated billing logic).
- **Mark reconnect** — sets a channel to `TOKEN_EXPIRED`; the merchant must re-OAuth.
- **Emergency AI off** (`SUPER_ADMIN`) — sets `automation_mode = MANUAL` on **every** channel
  (`MetaChannelSettings`, the authoritative layer the reply worker + Policy Engine read) **and**
  shop-level. Inbound messages still persist and the manual inbox still works; only automated
  delivery stops. There is intentionally **no** one-click re-enable in Phase 1 — restore the
  desired mode from the merchant app (or a Phase 2 `ai-settings` endpoint). This keeps the
  emergency action unambiguous and prevents accidental re-enable.

## Never exposed

Encrypted channel tokens (`page_access_token_ct`) and any secrets are **never** returned by
admin endpoints. The channels response omits the token field entirely.

## Audit

Every mutation writes an `AuditLog` row (admin user id, shop id, action, before/after, ip,
user-agent) via the shared `AuditService.logOperation`. Actions are namespaced `admin:*`
(`admin:suspend_shop`, `admin:reactivate_shop`, `admin:extend_trial`, `admin:add_credits`,
`admin:change_plan`, `admin:mark_reconnect`, `admin:emergency_ai_off`). View them at
`/admin/audit-logs`.

## Phase 2 (not built here)

AI & Inbox health tab + general `ai-settings` (OFF/DRAFT/AUTO + confidence threshold),
Orders & Courier health + courier retry, a System Logs page, and cost analytics. The
dashboard renders these as `—` until then.

## Tests

- `src/middleware/__tests__/platform-admin.middleware.test.js` — guard (role/cache/revocation).
- `src/modules/admin/__tests__/admin.service.test.js` — dashboard shaping + mutations.
- `src/modules/admin/__tests__/admin.authz.test.js` — router-level authorization.

Run: `npx jest src/middleware/__tests__/platform-admin.middleware.test.js src/modules/admin`
