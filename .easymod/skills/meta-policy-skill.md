---
name: em-meta-policy-skill
description: "EasyModerator Meta Platform Policy skill. MUST be consulted before implementing any FB/IG automation, comment-to-DM flow, Messenger broadcast, webhook subscription, rate-limit strategy, or user consent flow. Returns SAFE / CAUTION / BLOCK verdict."
last_updated: "2026-05-20"
---

# Meta Policy Skill — EasyModerator Compliance Auditor

## ROLE
Meta Platform Policy Compliance Auditor for EasyModerator. The entire EasyModerator platform depends on continued Meta API access. A single policy violation can trigger app restriction = platform shutdown = zero revenue. This skill is a hard safety gate.

**Returns one of:** `SAFE` | `CAUTION` | `BLOCK`

If this skill returns `BLOCK`: **stop implementation immediately**, do not proceed, propose the safe alternative from the Safe Alternatives Library below.

---

## PRE-IMPLEMENTATION CHECKLIST (10 Points)

Run ALL 10 checks before approving any Meta automation feature:

| # | Check | Pass criteria |
|---|-------|---------------|
| 1 | User-initiated trigger | Feature only sends messages AFTER a user action (comment, DM, click) |
| 2 | No cold outreach | No messages to users who have never interacted with the page |
| 3 | No fake engagement | No automated likes, follows, shares, or reactions |
| 4 | Consent present | User has implicitly (messaged first) or explicitly opted in |
| 5 | Opt-out honored | System checks `customer.messenger_opted_out` before sending |
| 6 | Rate limit safe | Send rate stays below 170/hr per page (EM soft limit, Meta hard: 200/hr) |
| 7 | Message window valid | Message is within 24h window OR uses an approved message tag |
| 8 | Content appropriate | No spam content, deceptive claims, prohibited categories |
| 9 | Page ownership | Automation only acts on the shop's OWN page/posts, never third-party |
| 10 | Deduplication | Idempotency guard prevents sending duplicate messages for same event |

**Verdict logic:**
- All 10 pass → `SAFE`
- 1–2 checks uncertain but mitigatable → `CAUTION` (implement with guard)
- Any check fails with no mitigation → `BLOCK`

---

## MESSENGER PLATFORM POLICY RULES

### Standard Messaging Window
- **24-hour window:** After a user sends a message, you may reply for up to 24 hours
- After 24 hours: standard messaging is prohibited without an approved Message Tag
- EasyModerator's HITL detection and AI pause guard operate within this window

### Approved Message Tags
Only these tags allow messaging outside the 24-hour window:

| Tag | Allowed use | EasyModerator use case |
|-----|------------|----------------------|
| `CONFIRMED_EVENT_UPDATE` | Remind users about upcoming events they registered for | Not typical for EM |
| `POST_PURCHASE_UPDATE` | Order status updates for a confirmed purchase | ✅ Order dispatch / delivery update |
| `ACCOUNT_UPDATE` | Notify users about changes to their account with your app | ✅ Subscription renewal alerts |

**NEVER use tags for:** promotional content, discount offers, re-engagement blasts, cold follow-up.

### Prohibited Message Content
- Spam / bulk identical messages
- Adult content, weapons, drugs
- Deceptive or misleading claims
- Harassment or threatening content
- Content that violates Facebook Community Standards

---

## COMMENT AUTOMATION SAFETY RULES

EasyModerator's core feature is comment-triggered DMs. These rules are non-negotiable:

### Trigger Rules
1. **Keyword-only:** Only trigger DM when comment contains the shop-configured keyword — not all comments
2. **Own posts only:** Only trigger on posts belonging to the shop's own page — NEVER on third-party posts, public groups, competitor pages
3. **No fake comment replies:** Comment reply automation must not simulate organic engagement
4. **One DM per trigger:** Never send multiple DMs for a single comment event

### Rate Limiting — Current Implementation
```
Per-page rate: 200 DMs/hour (Meta hard limit)
EM soft limit: 170 DMs/hour (implemented in message-worker.js guard 5)
Implementation: Redis leaky bucket per pageId
Key pattern: rate:meta:dm:{pageId}
Behavior when limit approached: job re-queued with 60-second delay
```

**If modifying rate limit logic:** maintain the 170/hr soft limit. Do not raise it above 185/hr under any circumstances. Document the change in `.easymod/memory/meta-policy-risks.md`.

### Anti-Spam Mitigations (currently implemented)
- AI generates contextual personalized replies (not copy-paste templates)
- Guardrail service validates response quality before sending
- Hallucination detector prevents confabulated product info
- Circuit breaker stops sends during LLM outages (no template blasts)
- BullMQ fair-queueing (`group.id = shopId`) — one shop can't flood Meta

---

## SPAM DETECTION RISK FACTORS

These signals trigger Meta spam detection. Monitor and mitigate:

| Risk Factor | Current EM Mitigation | Risk Level |
|------------|----------------------|-----------|
| Identical messages to many users | AI personalizes each reply | Mitigated |
| High DM send rate | 170/hr leaky bucket per page | Mitigated |
| Low open/response rate | Quality guardrail filter | Partial |
| User blocks / reports | No current tracking | **Unmitigated** |
| Keyword stuffing in messages | Hallucination detector | Partial |
| Sending outside 24h window | HITL + AI pause guards | Mitigated |

**Action item:** Implement user block/report tracking to identify and pause problematic shops.

---

## USER CONSENT FLOWS

### Messenger
- **Implicit consent:** User sends a message to the page → standard 24-hour window applies
- No explicit opt-in required for reactive messaging (within window)
- **Opt-out detection** (must be implemented and tested):
  ```
  Bengali: "বন্ধ করুন", "আর না", "থামুন"
  Banglish: "bondo koro", "ar na", "stop koro"
  English: "stop", "unsubscribe", "no more messages", "don't message me"
  ```
- On opt-out: set `customer.messenger_opted_out = true`, never send again

### WhatsApp Business API
- **Explicit opt-in REQUIRED** before any business-initiated message
- User must explicitly agree to receive messages from the business
- Opt-out: `customer.whatsapp_opted_out = true`

### Instagram
- Same rules as Messenger — 24-hour window, user-initiated trigger only
- Direct Instagram DMs: only in response to user-initiated action (comment / DM)

### Data Consent
- Only collect PII (name, phone, address) through explicit conversation — never scrape from public posts
- Data deletion callback must be implemented: `POST /api/webhooks/data-deletion`
- Store only what is needed (data minimization)

---

## APP REVIEW READINESS CHECKLIST

Required before submitting any new permission to Meta for review:

- [ ] Privacy Policy live at `/privacy-policy` route ✅
- [ ] Terms of Service live at `/terms` route ✅
- [ ] Data Deletion Callback endpoint live: `POST /api/webhooks/meta/data-deletion`
- [ ] Webhook verification (`hub.challenge` response) tested ✅
- [ ] All requested permissions have written use case justifications (in PR description)
- [ ] No test/sandbox data visible in production screenshots
- [ ] App mode is LIVE (not development) for production use
- [ ] Business Verification completed on Meta Business Manager

### Permissions EasyModerator Uses

| Permission | Purpose | Status |
|-----------|---------|--------|
| `pages_messaging` | Send/receive Messenger DMs | Active |
| `pages_read_engagement` | Read comments on posts for keyword detection | Active |
| `pages_manage_posts` | Reply to comments | Active |
| `instagram_basic` | Read IG profile and media for comment monitoring | Active |
| `instagram_manage_messages` | Send/receive Instagram DMs | Active |

### Removed Permissions

| Permission        | Removed          | Reason                                                                                                                                           |
|-------------------|------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| `whatsapp_business_messaging` | 2026-05-20 | BD market validation showed Messenger+IG covers 95% of f-commerce conversations; WhatsApp Business API onboarding friction too high for SME pilot |

---

## BLOCK TRIGGERS

These feature requests MUST be blocked. Return `BLOCK` immediately:

1. **"Broadcast to all followers/commenters regardless of keyword"** — cold outreach without trigger
2. **"Auto-DM everyone who liked/reacted to a post"** — no prior messaging interaction
3. **"Schedule promotional messages to send at midnight to all customers"** — outside 24h window without tag
4. **"Auto-reply to comments on other pages/groups"** — third-party page automation
5. **"Send bulk identical template messages to all customer contacts"** — spam risk
6. **"Simulate engagement — auto-like comments that trigger automation"** — fake engagement
7. **"Collect customer phone numbers by scraping public post comments"** — no consent
8. **"Bypass the 24-hour window to send promotional offers"** — requires approved message tag
9. **"Send messages to users who opted out"** — explicit consent violation
10. **"Remove the rate limiting guard to send faster"** — will trigger Meta spam detection

---

## SAFE ALTERNATIVES LIBRARY

When a requested feature is blocked, propose the safe alternative:

| Blocked Pattern | Safe Alternative |
|----------------|-----------------|
| Broadcast blast to all followers | POST_PURCHASE_UPDATE tag to customers with active orders only |
| Auto-DM all commenters immediately | DM only commenters using the configured trigger keyword, within rate limits |
| Send promo messages at scheduled time | Customer opt-in subscription flow → ACCOUNT_UPDATE tag for eligible messages |
| Scrape phones from public comments | Collect phone via in-conversation prompt ("Share your number for delivery") |
| Auto-like comments to boost engagement | Not implementable — explain engagement gaming risk to seller |
| Send to opted-out customers | Offer re-opt-in prompt if they message the page again |
| Remove rate limit | Increase rate limit incrementally with monitoring — never above 185/hr |
| Third-party page automation | Explain policy: only the page the shop owns and authorized |

---

## ALWAYS

- Run all 10 pre-implementation checks BEFORE any Meta feature review
- Check `.easymod/memory/meta-policy-risks.md` for previously identified risks
- Document new risks discovered during review in `.easymod/memory/meta-policy-risks.md`
- Escalate `BLOCK` verdicts to the founder before proceeding with alternatives

## NEVER

- Approve a feature that fails any of the 10 checklist items without mitigation
- Raise the rate limit above 185/hr per page
- Allow cold messaging (no prior user interaction)
- Implement features that simulate engagement (likes, follows, reactions)
- Skip the consent/opt-out check for any messaging feature
