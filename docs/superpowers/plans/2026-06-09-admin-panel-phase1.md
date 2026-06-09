# EasyModerator Internal Admin Panel — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a guarded, read-heavy operations admin panel (backend `/api/admin` module + `/admin` SPA section) so the EasyModerator team can monitor shops, control billing/trials, inspect channel health, audit every admin action, and emergency-stop a shop's AI — reusing existing services.

**Architecture:** New `src/modules/admin/` backend module (routes → controller → service) mounted at `/api/admin` behind `authenticate` + a new `requirePlatformAdmin` guard. Mutations call existing services (`subscription.service`, `metaChannelService`, `shop.service`) and log via the existing `AuditService`. A new nullable `users.platform_role` column (`SUPPORT_ADMIN | SUPER_ADMIN`) is the sole authority, verified by a cached DB lookup in the guard. Frontend adds a lazy-loaded `/admin` section behind a `PlatformAdminRoute` guard reading `platform_role` from `/api/auth/me`.

**Tech Stack:** Node.js + Express + Sequelize (Postgres/SQLite), BullMQ, Jest + supertest (mock-heavy), React + react-router-dom v6 + axios httpClient, TypeScript.

---

## Conventions (read once)

- **Source of truth spec:** `docs/superpowers/specs/2026-06-09-admin-panel-phase1-design.md`.
- **Branch:** all work on a fresh branch `feat/admin-panel-phase1` cut from **`origin/main`** (NOT the current stale `mvp-2-feature`). See Task 1.
- **Backend tests run from the backend dir** (the repo has a nested `.git` in `EasyMod-backend/`):
  `(cd EasyMod-backend && npx jest <path> --runInBand)`.
- **Git commits** use `git -C /d/hexabyte/easy-moderator` and end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **HTTP success envelope:** `res.json({ success: true, data })`. **Errors:** `throw new AppError(msg, status)` and let the global handler format them (controllers are wrapped in try/catch → `next(err)`).
- **Refinement vs spec §4.2:** We do **not** modify `generateAccessToken`/login. The guard reads `users.platform_role` directly (cached 60s). This is fewer touch points and revocation-safe. `/me` still exposes `platform_role` for the frontend.
- **Role policy:** reads → `SUPPORT_ADMIN` or `SUPER_ADMIN`; mutations → `SUPER_ADMIN` only.

---

## File map

**Backend (create):**
- `EasyMod-backend/src/database/migrations/20260609_001_add_user_platform_role.js`
- `EasyMod-backend/src/middleware/platform-admin.middleware.js`
- `EasyMod-backend/src/modules/admin/admin.service.js`
- `EasyMod-backend/src/modules/admin/admin.controller.js`
- `EasyMod-backend/src/modules/admin/admin.routes.js`
- `EasyMod-backend/src/modules/admin/README.md`
- `EasyMod-backend/src/scripts/grant-platform-admin.js`
- `EasyMod-backend/src/middleware/__tests__/platform-admin.middleware.test.js`
- `EasyMod-backend/src/modules/admin/__tests__/admin.service.test.js`
- `EasyMod-backend/src/modules/admin/__tests__/admin.authz.integration.test.js`

**Backend (modify):**
- `EasyMod-backend/src/modules/user/user.entity.js` — add `platform_role` attribute.
- `EasyMod-backend/src/modules/auth/auth.service.js` — `getAuthContext` returns `platform_role`.
- `EasyMod-backend/src/modules/routes.js` — mount admin router + guard failed-jobs.
- `EasyMod-backend/src/modules/admin/failed-jobs.routes.js` — add `requirePlatformAdmin`.

**Frontend (create):**
- `EasyMod-frontend/src/api/domains/admin.ts`
- `EasyMod-frontend/src/shared/lib/auth/useIsPlatformAdmin.ts`
- `EasyMod-frontend/src/shared/components/guards/PlatformAdminRoute.tsx`
- `EasyMod-frontend/src/app/components/admin/AdminLayout.tsx`
- `EasyMod-frontend/src/app/components/admin/AdminDashboard.tsx`
- `EasyMod-frontend/src/app/components/admin/AdminShops.tsx`
- `EasyMod-frontend/src/app/components/admin/AdminShopDetail.tsx`
- `EasyMod-frontend/src/app/components/admin/AdminAuditLogs.tsx`

**Frontend (modify):**
- `EasyMod-frontend/src/app/routes.ts` — add `/admin` route subtree.
- `EasyMod-frontend/src/features/auth/types/index.ts` — add optional `platform_role` to the me/user type.

---

## Task 1: Branch setup

**Files:** none (git only).

- [ ] **Step 1: Fetch and branch off main**

```bash
git -C /d/hexabyte/easy-moderator fetch origin
git -C /d/hexabyte/easy-moderator checkout -b feat/admin-panel-phase1 origin/main
```

- [ ] **Step 2: Bring the committed spec + plan onto the new branch**

Both docs were committed on `mvp-2-feature`. Copy them forward by branch ref (covers both files regardless of which commit each landed in):

```bash
git -C /d/hexabyte/easy-moderator checkout mvp-2-feature -- docs/superpowers/specs/2026-06-09-admin-panel-phase1-design.md docs/superpowers/plans/2026-06-09-admin-panel-phase1.md
git -C /d/hexabyte/easy-moderator add docs/superpowers/
git -C /d/hexabyte/easy-moderator commit -m "docs(admin): carry Phase 1 admin panel spec + plan onto feature branch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Expected: clean branch `feat/admin-panel-phase1` with the docs present.

---

## Task 2: Migration — `users.platform_role`

**Files:**
- Create: `EasyMod-backend/src/database/migrations/20260609_001_add_user_platform_role.js`

- [ ] **Step 1: Write the migration**

Follow the existing migration style (raw `queryInterface`, idempotent, reversible).

```js
'use strict';

/**
 * Add nullable users.platform_role for EasyModerator operators.
 * NULL = normal merchant user. Distinct from the tenant user_shops.role.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('users');
    if (!table.platform_role) {
      await queryInterface.addColumn('users', 'platform_role', {
        type: Sequelize.STRING(20),
        allowNull: true,
        defaultValue: null,
      });
    }
    await queryInterface.addIndex('users', ['platform_role'], {
      name: 'users_platform_role_idx',
    }).catch(() => { /* index may already exist */ });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_platform_role_idx').catch(() => {});
    await queryInterface.removeColumn('users', 'platform_role').catch(() => {});
  },
};
```

> Note: we use `STRING(20)` not a Postgres ENUM — values are validated in code (`PLATFORM_ROLES`), and STRING avoids the ENUM-migration friction this repo has hit before.

- [ ] **Step 2: Run the migration locally**

Run: `(cd EasyMod-backend && npx sequelize-cli db:migrate)` — or the repo's migrate script (check `package.json`; the repo also supports `db:sync`). Expected: migration applies, `users.platform_role` exists.

- [ ] **Step 3: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-backend/src/database/migrations/20260609_001_add_user_platform_role.js
git -C /d/hexabyte/easy-moderator commit -m "feat(admin): add users.platform_role migration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: User entity + `/me` expose `platform_role`

**Files:**
- Modify: `EasyMod-backend/src/modules/user/user.entity.js`
- Modify: `EasyMod-backend/src/modules/auth/auth.service.js` (`getAuthContext`)

- [ ] **Step 1: Add the attribute to the User model**

In `user.entity.js`, add after the `settings` attribute (before the closing options object):

```js
    settings: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {}
    },
    // EasyModerator operator role. NULL = normal merchant user.
    // 'SUPPORT_ADMIN' (read-only) | 'SUPER_ADMIN' (read + mutate). Distinct from
    // the tenant user_shops.role (owner/admin/staff).
    platform_role: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: null
    }
```

- [ ] **Step 2: Expose it on `/me`**

Find `getAuthContext` in `auth.service.js`. It loads the user for `req.user.userId`. Ensure the returned context includes `platform_role`. Locate the user fetch (e.g. `User.findByPk(userId, { attributes: [...] })`) and:
1. add `'platform_role'` to the `attributes` array, and
2. add `platform_role: user.platform_role || null` to the returned object.

(If `getAuthContext` returns the whole user, just confirm `platform_role` is included and not stripped.)

- [ ] **Step 3: Smoke test**

Run: `(cd EasyMod-backend && node -e "const U=require('./src/modules/user/user.entity'); console.log(!!U.rawAttributes.platform_role)")`
Expected: prints `true`.

- [ ] **Step 4: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-backend/src/modules/user/user.entity.js EasyMod-backend/src/modules/auth/auth.service.js
git -C /d/hexabyte/easy-moderator commit -m "feat(admin): model platform_role and expose it on /me

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `requirePlatformAdmin` guard (TDD)

**Files:**
- Create: `EasyMod-backend/src/middleware/platform-admin.middleware.js`
- Test: `EasyMod-backend/src/middleware/__tests__/platform-admin.middleware.test.js`

- [ ] **Step 1: Write the failing test**

```js
'use strict';

jest.mock('../../utils/cache.service', () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
}));
jest.mock('../../modules/entities', () => ({
  User: { findByPk: jest.fn() },
}));

const cacheService = require('../../utils/cache.service');
const { User } = require('../../modules/entities');
const { requirePlatformAdmin, PLATFORM_ROLES } = require('../platform-admin.middleware');

function mockRes() {
  return {};
}

describe('requirePlatformAdmin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cacheService.get.mockResolvedValue(null);
  });

  it('rejects when no req.user', async () => {
    const next = jest.fn();
    await requirePlatformAdmin()({}, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects a normal user (platform_role NULL) with 403', async () => {
    User.findByPk.mockResolvedValue({ platform_role: null });
    const next = jest.fn();
    await requirePlatformAdmin()({ user: { userId: 'u1' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('allows SUPPORT_ADMIN for read routes (default allowed roles)', async () => {
    User.findByPk.mockResolvedValue({ platform_role: 'SUPPORT_ADMIN' });
    const req = { user: { userId: 'u1' } };
    const next = jest.fn();
    await requirePlatformAdmin()(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
    expect(req.platformRole).toBe('SUPPORT_ADMIN');
  });

  it('blocks SUPPORT_ADMIN when SUPER_ADMIN required (mutations)', async () => {
    User.findByPk.mockResolvedValue({ platform_role: 'SUPPORT_ADMIN' });
    const next = jest.fn();
    await requirePlatformAdmin(PLATFORM_ROLES.SUPER_ADMIN)({ user: { userId: 'u1' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('allows SUPER_ADMIN for mutations', async () => {
    User.findByPk.mockResolvedValue({ platform_role: 'SUPER_ADMIN' });
    const req = { user: { userId: 'u1' } };
    const next = jest.fn();
    await requirePlatformAdmin(PLATFORM_ROLES.SUPER_ADMIN)(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('uses cached role and skips DB when cache hit', async () => {
    cacheService.get.mockResolvedValue('SUPER_ADMIN');
    const req = { user: { userId: 'u1' } };
    const next = jest.fn();
    await requirePlatformAdmin(PLATFORM_ROLES.SUPER_ADMIN)(req, mockRes(), next);
    expect(User.findByPk).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `(cd EasyMod-backend && npx jest src/middleware/__tests__/platform-admin.middleware.test.js --runInBand)`
Expected: FAIL — `Cannot find module '../platform-admin.middleware'`.

- [ ] **Step 3: Implement the guard**

```js
'use strict';

const { AppError } = require('../utils/AppError');
const cacheService = require('../utils/cache.service');
const { User } = require('../modules/entities');

const PLATFORM_ROLES = Object.freeze({
  SUPPORT_ADMIN: 'SUPPORT_ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
});

const ALL_ADMIN_ROLES = [PLATFORM_ROLES.SUPPORT_ADMIN, PLATFORM_ROLES.SUPER_ADMIN];
const ROLE_CACHE_TTL_SECONDS = 60;

/**
 * Resolve the caller's platform_role, cached 60s to avoid a SELECT per request.
 * Returns null for normal users.
 */
async function resolvePlatformRole(userId) {
  const cacheKey = `user:${userId}:platform_role`;
  const cached = await cacheService.get(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached === 'NONE' ? null : cached;
  }
  const user = await User.findByPk(userId, { attributes: ['platform_role'] });
  const role = user?.platform_role || null;
  await cacheService.set(cacheKey, role || 'NONE', ROLE_CACHE_TTL_SECONDS);
  return role;
}

/**
 * Guard: require the caller to hold one of `allowedRoles` (default: any admin).
 * Must run AFTER `authenticate` (needs req.user.userId).
 * SUPER_ADMIN is implicitly allowed wherever SUPPORT_ADMIN is.
 *
 * Usage:
 *   router.use(authenticate, requirePlatformAdmin());                    // reads
 *   router.patch('/x', requirePlatformAdmin(PLATFORM_ROLES.SUPER_ADMIN)); // mutations
 */
function requirePlatformAdmin(...allowedRoles) {
  const allowed = allowedRoles.length ? allowedRoles : ALL_ADMIN_ROLES;
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new AppError('Authentication required.', 401);
      }
      const role = await resolvePlatformRole(userId);
      if (!role || !allowed.includes(role)) {
        throw new AppError('Forbidden: platform admin access required.', 403);
      }
      req.platformRole = role;
      next();
    } catch (err) {
      next(err instanceof AppError ? err : new AppError('Authorization failed.', 403));
    }
  };
}

module.exports = { requirePlatformAdmin, resolvePlatformRole, PLATFORM_ROLES, ALL_ADMIN_ROLES };
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `(cd EasyMod-backend && npx jest src/middleware/__tests__/platform-admin.middleware.test.js --runInBand)`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-backend/src/middleware/platform-admin.middleware.js EasyMod-backend/src/middleware/__tests__/platform-admin.middleware.test.js
git -C /d/hexabyte/easy-moderator commit -m "feat(admin): requirePlatformAdmin guard with cached DB role check

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Seeding script `grant-platform-admin.js`

**Files:**
- Create: `EasyMod-backend/src/scripts/grant-platform-admin.js`

- [ ] **Step 1: Implement the script**

```js
'use strict';

/**
 * Grant/revoke an EasyModerator platform admin role.
 *
 * Usage:
 *   node src/scripts/grant-platform-admin.js <email> <SUPPORT_ADMIN|SUPER_ADMIN|NONE>
 *
 * NONE clears the role (revokes admin access). Busts the 60s role cache so the
 * change takes effect immediately.
 */

const { sequelize } = require('../utils/database/database-setup');
const User = require('../modules/user/user.entity');
const cacheService = require('../utils/cache.service');

const VALID = ['SUPPORT_ADMIN', 'SUPER_ADMIN', 'NONE'];

async function main() {
  const [email, roleArg] = process.argv.slice(2);
  if (!email || !roleArg || !VALID.includes(roleArg)) {
    console.error('Usage: node src/scripts/grant-platform-admin.js <email> <SUPPORT_ADMIN|SUPER_ADMIN|NONE>');
    process.exit(1);
  }
  const role = roleArg === 'NONE' ? null : roleArg;

  await sequelize.authenticate();
  const user = await User.findOne({ where: { email } });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(2);
  }
  await user.update({ platform_role: role });
  await cacheService.set(`user:${user.id}:platform_role`, role || 'NONE', 60).catch(() => {});

  console.log(`OK: ${email} platform_role => ${role || 'NONE (revoked)'} (user ${user.id})`);
  await sequelize.close();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(3); });
```

- [ ] **Step 2: Manual verification (documented, not automated)**

Run (against a dev DB with a known user): `(cd EasyMod-backend && node src/scripts/grant-platform-admin.js you@example.com SUPER_ADMIN)`
Expected: `OK: you@example.com platform_role => SUPER_ADMIN (user ...)`.

- [ ] **Step 3: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-backend/src/scripts/grant-platform-admin.js
git -C /d/hexabyte/easy-moderator commit -m "feat(admin): grant-platform-admin seeding script

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `admin.service` reads + dashboard (TDD)

**Files:**
- Create: `EasyMod-backend/src/modules/admin/admin.service.js`
- Test: `EasyMod-backend/src/modules/admin/__tests__/admin.service.test.js`

This task builds the read functions: `getDashboard`, `listShops`, `getShopOverview`, `getShopChannels`, `getShopBilling`, `getAuditLogs`. Write them all, then their mutations come in later tasks.

- [ ] **Step 1: Write failing tests for the dashboard + shop list shaping**

```js
'use strict';

const startOfTodayUTC = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

jest.mock('../../entities', () => ({
  Shop:         { count: jest.fn(), findAndCountAll: jest.fn() },
  Subscription: { count: jest.fn(), findOne: jest.fn() },
  Message:      { count: jest.fn() },
  Order:        { count: jest.fn() },
  MetaChannel:  { count: jest.fn() },
  AuditLog:     { findAndCountAll: jest.fn() },
  User:         {},
  UserShop:     {},
  Conversation: {},
}));

const entities = require('../../entities');
const adminService = require('../admin.service');

describe('admin.service.getDashboard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('buckets shop counts by subscription status and returns Phase-2 nulls', async () => {
    entities.Shop.count.mockResolvedValue(10);
    entities.Subscription.count
      .mockResolvedValueOnce(6)  // active
      .mockResolvedValueOnce(3)  // trialing
      .mockResolvedValueOnce(1); // suspended
    entities.Message.count
      .mockResolvedValueOnce(120) // messages today
      .mockResolvedValueOnce(45); // ai replies today
    entities.Order.count.mockResolvedValue(8);

    const data = await adminService.getDashboard();

    expect(data.shops).toEqual({ total: 10, active: 6, trial: 3, suspended: 1 });
    expect(data.today.messages).toBe(120);
    expect(data.today.aiAutoReplies).toBe(45);
    expect(data.today.orders).toBe(8);
    // Phase 2 placeholders — explicitly null, never fabricated
    expect(data.today.failedAiReplies).toBeNull();
    expect(data.today.courierFailures).toBeNull();
    expect(data.today.estimatedAiCost).toBeNull();
    expect(data.today.systemErrors).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `(cd EasyMod-backend && npx jest src/modules/admin/__tests__/admin.service.test.js --runInBand)`
Expected: FAIL — `Cannot find module '../admin.service'`.

- [ ] **Step 3: Implement `admin.service.js`**

```js
'use strict';

const { Op } = require('sequelize');
const {
  Shop, Subscription, Message, Order, MetaChannel, AuditLog, User, UserShop, Conversation,
} = require('../entities');
const cacheService = require('../../utils/cache.service');
const subscriptionService = require('../subscription/subscription.service');
const metaChannelService = require('../channel-providers/meta-channel.service');
const shopService = require('../shop/shop.service');
const AuditService = require('../audit/audit.service');
const { AppError } = require('../../utils/AppError');

function startOfTodayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ── Dashboard ────────────────────────────────────────────────────────────────
async function getDashboard() {
  const cacheKey = 'admin:dashboard';
  const cached = await cacheService.get(cacheKey).catch(() => null);
  if (cached) return cached;

  const since = startOfTodayUTC();
  const [
    totalShops, activeShops, trialShops, suspendedShops,
    messagesToday, aiRepliesToday, ordersToday,
  ] = await Promise.all([
    Shop.count(),
    Subscription.count({ where: { status: 'active' } }),
    Subscription.count({ where: { status: 'trialing' } }),
    Subscription.count({ where: { status: 'suspended' } }),
    Message.count({ where: { created_at: { [Op.gte]: since } } }),
    Message.count({ where: { created_at: { [Op.gte]: since }, sender: 'ai' } }),
    Order.count({ where: { created_at: { [Op.gte]: since } } }),
  ]);

  const data = {
    shops: { total: totalShops, active: activeShops, trial: trialShops, suspended: suspendedShops },
    today: {
      messages: messagesToday,
      aiAutoReplies: aiRepliesToday,
      orders: ordersToday,
      // Phase 2 — no clean source yet. Render as "—" in the UI; never fabricate.
      failedAiReplies: null,
      courierFailures: null,
      estimatedAiCost: null,
      systemErrors: null,
    },
    generatedAt: new Date().toISOString(),
  };
  await cacheService.set(cacheKey, data, 30).catch(() => {});
  return data;
}

// ── Shops list ───────────────────────────────────────────────────────────────
async function listShops({ search = '', page = 1, limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const where = {};
  if (search) {
    where[Op.or] = [{ shop_name: { [Op.iLike]: `%${search}%` } }];
  }

  const { rows, count } = await Shop.findAndCountAll({
    where,
    include: [
      { model: Subscription, as: 'subscription', required: false },
      {
        model: User, as: 'users', required: false,
        through: { attributes: ['role'], where: { role: 'owner' } },
        attributes: ['id', 'full_name', 'email', 'phone'],
      },
    ],
    order: [['created_at', 'DESC']],
    limit: safeLimit,
    offset,
    distinct: true,
  });

  const shopIds = rows.map((s) => s.id);
  const channelCounts = await MetaChannel.count({
    where: { shop_id: { [Op.in]: shopIds.length ? shopIds : ['00000000-0000-0000-0000-000000000000'] } },
    group: ['shop_id'],
  }).catch(() => []);
  const channelCountByShop = {};
  (Array.isArray(channelCounts) ? channelCounts : []).forEach((c) => {
    channelCountByShop[c.shop_id] = parseInt(c.count, 10);
  });

  const data = rows.map((shop) => {
    const sub = shop.subscription || {};
    const owner = (shop.users && shop.users[0]) || null;
    return {
      id: shop.id,
      shopName: shop.shop_name || shop.name,
      owner: owner ? { name: owner.full_name, email: owner.email, phone: owner.phone } : null,
      plan: sub.plan_name || null,
      status: sub.status || null,
      trialEndsAt: sub.trial_ends_at || null,
      channelCount: channelCountByShop[shop.id] || 0,
      conversationsUsed: sub.conversations_used ?? null,
      conversationsLimit: sub.conversations_limit ?? null,
      createdAt: shop.created_at,
    };
  });

  return { items: data, total: count, page: safePage, limit: safeLimit };
}

// ── Shop overview ────────────────────────────────────────────────────────────
async function getShopOverview(shopId) {
  const shop = await Shop.findByPk(shopId, {
    include: [
      { model: Subscription, as: 'subscription', required: false },
      {
        model: User, as: 'users', required: false,
        through: { attributes: ['role'] },
        attributes: ['id', 'full_name', 'email', 'phone'],
      },
    ],
  });
  if (!shop) throw new AppError('Shop not found', 404);

  const sub = shop.subscription || {};
  const owner = (shop.users || []).find((u) => u.UserShop?.role === 'owner') || (shop.users || [])[0] || null;
  const settings = shop.settings || {};

  return {
    shop: {
      id: shop.id,
      shopName: shop.shop_name || shop.name,
      uniqueCode: shop.unique_code,
      isActive: shop.is_active,
      timezone: shop.timezone,
      createdAt: shop.created_at,
    },
    owner: owner ? { id: owner.id, name: owner.full_name, email: owner.email, phone: owner.phone } : null,
    subscription: {
      planName: sub.plan_name || null,
      status: sub.status || null,
      trialEndsAt: sub.trial_ends_at || null,
      currentPeriodEnd: sub.current_period_end || null,
    },
    usage: {
      conversationsUsed: sub.conversations_used ?? null,
      conversationsLimit: sub.conversations_limit ?? null,
      topupBalance: sub.topup_balance ?? 0,
    },
    onboarding: {
      completed: Boolean(settings.onboarding?.completed ?? settings.onboardingCompleted ?? false),
      raw: settings.onboarding || null,
    },
  };
}

// ── Channels (NEVER expose page_access_token_ct) ──────────────────────────────
async function getShopChannels(shopId) {
  const channels = await metaChannelService.listByShop(shopId);
  return channels.map((c) => ({
    id: c.id,
    displayName: c.display_name,
    platform: c.platform,
    status: c.status,                                   // CONNECTED | TOKEN_EXPIRED | ...
    tokenExpiresAt: c.token_expires_at || null,
    webhookLastVerifiedAt: c.webhook_last_verified_at || null,
    webhookSubscribedFields: c.webhook_subscribed_fields || null,
    lastError: c.last_error || null,
    connectedAt: c.connected_at || null,
    // token field intentionally omitted
  }));
}

// ── Billing read ──────────────────────────────────────────────────────────────
async function getShopBilling(shopId) {
  const sub = await Subscription.findOne({ where: { shop_id: shopId } });
  if (!sub) throw new AppError('Subscription not found', 404);
  return {
    planName: sub.plan_name,
    planCode: sub.plan_code,
    status: sub.status,
    trialStart: sub.current_period_start,
    trialEndsAt: sub.trial_ends_at,
    conversationsLimit: sub.conversations_limit,
    conversationsUsed: sub.conversations_used,
    topupBalance: sub.topup_balance,
    estimatedAiCost: null, // Phase 2
  };
}

// ── Audit logs (cross-shop, filtered) ─────────────────────────────────────────
async function getAuditLogs({ adminUserId, shopId, action, startDate, endDate, page = 1, limit = 50 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const where = {};
  if (adminUserId) where.user_id = adminUserId;
  if (shopId) where.shop_id = shopId;
  if (action) where.action = action;
  if (startDate || endDate) {
    where.created_at = {};
    if (startDate) where.created_at[Op.gte] = new Date(startDate);
    if (endDate) where.created_at[Op.lte] = new Date(endDate);
  }
  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
    include: [{ model: User, as: 'user', attributes: ['id', 'full_name', 'email'], required: false }],
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      shopId: r.shop_id,
      admin: r.user ? { id: r.user.id, name: r.user.full_name, email: r.user.email } : null,
      oldValues: r.old_values,
      newValues: r.new_values,
      ipAddress: r.ip_address,
      createdAt: r.created_at,
    })),
    total: count, page: safePage, limit: safeLimit,
  };
}

module.exports = {
  getDashboard, listShops, getShopOverview, getShopChannels, getShopBilling, getAuditLogs,
  // mutations added in later tasks:
};
```

> Note: `Shop.belongsTo(Subscription, { as: 'subscription' })` and `Shop.hasMany(MetaChannel)` associations — verify the alias in `entities.js`. If `subscription` alias differs, adjust the `as` here and in tests. (Subscription has a unique index on `shop_id`, so the belongsTo/hasOne is 1:1.)

- [ ] **Step 4: Run the test to confirm pass**

Run: `(cd EasyMod-backend && npx jest src/modules/admin/__tests__/admin.service.test.js --runInBand)`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-backend/src/modules/admin/admin.service.js EasyMod-backend/src/modules/admin/__tests__/admin.service.test.js
git -C /d/hexabyte/easy-moderator commit -m "feat(admin): admin.service reads (dashboard, shops, overview, channels, billing, audit)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Mutations in `admin.service` (TDD)

**Files:**
- Modify: `EasyMod-backend/src/modules/admin/admin.service.js`
- Modify: `EasyMod-backend/src/modules/admin/__tests__/admin.service.test.js`

Add: `setShopStatus`, `extendTrial`, `addCredits`, `changePlan`, `markChannelReconnect`, `emergencyDisableAi`. Each is a thin wrapper over an existing service + cache-bust; **audit logging happens in the controller** (it has `req`), so these return `{ before, after }` for the controller to log.

- [ ] **Step 1: Write failing tests**

```js
describe('admin.service mutations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('setShopStatus suspends and busts the subscription cache', async () => {
    const update = jest.fn().mockResolvedValue(true);
    entities.Subscription.findOne.mockResolvedValue({ status: 'active', update });
    const cacheService = require('../../../utils/cache.service');
    jest.spyOn(cacheService, 'deleteForShop').mockResolvedValue();

    const res = await adminService.setShopStatus('shop-1', 'suspended');

    expect(update).toHaveBeenCalledWith({ status: 'suspended' });
    expect(cacheService.deleteForShop).toHaveBeenCalledWith('shop-1', 'subscription:status');
    expect(res).toEqual({ before: { status: 'active' }, after: { status: 'suspended' } });
  });

  it('emergencyDisableAi sets MANUAL on every channel + shop level', async () => {
    const metaChannelService = require('../../channel-providers/meta-channel.service');
    const shopService = require('../../shop/shop.service');
    jest.spyOn(metaChannelService, 'listByShop').mockResolvedValue([
      { id: 'ch-1' }, { id: 'ch-2' },
    ]);
    jest.spyOn(metaChannelService, 'getSettings').mockResolvedValue({ automation_mode: 'AI_ACTIVE' });
    jest.spyOn(metaChannelService, 'updateSettings').mockResolvedValue({});
    jest.spyOn(shopService, 'updateShopAiSettings').mockResolvedValue({});

    const res = await adminService.emergencyDisableAi('shop-1', 'admin-1');

    expect(metaChannelService.updateSettings).toHaveBeenCalledWith('ch-1', { automation_mode: 'MANUAL' });
    expect(metaChannelService.updateSettings).toHaveBeenCalledWith('ch-2', { automation_mode: 'MANUAL' });
    expect(shopService.updateShopAiSettings).toHaveBeenCalledWith('shop-1', 'admin-1', { automation_mode: 'MANUAL' });
    expect(res.after).toEqual({ automation_mode: 'MANUAL', channelsAffected: 2 });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `(cd EasyMod-backend && npx jest src/modules/admin/__tests__/admin.service.test.js -t "mutations" --runInBand)`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Implement the mutations (append to `admin.service.js` before `module.exports`)**

```js
// ── Mutations ─────────────────────────────────────────────────────────────────
const SUBSCRIPTION_STATUS_CACHE_KEY = 'subscription:status';

async function bustSubscriptionStatusCache(shopId) {
  await cacheService.deleteForShop(shopId, SUBSCRIPTION_STATUS_CACHE_KEY).catch(() => {});
}

async function setShopStatus(shopId, status) {
  if (!['suspended', 'active'].includes(status)) throw new AppError('status must be suspended|active', 400);
  const sub = await Subscription.findOne({ where: { shop_id: shopId } });
  if (!sub) throw new AppError('Subscription not found', 404);
  const before = { status: sub.status };
  await sub.update({ status });
  await bustSubscriptionStatusCache(shopId);
  return { before, after: { status } };
}

async function extendTrial(shopId, days) {
  const n = parseInt(days, 10);
  if (!Number.isInteger(n) || n <= 0 || n > 90) throw new AppError('days must be 1..90', 400);
  const sub = await Subscription.findOne({ where: { shop_id: shopId } });
  if (!sub) throw new AppError('Subscription not found', 404);
  const base = sub.trial_ends_at && new Date(sub.trial_ends_at) > new Date()
    ? new Date(sub.trial_ends_at) : new Date();
  const newEnd = new Date(base.getTime() + n * 24 * 60 * 60 * 1000);
  const before = { trial_ends_at: sub.trial_ends_at, status: sub.status };
  await sub.update({ trial_ends_at: newEnd, status: 'trialing' });
  await bustSubscriptionStatusCache(shopId);
  return { before, after: { trial_ends_at: newEnd, status: 'trialing' } };
}

async function addCredits(shopId, amount, reason = 'admin_grant') {
  const n = parseInt(amount, 10);
  if (!Number.isInteger(n) || n <= 0 || n > 100000) throw new AppError('amount must be 1..100000', 400);
  const before = await Subscription.findOne({ where: { shop_id: shopId }, attributes: ['topup_balance'] });
  await subscriptionService.grantBonusConversations(shopId, n, reason);
  const after = await Subscription.findOne({ where: { shop_id: shopId }, attributes: ['topup_balance'] });
  return {
    before: { topup_balance: before?.topup_balance ?? null },
    after: { topup_balance: after?.topup_balance ?? null, granted: n },
  };
}

async function changePlan(shopId, adminUserId, planData) {
  const sub = await Subscription.findOne({ where: { shop_id: shopId }, attributes: ['plan_name', 'plan_code'] });
  const before = { plan_name: sub?.plan_name, plan_code: sub?.plan_code };
  // updatePlan(shopId, userId, planData) — reuse the merchant billing path.
  const updated = await subscriptionService.updatePlan(shopId, adminUserId, planData);
  return { before, after: { plan_name: updated?.plan_name ?? planData.plan_name, plan_code: planData.plan_code } };
}

async function markChannelReconnect(shopId, channelId) {
  const channels = await metaChannelService.listByShop(shopId);
  const ch = channels.find((c) => c.id === channelId);
  if (!ch) throw new AppError('Channel not found for this shop', 404);
  const before = { status: ch.status };
  await metaChannelService.updateStatus(channelId, 'TOKEN_EXPIRED', 'Reconnect requested by admin');
  return { before, after: { status: 'TOKEN_EXPIRED' } };
}

/**
 * EMERGENCY: hard-stop a shop's AI. Channel settings override shop settings in
 * both the worker Guard 4 and the Policy Engine draftMode rule, so we set
 * automation_mode=MANUAL on EVERY channel, plus shop-level for UI consistency.
 */
async function emergencyDisableAi(shopId, adminUserId) {
  const channels = await metaChannelService.listByShop(shopId);
  const before = { channels: [] };
  for (const ch of channels) {
    let prevMode = null;
    try { prevMode = (await metaChannelService.getSettings(ch.id))?.automation_mode ?? null; } catch { /* ignore */ }
    before.channels.push({ channelId: ch.id, automation_mode: prevMode });
    await metaChannelService.updateSettings(ch.id, { automation_mode: 'MANUAL' });
  }
  // shop-level (the worker reads getShopAiSettings as the base layer)
  await shopService.updateShopAiSettings(shopId, adminUserId, { automation_mode: 'MANUAL' });
  return { before, after: { automation_mode: 'MANUAL', channelsAffected: channels.length } };
}
```

Then extend `module.exports` to include:
```js
  setShopStatus, extendTrial, addCredits, changePlan, markChannelReconnect, emergencyDisableAi,
```

- [ ] **Step 4: Run the tests to confirm pass**

Run: `(cd EasyMod-backend && npx jest src/modules/admin/__tests__/admin.service.test.js --runInBand)`
Expected: PASS (dashboard + mutations).

- [ ] **Step 5: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-backend/src/modules/admin/admin.service.js EasyMod-backend/src/modules/admin/__tests__/admin.service.test.js
git -C /d/hexabyte/easy-moderator commit -m "feat(admin): admin.service mutations (status, trial, credits, plan, reconnect, emergency AI off)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: `admin.controller` + `admin.routes` (wires reads, mutations, audit)

**Files:**
- Create: `EasyMod-backend/src/modules/admin/admin.controller.js`
- Create: `EasyMod-backend/src/modules/admin/admin.routes.js`
- Modify: `EasyMod-backend/src/modules/routes.js`

- [ ] **Step 1: Implement the controller**

Every mutation handler logs to `AuditService` using the `{ before, after }` returned by the service.

```js
'use strict';

const adminService = require('./admin.service');
const AuditService = require('../audit/audit.service');

const ok = (res, data) => res.json({ success: true, data });

function auditCtx(req) {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') || null };
}

// ── Reads ──
exports.getDashboard = async (req, res, next) => {
  try { ok(res, await adminService.getDashboard()); } catch (e) { next(e); }
};
exports.listShops = async (req, res, next) => {
  try { ok(res, await adminService.listShops(req.query)); } catch (e) { next(e); }
};
exports.getShopOverview = async (req, res, next) => {
  try { ok(res, await adminService.getShopOverview(req.params.shopId)); } catch (e) { next(e); }
};
exports.getShopChannels = async (req, res, next) => {
  try { ok(res, await adminService.getShopChannels(req.params.shopId)); } catch (e) { next(e); }
};
exports.getShopBilling = async (req, res, next) => {
  try { ok(res, await adminService.getShopBilling(req.params.shopId)); } catch (e) { next(e); }
};
exports.getAuditLogs = async (req, res, next) => {
  try { ok(res, await adminService.getAuditLogs(req.query)); } catch (e) { next(e); }
};

// ── Mutations (audited) ──
exports.setShopStatus = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const { status } = req.body;
    const { before, after } = await adminService.setShopStatus(shopId, status);
    await AuditService.logOperation({
      userId: req.user.userId, shopId,
      action: status === 'suspended' ? 'admin:suspend_shop' : 'admin:reactivate_shop',
      resourceType: 'SUBSCRIPTION', resourceId: shopId,
      oldValues: before, newValues: after, ...auditCtx(req),
    });
    ok(res, after);
  } catch (e) { next(e); }
};

exports.extendTrial = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const { before, after } = await adminService.extendTrial(shopId, req.body.days);
    await AuditService.logOperation({
      userId: req.user.userId, shopId, action: 'admin:extend_trial',
      resourceType: 'SUBSCRIPTION', resourceId: shopId,
      oldValues: before, newValues: after, ...auditCtx(req),
    });
    ok(res, after);
  } catch (e) { next(e); }
};

exports.addCredits = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const { before, after } = await adminService.addCredits(shopId, req.body.amount, req.body.reason);
    await AuditService.logOperation({
      userId: req.user.userId, shopId, action: 'admin:add_credits',
      resourceType: 'SUBSCRIPTION', resourceId: shopId,
      oldValues: before, newValues: after, ...auditCtx(req),
    });
    ok(res, after);
  } catch (e) { next(e); }
};

exports.changePlan = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const { before, after } = await adminService.changePlan(shopId, req.user.userId, req.body);
    await AuditService.logOperation({
      userId: req.user.userId, shopId, action: 'admin:change_plan',
      resourceType: 'SUBSCRIPTION', resourceId: shopId,
      oldValues: before, newValues: after, ...auditCtx(req),
    });
    ok(res, after);
  } catch (e) { next(e); }
};

exports.markChannelReconnect = async (req, res, next) => {
  try {
    const { shopId, channelId } = req.params;
    const { before, after } = await adminService.markChannelReconnect(shopId, channelId);
    await AuditService.logOperation({
      userId: req.user.userId, shopId, action: 'admin:mark_reconnect',
      resourceType: 'META_CHANNEL', resourceId: channelId,
      oldValues: before, newValues: after, ...auditCtx(req),
    });
    ok(res, after);
  } catch (e) { next(e); }
};

exports.emergencyDisableAi = async (req, res, next) => {
  try {
    const { shopId } = req.params;
    const { before, after } = await adminService.emergencyDisableAi(shopId, req.user.userId);
    await AuditService.logOperation({
      userId: req.user.userId, shopId, action: 'admin:emergency_ai_off',
      resourceType: 'SHOP', resourceId: shopId,
      oldValues: before, newValues: after, ...auditCtx(req),
    });
    ok(res, after);
  } catch (e) { next(e); }
};
```

- [ ] **Step 2: Implement the router**

```js
'use strict';

const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const { requirePlatformAdmin, PLATFORM_ROLES } = require('../../middleware/platform-admin.middleware');
const ctrl = require('./admin.controller');

const router = express.Router();

// Every admin route requires auth + at least SUPPORT_ADMIN (reads).
router.use(authenticate, requirePlatformAdmin());

const superOnly = requirePlatformAdmin(PLATFORM_ROLES.SUPER_ADMIN);

// Reads
router.get('/dashboard', ctrl.getDashboard);
router.get('/shops', ctrl.listShops);
router.get('/shops/:shopId', ctrl.getShopOverview);
router.get('/shops/:shopId/channels', ctrl.getShopChannels);
router.get('/shops/:shopId/billing', ctrl.getShopBilling);
router.get('/audit-logs', ctrl.getAuditLogs);

// Mutations (SUPER_ADMIN only)
router.patch('/shops/:shopId/status', superOnly, ctrl.setShopStatus);
router.patch('/shops/:shopId/billing', superOnly, ctrl.changePlan);
router.post('/shops/:shopId/add-credits', superOnly, ctrl.addCredits);
router.post('/shops/:shopId/extend-trial', superOnly, ctrl.extendTrial);
router.patch('/shops/:shopId/channels/:channelId/reconnect', superOnly, ctrl.markChannelReconnect);
router.post('/shops/:shopId/ai/emergency-off', superOnly, ctrl.emergencyDisableAi);

module.exports = router;
```

- [ ] **Step 3: Mount it in `src/modules/routes.js`**

Add near the other `/admin/*` mounts (after the `router.use('/admin/partner', ...)` line):

```js
router.use('/admin', require('./admin/admin.routes'));
```

> Express matches the more specific `/admin/partner` and `/admin/failed-jobs` mounts as well; the new `/admin` router only defines `dashboard|shops|audit-logs`, so there is no path collision. Place this line AFTER the partner/failed-jobs mounts to be safe.

- [ ] **Step 4: Sanity check the app boots**

Run: `(cd EasyMod-backend && node -e "require('./src/app'); console.log('app loaded ok')")`
Expected: prints `app loaded ok` (no require/throw).

- [ ] **Step 5: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-backend/src/modules/admin/admin.controller.js EasyMod-backend/src/modules/admin/admin.routes.js EasyMod-backend/src/modules/routes.js
git -C /d/hexabyte/easy-moderator commit -m "feat(admin): admin controller + routes mounted at /api/admin with guard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Authorization integration test (TDD, supertest)

**Files:**
- Create: `EasyMod-backend/src/modules/admin/__tests__/admin.authz.integration.test.js`

Mirror the mock-heavy supertest pattern from `shop.api.integration.test.js`.

- [ ] **Step 1: Write the test**

```js
'use strict';

const redisStore = {};
jest.mock('../../../utils/redis-client', () => ({
  get: jest.fn(async (k) => redisStore[k] ?? null),
  set: jest.fn(async (k, v) => { redisStore[k] = v; }),
  del: jest.fn(async (k) => { delete redisStore[k]; }),
  setex: jest.fn(async (k, _t, v) => { redisStore[k] = v; }),
}));
jest.mock('../../../utils/structured-logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

// Auth middleware: inject a fixed user; vary platform_role via the User mock.
jest.mock('../../../middleware/auth.middleware', () => ({
  authenticate: (req, _res, next) => { req.user = { userId: 'admin-1', email: 'a@x.io' }; next(); },
  checkSubscriptionStatus: (_req, _res, next) => next(),
}));

const platformRoleHolder = { value: null };
jest.mock('../../entities', () => ({
  User: { findByPk: jest.fn(async () => ({ platform_role: platformRoleHolder.value })) },
  Shop: { count: jest.fn(async () => 0) },
  Subscription: { count: jest.fn(async () => 0), findOne: jest.fn() },
  Message: { count: jest.fn(async () => 0) },
  Order: { count: jest.fn(async () => 0) },
  MetaChannel: { count: jest.fn(async () => []) },
  AuditLog: { findAndCountAll: jest.fn(async () => ({ rows: [], count: 0 })) },
  UserShop: {}, Conversation: {},
}));
// Force the guard's cache to miss so it reads the (mocked) User row each time.
jest.mock('../../../utils/cache.service', () => ({
  get: jest.fn(async () => null),
  set: jest.fn(async () => {}),
  deleteForShop: jest.fn(async () => {}),
}));

const request = require('supertest');
const app = require('../../../app');

describe('admin authz', () => {
  beforeEach(() => { platformRoleHolder.value = null; });

  it('403 for a normal user on GET /api/admin/dashboard', async () => {
    platformRoleHolder.value = null;
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(403);
  });

  it('200 for SUPPORT_ADMIN on a read route', async () => {
    platformRoleHolder.value = 'SUPPORT_ADMIN';
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('403 for SUPPORT_ADMIN on a mutation', async () => {
    platformRoleHolder.value = 'SUPPORT_ADMIN';
    const res = await request(app).patch('/api/admin/shops/shop-1/status').send({ status: 'suspended' });
    expect(res.status).toBe(403);
  });

  it('allows SUPER_ADMIN on a mutation (reaches the handler)', async () => {
    platformRoleHolder.value = 'SUPER_ADMIN';
    const { Subscription } = require('../../entities');
    Subscription.findOne.mockResolvedValue({ status: 'active', update: jest.fn(async () => {}) });
    const res = await request(app).patch('/api/admin/shops/shop-1/status').send({ status: 'suspended' });
    expect([200, 201]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run it**

Run: `(cd EasyMod-backend && npx jest src/modules/admin/__tests__/admin.authz.integration.test.js --runInBand)`
Expected: PASS (4 tests). If the app requires extra mocks to boot (e.g. queue/redis), add the same mocks used by `shop.api.integration.test.js`.

- [ ] **Step 3: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-backend/src/modules/admin/__tests__/admin.authz.integration.test.js
git -C /d/hexabyte/easy-moderator commit -m "test(admin): authorization integration tests for /api/admin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Guard the existing failed-jobs route

**Files:**
- Modify: `EasyMod-backend/src/modules/admin/failed-jobs.routes.js`

- [ ] **Step 1: Add the platform-admin guard**

Replace the `router.use(authenticate);` line with:

```js
const { requirePlatformAdmin } = require('../../middleware/platform-admin.middleware');
router.use(authenticate, requirePlatformAdmin());
```

And remove the now-stale TODO comment ("Add an isAdmin check here when the User model gains a role column.").

- [ ] **Step 2: Boot check**

Run: `(cd EasyMod-backend && node -e "require('./src/app'); console.log('ok')")`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-backend/src/modules/admin/failed-jobs.routes.js
git -C /d/hexabyte/easy-moderator commit -m "feat(admin): require platform admin for failed-jobs DLQ route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Frontend — API domain + platform-admin guard

**Files:**
- Create: `EasyMod-frontend/src/api/domains/admin.ts`
- Create: `EasyMod-frontend/src/shared/lib/auth/useIsPlatformAdmin.ts`
- Create: `EasyMod-frontend/src/shared/components/guards/PlatformAdminRoute.tsx`
- Modify: `EasyMod-frontend/src/features/auth/types/index.ts`

- [ ] **Step 1: Add `platform_role` to the me/user type**

In `features/auth/types/index.ts`, extend `UserSchema` with an optional field:

```ts
export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(['admin', 'user', 'viewer']),
  platform_role: z.enum(['SUPPORT_ADMIN', 'SUPER_ADMIN']).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
```

> If the `/me` response is consumed via a separate `MeResponse` type rather than `UserSchema`, add `platform_role?: 'SUPPORT_ADMIN' | 'SUPER_ADMIN' | null` there too. The hook in Step 2 reads it directly from the `/api/auth/me` payload, so it does not depend on this schema strictly.

- [ ] **Step 2: Implement the API domain client**

```ts
import { httpClient } from '@/shared/lib/http/client';

export type AdminDashboard = {
  shops: { total: number; active: number; trial: number; suspended: number };
  today: {
    messages: number; aiAutoReplies: number; orders: number;
    failedAiReplies: number | null; courierFailures: number | null;
    estimatedAiCost: number | null; systemErrors: number | null;
  };
  generatedAt: string;
};

export type AdminShopRow = {
  id: string; shopName: string;
  owner: { name: string | null; email: string | null; phone: string | null } | null;
  plan: string | null; status: string | null; trialEndsAt: string | null;
  channelCount: number; conversationsUsed: number | null; conversationsLimit: number | null;
  createdAt: string;
};

const unwrap = <T>(p: Promise<{ data: { data: T } }>) => p.then((r) => r.data.data);

export const adminApi = {
  getDashboard: () => unwrap<AdminDashboard>(httpClient.get('/api/admin/dashboard')),
  listShops: (params: { search?: string; page?: number; limit?: number }) =>
    unwrap<{ items: AdminShopRow[]; total: number; page: number; limit: number }>(
      httpClient.get('/api/admin/shops', { params })),
  getShop: (id: string) => unwrap<any>(httpClient.get(`/api/admin/shops/${id}`)),
  getShopChannels: (id: string) => unwrap<any[]>(httpClient.get(`/api/admin/shops/${id}/channels`)),
  getShopBilling: (id: string) => unwrap<any>(httpClient.get(`/api/admin/shops/${id}/billing`)),
  getAuditLogs: (params: Record<string, string | number | undefined>) =>
    unwrap<{ items: any[]; total: number; page: number; limit: number }>(
      httpClient.get('/api/admin/audit-logs', { params })),
  setStatus: (id: string, status: 'suspended' | 'active') =>
    unwrap<any>(httpClient.patch(`/api/admin/shops/${id}/status`, { status })),
  changePlan: (id: string, body: { plan_code?: string; plan_name?: string }) =>
    unwrap<any>(httpClient.patch(`/api/admin/shops/${id}/billing`, body)),
  addCredits: (id: string, amount: number, reason?: string) =>
    unwrap<any>(httpClient.post(`/api/admin/shops/${id}/add-credits`, { amount, reason })),
  extendTrial: (id: string, days: number) =>
    unwrap<any>(httpClient.post(`/api/admin/shops/${id}/extend-trial`, { days })),
  markReconnect: (id: string, channelId: string) =>
    unwrap<any>(httpClient.patch(`/api/admin/shops/${id}/channels/${channelId}/reconnect`, {})),
  emergencyAiOff: (id: string) =>
    unwrap<any>(httpClient.post(`/api/admin/shops/${id}/ai/emergency-off`, {})),
};
```

- [ ] **Step 3: Implement the `useIsPlatformAdmin` hook**

```ts
import { useEffect, useState } from 'react';
import { httpClient } from '@/shared/lib/http/client';

type State = { loading: boolean; role: 'SUPPORT_ADMIN' | 'SUPER_ADMIN' | null };

export function useIsPlatformAdmin(): State {
  const [state, setState] = useState<State>({ loading: true, role: null });
  useEffect(() => {
    let alive = true;
    httpClient.get('/api/auth/me')
      .then((r) => {
        const role = r?.data?.data?.platform_role ?? r?.data?.platform_role ?? null;
        if (alive) setState({ loading: false, role: role || null });
      })
      .catch(() => { if (alive) setState({ loading: false, role: null }); });
    return () => { alive = false; };
  }, []);
  return state;
}
```

- [ ] **Step 4: Implement `PlatformAdminRoute`**

```tsx
import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useIsPlatformAdmin } from '@/shared/lib/auth/useIsPlatformAdmin';

export function PlatformAdminRoute({ children }: { children: ReactNode }) {
  const { loading, role } = useIsPlatformAdmin();
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-gray-500">Loading…</div>;
  }
  if (!role) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 5: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-frontend/src/api/domains/admin.ts EasyMod-frontend/src/shared/lib/auth/useIsPlatformAdmin.ts EasyMod-frontend/src/shared/components/guards/PlatformAdminRoute.tsx EasyMod-frontend/src/features/auth/types/index.ts
git -C /d/hexabyte/easy-moderator commit -m "feat(admin-ui): admin API client + platform-admin guard/hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Frontend — Admin layout + Dashboard + Shops list pages

**Files:**
- Create: `EasyMod-frontend/src/app/components/admin/AdminLayout.tsx`
- Create: `EasyMod-frontend/src/app/components/admin/AdminDashboard.tsx`
- Create: `EasyMod-frontend/src/app/components/admin/AdminShops.tsx`

- [ ] **Step 1: AdminLayout (sidebar + Outlet)**

```tsx
import { NavLink, Outlet } from 'react-router-dom';

const links = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/shops', label: 'Shops' },
  { to: '/admin/audit-logs', label: 'Audit Logs' },
];

export default function AdminLayout() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-56 shrink-0 border-r bg-white">
        <div className="px-4 py-4 text-sm font-semibold text-gray-900">EasyMod Admin</div>
        <nav className="px-2 space-y-1">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}
              className={({ isActive }) =>
                `block rounded px-3 py-2 text-sm ${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'}`}>
              {l.label}
            </NavLink>
          ))}
          <NavLink to="/app" className="block rounded px-3 py-2 text-sm text-gray-400 hover:bg-gray-100">← Back to app</NavLink>
        </nav>
      </aside>
      <main className="flex-1 p-6"><Outlet /></main>
    </div>
  );
}
```

- [ ] **Step 2: AdminDashboard**

```tsx
import { useEffect, useState } from 'react';
import { adminApi, AdminDashboard as Dash } from '@/api/domains/admin';

function Stat({ label, value }: { label: string; value: number | string | null }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value ?? '—'}</div>
    </div>
  );
}

export default function AdminDashboard() {
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { adminApi.getDashboard().then(setD).catch((e) => setErr(String(e?.message || e))); }, []);
  if (err) return <div className="text-red-600">Failed to load: {err}</div>;
  if (!d) return <div className="text-gray-500">Loading…</div>;
  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-gray-900">SaaS Health</h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total shops" value={d.shops.total} />
        <Stat label="Active" value={d.shops.active} />
        <Stat label="Trial" value={d.shops.trial} />
        <Stat label="Suspended" value={d.shops.suspended} />
        <Stat label="Messages today" value={d.today.messages} />
        <Stat label="AI replies today" value={d.today.aiAutoReplies} />
        <Stat label="Orders today" value={d.today.orders} />
        <Stat label="Est. AI cost (Phase 2)" value={d.today.estimatedAiCost} />
      </div>
      <p className="text-xs text-gray-400">“—” metrics arrive in Phase 2. Generated {new Date(d.generatedAt).toLocaleTimeString()}.</p>
    </div>
  );
}
```

- [ ] **Step 3: AdminShops (search + pagination + view link)**

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, AdminShopRow } from '@/api/domains/admin';

export default function AdminShops() {
  const [rows, setRows] = useState<AdminShopRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  useEffect(() => {
    adminApi.listShops({ search, page, limit }).then((r) => { setRows(r.items); setTotal(r.total); });
  }, [search, page]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Shops</h1>
        <input value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }}
          placeholder="Search shop or owner email…"
          className="w-72 rounded border px-3 py-1.5 text-sm" />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Shop</th><th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Plan</th><th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Channels</th><th className="px-3 py-2">Used</th>
              <th className="px-3 py-2">Created</th><th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="px-3 py-2 font-medium text-gray-900">{s.shopName}</td>
                <td className="px-3 py-2 text-gray-600">{s.owner?.email || '—'}</td>
                <td className="px-3 py-2">{s.plan || '—'}</td>
                <td className="px-3 py-2">{s.status || '—'}</td>
                <td className="px-3 py-2">{s.channelCount}</td>
                <td className="px-3 py-2">{s.conversationsUsed ?? '—'}/{s.conversationsLimit ?? '—'}</td>
                <td className="px-3 py-2 text-gray-500">{new Date(s.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2"><Link to={`/admin/shops/${s.id}`} className="text-blue-600">View</Link></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">No shops</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{total} shops</span>
        <div className="space-x-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Prev</button>
          <span>Page {page}</span>
          <button disabled={page * limit >= total} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-frontend/src/app/components/admin/AdminLayout.tsx EasyMod-frontend/src/app/components/admin/AdminDashboard.tsx EasyMod-frontend/src/app/components/admin/AdminShops.tsx
git -C /d/hexabyte/easy-moderator commit -m "feat(admin-ui): admin layout, dashboard, shops list

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: Frontend — Shop detail (Overview / Channels / Billing tabs)

**Files:**
- Create: `EasyMod-frontend/src/app/components/admin/AdminShopDetail.tsx`

- [ ] **Step 1: Implement the tabbed detail page**

Includes the **Emergency: stop AI** button (with `window.confirm`) and the billing actions. AI & Inbox / Orders & Courier tabs render a Phase 2 placeholder.

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { adminApi } from '@/api/domains/admin';

const TABS = ['Overview', 'Channels', 'Billing', 'AI & Inbox', 'Orders & Courier'] as const;
type Tab = typeof TABS[number];

export default function AdminShopDetail() {
  const { shopId = '' } = useParams();
  const [tab, setTab] = useState<Tab>('Overview');
  const [overview, setOverview] = useState<any>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [billing, setBilling] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = () => {
    adminApi.getShop(shopId).then(setOverview).catch(() => {});
    adminApi.getShopChannels(shopId).then(setChannels).catch(() => {});
    adminApi.getShopBilling(shopId).then(setBilling).catch(() => {});
  };
  useEffect(reload, [shopId]);

  const act = async (fn: () => Promise<any>, label: string) => {
    try { await fn(); setMsg(`${label} ✓`); reload(); }
    catch (e: any) { setMsg(`${label} failed: ${e?.message || e}`); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-900">{overview?.shop?.shopName || 'Shop'}</h1>
      {msg && <div className="rounded bg-gray-100 px-3 py-2 text-sm">{msg}</div>}
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm ${tab === t ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-500'}`}>{t}</button>
        ))}
      </div>

      {tab === 'Overview' && overview && (
        <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <div><dt className="text-gray-500">Owner</dt><dd>{overview.owner?.email || '—'}</dd></div>
          <div><dt className="text-gray-500">Plan</dt><dd>{overview.subscription?.planName || '—'}</dd></div>
          <div><dt className="text-gray-500">Status</dt><dd>{overview.subscription?.status || '—'}</dd></div>
          <div><dt className="text-gray-500">Trial ends</dt><dd>{overview.subscription?.trialEndsAt ? new Date(overview.subscription.trialEndsAt).toLocaleDateString() : '—'}</dd></div>
          <div><dt className="text-gray-500">Conversations</dt><dd>{overview.usage?.conversationsUsed ?? '—'}/{overview.usage?.conversationsLimit ?? '—'}</dd></div>
          <div><dt className="text-gray-500">Onboarding</dt><dd>{overview.onboarding?.completed ? 'Complete' : 'Incomplete'}</dd></div>
        </dl>
      )}

      {tab === 'Channels' && (
        <div className="space-y-3">
          <button onClick={() => { if (window.confirm('EMERGENCY: stop ALL AI automation for this shop? Inbound messages still arrive; only automated replies stop.')) act(() => adminApi.emergencyAiOff(shopId), 'Emergency AI off'); }}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white">Emergency: stop AI</button>
          <table className="min-w-full rounded-lg border bg-white text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr><th className="px-3 py-2">Channel</th><th className="px-3 py-2">Platform</th><th className="px-3 py-2">Token</th><th className="px-3 py-2">Webhook</th><th className="px-3 py-2">Error</th><th className="px-3 py-2"></th></tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2">{c.displayName}</td>
                  <td className="px-3 py-2">{c.platform}</td>
                  <td className="px-3 py-2">{c.status}</td>
                  <td className="px-3 py-2">{c.webhookLastVerifiedAt ? 'verified' : '—'}</td>
                  <td className="px-3 py-2 text-red-600">{c.lastError || '—'}</td>
                  <td className="px-3 py-2"><button onClick={() => act(() => adminApi.markReconnect(shopId, c.id), 'Mark reconnect')} className="text-blue-600">Mark reconnect</button></td>
                </tr>
              ))}
              {channels.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No channels</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'Billing' && billing && (
        <div className="space-y-3 text-sm">
          <div>Plan: <b>{billing.planName}</b> · Status: {billing.status} · Used {billing.conversationsUsed}/{billing.conversationsLimit} · Top-up {billing.topupBalance}</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => act(() => adminApi.extendTrial(shopId, 7), 'Extend trial 7d')} className="rounded border px-3 py-1.5">Extend trial 7d</button>
            <button onClick={() => act(() => adminApi.addCredits(shopId, 50, 'admin_grant'), 'Add 50 credits')} className="rounded border px-3 py-1.5">Add 50 credits</button>
            {billing.status === 'suspended'
              ? <button onClick={() => act(() => adminApi.setStatus(shopId, 'active'), 'Reactivate')} className="rounded border px-3 py-1.5 text-green-700">Reactivate</button>
              : <button onClick={() => act(() => adminApi.setStatus(shopId, 'suspended'), 'Suspend')} className="rounded border px-3 py-1.5 text-red-700">Suspend</button>}
          </div>
        </div>
      )}

      {(tab === 'AI & Inbox' || tab === 'Orders & Courier') && (
        <div className="rounded border border-dashed p-6 text-center text-gray-400">Phase 2</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-frontend/src/app/components/admin/AdminShopDetail.tsx
git -C /d/hexabyte/easy-moderator commit -m "feat(admin-ui): shop detail (overview/channels/billing) + emergency AI stop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: Frontend — Audit Logs page + wire routes

**Files:**
- Create: `EasyMod-frontend/src/app/components/admin/AdminAuditLogs.tsx`
- Modify: `EasyMod-frontend/src/app/routes.ts`

- [ ] **Step 1: AdminAuditLogs (filters + pagination)**

```tsx
import { useEffect, useState } from 'react';
import { adminApi } from '@/api/domains/admin';

export default function AdminAuditLogs() {
  const [rows, setRows] = useState<any[]>([]);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  useEffect(() => {
    adminApi.getAuditLogs({ action: action || undefined, page, limit }).then((r) => { setRows(r.items); setTotal(r.total); });
  }, [action, page]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Audit Logs</h1>
        <input value={action} onChange={(e) => { setPage(1); setAction(e.target.value); }}
          placeholder="Filter action (e.g. admin:suspend_shop)"
          className="w-80 rounded border px-3 py-1.5 text-sm" />
      </div>
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Admin</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Resource</th><th className="px-3 py-2">Shop</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 text-gray-500">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2">{r.admin?.email || r.admin?.id || 'system'}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-3 py-2">{r.resourceType}</td>
                <td className="px-3 py-2 text-gray-500">{r.shopId || '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No entries</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{total} entries</span>
        <div className="space-x-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Prev</button>
          <span>Page {page}</span>
          <button disabled={page * limit >= total} onClick={() => setPage((p) => p + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the `/admin` route subtree in `routes.ts`**

Add the lazy imports near the other lazies:

```ts
const AdminLayout = lazy(() => import("./components/admin/AdminLayout"));
const AdminDashboard = lazy(() => import("./components/admin/AdminDashboard"));
const AdminShops = lazy(() => import("./components/admin/AdminShops"));
const AdminShopDetail = lazy(() => import("./components/admin/AdminShopDetail"));
const AdminAuditLogs = lazy(() => import("./components/admin/AdminAuditLogs"));
```

Add the import for the guard at the top:

```ts
import { PlatformAdminRoute } from "@/shared/components/guards/PlatformAdminRoute";
```

Add a new top-level route object (sibling of `/app`), protected by `protectedLoader` (must be logged in) and wrapped in `PlatformAdminRoute` (must be platform admin):

```ts
  {
    path: "/admin",
    loader: protectedLoader,
    errorElement: createElement(RouteError),
    Component: withSuspense((props: any) =>
      createElement(PlatformAdminRoute, {}, createElement(AdminLayout, props))
    ),
    children: [
      { index: true, Component: withSuspense(AdminDashboard) },
      { path: "shops", Component: withSuspense(AdminShops) },
      { path: "shops/:shopId", Component: withSuspense(AdminShopDetail) },
      { path: "audit-logs", Component: withSuspense(AdminAuditLogs) },
    ],
  },
```

- [ ] **Step 3: Typecheck + build the frontend**

Run: `(cd EasyMod-frontend && npm run build)` (or `npx tsc --noEmit`).
Expected: builds with no type errors. Fix import-path/alias issues if any (`@/` alias is configured in this repo).

- [ ] **Step 4: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-frontend/src/app/components/admin/AdminAuditLogs.tsx EasyMod-frontend/src/app/routes.ts
git -C /d/hexabyte/easy-moderator commit -m "feat(admin-ui): audit logs page + /admin route subtree behind PlatformAdminRoute

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 15: README + full test sweep

**Files:**
- Create: `EasyMod-backend/src/modules/admin/README.md`

- [ ] **Step 1: Write the README**

```markdown
# EasyModerator Admin Panel (Phase 1)

Operator-only panel mounted at `/api/admin` (backend) and `/admin` (SPA).

## Roles
| Role | Reads | Mutations | Emergency AI off |
| --- | --- | --- | --- |
| (none) | ✗ | ✗ | ✗ |
| SUPPORT_ADMIN | ✓ | ✗ | ✗ |
| SUPER_ADMIN | ✓ | ✓ | ✓ |

`platform_role` lives on `users` and is distinct from the tenant `user_shops.role`
(owner/admin/staff). The guard (`requirePlatformAdmin`) re-checks the DB value
(cached 60s) so revocation takes effect within a minute even with a valid JWT.

## Seeding an admin
    node src/scripts/grant-platform-admin.js <email> SUPER_ADMIN
    node src/scripts/grant-platform-admin.js <email> SUPPORT_ADMIN
    node src/scripts/grant-platform-admin.js <email> NONE   # revoke

## Safe operations
- **Suspend / reactivate**: sets `Subscription.status` and busts the 60s
  `subscription:status` cache. Suspended shops are blocked by `checkSubscriptionStatus`.
- **Extend trial**: advances `trial_ends_at` (max +90d) and keeps status `trialing`.
- **Add credits**: calls `grantBonusConversations` (adds to `topup_balance`).
- **Change plan**: reuses `subscription.service.updatePlan`.
- **Mark reconnect**: sets a channel to `TOKEN_EXPIRED`; the merchant must re-OAuth.
- **Emergency AI off** (SUPER_ADMIN): sets `automation_mode = MANUAL` on every channel
  AND shop-level. Inbound messages still persist; only automated replies stop. There is
  intentionally no one-click re-enable — restore via the merchant app or Phase 2 ai-settings.

## Never exposed
Encrypted channel tokens (`page_access_token_ct`) and any secrets are never returned by
admin endpoints.

## Audit
Every mutation writes an `AuditLog` row (admin user, shop, action, before/after, ip, ua)
via `AuditService.logOperation`. View at `/admin/audit-logs`.
```

- [ ] **Step 2: Run the full backend admin test sweep**

Run: `(cd EasyMod-backend && npx jest src/middleware/__tests__/platform-admin.middleware.test.js src/modules/admin --runInBand)`
Expected: all PASS.

- [ ] **Step 3: Run the broader suite to check for regressions**

Run: `(cd EasyMod-backend && npx jest --runInBand)`
Expected: no NEW failures vs the baseline (the project has some known pre-existing FE test rot; backend should be green).

- [ ] **Step 4: Commit**

```bash
git -C /d/hexabyte/easy-moderator add EasyMod-backend/src/modules/admin/README.md
git -C /d/hexabyte/easy-moderator commit -m "docs(admin): admin module README (roles, safe ops, seeding)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (completed against the spec)

**Spec coverage:**
- §2 Dashboard → Task 6 (`getDashboard`, honest sources + Phase-2 nulls). ✓
- §3 Shops list (search/pagination) → Task 6 `listShops` + Task 12 UI. ✓
- §4A Overview → Task 6 `getShopOverview` + Task 13. ✓
- §4B Channels (+mark reconnect, no token) → Task 6/7 + Task 13. ✓
- §4E Billing (+extend trial/add credits/plan/suspend) → Task 7 + Task 13. ✓
- §5 Auth guard (platform_role) → Tasks 2–4. ✓
- §6 Audit (reuse AuditService) → Task 8 controller wiring + Task 14 UI. ✓
- Emergency AI off (added requirement) → Task 7 `emergencyDisableAi` (channel-level MANUAL) + Task 13 button. ✓
- Tests (authz + mutations) → Tasks 4, 7, 9. ✓
- README → Task 15. ✓
- Phase 2 items (AI/orders health tabs, system logs, cost) → stubbed only. ✓ (out of scope by design)

**Placeholder scan:** none — every code step contains complete code. The only `null`/`—`
values are the deliberate Phase-2 dashboard placeholders documented in the spec.

**Type consistency:** service returns `{ before, after }` consumed uniformly by the
controller; `adminApi` method names match the routes; `platform_role` string values
(`SUPPORT_ADMIN`/`SUPER_ADMIN`) consistent across migration, entity, guard, script, README, FE.

**Open verification points flagged inline** (resolve during execution, not blockers):
- Subscription association alias on `Shop` (`as: 'subscription'`) — confirm in `entities.js`.
- `getAuthContext` return shape for the `platform_role` field on `/me`.
- App boot may need the same incidental mocks as `shop.api.integration.test.js`.
