# 10 — Production Verification

**Status: PENDING DEPLOY.** To be executed and recorded after the merge triggers the production deploy (`09_`). No missing or unavailable value will be recorded as PASS.

## Real health endpoints (post-deploy)

```bash
curl -s https://easymod.tech/health           # expect service:"easymod-backend", commit=<merge sha>
curl -s https://easymod.tech/health/ready      # expect service:"easymod-backend", status:"ready", database:"connected"
curl -s https://easymod.tech/health/detailed -H "Authorization: Bearer <ADMIN_TOKEN>"
```

`/health/detailed` must truthfully report PostgreSQL, Redis, Qdrant, the auto-reply canary, `autoReplyDlq` (integer), and `webhookReceipts.deadLettered`/`held`. The response must come from the backend (provenance marker present), **not** the nginx stub — verifying F-05 is actually fixed in production.

## Negative verification (controlled, non-production)

Already demonstrated locally via the fail-closed unit tests (`06_`): the nginx-stub-shaped response fails provenance, a missing/`null`/`"0"` DLQ fails, `deadLettered>0` fails, backend-unreachable fails. In production, a container-level check (stop the backend on a staging copy, or observe a genuine dependency blip) must drive `/health/ready` to 503 externally — never a stale 200.

## Launch-readiness gate (post-deploy)

```bash
BASE_URL=https://easymod.tech ADMIN_TOKEN=<jwt> node scripts/launch-readiness.js
```
Record per gate: number, PASS/FAIL, sanitized evidence, and whether human verification remains required. The admin token is never printed.

Expected honest outcome immediately post-deploy (before founder actions): infra/DB/Redis/vector gates should PASS if all services are healthy; **canary** may be FAIL until the worker has run a probe cycle; **activation** UNVERIFIED without an admin token; **alerting** requires human receipt (gate 8). None of these will be reported green while unknown.

## Release identity

Confirm production serves the new image via the `commit` field on `/health` and `/health/ready` matching the merge commit SHA, and/or the GHCR image digest from the deploy run. No environment values are exposed.

*(Actual captured outputs to be appended here after deploy.)*
