# EasyModerator Meta Safe Rules

## Why These Rules Exist
EasyModerator's entire platform depends on continued Meta API access. A restriction on the Meta App = zero automation = zero revenue. These rules are the survival constraints for the business.

---

## Non-Negotiable Automation Constraints

### 1. Comment Automation
- ONLY trigger DMs when a customer comment contains the configured keyword on the **shop's own post**
- NEVER trigger on: competitor pages, public groups, posts the shop doesn't own
- NEVER send duplicate DMs for the same comment event (idempotency guard — implemented)
- NEVER send to customers with `customer.messenger_opted_out = true`
- Rate limit: **170 DMs/hour/page** (EM soft limit, Meta hard limit: 200/hr)

### 2. Messenger Messaging Rules
- Standard messaging: **only within 24-hour window** from last user message
- Outside 24-hour window: ONLY with an approved Message Tag
  - `POST_PURCHASE_UPDATE` — confirmed purchase order updates
  - `CONFIRMED_EVENT_UPDATE` — events user registered for
  - `ACCOUNT_UPDATE` — changes to user's account with the app
- NEVER use Message Tags for: promotional content, discounts, reactivation blasts

### 3. Rate Limiting — Current Implementation
```
Soft limit:  170 DMs/hour/page  (EM guard 5 in message-worker.js)
Hard limit:  200 DMs/hour/page  (Meta enforcement)
Algorithm:   Redis leaky bucket per pageId
Key:         rate:meta:dm:{pageId}
Behavior:    When soft limit reached → re-queue job with 60s delay (not drop)
```

**Never raise the soft limit above 185/hr.** Any change to rate limit logic requires approval and entry in `.easymod/memory/meta-policy-risks.md`.

### 4. Required User Consent
- **Messenger:** Implicit consent when user sends message first (within 24-hour window)
- **WhatsApp:** Explicit opt-in required before any business-initiated message
- **Instagram:** Same as Messenger — user must message first
- **Opt-out detection** (all languages):
  ```
  Bengali:   "বন্ধ করুন", "আর না", "থামুন", "বন্ধ"
  Banglish:  "bondo koro", "ar na", "stop koro", "band koro"
  English:   "stop", "unsubscribe", "opt out", "no more messages", "don't message"
  ```
- On opt-out: `customer.messenger_opted_out = true` → never send again until explicit re-opt-in

### 5. Page Ownership
- Only automate actions on pages and accounts the shop has explicitly authorized via OAuth
- Access token stored encrypted (`CHANNEL_ENCRYPTION_KEY` AES encryption in channel.entity)
- Token scope validated at channel connection time

---

## App Review Requirements

The following must be live and verifiable before submitting any new permission to Meta:

- [ ] Privacy Policy: live at `/privacy-policy` ✅
- [ ] Terms of Service: live at `/terms` ✅
- [ ] Data Deletion Callback: `POST /api/webhooks/data-deletion` — must be implemented
- [ ] Webhook verification (`GET /api/webhooks/meta?hub.challenge=`) ✅
- [ ] All permissions have written justifications (stored in App Review submission notes)
- [ ] App is in LIVE mode (not Development mode) for production pages
- [ ] Business Verification completed on Meta Business Manager

---

## Permissions Inventory

| Permission | Use Case | Status |
|-----------|---------|--------|
| `pages_messaging` | Send/receive Messenger DMs for comment automation | Active |
| `pages_read_engagement` | Monitor comments on posts for keyword trigger detection | Active |
| `pages_manage_posts` | Reply to comments (not just DMs) | Active |
| `instagram_basic` | Read IG profile + media for comment monitoring | Active |
| `instagram_manage_messages` | Send/receive Instagram DMs | Active |
| `whatsapp_business_messaging` | WhatsApp Business API messaging | Active |

**Do not request additional permissions** without explicit Meta policy review and approval from founder.

---

## Features That Must Be Blocked

Any feature matching these patterns MUST be blocked and NOT implemented:

1. "Send message to all followers / all commenters regardless of keyword" — cold outreach
2. "Auto-DM users who liked/reacted to a post" — no prior messaging interaction
3. "Schedule promotional messages outside the 24-hour window" — requires approved tag
4. "Auto-reply to comments on other pages/groups" — third-party page violation
5. "Send bulk identical template messages to all customer contacts" — spam pattern
6. "Auto-like, auto-follow, or auto-share on behalf of the page" — fake engagement
7. "Collect phone numbers by scraping public post comments" — no user consent
8. "Remove or bypass rate limiting guards for faster sends" — spam detection trigger
9. "Send to customers who have opted out" — explicit consent violation
10. "Bypass message-worker.js guard chain for performance" — removes all safety layers

---

## Spam Risk Mitigation (Current)

| Risk Factor | Mitigation in Place |
|------------|-------------------|
| Identical messages | AI generates personalized replies |
| High send rate | 170/hr leaky bucket guard |
| Poor response quality | Guardrail quality score check |
| Outside 24h window | HITL + AI pause guard (guard 3) |
| Duplicate sends | Redis NX idempotency (guard 1) |
| LLM hallucination causing bad messages | Hallucination detector (guard 3 of guardrail) |
| One shop flooding Meta | BullMQ group fair-queueing per shopId |

---

## Safe Alternatives Library

When a feature is blocked, offer the safe alternative:

| Blocked Request | Safe Alternative |
|----------------|-----------------|
| Blast all followers with promotion | Use `ACCOUNT_UPDATE` tag for renewal reminders only |
| DM all commenters immediately | DM only keyword-trigger commenters, within rate limits |
| Cold promo to all contacts | Build opt-in flow → use `POST_PURCHASE_UPDATE` for order confirmations |
| Scrape phones from comments | Collect phone in DM conversation ("Please share your delivery number") |
| Auto-engage (likes/follows) | Focus on DM quality — engagement gaming violates Meta TOS |
| Remove rate limits for speed | Increase soft limit incrementally (max 185/hr) with monitoring |
| Third-party page automation | Requires that page to authorize EasyModerator — explain to seller |

---

## When Something Goes Wrong

If Meta sends a policy warning or restriction notice:

1. **Immediately** pause all automation for affected pages
2. Document incident in `.easymod/memory/meta-policy-risks.md`
3. Identify which feature/behavior triggered the warning
4. Do NOT re-enable automation until root cause is identified and fixed
5. Submit a Meta support ticket if restriction was incorrect
6. Review all recent changes to automation code in `message-worker.js` and `meta-send.service.js`
