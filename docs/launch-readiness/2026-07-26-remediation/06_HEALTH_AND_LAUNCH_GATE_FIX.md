# 06 — Health Routing and Fail-Closed Launch Gates (F-05)

## Root cause

Caddy proxied only `/api/*`, `/uploads/*`, `/webhooks/*`; `/health*` fell through to the SPA's nginx container, which answered `/health`, `/health/detailed`, and `/health/ready` with **hardcoded literals** (`{"status":"healthy"}`, `server:"nginx"`, `{"status":"ready"}`). So the external launch gate reported PASS against a static file server that knows nothing about Postgres, Redis, Qdrant, the worker, or the DLQ. The DLQ gate also coerced an absent depth with `(d.autoReplyDlq || 0) === 0`.

## Fixes

**Caddyfile** — a `@health` matcher for `/health` and `/health/*` reverse-proxies to `backend:3000`, declared **first** so the catch-all can never shadow it again.

**Frontend `nginx.conf`** — the three health stubs are **removed**, with a comment forbidding their return. The frontend container makes no readiness claim about the backend.

**Backend responses** — `/health`, `/health/ready`, `/health/detailed` now carry `service: "easymod-backend"` (a provenance marker) and `commit: GIT_SHA` (release identity). `/health/detailed` sets `autoReplyDlq` to an integer or `null` (never a coerced `0`) and adds `webhookReceipts.deadLettered` / `.held` for the inbound DLQ.

**`scripts/launch-readiness.js`** — rewritten to fail closed:
- A `200` is never sufficient — every response must have `service === "easymod-backend"`, so a proxy/static stub fails provenance.
- Counters must be real non-negative integers; absent / `null` / string values FAIL (no `|| 0`).
- Missing DB/Redis/vector/canary fields, or any unrecognised schema, FAIL.
- An unreadable endpoint (401 / timeout / parse error) is UNVERIFIED = FAIL; nothing unknown is ever green.
- New inbound-webhook-DLQ gate: `deadLettered > 0` (or unknown) FAILS.
- Pure `evaluateGates()` is exported for testing against fixtures.

## Tests — `scripts/__tests__/launch-readiness.test.js` (23 tests, all pass)

Healthy backend passes all gates · backend unreachable fails · DB disconnected fails on a 200 · **the nginx `/health/ready` stub fails provenance** · **the nginx `/health/detailed` stub fails every dependent gate** · empty 200 body fails · Redis unavailable / `not_configured` fails · Qdrant unavailable fails · missing infra field → unexpected-schema fail · missing/`null`/`"0"`(string)/`>0` DLQ all fail · inbound dead-letters `>0` fails · missing `webhookReceipts` fails · missing/stale/absent canary fails · activation 401 → unverified (never PASS) · below-target activation fails · unexpected growth schema fails.

## Note on the automated deploy gate

The in-container deploy health check (`docker exec easymod-backend-1 … /health/ready`) and the compose healthcheck already probe the backend directly and were always sound. This fix repairs the **external / human-facing** signal, which was the false one.

## Docs

Launch documentation should reference the real backend health path (`https://easymod.tech/health/ready` now routes to the API) and the schema fields the gate requires: `service`, `status`, `database`, `redis`, `vectorDb`, `autoReplyDlq` (int), `webhookReceipts.deadLettered` (int), `autoReplyCanary.{lastOkAgeMs,fresh}`. See `10_PRODUCTION_VERIFICATION.md` for the executed gate output.
