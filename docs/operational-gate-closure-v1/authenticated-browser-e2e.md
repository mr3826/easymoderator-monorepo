# Operational Gate Closure V1 — authenticated browser E2E

This runbook covers the isolated two-shop browser rehearsal in
`EasyMod-frontend/tests/operational-gate-closure-v1`. It uses the real sign-in
form, HTTP-only auth cookies, the candidate API, and synthetic PostgreSQL rows.
It does not use mocked API routes or call a messaging provider.

## Observed host publication issue and validated runner

On 2026-10-27, Compose rendered the backend mapping as `127.0.0.1:54643:3000`, but Docker Desktop did not materialize a host binding: the backend container reported `3000/tcp: null` and Windows/WSL loopback requests failed. The app itself listened on `0.0.0.0:3000` and its in-container readiness check passed. This is a Docker Desktop/WSL publication issue, not an application listener failure.

The final authenticated journeys ran in a temporary Microsoft Playwright runner connected only to the closure internal network, with no published runner ports or gateway. A loopback-only Node proxy on `127.0.0.1:54643` forwarded to `backend:3000`; the HTTPS Vite server bound to `127.0.0.1:54680`. This preserved the application authentication, Secure cookie, CSRF, and production-origin checks. Chromium and Firefox each passed the primary authenticated tenant journey (one test each); Chromium also passed the worker-restart Inbox visibility journey (one test). The primary test verifies the CSRF-protected cross-shop order PATCH returns 404 and the Shop A order remains `processing`. The runner was an isolated test surface; it did not make a founder-accessible preview available on Windows. `FOUNDER_PREVIEW` therefore remains **BLOCKED** pending a safe, verified host publication or an explicitly provided isolated review surface.

Sanitized runner and browser logs are under `D:\easymod\_operational-gate-closure-v1-local\evidence\` (`browser-runner-isolation.json`, `playwright-chromium-final.log`, `playwright-firefox-final.log`, and `playwright-worker-restart-final.log`).


## Required local stack

Start the API, PostgreSQL, and Redis in the dedicated isolated rehearsal stack
only. Do not point this fixture at a shared, staging, or production database.
The Compose file declares a loopback API mapping at `http://127.0.0.1:54643`. Verify Docker actually materializes it before using a Windows-host browser; a Compose declaration alone is not reachability evidence. The dedicated closure
Compose file publishes no PostgreSQL port; run migrations and seeding inside
its backend container so the container's `DATABASE_URL` resolves the internal
`postgres` service. The database URL must have all of these properties:

- Database name is exactly `easymod_ops_gate_e2e`.
- Database host is `postgres`, `127.0.0.1`, or `localhost`.
- Migrations have completed successfully.
- The local API remains in `NODE_ENV=production`; its Secure, HTTP-only auth
  cookie is accepted by the HTTPS browser origin without changing cookie
  policy.
- The API's local-only JWT/session and database settings come from the
  isolated stack. Do not copy a production environment file.

PostgreSQL, Redis, API, and Vite ports must not be published beyond loopback.
The closure Compose backend uses synthetic placeholder provider values only
for local configuration validation. Its network is internal with no egress;
no live provider call or paid inference is allowed.
The browser's isolated Vite server serves HTTPS at `127.0.0.1:54680`, binds
only to loopback, and proxies same-origin `/api` and `/health` to the API URL
above. The self-signed certificate and private key must be generated outside
the repository. The dedicated Vite config validates both paths and refuses
repository-contained TLS material. Playwright ignores certificate validation
only in this loopback-only configuration; its browser-context request guard
aborts non-loopback HTTP(S) traffic. `OPS_E2E_API_URL`, `OPS_E2E_BASE_URL`,
`OPS_E2E_FRONTEND_PORT`, `OPS_E2E_TLS_CERT`, and `OPS_E2E_TLS_KEY` are the
explicit override variables. Both URLs reject non-loopback hosts.
Because production CSRF checks exact request origins, the closure-only API
`CORS_ORIGINS` must also include `https://127.0.0.1:54680`; keep `APP_URL`,
cookie flags, and application CSRF policy unchanged.

Generate a short-lived development certificate in the WSL runner's `/tmp`
directory (outside the repository), with both loopback SANs:

```sh
mkdir -p /tmp/easymod-operational-gate-closure-v1-tls
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 7 \
  -keyout /tmp/easymod-operational-gate-closure-v1-tls/localhost.key \
  -out /tmp/easymod-operational-gate-closure-v1-tls/localhost.crt \
  -subj '/CN=127.0.0.1' \
  -addext 'subjectAltName=IP:127.0.0.1,DNS:localhost' \
  -addext 'extendedKeyUsage=serverAuth'
```

## Seed the synthetic shops

Run from the WSL shell in the worktree root after the isolated Compose backend
is healthy. Set `CLOSURE_ENV_FILE` to the absolute path of the generated
closure-only Compose env file. Use one local-only password of 14 or more
characters and keep the same value in this shell for seeding and Playwright.

```sh
export CLOSURE_ENV_FILE='/tmp/<generated-closure-only-env-file>'
read -rsp 'Local synthetic E2E password (14+ characters): ' OPS_E2E_PASSWORD
printf '\n'
export OPS_E2E_PASSWORD

docker compose --project-name easymod-operational-gate-closure-v1 \
  --env-file "$CLOSURE_ENV_FILE" \
  -f docs/operational-gate-closure-v1/compose.yml \
  exec backend node src/database/migrate.js up

docker compose --project-name easymod-operational-gate-closure-v1 \
  --env-file "$CLOSURE_ENV_FILE" \
  -f docs/operational-gate-closure-v1/compose.yml \
  exec -e OPS_E2E_PASSWORD -e OPS_E2E_SEED_CONFIRM=SEED_LOCAL_OPS_E2E_ONLY \
  backend node scripts/operational-gate-closure-v1/seed-e2e.js
```

The seed refuses an unexpected database, host, missing password, or missing
confirmation token. It is additive and rerunnable. It creates two owner
accounts, one synthetic order, four Messenger-shaped conversations, draft and
handoff records, and a Shop A-only tag. It creates no `MetaChannel`; therefore
draft approval cannot reach Meta or another provider. It does not drop tables,
truncate rows, or call Sequelize `sync`.

Chromium and Firefox use separate expired-draft and handoff fixtures because
the browser journey dismisses drafts and resolves handoffs. The separate rows
keep the two browser projects repeatable when they run sequentially against the
same isolated database.

## Run the browser rehearsal

After a clean frontend dependency install and Chromium browser install, run:

```sh
export OPS_E2E_PASSWORD='<the-same-local-only-synthetic-password>'
export OPS_E2E_API_URL='http://127.0.0.1:54643'
export OPS_E2E_BASE_URL='https://127.0.0.1:54680'
export OPS_E2E_FRONTEND_PORT='54680'
export OPS_E2E_TLS_CERT='/tmp/easymod-operational-gate-closure-v1-tls/localhost.crt'
export OPS_E2E_TLS_KEY='/tmp/easymod-operational-gate-closure-v1-tls/localhost.key'

cd EasyMod-frontend
npx playwright test \
  --config=playwright.operational-gate-closure.config.ts \
  tests/operational-gate-closure-v1/authenticated-tenant-journey.spec.ts
cd ..
```

Run the worker-restart spec separately after creating the signed webhook run ID
as described in [`worker-restart-rehearsal.md`](worker-restart-rehearsal.md).

The dedicated config starts its own HTTPS Vite server and fails if the selected
port is already occupied; it does not reuse an unknown process. Set
`OPS_E2E_SKIP_VITE=1` only when deliberately targeting an already-running
isolated HTTPS frontend bound to the same loopback URL.

## Evidence this suite checks

- Shop A and Shop B sign in through the UI in separate browser cookie jars.
- Each Inbox shows only conversations belonging to its authenticated shop.
- Shop A navigates from Inbox to the Customers page, opens its seeded customer
  detail drawer, and opens the linked order detail.
- Shop A creates and rereads a private customer note and applies a shop tag.
- A current-window draft approval is sent to the API and refused with
  `DRAFT_DELIVERY_NOT_CONFIRMED` because there is no active Facebook channel;
  the message has no provider acknowledgement and no provider attempt.
- An expired-window draft cannot call the approval endpoint; merchant
  dismissal is persisted as `DISMISSED`.
- Shop A claims a human handoff and resolves it with a resolution note.
- Shop B receives not-found responses for Shop A's conversation and order.
  Its authenticated notes and customer-tag queries return HTTP 200 with empty
  lists: both query by Shop B's shop ID and Shop A's customer ID, so neither
  returns Shop A's notes or tag assignments. A Shop B order-cancel request is
  denied and Shop A's order remains `processing`.

The commerce write probe here checks cross-shop isolation. It does not emulate
an AI agent's internal order-action path. AI commerce-action denial and
synthetic webhook delivery require the separate backend action-gate and
Meta-shaped E2E evidence; this browser suite does not claim those results.
