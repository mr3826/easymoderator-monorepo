# 08 — Test and Security Receipts

All commands run locally from `EasyMod-backend/` or `EasyMod-frontend/` on 2026-07-26.

## Backend

| Command | Result |
|---|---|
| `npx jest --runInBand --forceExit --silent` | **111 suites / 1307 tests passed**, 0 failed, exit 0 (107.4 s) |
| `npm run test:security` | **24 suites / 150 tests passed**, exit 0 (12.6 s) |

New/changed backend test files (consolidated run: 7 suites / 119 tests, exit 0):
- `scripts/__tests__/launch-readiness.test.js` — 23 tests (F-05 fail-closed)
- `scripts/__tests__/render-production-env.test.js` — 15 tests (F-01 + provider render)
- `src/modules/integration/__tests__/meta-webhook-durability.test.js` — 27 tests (F-02/F-03)
- `src/modules/integration/__tests__/meta-webhook.routes.test.js` — updated ack-contract tests
- `src/config/__tests__/production-config.validator.test.js` — +2 (conditional bKash webhook secret)
- `src/modules/payment/__tests__/bangladesh-payment.disabled.test.js` — 9 tests (fail-closed bKash)
- `src/utils/__tests__/ops-alert.test.js` — +5 (F-06 sinks/test-alert)

## Frontend

| Command | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | **50 files / 446 tests passed**, exit 0 (78.7 s) |
| `npm run build` | exit 0 (built in 26.7 s) |

New frontend test: `src/app/components/billing/__tests__/BKashCheckout.test.tsx` — 3 tests (purchasing gate).

## Migration up / down / up (real PostgreSQL 15)

Disposable `postgres:15-alpine` container; `DATABASE_URL` pointed at it.

| Step | Command | Result |
|---|---|---|
| UP (full chain) | `node src/database/migrate.js up` | all migrations OK incl. `20260726_001_meta_webhook_receipts`; `to_regclass('public.meta_webhook_receipts')` → present |
| DOWN | `node src/database/migrate.js down` | rolled back `20260726_001`; table and enum `to_reg*` → empty |
| UP again | `node src/database/migrate.js up` | re-applied; table present; 21 columns confirmed |

Clean and reversible.

## Infrastructure config validation

| Check | Command | Result |
|---|---|---|
| Caddy | `caddy validate --config Caddyfile --adapter caddyfile` (2-alpine container) | `Valid configuration` (exit 0); `caddy fmt --overwrite` applied |
| nginx | `nginx -t` with `nginx.conf` mounted at `conf.d/default.conf` (1.25-alpine) | `syntax is ok` / `test is successful` (exit 0) |
| Compose | `docker compose -f docker-compose.prod.yml config -q` (transient empty `.env.prod`, dummy interp vars) | exit 0; transient file removed, tree clean |

## Security diff scan

A manual security review of the complete branch diff (24 files) was performed. Categories checked and result:

| Area | Result |
|---|---|
| Injection | No raw SQL; all DB access via Sequelize models / parameterized queries |
| Crypto | AES-256-GCM with a random 12-byte IV and a **distinct AAD** (`meta-webhook-payload`) so a token ciphertext can't be replayed as a payload ciphertext; payment key normalization preserves the existing derivation |
| Secret handling | No secret value read, logged, printed, or written to a repo file; derived payment key masked in Actions; alert sinks reported as booleans only |
| PII | Sender PSID stored only as SHA-256; replay body encrypted; alerts and logs on the durability paths carry no message body/PSID (asserted by tests) |
| AuthZ | `POST /admin/ops/test-alert` is SUPER_ADMIN-only and audited |
| Tenancy | Held receipts have `shop_id = null` until a CONNECTED channel resolves; no cross-tenant association (asserted) |
| SSRF / outbound | No new outbound fetch to user-controlled URLs; the off-site upload targets an operator-configured bucket only |
| Webhook auth | HMAC-SHA256 verification unchanged; fail-closed without app secret |

**No issues found.** Recommend the org's Codex Security scanner run on the PR as an independent pass; `/security-review` can also be invoked for a second opinion.
