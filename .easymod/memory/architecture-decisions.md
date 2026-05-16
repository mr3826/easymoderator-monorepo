# Architecture Decisions
**Last Updated:** 2026-05-16

## Overview
_ADR log maintained by EM-Orchestrator. Records architectural decisions, their rationale, and consequences._

---

## Decisions Log (ADRs)

## ADR-001: Webhook Send Compatibility Shim

**Date:** 2026-05-16
**Status:** Accepted

### Context

Nine call sites across six modules (payment-webhook.controller, invoice.service, delivery-tracking.service, order-tracking.service, order-session.service, owner-notification.service) required `../webhook/webhook.service` with a `sendMessage(channel, recipientId, text)` interface. That module did not exist. All calls were wrapped in try/catch with TODO comments noting silent failure.

### Decision

Create `src/modules/webhook/webhook.service.js` as a thin compatibility shim. It adapts the `sendMessage(channel, recipientId, text)` interface to `meta-send.service.sendWithRateLimit({ shopId, platform, recipientId, message })`. This is intentionally a shim, not a full service — the real send logic stays in `integration/meta-send.service.js` which owns rate limiting and the Graph API call.

### Meta Policy Impact

The shim routes through `sendWithRateLimit` which enforces the 170/hr leaky bucket per pageId. Meta rate limit safety is preserved. However, the shim does not yet check `customer.messenger_opted_out` before forwarding — this is a known gap documented in meta-policy-risks.md.

### BD Commerce Impact

Payment confirmation, delivery tracking, and order status messages to customers now have a real send path instead of silently failing. This directly affects the BD commerce conversion flow (step 12-14 of the 14-step funnel).

### Consequences

All nine call sites now have a working send path. The shim is single-responsibility and easily replaceable. Adding opt-out checking, message tagging (POST_PURCHASE_UPDATE), or channel-type-specific adapters can be done in one place.

### Migration Notes

No DB migration required. No env var changes.

### Rollback

Delete `src/modules/webhook/webhook.service.js`. All nine call sites revert to silent failure (no regression in functionality, just lost confirmations).

---

## ADR-002: CSRF Session Identifier — Remove IP Fallback

**Date:** 2026-05-16
**Status:** Accepted

### Context

The `csrf-middleware.js` `getSessionIdentifier` function used `x-forwarded-for` / `x-real-ip` / `req.ip` as a fallback identifier for requests without a session ID. This is exploitable via two attack vectors: (1) IP spoofing via X-Forwarded-For header manipulation, and (2) CSRF token sharing across users on the same NAT/proxy network.

### Decision

Replace the IP fallback with `crypto.randomUUID()` stored as `req.session._csrfSessionId`. On subsequent requests within the same session, the stored UUID is reused. For truly session-less requests (no session object at all), a fresh UUID is generated per request — meaning no CSRF protection for that specific request, but this path should not be reachable for any state-changing authenticated endpoint.

### Meta Policy Impact

N/A — CSRF is an internal auth mechanism, not a Meta API concern.

### BD Commerce Impact

N/A — improves security for BD seller dashboard authentication flows.

### Consequences

Slightly higher entropy per session creation (one `crypto.randomUUID()` call per anonymous POST that lacks a session). Sessions with `saveUninitialized: false` may not persist the `_csrfSessionId` unless `session.save()` completes before the response. Non-blocking save is used to avoid response latency.

### Migration Notes

No DB migration. No env var changes. Existing sessions will generate a new `_csrfSessionId` on next POST — one-time re-validation required for in-flight sessions.

### Rollback

Revert `csrf-middleware.js` to prior IP-based fallback (git revert the commit).

**ADR format:**
```md
## ADR-{number}: {Title}
**Date:** {YYYY-MM-DD}
**Status:** Accepted / Superseded / Proposed

### Context
{What situation prompted this decision?}

### Decision
{What was decided?}

### Meta Policy Impact
{Affects Meta API? Rate limits? Consent? — or N/A}

### BD Commerce Impact
{Affects BD seller workflows, BKash, delivery, or order flows? — or N/A}

### Consequences
{What changes? What becomes easier or harder?}

### Migration Notes
{DB migrations, queue topology, env var changes required?}

### Rollback
{How to revert if this causes problems?}
```

---

## Pending Decisions

_Decisions under discussion — not yet finalized._

_No entries yet._

---

## Overturned Decisions

_ADRs that were superseded — kept for historical context._

_No entries yet._
