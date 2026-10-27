# 03 — Feature flags and side effects

## Production defaults

The production renderer at the frozen source explicitly emits strict-literal false defaults for the global commerce mutation boundary:

| Switch | Local rehearsal value | Source/default evidence |
|---|---:|---|
| DOMAIN_AGENT_RUNTIME_ENABLED | false | Production renderer default false |
| AI_ORDER_MUTATIONS_ENABLED | false | Production renderer default false |
| AI_COURIER_BOOKING_ENABLED | false | Production renderer default false |
| AI_PAYMENT_ACCEPTANCE_ENABLED | false | Production renderer default false |
| AI_SUPPORT_CASE_ENABLED | false | Production renderer default false |
| MOBILE_API_ENABLED | false | Production renderer default false; mobile routes remain gated |
| BKASH_ENABLED | false | Renderer emits false when the integration is not enabled |
| TELEGRAM_ENABLED | false | Renderer emits false when the integration is not enabled |
| GROWTH_OS_ENABLED | false | Production renderer default false |
| AI_PHOTO_MATCH_ENABLED | false on backend override and worker synthetic env file | Local-only safety override; production renderer currently defaults this optional provider path to true. Neither service was started. |
| AI_VISION_ENABLED | false on backend override and worker synthetic env file | Production renderer default false. Neither service was started. |

The overlay and synthetic env explicitly disable commerce mutations, mobile API, payment integration, Telegram, image matching, and vision. The optional photo-match override is a documented non-equivalence, not a claim about production's default.

A production-defaults-matrix test ran as part of the focused backend regression battery and asserted the flags-off code paths, including a verified payment webhook that does not trigger courier auto-booking. The backend security suite also passed. These are deterministic code tests, not a deployed-runtime observation.

## Corrected interaction-choice boundary

FlowGuard found a path where a proposal could be stored as GENERATED before outbound policy and delivery completed. Bare-number lookup and the resolver CAS accepted both GENERATED and SENT, even though the worker marks SENT only after the provider acknowledges delivery. A denied or failed send could therefore leave a choice that had never been delivered eligible for a later typed-number response.

Commit 3e7ce558 narrows numeric lookup and resolver claims to SENT. The resolver now rejects an undelivered proposal, rechecks the per-shop interaction-choice flag at the authoritative resolution boundary, and makes the worker skip the response when that flag has been revoked. A claimed proposal is best-effort restored to SENT if that flag check denies dispatch. Replay of an already consumed proposal remains a no-op.

The independent code reviewer caught and corrected an initial status-ordering regression during review. The final reviewer rechecked the corrected branch and the service/worker tests. The code-level review did not run a database-backed worker or a real provider.

## Safety claim and limits

- The code tests prove the listed source branches under their fixtures.
- Commerce operations still require the global Action Gate and their mapped feature flags.
- Per-shop feature-flag recheck closes the observed race window immediately before resolver dispatch; it is not an atomic transaction with the subsequent commerce operation. The separate Action Gate remains the final commerce-mutation authority.
- No live or runtime check exercised webhook replay, queued jobs, retry/reconciliation, a worker crash, or a flag flip during a database transaction.
- No real messages, orders, payments, refunds, or courier bookings were attempted.

## Kill switches

1. Per conversation: set ai:pause:<conversation-id> to stop automated AI handling for that conversation.
2. Per shop: set automation_mode=MANUAL.
3. Global: disable the parent runtime and relevant order, courier, payment, and support flags; production changes require re-render and restart.

The source readiness report describes all three levels, but this rehearsal did not trigger them in a running stack. Production confirmation paths and authorized operators remain owner decisions. Do not describe the kill-switch rehearsal as passed.
