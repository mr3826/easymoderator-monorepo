# EasyModerator Messenger Smoke Preflight Remediation Report

Generated: 2026-07-19 03:20 Asia/Dhaka  
Scope: Confirmed preflight blockers only  
Verdict: PARTIAL REMEDIATION - still blocked for real Messenger smoke

## What Changed

| Area | Before | After |
|---|---|---|
| Shop AI mode | `DRAFT`, `auto_reply_enabled=false` | `AI_ACTIVE`, `auto_reply_enabled=true` |
| Channel AI mode | `DRAFT`, `aiAutoReply=true` | `AI_ACTIVE`, `aiAutoReply=true` |
| Channel label | `null` | `Messenger Smoke Test - Bornohin Fashion BD` |
| Product fixture | `Premium Black Panjabi`, price `2000.00` | `EM Smoke Test Tracked Panjabi`, price `1490.00` |
| Product stock | quantity `9`, tracked | quantity `9`, `track_quantity=true`, active/in stock |
| Product sizes | none | `M`, `L` |
| COD charge | `60` extra COD charge | `0` extra COD charge; delivery charges remain area-based |
| FAQ fixture | one generic FAQ | added FAQ ID `13`, category `smoke_test_return_refund_policy` |

The existing test product was updated in place instead of creating a new product record, avoiding a product-count billing increment.

## Local Code Fixes

| File | Change | Verification |
|---|---|---|
| `EasyMod-backend/src/modules/shop/shop.controller.js` | Fixed `/api/shop/ai-diagnostics` by selecting `page_access_token_ct` instead of nonexistent `page_access_token`, and exposed safe channel metadata. | `node --check` passed. |
| `EasyMod-backend/src/modules/channel-providers/meta-channel.controller.js` | Extended `test-webhook` to verify Meta subscriptions, optionally repair them, and return required/subscribed fields. | `node --check` passed. |
| `EasyMod-backend/src/modules/channel-providers/meta-channel.service.js` | `confirmWebhookActive` now persists verified webhook fields. | `node --check` passed. |
| `EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js` | OAuth connect now stores verified subscribed fields. | Targeted Jest suite passed. |
| `EasyMod-backend/src/jobs/message-worker.js` | Shop `MANUAL` is now checked as a hard kill switch before channel settings are merged. | Targeted Jest suite passed. |

These code fixes are local only. Live production still reports git `dad4b99a`, so diagnostics/subscription-sync/kill-switch fixes are not active on the deployed backend yet.

## Validation Rerun

| Check | Result | Evidence |
|---|---:|---|
| Locked tenant verified | PASS | Authenticated as `admin@test.prod`; user/shop IDs matched required test assets. |
| Shop/channel auto-reply config | PASS | Both shop and channel are now `AI_ACTIVE`. |
| Page ID | PASS | Connected channel is Page `1006927412511938`, display `Bornohin Fashion BD`. |
| Invalid verify token rejected | PASS | Webhook challenge with invalid token returned `403`. |
| Invalid signature rejected | PASS | Meta-shaped POST with invalid signature returned `403`. |
| Positive verify challenge | FAIL | All local token candidates returned `403`; deployed secret/Meta Dashboard token still needs alignment. |
| Page token ping | PASS | Channel test webhook ping returned `ok=true`, latency `1877ms`. |
| Stored `messages` subscription | FAIL | Live stored fields are still `[]`; local repair/sync patch is not deployed. |
| Dedicated product fixture | PASS | Product ID `95162218-b5d9-4690-8544-0f296f2925b6`, price `1490.00`, tracked quantity `9`, sizes `M/L`. |
| COD and delivery | PASS | COD enabled, extra COD charge `0`, area charges `60/80/120`. |
| Refund FAQ | PASS | Dedicated active FAQ exists. |
| Courier side effects | PASS | Pathao, Steadfast, RedX disconnected/inactive. |
| Payment side effects | PASS | Payment gateway config count is `0`; only COD is available. |
| Billing side effects | PASS/WARN | No billing/payment action triggered; subscription remains `trial_expired`, which blocks AI. |
| AI diagnostics | FAIL | Live `/api/shop/ai-diagnostics` still returns `500`. |

## Remaining Blockers

| Severity | Blocker | Required Resolution |
|---|---|---|
| P0 | Subscription status is `trial_expired`. | Create a safe non-billable AI-active test state, or deploy an explicit smoke-test bypass that cannot be merchant-controlled. Do not trigger a real payment request. |
| P0 | Webhook verify token is not aligned. | Align deployed `META_WEBHOOK_VERIFY_TOKEN` and Meta Dashboard callback config; prove a positive challenge. |
| P0 | `messages` subscription is not verified. | Deploy the subscription verification/sync patch and run the test-webhook repair against only the dedicated Page. |
| P0 | Shop-level kill switch precedence is not live. | Deploy the local worker fix before any smoke scenario that depends on emergency manual mode. |
| P1 | AI diagnostics is still 500 on live. | Deploy the local diagnostics fix and re-run diagnostics. |
| P1 | `api.easymod.tech` TLS is broken while config references it. | Fix DNS/TLS or remove/update stale config references; until then use `https://easymod.tech/api`. |

## Gate

Real Messenger smoke testing remains blocked. Do not send the first customer-side Messenger message until the P0 items above pass in a fresh preflight run.
