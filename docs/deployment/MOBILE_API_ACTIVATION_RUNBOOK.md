# Mobile API Activation Runbook

How the production mobile API is switched on, proven, observed and rolled back.
Mobile architecture and state live in [`docs/mobile/`](../mobile/AGENT_HANDOFF.md); this page is
only the production operation. The switch is ADR M-010 ([`M-010-feature-flags.md`](../mobile/adr/M-010-feature-flags.md)).

## What `MOBILE_API_ENABLED` controls

| Value in `.env.prod` | Effect |
| --- | --- |
| `true` | `/api/auth/native/*` and `/api/mobile/*` are served; native (sid) tokens are honoured |
| `false` (the default) | Both route groups return the generic 404; every native token is refused with 401 `NATIVE_API_DISABLED` |
| unset | Rendered as `false` |
| anything else (`TRUE`, `1`, `yes`, `true␠`) | The render fails and the deploy stops; the backend also refuses to boot with it |

When enabled, the mobile surface is:

- **Native auth** (`/api/auth/native/*`): sign-in, 2FA verify (5 per 5 minutes per IP, plus a
  per-account limit), refresh with rotation and reuse detection, logout, switch-shop and the device
  session list/revoke.
- **Home** (`/api/mobile/today`, `/api/mobile/attention`): read-only, scoped to the token's shop, with
  membership re-checked on every request.
- **Native tokens.** Outside `/api/auth/native/*` they are read-only (`NATIVE_READ_ONLY`). They reach only
  `/api/mobile/*` and `GET /api/order/:uuid` / `GET /api/conversation/:uuid`; everything else is
  refused (`NATIVE_ROUTE_NOT_ALLOWED`), including the admin, Growth OS and dashboard APIs.

These do not change with the switch:

- Web (cookie, sid-less) tokens and every web route.
- Growth OS: its staff and the bootstrap operator get no native session, and its claims never apply to
  native tokens.
- The Wave 3 switches (`MOBILE_PUSH_ENABLED`, `MOBILE_ORDER_MUTATIONS_ENABLED`,
  `MOBILE_COURIER_ACTIONS_ENABLED`, `MOBILE_AI_DRAFTS_ENABLED`) are **not rendered**, so no repository
  setting can turn them on.
- The device-E2E fixture routes need `NODE_ENV=test` and a disposable database. In addition, the
  production validator refuses to boot with `MOBILE_E2E_FIXTURES_*` present.

## Where the value comes from

```text
repository variable MOBILE_API_ENABLED
  -> .github/workflows/ci-cd.yml (deployment dry run + deploy)
  -> EasyMod-backend/scripts/render-production-env.js (strict true/false)
  -> /opt/easymod/.env.prod
  -> src/config/config.js mobileApiEnabled (read once at boot)
```

There is no other configuration path. The value only takes effect on a deploy, because the backend
reads it at boot.

## Activate

1. Confirm the candidate: `origin/main` is green, and `/api/version` and `/health/ready` are healthy.
2. Set the switch and open the one-shot deploy gate:

   ```bash
   gh variable set MOBILE_API_ENABLED --body true
   gh variable set PRODUCTION_DEPLOY_ENABLED --body true
   ```

3. Deploy the exact main SHA:

   ```bash
   gh workflow run ci-cd.yml --ref main -f target=backend -f deploy_confirmation=DEPLOY-<full main SHA>
   ```

   Approve the `production` environment when it asks. The deploy renders `.env.prod`, validates it with
   the candidate image, migrates, replaces the backend, and checks `/health/ready` and `/api/version`.
   It rolls itself back if any of those fail.
4. Close the gate: `gh variable set PRODUCTION_DEPLOY_ENABLED --body false`.
5. Prove it (next section).

## Prove it

`.github/workflows/mobile-production-proof.yml` runs manually from `main` in the `production`
environment:

```bash
gh workflow run mobile-production-proof.yml --ref main \
  -f expected_sha=<full SHA production serves> -f expect_mobile_api=enabled -f device=true
```

**API proof** (`scripts/mobile-production-proof/api-proof.js`, paced under the `/api/auth` limit of
10 requests per minute per IP, as the designated test merchant
`merchant@easymod.tech`):

- **Health:** web app, Growth OS, `/health/ready` and the served commit.
- **Refusals:**
  - no token, a malformed token and a forged token;
  - wrong password and unknown account;
  - a CSRF-exempt bypass attempt that carries a cookie;
  - an unknown 2FA challenge, plus the rate-limit contract.
- **The merchant's session and data:**
  - sign-in and both Home contracts;
  - real order/conversation detail reads;
  - 404s for ids outside the shop;
  - write refusal and allowlist refusal (admin, Growth, dashboard, web `me`).
- **Session lifecycle:** switch-shop refusal, the session list, refresh rotation, replay detection
  revoking the session, remote revocation, logout, and re-login.

If the SUPER_ADMIN review credential (`SEED_ADMIN_PASSWORD`) is current, the proof also checks:

- the admin's native token stays inside the mobile surface;
- a real cross-shop read is refused in both directions;
- if that account has 2FA, that a challenge is issued instead of a session.

The proof never opens more than two sessions at a time and signs out every session it opens.

**Device proof:** the signed APK that `mobile-release.yml` produced for the current `EasyMod-mobile`
source is checked first:

- its SHA-256 matches the release run's `SHA256SUMS`;
- its signer is the pinned upload key;
- the APK, and the AAB beside it, are the chosen build variant, with that variant's package and the
  release's source SHA.

`-f variant=` picks the build:
- `preview` (the default) is `tech.easymod.merchant.preview`, the internal QA sideload build.
- `production` is `tech.easymod.merchant`, the Play build from the `mobile-release-production-<sha>`
  artifact. Prove it before its AAB is uploaded to Play.

It then runs on an API 34 emulator against production:

- sign-in, Home, all tabs, pull-to-refresh;
- a foreign-entity deep link (unavailable);
- restart with the session kept;
- real order and conversation deep links from Home (warm), and a cold-start link (the order, or the
  conversation when Home has no order);
- logout, cold relaunch signed out, re-login, logout.

**Observability:** read-only over SSH. It takes only the mobile-client response lines from the
proof window and summarises them per client and per route (status classes, p50/p95 latency, 5xx
count). It also collects counts of native audit events and of session ends by reason.

To prove the rollback state, use `-f expect_mobile_api=disabled`. That mode uses no credential and
checks that every mobile route answers 404 while web and Growth stay healthy.

The artifact `mobile-production-proof-<run>` holds the JSON reports, JUnit files and screenshots.
Every file is scanned for the credentials before upload.

## Roll back

```bash
gh variable set MOBILE_API_ENABLED --body false
gh variable set PRODUCTION_DEPLOY_ENABLED --body true
gh workflow run ci-cd.yml --ref main -f target=backend -f deploy_confirmation=DEPLOY-<full main SHA>
# approve production, then:
gh variable set PRODUCTION_DEPLOY_ENABLED --body false
gh workflow run mobile-production-proof.yml --ref main -f expected_sha=<SHA> -f expect_mobile_api=disabled
```

What rollback changes:

- On the next boot the native routes 404, and every native token already issued gets 401
  `NATIVE_API_DISABLED`, including on the order/conversation detail reads.
- Web and Growth OS are untouched.
- No database change is involved: the native session rows simply stop being honoured.

What devices see:

- The app's refresh then gets a 404, which it treats as "offline, keep the session".
- Merchants see their cached Home in read-only mode, and recover without signing in again once the
  switch returns to `true`.
- To end every mobile session for good, revoke the rows instead (for example with a
  `token_version` bump for a specific user).

The deploy job's own automatic rollback also restores the previous `.env.prod`, so a failed
activation deploy returns to the previous switch value together with the previous image.

## Observe

- **Request logs.** Every `Response sent` line carries `statusCode`, `path`, `durationMs` and
  `client`: `android/<app version>` for the app, `null` for web. On the droplet:

  ```bash
  docker logs --since 1h easymod-backend-1 2>&1 | grep -F '"client":"android/'
  ```

- **Audit.** These events carry `metadata.source = MOBILE`:
  - `NATIVE_TOKEN_REFRESH`;
  - `NATIVE_REFRESH_TOKEN_REUSE_DETECTED`.
- **Sessions.** `user_sessions.metadata.deactivated_reason` records why a session ended:
  - `user_revoked` (logout or a device revoke);
  - `refresh_token_reuse_detected`;
  - `max_sessions_reached` (three sessions per user).
- **Errors.** Mobile 5xx errors reach the backend Sentry project through the same handler as web
  errors, tagged with the release SHA.

## Test identities

- **Designated test merchant:** `merchant@easymod.tech`. It is the Meta review merchant, seeded by
  `seed-meta-review-merchant.yml`; its password is `META_REVIEW_MERCHANT_PASSWORD` in `production`.
  It is used with native tokens only, so the proof never replaces the account's single web session.
- **SUPER_ADMIN review account:** `SEED_ADMIN_*`, best effort, native only.
- **Never used:**
  - real merchant accounts;
  - the Growth OS bootstrap operator (its native refusal is covered by
    `native-auth-account-state.integration.test.js`);
  - production fixtures.
