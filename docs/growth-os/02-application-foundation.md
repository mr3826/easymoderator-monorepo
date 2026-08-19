# Growth OS Application Foundation

Date: 2026-07-18
Status: Prompt 2 foundation implemented
Verdict: CONDITIONALLY READY for Prompt 3 after manual role bootstrap and browser verification

This prompt creates the dedicated Growth OS application shell and backend access boundary only. It does not implement prospects, leads, demos, tasks, trials, scoring, outreach, referrals, customer-success workflows, merchant navigation, merchant routes, production DNS, or live deployment.

## Frontend Location

Growth OS lives in a sibling frontend application:

```text
EasyMod-growth/
  package.json
  package-lock.json
  Dockerfile
  nginx.conf
  vite.config.ts
  src/
```

It is independent from `EasyMod-frontend/` and does not import the merchant router, merchant dashboard components, or merchant navigation.

Build commands:

```bash
cd EasyMod-growth
npm ci
npm run build
```

Local development:

```bash
cd EasyMod-growth
npm run dev
```

Default local URL:

```text
http://localhost:5174
```

The Vite dev server proxies `/api/*` to `http://localhost:3000`.

## Backend Namespace

Growth OS backend code lives under:

```text
EasyMod-backend/src/modules/growth-os/
```

Mounted namespace:

```text
/api/internal/growth-os/*
```

Implemented endpoint:

```text
GET /api/internal/growth-os/session
```

Safe session response:

```json
{
  "success": true,
  "data": {
    "internalUserId": "user-uuid",
    "displayName": "Internal User",
    "role": "FOUNDER",
    "permissions": ["growth_os.session.read"]
  }
}
```

The endpoint does not return passwords, tokens, merchant secrets, channel credentials, shop secrets, or unnecessary personal data.

## Authentication Behavior

Growth OS reuses the existing EasyModerator authentication foundation:

- `POST /api/auth/signin`
- `POST /api/auth/logout`
- httpOnly `access_token` and `refresh_token` cookies
- backend `authenticate` middleware
- existing CSRF/session behavior
- same backend service behind Caddy

The Growth OS frontend has its own login page. Signing in authenticates with the existing auth endpoint, then immediately calls `/api/internal/growth-os/session`. Authentication alone is not enough to enter Growth OS.

Unauthenticated behavior:

- frontend sends the user to `/login`
- backend returns `401` for `/api/internal/growth-os/session`

Session-expired behavior:

- frontend routes to `/session-expired`
- backend remains the source of truth with `401`

## Authorization Behavior

Growth OS access is explicit and denied by default.

New table:

```text
growth_os_user_roles
```

Migration:

```text
EasyMod-backend/src/database/migrations/20260718_001_growth_os_user_roles.js
```

Entity:

```text
EasyMod-backend/src/modules/growth-os/growth-os-user-role.entity.js
```

Guard:

```text
requireGrowthOsAccess()
```

Rules:

- merchant `user_shops.role` does not grant Growth OS access
- `users.platform_role` does not grant Growth OS access
- frontend route guards are UX only
- every Growth OS backend route must run backend authorization middleware
- role lookups are cached for 60 seconds with `growth-os:user:{userId}:role`

Roles:

- `FOUNDER`
- `GROWTH_MANAGER`
- `BUSINESS_EXECUTIVE`
- `MARKETER`
- `CUSTOMER_SUCCESS`
- `READ_ONLY_ANALYST`

Initial permissions are intentionally minimal and foundation-oriented. Prompt 3 must extend permissions only for the prospect/lead module it implements.

## Manual Role Bootstrap

No Founder UI exists yet. Bootstrap the first Growth OS role directly in the database after migrations run:

```sql
INSERT INTO growth_os_user_roles (user_id, role, is_active, metadata)
VALUES ('<existing-user-id>', 'FOUNDER', true, '{"bootstrap": true}'::jsonb);
```

To revoke access:

```sql
UPDATE growth_os_user_roles
SET is_active = false,
    revoked_at = NOW(),
    revoked_by = '<founder-user-id>'
WHERE user_id = '<user-id>'
  AND is_active = true;
```

Because role access is cached for 60 seconds, revocation may take up to 60 seconds to reflect unless the cache key is deleted.

## Deployment Preparation

Prepared production host:

```text
https://growth.easymod.tech
```

Prepared files:

- `EasyMod-growth/Dockerfile`
- `EasyMod-growth/nginx.conf`
- `docker-compose.prod.yml`
- `Caddyfile`
- `.github/workflows/ci-cd.yml`
- `.env.prod.example`

Docker Compose service:

```text
growth-frontend
```

Default image:

```text
ghcr.io/mr3826/easymod-growth:latest
```

Caddy routing:

```text
growth.easymod.tech/api/* -> backend:3000
growth.easymod.tech/*     -> growth-frontend:8080
```

CI/CD preparation:

- path filter for `EasyMod-growth/**`
- build gate for Growth OS frontend
- GHCR image `easymod-growth`
- deploy env `GHCR_IMAGE_GROWTH`
- post-deploy container health check for `growth-frontend`

Required production environment:

```text
CORS_ORIGINS=https://easymod.tech,https://growth.easymod.tech
GROWTH_FRONTEND_URL=https://growth.easymod.tech
COOKIE_DOMAIN=easymod.tech
```

DNS is not changed by this prompt. Create or verify DNS separately before production use.

## Health Checks

Growth frontend nginx endpoints:

```text
/health
/health/ready
```

Backend readiness remains:

```text
/health/ready
```

Production smoke after deploy:

```bash
curl -i https://growth.easymod.tech/health/ready
curl -i https://growth.easymod.tech/api/internal/growth-os/session
```

Expected unauthenticated API response:

```text
401
```

Expected authorized founder browser result:

- Growth OS shell
- logged-in internal user
- role
- `No modules enabled yet`
- logout button

Expected merchant browser result:

- access denied
- no access to `/api/internal/growth-os/session`

## Manual Tests

Founder:

1. Start backend locally on `http://localhost:3000`.
2. Run migrations.
3. Bootstrap `FOUNDER` in `growth_os_user_roles`.
4. Start Growth OS: `cd EasyMod-growth && npm run dev`.
5. Open `http://localhost:5174`.
6. Sign in with the founder account.
7. Expected: Growth OS shell opens and shows the founder role.

Merchant:

1. Open `http://localhost:5174`.
2. Sign in with a normal merchant account with no Growth OS role.
3. Expected: access denied.
4. Directly request `GET /api/internal/growth-os/session`.
5. Expected: `403`.

Unauthenticated:

1. Open `http://localhost:5174` in a clean browser session.
2. Expected: login page.
3. Directly request `GET /api/internal/growth-os/session`.
4. Expected: `401`.

Merchant dashboard regression:

1. Build merchant frontend.
2. Confirm `EasyMod-frontend/src/app/routes.ts` has no Growth OS route.
3. Open the merchant dashboard under the normal host.
4. Expected: no Growth OS navigation, routes, or shell.

## Tests Run

Backend:

```bash
cd EasyMod-backend
npx jest src/modules/growth-os/__tests__/growth-os.authz.test.js --runInBand
```

Result:

```text
PASS
6 tests passed
```

Frontend:

```bash
cd EasyMod-growth
npm ci
npm run build
```

Result:

```text
PASS
```

Merchant regression:

```bash
cd EasyMod-frontend
npm run build
```

Result:

```text
PASS
```

Deployment config:

```bash
docker compose -f docker-compose.prod.yml config --quiet
```

Initial result without env:

```text
blocked by missing DB_PASSWORD interpolation
```

This is expected because the production compose file requires `.env.prod` or equivalent environment variables.

Validation result with a temporary `.env.prod` copied from `.env.prod.example`:

```text
PASS
```

The local Docker client emitted `C:\Users\ahmee\.docker\config.json: Access is denied`; that is a local Docker config permission warning, not a Compose YAML error.

## Audit Logging

Prompt 2 adds no Growth OS mutation endpoint. Therefore, no Growth OS audit event is emitted by this foundation endpoint.

Future mutation endpoints must log important changes using `AuditService.logOperation`, including:

- role assignment and revocation
- prospect create/update/status transitions
- task assignment/completion
- demo state changes
- trial/customer-health interventions
- exports
- outreach draft lifecycle

## Rollback

Frontend rollback:

1. Remove or disable the `growth.easymod.tech` Caddy site block.
2. Stop `growth-frontend`.
3. Re-deploy the previous Compose/Caddy config.

Backend rollback:

1. Remove the `/api/internal/growth-os` route mount.
2. Revert `EasyMod-backend/src/modules/growth-os/`.
3. Run migration down only if no Growth OS access data must be preserved:

```bash
cd EasyMod-backend
npm run migrate:down
```

Data safety:

- rollback does not delete merchant data
- migration down only drops `growth_os_user_roles`
- no shop, subscription, message, order, billing, Meta webhook, or merchant dashboard data is modified by Prompt 2

## Known Limitations

- no Growth OS role-management UI yet
- first role must be bootstrapped through database access
- no prospects/leads/tasks/demos/trials modules yet
- no Growth OS mutation audit events yet because no mutation endpoint exists
- no live deployment or DNS change was performed
- npm reported one high-severity advisory while generating/installing the new frontend package graph; this needs separate dependency triage
- frontend route guards are intentionally not treated as security controls

## Prompt 3 Readiness

CONDITIONALLY READY.

Prompt 3 can start after:

1. `growth_os_user_roles` migration is applied locally or in staging.
2. At least one internal user is bootstrapped as `FOUNDER`.
3. `http://localhost:5174` or `https://growth.easymod.tech` opens the Growth OS shell for the authorized user.
4. A merchant account receives access denied.
5. The merchant dashboard remains unchanged.

Prompt 3 should implement only the prospect and lead foundation under the existing Growth OS boundary.
