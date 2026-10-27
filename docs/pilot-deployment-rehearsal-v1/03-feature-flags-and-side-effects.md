# 03 — Feature flags and side effects

## Runtime flag state

The final backend and worker containers both reported these runtime values:

| Switch | Backend | Worker | Source/production note |
|---|---:|---:|---|
| `START_EMBEDDED_WORKERS` | false | false | Dedicated worker owns queue consumers |
| `DOMAIN_AGENT_RUNTIME_ENABLED` | false | false | Production renderer default false |
| `AI_ORDER_MUTATIONS_ENABLED` | false | false | Production renderer default false |
| `AI_COURIER_BOOKING_ENABLED` | false | false | Production renderer default false |
| `AI_PAYMENT_ACCEPTANCE_ENABLED` | false | false | Production renderer default false |
| `AI_SUPPORT_CASE_ENABLED` | false | false | Production renderer default false |
| `MOBILE_API_ENABLED` | false | false | Production renderer default false |
| `AI_PHOTO_MATCH_ENABLED` | false | false | Deliberate rehearsal override; production renderer defaults true |
| `AI_VISION_ENABLED` | false | false | Production renderer default false |

`RUN_WORKER` was unset in the backend runtime. Payment and Telegram integrations were disabled in the synthetic configuration. The optional photo-match override is intentionally non-equivalent to production. It does not disable the separate text-only RAG order-selection path described in the owner and provider documents.

## Corrected consumer-startup boundary

FlowGuard traced an import path from `server.js` through the normal route tree to `notification.controller.js`, which imported the queue-manager singleton. Before correction, QueueManager constructed BullMQ Workers during import, so the API container could consume jobs even with `START_EMBEDDED_WORKERS=false`. A synthetic job completed after the dedicated worker was stopped, confirming the ownership failure in the rehearsal.

Commit `6d6bc1dd056e09202b97d05e81f20308b15109ab` makes queue-manager imports passive: they create queue handles but no consumers. The dedicated worker explicitly invokes `startWorkers()`, waits for Worker readiness, then schedules recurring jobs and reports ready. The embedded server path is still controlled by `START_EMBEDDED_WORKERS`; the message Worker handle is reused to avoid duplicate construction when `RUN_WORKER=true` is set. The startup-boundary regression passed 4 tests after the correction.

On the corrected runtime, we stopped only this rehearsal project's dedicated worker, enqueued a no-send synthetic canary, and observed it remain waiting (`waiting=1`, `active=0`, `delayed=0`, `failed=0`). Starting the dedicated worker completed the canary once with `{canary:true,ok:true}` and cleared pending counts. This demonstrates queue consumer ownership for the exercised synthetic path.

## Kill switches and webhook fail-closed behavior

All three documented levels were exercised against synthetic rehearsal records:

| Level | Trigger and observed enforcement | Result |
|---|---|---|
| Global Action Gate | Attempted synthetic `CREATE_ORDER` while global runtime switch was disabled | Denied with `runtime_kill_switch_enabled`; exactly one `ai.action_gate.denied` audit row |
| Per conversation | Set `ai:pause:<synthetic-conversation-id>` and ran a synthetic worker job | Job completed as `ai_paused`; no message was written |
| Per shop | Set shop `automation_mode=MANUAL` and ran a synthetic worker job | Job completed as `manual_mode`; no message was written |

The synthetic conversation retained 0 customer messages and 2 processing turns. The per-shop `MANUAL` path also created/queued an in-app HITL notification for the synthetic shop; the fixture had no push subscription or Telegram binding, and the project network was internal with no egress. No customer send/message was produced. The missing-signature synthetic payment callback returned HTTP 503. A separate throwaway signed webhook replay/race harness passed 2 tests and was cleaned up; the main shared rehearsal database received no valid payment callback. Fresh independent receipt: `D:\easymod-runtime\pilot-deployment-rehearsal-v1\kill-switches-independent-final.log` (exit 0).

## Scope and residual safety gaps

- The exercised API, worker, and webhook cases were synthetic and isolated. They establish the tested denials, not all possible commerce flows.
- No real message, order, payment, refund, or courier action was attempted. No valid webhook was delivered to the primary rehearsal stack.
- No feature-flag revocation was injected during a payment/order transaction, and no retry/reconciliation job was fault-injected.
- The `AI_PHOTO_MATCH_ENABLED=false` and `AI_VISION_ENABLED=false` settings do not gate every image-triggered order choice. The text-only RAG matcher can still run on accompanying text, and the caller does not validate match confidence. Keep that path out of pilot commerce until its gate and catalog identity are calibrated.
- The Messenger provider-outage event is not consumed by the Inbox SSE hook. The Bangla/Banglish price-keyword fallback can prompt an order under AUTO mode. Keep AI reply mode `MANUAL` until outage visibility and fallback regression coverage are addressed.

`COMMERCE_MUTATION_SAFETY=PARTIAL`: the global Action Gate, conversation pause, per-shop MANUAL mode, missing-signature callback, and worker ownership boundary passed for the exercised synthetic paths; broader replay, revocation-race, and business-side-effect coverage remains incomplete.
