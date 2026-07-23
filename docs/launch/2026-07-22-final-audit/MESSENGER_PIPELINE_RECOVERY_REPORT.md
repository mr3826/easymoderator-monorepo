# Messenger Pipeline Production Recovery Report

Generated: 2026-07-21 03:45 Asia/Dhaka  
Scope: rebuilt production environment recovery and pipeline verification  
Verdict: PARTIAL RECOVERY - blocked before Messenger persistence because no Facebook Page is connected to the smoke tenant

## Executive Summary

Production infrastructure is deployed and serving the recovery backend commit `f1c7ee5e`. The dedicated smoke tenant was created, authentication works, billing is AI-eligible, AI auto-reply is enabled, a product fixture exists, and `/api/shop/ai-diagnostics` now works.

The Messenger pipeline is not end-to-end workable yet because the rebuilt database has zero connected Meta channels for the smoke tenant. A Messenger webhook can only persist/enqueue after the backend resolves the incoming Page ID to a `meta_channels` row with `status=CONNECTED`. With no connected Page, processing stops before message persistence.

## Deployment Status

| Check | Status | Evidence |
|---|---:|---|
| Production backend version | PASS | `/api/version` returns git `f1c7ee5e5b0144363cae5824e1a6b0b286ecc211`, started `2026-07-20T21:40:46.158Z`. |
| CI/CD run | PASS | GitHub Actions run `29780861845` completed successfully. |
| Backend tests in CI | PASS | `Test & Build Gate` passed. |
| Backend image build/push | PASS | `ghcr.io/mr3826/easymod-backend:f1c7ee5e` built and pushed. |
| Droplet deploy | PASS | Deploy job copied env, pulled backend image, recreated backend and worker. |
| Migrations | PASS | Deploy log: `All migrations completed successfully`; `/api/version` reports 29 migrations, latest `20260704_001_telegram_notification_bindings`. |

## Infrastructure

| Component | Status | Evidence |
|---|---:|---|
| Frontend signin route | PASS | `https://easymod.tech/signin` returned HTTP `200`. |
| Dashboard route | PASS | `https://easymod.tech/app` returned HTTP `200`. |
| Canonical API | PASS | `https://easymod.tech/api/version` returned HTTP `200`. |
| Backend container | PASS | Deploy log: `Container easymod-backend-1 Healthy`; health check passed on attempt 1. |
| PostgreSQL | PASS | Deploy log: `Container easymod-postgres-1 Healthy`; migrations completed. |
| Redis | PASS | Deploy log: `Container easymod-redis-1 Healthy`; diagnostics queue counts returned. |
| Worker process | PASS | Deploy log: `Container easymod-worker-1 Started`. |
| BullMQ message queue | PASS | `/api/shop/ai-diagnostics` returned `waiting=0`, `active=0`, `failed=0`, `delayed=0`, `paused=0`. |
| Legacy API subdomain | FAIL | `https://api.easymod.tech/api/version` still fails TLS from this workstation. Use `https://easymod.tech/api`. |

## Environment Validation

| Item | Status | Evidence |
|---|---:|---|
| `DATABASE_URL` | PRESENT | GitHub Actions secret name exists; deploy log rendered masked DB connection and migrations succeeded. |
| `REDIS_URL` | PRESENT | Secret name exists; deploy log rendered `redis://redis:6379`; Redis healthy. |
| `META_APP_SECRET` | PRESENT | Secret name exists; webhook rejects invalid signatures/tokens. |
| `META_WEBHOOK_VERIFY_TOKEN` | PRESENT/UNVERIFIED | Secret name exists, but value cannot be read from GitHub; callback must be verified in Meta Dashboard with the deployed value. |
| `META_APP_ID` | PARTIAL | OAuth initiate returns a Facebook dialog URL with a non-empty `client_id`; GitHub secret list only shows `VITE_META_APP_ID`, so exact backend source remains server/env-level. |
| `META_PAGE_ACCESS_TOKEN` | NOT GLOBAL | Not expected as a deploy secret in current architecture; Page tokens are stored per connected `meta_channels` row after OAuth. |
| `GEMINI/OPENAI` | PRESENT BY NAME | Relevant Actions secret names exist. Live AI execution was not reached because Messenger is blocked at Page connection. |

## Test Tenant

| Check | Status | Evidence |
|---|---:|---|
| Fresh smoke admin | PASS | Created `codex-smoke-20260721@test.prod`. |
| Auth login | PASS | `/api/auth/signin` returned HTTP `200`; `/api/auth/me` returned user `ec528920-f252-40f7-9abd-6813cd09a14b`. |
| Smoke shop | PASS | Shop `794d050e-5c3c-4d2f-8102-4b388c2c211a`, name `Codex Smoke Admin`. |
| Dashboard access | PASS | Frontend dashboard route reachable; authenticated API session works. |
| Subscription | PASS | Status `trialing`, trial ends `2026-08-03T21:25:16.876Z`; AI is not billing-blocked. |
| AI settings | PASS | `automation_mode=AI_ACTIVE`, `auto_reply_enabled=true`, confidence `75`, payment methods `COD`. |
| Product fixture | PASS | Product `e2c3d72e-3d2b-448a-b2ba-13d051d4f452`, `EM Recovery Smoke Panjabi`, price `1490.00`, quantity `9`. |
| Meta channels | FAIL | `/api/channels/meta` returned zero channels for the smoke tenant. |

## Meta Webhook And Subscription

| Check | Status | Evidence |
|---|---:|---|
| Callback endpoint reachable | PASS | Invalid verify-token challenge returns HTTP `403`, proving route exists and rejects wrong tokens. |
| Positive callback challenge | BLOCKED | Deployed token value is not readable here; local token fingerprint `db06fed9` returned `403`, so local file is not authoritative. Verify in Meta Dashboard using the deployed secret. |
| OAuth initiate | PASS | `/api/channels/meta/oauth/initiate` returned HTTP `200`; URL host `www.facebook.com`, path `/v22.0/dialog/oauth`, redirect `https://easymod.tech/app/channels/oauth-callback`, scopes `pages_show_list,pages_messaging,pages_manage_metadata`. |
| Page connected to smoke tenant | FAIL | No `meta_channels` rows exist for the smoke tenant. |
| Page subscribed to `messages` | NOT VERIFIED | Requires a connected channel/page token. The deployed `test-webhook` endpoint now supports verify/repair after a channel exists. |

## Exact Pipeline Stop Point

Current trace cannot reach a fresh Messenger message end-to-end because stage 4 is missing:

1. Meta sends webhook: **not proven**
2. Webhook received: **route reachable, but no live Page event proven**
3. Signature verified: **invalid requests rejected; valid live signature not observed**
4. Page/tenant mapping: **FAIL - no connected `meta_channels` row**
5. Event persisted: **not reached**
6. Conversation created/updated: **not reached**
7. BullMQ job created: **not reached**
8. Worker consumes job: **not reached for Messenger**
9. Billing/manual/HITL checks: **tenant is ready, but not reached**
10. AI generation: **not reached**
11. Messenger delivery: **not reached**

Code evidence: `meta-webhook-events.handler.js` resolves the incoming Page ID through `resolveConnectedChannel(pageId, 'facebook')`. If no `CONNECTED` channel exists, it logs `No CONNECTED facebook channel for page_id=...` and continues without storing the message.

## Recovery Actions Completed

| Action | Status |
|---|---:|
| Deployed diagnostics fix for `page_access_token_ct` | DONE |
| Deployed webhook subscription verify/repair reporting in `test-webhook` | DONE |
| Deployed persistence of verified webhook subscribed fields | DONE |
| Deployed OAuth connect persistence of subscribed fields | DONE |
| Deployed shop-level MANUAL hard kill switch precedence | DONE |
| Created fresh smoke tenant/admin | DONE |
| Enabled smoke tenant AI auto-reply | DONE |
| Created product fixture | DONE |
| Verified queue diagnostics visible | DONE |

## Required Fixes / Next Actions

| Severity | Component | Root Cause | Required Fix |
|---|---|---|---|
| P0 | Meta configuration | Smoke tenant has no connected Facebook Page. | Log into the smoke tenant dashboard, connect the dedicated Facebook Page through Meta OAuth, and select the test Page. |
| P0 | Meta Dashboard | Positive callback verification is not proven. | In Meta Developer Dashboard, set callback URL to `https://easymod.tech/api/webhooks/meta` and verify token to the deployed `META_WEBHOOK_VERIFY_TOKEN`; run Verify and Save. |
| P0 | Page subscription | `messages` subscription cannot be checked without a connected Page token. | After OAuth connect, call `/api/channels/meta/{channelId}/test-webhook` with `repairSubscription:true`; require `subscription.ok=true` and fields containing `messages`. |
| P0 | Live message trace | No fresh Page event can map to the smoke tenant yet. | Send a new Messenger message only after Page connection and subscription verification pass. |
| P1 | API DNS/TLS | `api.easymod.tech` fails TLS while canonical API works. | Fix or remove stale API subdomain references; keep frontend/API on same-origin `https://easymod.tech/api`. |
| P1 | Backend detailed health routing | Public `/health/*` is answered by proxy health, not Node detailed health. | Expose a backend-routed authenticated ops health endpoint if full DB/Redis/vector/canary detail is needed without SSH. |

## Current Go / No-Go

NO-GO for real Messenger smoke scenarios.

The backend and worker are deployable and the smoke tenant is prepared, but Messenger customer messages cannot be proven until the dedicated Facebook Page is connected to the rebuilt database and subscribed to `messages`.
