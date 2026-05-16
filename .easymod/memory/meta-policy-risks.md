# Meta Policy Risks
**Last Updated:** 2026-05-16

## Overview
_Meta Platform Policy risk register maintained by EM-Orchestrator. Updated when a new risk is discovered, a feature is blocked, or a policy clarification is obtained. Critical for platform survivability._

---

## Identified Risks

## 2026-05-16 — Messenger Opt-Out Check Missing in Send Pipeline
**Risk Level:** HIGH
**Status:** Active

### Description
`message-worker.js` and the new `webhook/webhook.service.js` shim do not check
`customer.metadata.marketing_opt_out` (or any messenger-specific opt-out flag)
before dispatching outbound messages.  The meta-policy-skill.md standard requires
checking `customer.messenger_opted_out` before every send.  The customer entity
stores consent status under `metadata.marketing_opt_out` — field name mismatches
the policy standard and no check exists in the send path.

### Trigger Scenario
A customer sends "stop" or Bengali opt-out phrases during a conversation.
The opt-out detection guardrail may set `metadata.marketing_opt_out = true`,
but subsequent automated messages (order status, payment confirmation, delivery
tracking) will still be dispatched because the send path never reads this flag.

### Current Mitigation
Guardrail service (Guard 4) validates content policy before AI replies.
HITL flag prevents further AI replies after escalation.

### Residual Risk
Order/payment/delivery confirmation messages bypass the AI guardrail and go
directly through the webhook.service.js shim — these are NOT gated by opt-out
check.  If Meta detects messages to opted-out users, it can restrict the page.

### Recommended Action
1. Add `customer.messenger_opted_out` boolean column to Customer entity (migration).
2. Add a guard in `webhook/webhook.service.js` that queries Customer by recipientId
   and rejects send if `messenger_opted_out = true`.
3. Add opt-out detection patterns (stop / বন্ধ করুন / ar na) to message-worker.js
   guard chain as Guard 0 (before all other processing).
4. Write tests: opted-out customer → sendMessage returns early, not forwarded.

---

## 2026-05-16 — Unknown Payment Gateway Webhook Passes Without Signature Validation
**Risk Level:** MEDIUM
**Status:** Active

### Description
`webhook.middleware.js` `validateWebhookSignature(gateway)` returns a pass-through
`next()` handler for any gateway not explicitly listed in the validators object.
Currently only `bkash` is registered.  A malicious actor can POST arbitrary
payloads to `/api/webhooks/{any-unknown-gateway}/payment-status` without any
authentication.

### Trigger Scenario
Attacker forges a webhook from an unknown gateway name, causing order status
updates or payment confirmations to be processed without verification.

### Current Mitigation
Rate limiting now applied to `/bkash/payment-status` route (60/min).
Other gateway routes would need their own middleware.

### Residual Risk
Medium — depends on whether any unknown-gateway routes are exposed and whether
payment state is mutated on unauthenticated webhook receipt.

### Recommended Action
Change the default in `validateWebhookSignature` from pass-through to a 401
rejection for unknown gateways.  Registry-based approach: only explicitly
registered gateways can receive webhooks.

**Risk entry format:**
```md
## {YYYY-MM-DD} — {Risk Title}
**Risk Level:** HIGH / MEDIUM / LOW
**Status:** Active / Mitigated / Accepted

### Description
{What is the risk?}

### Trigger Scenario
{Under what conditions would this risk materialize?}

### Current Mitigation
{What guards or limits are currently in place?}

### Residual Risk
{What risk remains after mitigation?}

### Recommended Action
{What should be done next?}
```

---

## Blocked Features

_Features that were blocked by meta-policy-skill.md review._

_No entries yet._

**Entry format:**
```md
## {YYYY-MM-DD} — Blocked: {Feature Name}
**Requested:** {what was requested}
**Block Reason:** {which checklist item failed}
**Safe Alternative Proposed:** {what was offered instead}
**Status:** {alternative accepted / deferred / cancelled}
```

---

## Policy Clarifications

_Clarifications obtained from Meta documentation or support._

_No entries yet._

---

## App Review Notes

_Notes from Meta App Review submissions and outcomes._

_No entries yet._
