# EasyModerator Messenger Smoke Preflight Report

Generated: 2026-07-19 03:20 Asia/Dhaka  
Scope: Remediation rerun and preflight only  
Verdict: FAIL - real Messenger smoke test NOT RUN

## Boundary

No real Messenger smoke scenario was started. No human operator message was sent through Messenger, and no real outbound Messenger message, courier booking, payment request, or billing activation was triggered.

Only the dedicated test merchant `admin@test.prod` was used. Secrets, tokens, passwords, Page tokens, and access cookies were not printed or committed.

## Remediation Summary

| Area | Status | Evidence |
|---|---:|---|
| Test shop/channel AI configuration | REMEDIATED | Shop `automation_mode=AI_ACTIVE`, `auto_reply_enabled=true`; channel `automationMode=AI_ACTIVE`, `aiAutoReply=true`. |
| Dedicated tracked product fixture | REMEDIATED | Product ID `95162218-b5d9-4690-8544-0f296f2925b6`, `EM Smoke Test Tracked Panjabi`, price `1490.00`, quantity `9`, `track_quantity=true`, sizes `M/L`. |
| COD/delivery fixture | REMEDIATED | COD enabled; extra COD charge set to `0`; delivery charges are inside Dhaka `60`, sub-Dhaka `80`, outside Dhaka `120`. |
| Refund/return FAQ fixture | REMEDIATED | FAQ ID `13`, category `smoke_test_return_refund_policy`, priority `1000`, active. |
| Diagnostics 500 code root cause | PATCHED LOCALLY | `shop.controller.js` no longer selects nonexistent `page_access_token`; it uses `page_access_token_ct` and emits non-secret channel metadata. Not live on deployed git `dad4b99a`. |
| Meta subscription verification/sync | PATCHED LOCALLY | `test-webhook` can verify/repair subscription and sync stored fields after deploy. Not live on deployed git `dad4b99a`. |
| Shop-level AI kill switch precedence | PATCHED LOCALLY | Worker now checks shop `MANUAL` before merging channel settings. Not live on deployed git `dad4b99a`. |

## Resolved Test Assets

| Item | Result |
|---|---|
| Test merchant | `admin@test.prod` |
| Merchant user ID | `3a5989f2-8443-4af8-a0f8-3938f6168c79` |
| Shop ID | `30010a3a-c180-4f2b-bd74-4bc9c468097e` |
| Shop name | `Bornohin Fashion` |
| Connected Meta channel ID | `843cdd8e-49d5-4a19-9b7d-05900787abaf` |
| Authoritative Facebook Page ID | `1006927412511938` |
| Page display name | `Bornohin Fashion BD` |
| Rejected candidate Page ID | `61575483248182` was not connected to the test merchant |

## Environment

| Check | Status | Evidence |
|---|---:|---|
| Active backend URL reachable | PASS | `https://easymod.tech/api/version` returned git `dad4b99a`, build `2026-07-16T23:11:23Z`, started `2026-07-18T20:07:54.964Z`. |
| Readiness endpoint | PASS | `https://easymod.tech/health/ready` returned `{"status":"ready","timestamp":"2026-07-19T03:19:58+06:00"}`. |
| API CSRF endpoint | PASS | `https://easymod.tech/api/csrf` returned a token; root `/csrf` serves frontend HTML and is not the API endpoint. |
| Legacy/configured API subdomain | FAIL | `https://api.easymod.tech/api/version` failed TLS/internal connection. Active API path remains `https://easymod.tech/api`. |
| Direct local PostgreSQL access | FAIL | `.env.prod` `DATABASE_URL` resolves to Docker host `postgres`; local probe failed `ENOTFOUND postgres`. |
| Direct local Redis access | FAIL | `.env.prod` `REDIS_URL` resolves to Docker host `redis`; local probe failed `ENOTFOUND redis`. |

## Webhook And Meta Channel

| Check | Status | Evidence |
|---|---:|---|
| Webhook route reachable | PASS | Invalid verify-token challenge returned `403`, proving the route exists. |
| Invalid POST signature rejected | PASS | Meta-shaped POST with `x-hub-signature-256: sha256=invalid` returned `403`. |
| Positive verify-token challenge | FAIL | Local `.env.prod`, `.env`, and `.env.docker` `META_WEBHOOK_VERIFY_TOKEN` candidates all had fingerprint `db06fed9` and returned `403`; deployed secret/Meta Dashboard token still not aligned. |
| Connected Page ID | PASS | Connected channel maps to Page ID `1006927412511938`, display name `Bornohin Fashion BD`, status `CONNECTED`. |
| Page token ping | PASS | `/api/channels/meta/843cdd8e-49d5-4a19-9b7d-05900787abaf/test-webhook` returned `ping.ok=true`, latency `1877ms`. |
| Stored webhook subscribed fields | FAIL | Live API still returns `webhookSubscribedFields: []`; required field is `messages`. The local verification/sync patch must be deployed before this can be repaired through the app. |

## Automation State

| Check | Status | Evidence |
|---|---:|---|
| Shop auto-reply configuration | PASS | `/api/shop/ai-settings` returned `automation_mode=AI_ACTIVE`, `auto_reply_enabled=true`, confidence threshold `75`, `payment_methods=["COD"]`. |
| Channel auto-reply configuration | PASS | Channel settings returned `automationMode=AI_ACTIVE`, `aiAutoReply=true`, send threshold `0.75`, suggest threshold `0.5`, `allowOrderCreation=true`. |
| Effective tenant config | PASS | For this locked shop/channel, configuration is now set to allow auto-reply. |
| Runtime subscription gate | FAIL | Subscription status is `trial_expired`; `message-worker.js` blocks automated AI before LLM processing for this status. |
| Immediate shop-level kill switch | PENDING DEPLOY | Local worker patch makes shop `MANUAL` win over channel `AI_ACTIVE`; deployed git `dad4b99a` does not yet contain this fix. |

## Fixtures

| Area | Status | Evidence |
|---|---:|---|
| Dedicated product fixture | PASS | Product ID `95162218-b5d9-4690-8544-0f296f2925b6`, name `EM Smoke Test Tracked Panjabi`, Bangla name present, price `1490.00`, `in_stock=true`, `is_active=true`. |
| Stock fixture | PASS | `track_quantity=true`, quantity `9`, low stock threshold `2`. |
| Size fixture | PASS | Variants include `Size` options `M` and `L`. |
| Bangla/English/Banglish aliases | PASS | Aliases include `smoke test panjabi`, `panjabi dam`, `smok panjabi`, `smoak panjabi`, `স্মোক টেস্ট পাঞ্জাবি`, and `টেস্ট পাঞ্জাবি`. |
| Delivery and COD | PASS | COD enabled; extra COD charge `0`; area delivery charges are unambiguous. |
| Courier safety | PASS | Pathao, Steadfast, and RedX are disconnected/inactive. |
| Payment safety | PASS | `/api/payment/config` returned zero gateway configs; available payment method is COD only. |
| Billing side-effect safety | PASS/WARN | No payment request or subscription activation was triggered; usage counters remain `0`. However this also leaves subscription `trial_expired`, so runtime AI is blocked. |
| FAQ/policy grounding | PASS | Dedicated refund/return FAQ is active with explicit human escalation requirement. |

## Observability

| Check | Status | Evidence |
|---|---:|---|
| Version evidence | PASS | Live deploy is still `dad4b99a`, build `2026-07-16T23:11:23Z`. |
| AI diagnostics endpoint | FAIL | `/api/shop/ai-diagnostics` still returns `500 Internal Server Error` on live; local fix is not deployed. |
| Channel webhook ping | PASS | Authenticated test-webhook ping succeeds. |
| Full DB/queue trace from this workstation | FAIL | Direct PostgreSQL and Redis access remain unavailable from this workspace. |

## Blocking Defects

| Severity | Defect | Impact |
|---|---|---|
| P0 | Test subscription is `trial_expired`. | Worker will suppress automated AI even though shop/channel settings are enabled. A safe non-billable active test state is required. |
| P0 | Deployed webhook verify token is not aligned with local secret sources / Meta Dashboard. | Positive Meta webhook challenge cannot be proven. |
| P0 | Required `messages` subscription is not authoritatively verified. | Inbound Messenger delivery is not proven for the connected Page. |
| P0 | Shop-level `MANUAL` kill switch precedence fix is not deployed. | A channel-level `AI_ACTIVE` setting can still override shop-level manual mode on live code. |
| P1 | `/api/shop/ai-diagnostics` still returns `500` on live. | Webhook-to-queue-to-worker observability is still incomplete. |
| P1 | `https://api.easymod.tech` is broken while config references it. | Environment targeting remains confusing; use `https://easymod.tech/api` until DNS/TLS/config is corrected. |
| P1 | Direct PostgreSQL/Redis trace is unavailable. | Final persisted message, BullMQ queue state, and worker trace cannot be independently proven from this workstation. |

## Release Gate Decision

Do not start the real Messenger smoke checklist yet.

Minimum fixes before the human sends the first Messenger message:

1. Deploy the local code fixes for diagnostics, Meta subscription verification/sync, and shop-level kill-switch precedence.
2. Align Meta Dashboard callback URL and deployed `META_WEBHOOK_VERIFY_TOKEN`; re-run a positive challenge without printing the token.
3. Run the deployed `test-webhook` verifier with subscription repair for the dedicated Page, then confirm stored fields include `messages`.
4. Put the test shop into a safe non-billable AI-active test state, or deploy an explicit smoke-test billing bypass that cannot be merchant-controlled.
5. Re-run this preflight and confirm every P0 item is green before any customer-side Messenger message is sent.
