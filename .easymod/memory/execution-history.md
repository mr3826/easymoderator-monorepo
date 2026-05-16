# Execution History
**Last Updated:** 2026-05-16

## Overview
_Updated by EM-Orchestrator after every task completion. Provides persistent learning context across sessions._

---

## Recent Tasks

## 2026-05-16 — Full Codebase Review and Issue Remediation

**Task:** Full audit of 77 modified + 14 deleted files since May 10 review. Fix P0 security issues, broken imports, and phone validator bugs. Perform Meta policy compliance check.

**Outcome:** Partial success (P0 fixes complete, P1 deferred, Meta risks documented)

**Modules Affected:** rto-shield, shop-bd-settings, payment/self-mfs-handler, webhooks/payment-webhook, middleware/csrf, webhook (new shim), delivery-tracking, order-tracking, order-session, notification/owner-notification, invoice, utils/validators/phone

**Architecture Changes:**

- Created `src/modules/webhook/webhook.service.js` — compatibility shim adapting `sendMessage(channel, recipientId, text)` to `meta-send.service.sendWithRateLimit()`. Resolves 9 broken require() call sites across 6 modules.
- Fixed `normalizePhone`, `toInternationalFormat`, `BD_LANDLINE` regex bugs in `src/utils/validators/phone.validator.js`. Shared utility now covers all legacy inline regex variants.
- Replaced private `normalizePhone` + `BD_PHONE_RE` in `rto-shield.service.js` and `self-mfs-handler.service.js` with imports from shared validator.
- Replaced local `BD_PHONE_REGEX` literal in `shop-bd-settings.js` with imported `bdMobileRegex`.

**Technical Debt:**

- `customer.messenger_opted_out` field does not exist on Customer entity — the opt-out flag is stored as `metadata.marketing_opt_out`. Field name mismatch vs meta-policy-skill.md standard. The send path (webhook shim + order/delivery modules) never reads this flag. This is debt that must be resolved before scaling send volume.
- `validateWebhookSignature` silently passes unknown gateway names — should default to 401.

**Meta Risk:** HIGH — Messenger opt-out check missing in automated send pipeline (payment confirmation, delivery tracking, order status). See meta-policy-risks.md.

**Future Recommendations:**

- Add `messenger_opted_out` boolean column to Customer entity (DB migration).
- Add opt-out guard in `webhook/webhook.service.js` before forwarding to `sendWithRateLimit`.
- Add opt-out phrase detection to `message-worker.js` as Guard 0.
- Change `validateWebhookSignature` default behavior to reject unknown gateways (401).
- Consolidate remaining inline BD phone regexes in: `customer.validator.js` (3 instances), `order.validator.js`, `subscription/partner-apply.routes.js`, `shop/shop.validator.js`, `conversation/conversation-state-standalone.service.js`, `order/order-session.service.js`.
- P1 delivery provider interface pattern — still pending (5–6 hr effort, ~200 LOC saved).
- P1 middleware error wrapper — still pending (2–3 hr effort, ~80 LOC saved).

**Entry format:**
```md
## {YYYY-MM-DD} — {Task Title}
**Task:** {what was attempted}
**Outcome:** {succeeded / failed / partial}
**Modules Affected:** {list}
**Architecture Changes:** {description or N/A}
**Technical Debt:** {introduced or N/A}
**Meta Risk:** {discovered or N/A}
**Future Recommendations:** {notes}
```

---

## Key Outcomes

_Aggregated wins and learnings — updated when a milestone is reached._

_No entries yet._

---

## Patterns Observed

_Recurring patterns, anti-patterns, or techniques that proved effective._

_No entries yet._
