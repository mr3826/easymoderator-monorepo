# Evidence Index — claim → receipt

Every material claim in this audit maps to a receipt below. Receipts are commands with
exit codes, file:line references, or live HTTP responses captured on 2026-07-26.

## Repository state

| Claim | Receipt |
|---|---|
| Branch `codex/phase1-security-compliance` @ `d716ecf` | `git rev-parse HEAD` |
| Fully merged into `origin/main` | `git merge-base --is-ancestor HEAD origin/main` → exit 0 |
| Tree clean | `git status --porcelain \| wc -l` → `0` |
| No stashes, 1 worktree | `git stash list`, `git worktree list` |
| No open PRs | `gh pr list --state open` → empty |
| Lockfile consistent (only a script changed) | `git show 2225364 -- package.json \| grep '^[+-]'` → 2 lines, both `test:security` |

## Meta scope

| Claim | Receipt |
|---|---|
| Exactly 3 permissions | `MetaMessengerProvider.js:27-31` |
| No env override | repo-wide grep for `META_SCOPES`/`META_PERMISSIONS` → 0 hits |
| OAuth called with empty scopes → DEFAULT_SCOPES | `meta-oauth.service.js:51`, `MetaMessengerProvider.js:90` |
| No frontend `FB.login` | repo-wide grep → 0 hits |
| Webhook field = `messages` only | `MetaMessengerProvider.js:33-35`, subscribe at `:333-338` |
| Controller fallback also `['messages']` | `meta-channel.controller.js:327-329` |
| `feed`/comments ignored | `MetaMessengerProvider.js:429` |
| One provider only | `provider.registry.js:21-23`; `ls providers/` → 1 file |
| Model enum `ENUM('facebook')` | `meta-channel.entity.js:36` |

## Webhook security and reliability

| Claim | Receipt |
|---|---|
| Timing-safe HMAC-SHA256 | `meta-webhook.routes.js:56-64` |
| Fail-closed without app secret | `meta-webhook.routes.js:160-162` |
| **Bad signature → 403 (live)** | `POST https://easymod.tech/api/webhooks/meta` + `x-hub-signature-256: sha256=deadbeef` → `403` |
| `external_id` UNIQUE | `20260520_000_initial_schema.js:440,448` |
| Redis dedup claim | `message-worker.js:292-294` |
| **Unknown Page → silent drop + 200** | `meta-webhook-events.handler.js:448-467` + `:172` |
| **Store failure swallowed** | `meta-webhook-events.handler.js:508-512` |
| Synchronous processing before ack | `meta-webhook.routes.js:170-172` |
| `dispatchMessageJob` not awaited | `meta-webhook-events.handler.js:505` |

## Messenger policy

| Claim | Receipt |
|---|---|
| `ALLOWED_TAGS` empty; outside-window hard-deny | `templateRequired.rule.js:15,25` |
| No rule sets `message_tag` | grep across `policy/rules/` → 0 non-test hits |
| 24h window | `twentyFourHourWindow.rule.js:17` |
| Manual send goes through the engine | `conversation.controller.js:239-243` |
| Provider refuses without an allowing decision | `MetaMessengerProvider.js:435-437` |
| **Coalescing = 8s (not 10s)** | `burst-coalescer.js:35` |
| Suppression = 1800s (30 min) | `conversation.controller.js:15,425` |
| Worker guard order | `message-worker.js:296-310` |
| Suppression write fire-and-forget | `conversation.controller.js:425` |

## Data deletion, deauthorization, security

| Claim | Receipt |
|---|---|
| **Deletion unsigned → rejected (live)** | `{"error":"Missing signed_request"}` |
| **Deletion forged → rejected (live)** | `{"error":"Invalid signed_request signature"}` |
| **Deauthorize unsigned → rejected (live)** | `{"error":"Missing signed_request"}` |
| Security suite green | `npm run test:security` → 24 suites / 148 tests, exit 0 |
| **Payment key hazard** | `payment-config.entity.js:14-20` + preflight `invalid: PAYMENT_ENCRYPTION_KEY` |
| Production security headers | `curl -I https://easymod.tech` → CSP, HSTS, nosniff, SAMEORIGIN, permissions-policy |

## Order flow

| Claim | Receipt |
|---|---|
| **Bare "no"/"না" cannot cancel** | `order-flow.service.js:64-105` — explicit phrases/regexes only |
| Order idempotency | `20260611_001_order_session_metadata_orders_idempotency.js` |
| Tenant-safe customer resolution | `order-flow.service.js:112-126` |
| Live order flow is `order-flow.service.js` | `message-worker.js:409` |
| `ai-chatbot` unmounted | `routes.js` — no `/ai-chatbot` entry |

## Tests, build, CI

| Claim | Receipt |
|---|---|
| Backend 107 suites / 1226 tests | `npx jest --runInBand --forceExit --silent` → exit 0, 76.9s |
| Security 24 suites / 148 tests | `npm run test:security` → exit 0, 11.2s |
| Frontend typecheck clean | `npx tsc --noEmit` → exit 0 |
| Frontend 49 files / 443 tests | `npx vitest run` → exit 0, 48.7s |
| Frontend build passes | `npm run build` → exit 0, 18.70s |
| E2E never runs in CI | `ci-cd.yml:117-134`; 8 specs in `tests/e2e/` |
| CI does not typecheck | `"build": "vite build"` (esbuild strips types) |
| No lint config | `npx eslint src` → "couldn't find an eslint.config file" |
| Backend audit blocked | `npm audit --omit=dev` → exit 1, "Invalid package tree" |
| Frontend 2 high advisories | `npm audit --omit=dev` → react-router GHSA-qwww-vcr4-c8h2 |

## Production infrastructure

| Claim | Receipt |
|---|---|
| Canonical origin is the apex | `Caddyfile`; `.env.prod.example:43-46` |
| `app.easymod.tech` NXDOMAIN | `nslookup app.easymod.tech` |
| `api.easymod.tech` TLS failure | `curl` → `(35) tlsv1 alert internal error` |
| **`easymod.tech` reachable** | `curl -o /dev/null -w '%{http_code}'` → `200` |
| Backend alive | `GET /api/health` → 404 with backend JSON envelope + `requestId` |
| **`/health/*` served by nginx stub** | `GET /health/detailed` → `"server":"nginx"`; `nginx.conf:67-84` |
| Real probe checks DB + Redis | `routes/health.routes.js:30-56` |
| Caddy never proxies `/health/*` | `Caddyfile` — only `/api/*`, `/uploads/*`, `/webhooks/*` |
| **Gate false-PASS reproduced** | `BASE_URL=https://easymod.tech node scripts/launch-readiness.js` → `✅ PASS Infra up`, `✅ PASS Auto-reply DLQ empty (dlq=n/a)` |
| DLQ coercion bug | `launch-readiness.js:60` — `(d.autoReplyDlq \|\| 0) === 0` |
| Deploy gate probes the container directly | `ci-cd.yml:433`; `docker-compose.prod.yml:71` |
| 8 secrets missing | `gh secret list` (names only) |
| `BKASH_ENABLED=true`, `SANDBOX=false` | `ci-cd.yml:246,253` |
| Courier secrets referenced but absent | `ci-cd.yml:254-257` vs `gh secret list` |
| Deploy failed at preflight | `gh run list` → run `30189476291` failure |

## Backups

| Claim | Receipt |
|---|---|
| Daily backup runs and succeeds | `gh run list` → `30189139485` success 10s |
| **Backups on the droplet** | `backup.yml` — `BACKUP_DIR=/opt/easymod/backups` |
| Uploads included | `backup.yml` tar step |
| 7-day retention | `find ... -mtime +7 -delete` |
| No off-site step | `backup.yml` — no upload command anywhere |
| No restore test | no evidence in repo or CI history |

## Public copy

| Claim | Receipt |
|---|---|
| No Instagram/WhatsApp/comment claims | grep `LandingPage.tsx` → 0 hits; live page text → 0 hits |
| Privacy policy renders unauthenticated | `GET /privacy-policy` → 200, full policy text |
| Terms resolve | `GET /terms` → 200 |
| No horizontal overflow | 360/375/768 → `scrollWidth === innerWidth` |
| **Bengali layout intact** | toggled to বাংলা at 360px → `scrollWidth 360 === innerWidth 360` |
| No console errors | `read_console_messages(onlyErrors)` → none |
| ROI claim | live text: "~20% COD return rate avoided" |
| "0 BD couriers built-in" | live landing page stat strip |
| © 2025 | live footer |

## Explicitly NOT done

| Not done | Why |
|---|---|
| Merge, deploy, push | forbidden by the brief |
| Droplet SSH | read-only remit; would require the private key |
| Any secret **value** read or printed | prohibited |
| Meta OAuth / real message send | no tester access; would send real messages |
| Account creation / credential entry | prohibited |
| Migration up/down/up re-run | Docker daemon not running |
| `migrate:status` against production | requires live `DATABASE_URL` |
| Real bKash charge / courier booking | requires founder approval and real money |
| Playwright E2E | requires a live app instance |
