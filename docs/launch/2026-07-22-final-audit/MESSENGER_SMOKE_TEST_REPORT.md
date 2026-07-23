# EasyModerator Real Messenger Smoke Test Report

Generated: 2026-07-19 03:20 Asia/Dhaka  
Verdict: NOT RUN

The real Messenger smoke test has not started. The human operator has not sent the first message from the test customer account, and preflight still has P0 blockers that would make the AI/order scenarios produce misleading results.

## Current Run State

| Field | Value |
|---|---|
| Test merchant | `admin@test.prod` |
| Shop | `Bornohin Fashion` (`30010a3a-c180-4f2b-bd74-4bc9c468097e`) |
| Facebook Page | `Bornohin Fashion BD` (`1006927412511938`) |
| Connected channel | `843cdd8e-49d5-4a19-9b7d-05900787abaf` |
| Smoke product | `EM Smoke Test Tracked Panjabi` (`95162218-b5d9-4690-8544-0f296f2925b6`) |
| Customer account | Human operator only; no automated login or password requested |
| Smoke status | `NOT_RUN` |

## Scenario Results

| # | Scenario | Operator Message | Status | Reason |
|---:|---|---|---:|---|
| 1 | Bangla product price | `EM Smoke Test Tracked Panjabi এর দাম কত?` | NOT RUN | Preflight blocked; subscription status `trial_expired` suppresses runtime AI. |
| 2 | Banglish typo | `smok panjabi dam koto?` | NOT RUN | Preflight blocked; subscription status `trial_expired` suppresses runtime AI. |
| 3 | Product price plus delivery charge | `test panjabi price ar delivery charge koto?` | NOT RUN | Preflight blocked; runtime AI and webhook subscription are not fully proven. |
| 4 | Unknown product | `blue denim jacket ache?` | NOT RUN | Preflight blocked; do not test customer-side until safe runtime path is green. |
| 5 | Explicit human request | `মানুষের সাথে কথা বলতে চাই` | NOT RUN | Preflight blocked; deterministic handoff code is local but live kill-switch fix is not deployed. |
| 6 | Refund request | `আমি refund চাই, টাকা ফেরত দিন` | NOT RUN | Preflight blocked; dedicated FAQ exists, but runtime subscription gate blocks AI. |
| 7 | Complete COD order | Product -> name -> phone -> address -> confirm | NOT RUN | Preflight blocked; order automation cannot be certified with subscription inactive. |
| 8 | Duplicate confirmation | Repeat final confirmation message | NOT RUN | Preflight blocked; no live Messenger order flow started. |
| 9 | Attachment/file behavior | Send image/file attachment from Messenger | NOT RUN | Preflight blocked; no human Messenger message sent. |
| 10 | Low-confidence handoff | Unsupported/ambiguous product-policy question | NOT RUN | Preflight blocked; `/api/shop/ai-diagnostics` still fails on live. |
| 11 | AI disabled or HITL active | Message while channel/shop is manually disabled | NOT RUN | Preflight blocked; live worker does not yet contain shop-level kill-switch precedence fix. |
| 12 | Response inside Messenger window | Any valid first-turn message | NOT RUN | No Messenger interaction started. |

## Expected Evidence Per Scenario

For each scenario after preflight is fixed, collect:

| Evidence | Required |
|---|---:|
| Customer-visible Messenger reply screenshot or exact operator transcript | Yes |
| Merchant-visible EasyModerator conversation state | Yes |
| Stored conversation ID and final message ID | Yes |
| Product ID(s) used for grounding | Yes |
| Price/stock/source references in final reply | Yes |
| Handoff state and reason when applicable | Yes |
| Order record and idempotency evidence when applicable | Yes |
| Inventory state before/after order scenario | Yes |
| Audit log or diagnostic trace | Yes |
| Outbound provider result or dry-run/intercept evidence | Yes |

## Not-Run Rationale

The tenant fixtures are now mostly ready, but these P0 blockers remain:

1. The test shop subscription is `trial_expired`, and the worker blocks automated AI for that status.
2. The deployed webhook challenge does not accept any local verify-token source.
3. Stored webhook subscribed fields still do not show the required `messages` subscription.
4. Local fixes for diagnostics, subscription verification/sync, and shop-level kill-switch precedence are not deployed to live.
5. `/api/shop/ai-diagnostics` still returns `500`, so webhook-to-worker trace is incomplete.

Starting the Messenger smoke now would not prove the production AI path and could create false confidence.
