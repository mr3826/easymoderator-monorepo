# 12 — Production Infrastructure and Operations (Workstream K)

**Verdict for this workstream: FAIL.** The primary launch gate reports false PASSes, and
the deployed image predates every Phase 1 control.

## Correction to a prior claim

A previous session reported production health as unverifiable and blamed sandbox network
restrictions. **That was wrong**, and the correction matters because it changes what is
knowable.

`api.easymod.tech` and `app.easymod.tech` were never production hostnames:

```
api.easymod.tech   → 139.59.249.141, TLS handshake fails (tlsv1 alert internal error)
app.easymod.tech   → NXDOMAIN
easymod.tech       → HTTP 200
```

The canonical origin is the **apex `https://easymod.tech`** — a same-origin SPA
(`Caddyfile`, `.env.prod.example:43-46`). It is reachable from this environment, and all
live evidence in this audit was gathered directly against it.

## ⛔ Finding F-05 (P1) — the launch-readiness gate reports false PASSes

### Root cause

`Caddyfile` proxies only three prefixes to the backend:

```
handle /api/*      → reverse_proxy backend:3000
handle /uploads/*  → reverse_proxy backend:3000
redir  /webhooks/* → /api{uri} 301
handle             → reverse_proxy frontend:8080     ← everything else, including /health/*
```

The backend mounts its real probes at `/health` (`app.js:230`), **not** `/api/health`.
Confirmed: `GET /api/health` → `404` from the backend's own JSON error envelope.

So `/health/*` from outside lands on the **frontend nginx container**, which answers with
hardcoded stubs (`EasyMod-frontend/nginx.conf:67-84`):

```nginx
location /health          { return 200 '{"status":"healthy","timestamp":"$time_iso8601",...}'; }
location /health/detailed { return 200 '{"status":"healthy",...,"server":"nginx",...}'; }
location /health/ready    { try_files /index.html @not_ready;
                            return 200 '{"status":"ready","timestamp":"$time_iso8601"}'; }
```

`/health/ready` returns "ready" **if `index.html` exists on disk**. No database check. No
Redis check. No backend check.

Confirmed live — note `"server":"nginx"`, and the absence of the `database` / `redis` /
`version` fields the backend's real probe always includes:

```
GET https://easymod.tech/health          → {"status":"healthy","timestamp":"...","version":""}
GET https://easymod.tech/health/ready    → {"status":"ready","timestamp":"..."}
GET https://easymod.tech/health/detailed → {"status":"healthy",...,"server":"nginx",...}
```

The real probe (`routes/health.routes.js:30-56`) calls `sequelize.authenticate()` and
`checkRedisAvailability()` and returns `503 not_ready` on failure. It is reachable **only**
inside the Docker network.

### Consequence — reproduced this run

`docs/launch/LAUNCH_GATE_CHECKLIST.md` instructs `BASE_URL=https://easymod.tech node
scripts/launch-readiness.js`. Executed exactly as documented:

```
Launch readiness — https://easymod.tech
------------------------------------------------------------
✅ PASS  Infra up (/health/ready 200)     ok
❌ FAIL  DB + Redis + Vector store        db=undefined redis=undefined vector=undefined (undefined)
✅ PASS  Auto-reply DLQ empty             dlq=n/a
❌ FAIL  Auto-reply canary fresh          no canary heartbeat yet
❌ FAIL  Activation >= 10 shops           /api/analytics/growth status=401 (admin token required)
```

Two gates are lying:

1. **Gate 2 "Infra up"** — passes against an nginx stub. It would stay green with a dead
   backend, dead Postgres, and dead Redis.
2. **Gate 4 "No silent reply failures — message-dlq depth = 0"** — passes because
   `(d.autoReplyDlq || 0) === 0` evaluates `undefined || 0` to `0`
   (`launch-readiness.js:60`). The detail string honestly says `dlq=n/a`, but the gate
   records **PASS**. The system reports "no silent reply failures" while having zero
   knowledge of the DLQ.

Gate 4 is the exact false-success pattern this audit exists to catch.

### What is *not* affected

The **automated deploy gate is sound.** CI probes the backend container directly
(`ci-cd.yml:433`, `docker exec easymod-backend-1 node -e "...http://127.0.0.1:3000/health/ready..."`),
as does the compose healthcheck (`docker-compose.prod.yml:71`). Only the external and
human-facing signal is fake.

### Remediation

Add `handle /health/*  { reverse_proxy backend:3000 }` to the `Caddyfile` **above** the
catch-all, remove or rename the nginx stubs, and change `launch-readiness.js:60` to fail
when `autoReplyDlq` is absent rather than coercing it to `0`.

## Production state checks

| Check | Status | Evidence |
|---|---|---|
| Frontend | **UP** | 200, SPA renders, no console errors |
| Backend API | **UP** | JSON error envelope with `requestId` on `/api/*` |
| TLS certificate | **VALID** | apex serves TLS cleanly (Let's Encrypt via Caddy) |
| HTTPS / HSTS | **PASS** | `strict-transport-security: max-age=31536000; includeSubDomains` |
| CSP | **PASS** | strict; `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` |
| Other headers | **PASS** | `nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`, restrictive `permissions-policy` |
| CORS | PASS (config) | `CORS_ORIGINS=https://easymod.tech` — apex only |
| DNS | PASS (apex) | `easymod.tech` resolves and serves; `www` → 301 |
| Meta webhook endpoint | **UP + fail-closed** | 403 on bad signature |
| Compliance callbacks | **UP + fail-closed** | see `06_` |
| Rate limits | PASS (config) | webhook + API limiters |
| **Worker** | **UNVERIFIED** | no externally reachable health surface |
| **Scheduler** | **UNVERIFIED** | same |
| **PostgreSQL / Redis / Qdrant** | **UNVERIFIED** | real probe unreachable externally |
| **Queue depths / DLQ depth** | **UNVERIFIED** | requires `/health/detailed` on the backend + admin token |
| **Auto-reply canary freshness** | **FAIL** | "no canary heartbeat yet" |
| **Disk / memory / CPU** | **UNVERIFIED** | requires droplet SSH |
| **Container restart state** | **UNVERIFIED** | requires droplet SSH |
| Deployment rollback | documented in PR #74 | never exercised |
| **Migration execution during deploy** | correct in code, **never executed in production** | deploy has not run |

**No droplet SSH was attempted.** It is outside the read-only remit and would require
handling `DO_SSH_PRIVATE_KEY`.

## Required environment variables — 8 missing

`gh secret list` (names only; **no values read or printed**) confirms these are absent:

| Secret | Why required |
|---|---|
| `BKASH_APP_KEY` | `BKASH_ENABLED: "true"` hardcoded at `ci-cd.yml:246` |
| `BKASH_APP_SECRET` | " |
| `BKASH_BASE_URL` | " |
| `BKASH_USERNAME` | " |
| `BKASH_PASSWORD` | " |
| `BKASH_WEBHOOK_SECRET` | also in `CORE_REQUIRED` |
| `CSRF_SECRET` | ≥32 chars, dedicated CSRF secret |
| `SENTRY_DSN` **or** `SLACK_ALERT_WEBHOOK_URL` | repo has `VITE_SENTRY_DSN` only; the backend reads `SENTRY_DSN` |

Plus `PAYMENT_ENCRYPTION_KEY` present but **invalid** (not 64 hex) — see the F-01 hazard
in `06_`.

`PATHAO_*` and `STEADFAST_*` are referenced by the workflow (`ci-cd.yml:254-257`) and are
**also absent**, so courier credentials would render empty.

## Launch gate scorecard

| # | Gate | Status |
|---|---|---|
| 1 | CI green on `main` | **FAIL** — run `30189476291` failed |
| 2 | Infra up (`/health/ready`) | **UNSOUND** — false PASS |
| 3 | DB + Redis + Vector healthy | **FAIL / unverifiable externally** |
| 4 | Message DLQ = 0 | **UNSOUND** — false PASS (`dlq=n/a`) |
| 5 | Auto-reply canary fresh | **FAIL** — no heartbeat |
| 6 | Canary green 7 straight days | **NOT STARTED** |
| 7 | ≥10 shops activated | **UNVERIFIED** (401, admin token required) |
| 8 | Alerting reaches a human | **FAIL** — neither `SENTRY_DSN` nor `SLACK_ALERT_WEBHOOK_URL` is set |
| 9 | Attachment round-trip | **UNVERIFIED** |
| 10 | Meta identity coverage = 0 missing | **UNVERIFIED** (admin token required) |

**Zero of ten hard gates are confirmed green.**

Gate 8 deserves emphasis: with neither alert sink configured, `opsAlert(...)` has nowhere
to go. Every "we will be alerted" assurance elsewhere in this system is currently false
in production.
