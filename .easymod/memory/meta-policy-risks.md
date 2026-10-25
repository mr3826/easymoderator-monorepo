# Meta Policy Risks
**Last Updated:** 2026-10-25 (Pilot+ V1 reconciliation)

## Overview
_Meta Platform Policy risk register maintained by EM-Orchestrator. Updated when a new risk is discovered, a feature is blocked, or a policy clarification is obtained. Critical for platform survivability._

---

## Identified Risks

## 2026-10-25 — Messenger message-tag retirement (P0-1) — CLOSED on Pilot+ branch; HUMAN_AGENT pending
**Risk Level:** HIGH → contained
**Status:** Mitigated (branch `feat/pilotplus-v1-merchant-momentum`, commit 6b9dcfbd)

### Description
Meta deprecated CONFIRMED_EVENT_UPDATE / ACCOUNT_UPDATE / POST_PURCHASE_UPDATE
(2026-02-09) and returns error 100 for them since 2026-04-27. Until this fix the
policy window rule blindly attached POST_PURCHASE_UPDATE to every outside-window
send (guaranteed failures + policy exposure), and templateRequired allowed all
three.

### Current state after fix
- Outside window without a currently-valid tag → DENY → worker HELDS the message
  for merchant recovery (action queue bucket 2/4). No default tag exists.
- Provider attaches a tag ONLY if `isAllowedMessageTag` passes (defense-in-depth).
- HUMAN_AGENT: the sole surviving class — requires the separate Human-Agent
  permission (NOT granted), manual representative replies only (automated use is
  an explicitly disallowed usage — blocked in rule), and a 7-day clock measured
  from verified inbound evidence. Path exists behind `META_HUMAN_AGENT_TAG_ENABLED`
  (default OFF).

### Pending founder action
Apply for the Human-Agent permission via App Review; until then keep the flag
OFF. Post-window outreach alternatives (Utility/Marketing Messages with opt-in,
private replies, sponsored messages, OTN) each need separate decisions.

## 2026-10-25 — Interactive choices (Pilot+ P+02) policy posture
**Risk Level:** LOW (by construction)
**Status:** Active (monitored)

### Description
Quick replies ride the standard 24-hour messaging window as ordinary RESPONSE
sends: every proposal send traverses the FULL policy chain (consent, opt-out,
window, sanitizer, rate limit) with no exemption; taps resolve only through the
server-side interaction kernel (opaque payload, scope+expiry+version+single-use),
and business reply mode (AUTO/DRAFT/MANUAL) still governs every consequence.
Pilot flags default OFF; nothing interactive can message outside the window.

## 2026-05-16 — Messenger Opt-Out Check Missing in Send Pipeline
**Risk Level:** HIGH
**Status:** Mitigated in current architecture (2026-10-25 Pilot+ verification) — residual exception noted

### Description
`message-worker.js` and the new `webhook/webhook.service.js` shim do not check
`customer.metadata.marketing_opt_out` (or any messenger-specific opt-out flag)
before dispatching outbound messages.  The meta-policy-skill.md standard requires
checking `customer.messenger_opted_out` before every send.  The customer entity
stores consent status under `metadata.marketing_opt_out` — field name mismatches
the policy standard and no check exists in the send path.

### Verification update (2026-10-25)
The described gap matches pre-cutover code. The current chain enforces opt-out at
THREE points: `policy/rules/messengerOptedOut.rule.js` (per-channel
`messaging_consent[platform].opted_out_at`, fail-closed on unknown state),
ingest `processInboundConsent` (STOP phrases recorded + pending bursts cancelled),
and the worker's irreversible-boundary consent RE-READ before any provider call
(`claimProviderSendBoundary`). Opportunity outreach recommendations additionally
return DO_NOT_CONTACT for opted-out customers (advisory only — no sends exist).

### Residual risk
`messengerOptedOut.rule` still carries a narrow legacy exception for transactional
message classes (rule lines ~49-51). Unchanged by Pilot+ (out of authorized scope);
worth an explicit product decision on removing it.

### Trigger scenario
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
