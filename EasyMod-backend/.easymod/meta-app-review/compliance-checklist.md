# App Review Readiness Checklist

**App:** Easy Moderator
**Last updated:** 2026-06-27 (Messenger-only launch; Comment-to-DM removed)
**Source:** Copied from `.easymod/skills/meta-policy-skill.md` (App Review Readiness Checklist, lines 144–156) with current pass/fail state and file:line evidence.

---

## Checklist Items

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Privacy Policy live at `/privacy-policy` route | PASS | `EasyMod-frontend/src/app/routes.ts` — route `/privacy-policy` renders `PrivacyPolicy.tsx`. Live at `https://easymod.tech/privacy-policy` (paste apex into the dashboard; `www` 301s to apex). |
| 2 | Terms of Service live at `/terms` route | PASS | `EasyMod-frontend/src/app/routes.ts` — route `/terms` renders `TermsOfService.tsx`. Live at `https://easymod.tech/terms`. **Note:** the dashboard Terms URL is `/terms` — NOT `/terms-of-service` (there is no such route; it would 404). |
| 3 | Data Deletion Callback endpoint live: `POST /api/webhooks/meta/data-deletion` | PASS | `EasyMod-backend/src/modules/integration/meta-webhook-gdpr.handler.js` — signed_request validation, idempotency guard, `Customer.destroy` cascade, 200 + confirmation_code response. Mounted at `/api/webhooks/meta` in `app.js`. See `data-deletion-flow.md`. |
| 4 | Webhook verification (`hub.challenge` response) tested | PASS | `EasyMod-backend/src/modules/integration/meta-webhook.routes.js` — `GET /webhooks/meta` accepts the global `META_WEBHOOK_VERIFY_TOKEN` (App Dashboard handshake) with timing-safe compare, and falls back to per-channel tokens for any legacy direct subscriptions. |
| 5 | All requested permissions have written use case justifications | PASS | See `permissions-justification.md` in this directory — 3 permissions each with use case, screen, API call, and data retention policy. |
| 6 | No test/sandbox data visible in production screenshots | PENDING | Screencasts must be recorded using the test accounts specified in `test-user-credentials.md`. Production environment has no seeded test data. |
| 7 | App mode is LIVE (not development) for production use | PENDING | Founder to verify in Meta App Dashboard. Set app to Live mode before recording screencasts. |
| 8 | Business Verification completed on Meta Business Manager | PENDING | Founder to complete Meta Business Verification for Hexabyte Limited. Required before any Page permission (pages_messaging etc.) can be granted to non-test users. |

---

## Policy Engine Safety Checks (Pre-Implementation Checklist from meta-policy-skill.md)

These 10 checks are verified against the codebase:

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | User-initiated trigger | PASS | Messenger replies are sent only in response to direct inbound Messenger messages. Comment-to-DM is not mounted or subscribed. `meta-webhook-events.handler.js` |
| 2 | No cold outreach | PASS | No broadcast feature; all sends are reactive. Policy engine `policy.engine.js` blocks outbound without prior inbound. |
| 3 | No fake engagement | PASS | No auto-like, auto-follow, or auto-share implemented anywhere in codebase. Grep confirms zero. |
| 4 | Consent present | PASS | `consentService.recordInbound()` called on every inbound event. `messaging_consent` JSONB updated. |
| 5 | Opt-out honored | PASS | `policy.engine.js` checks `messaging_consent.{platform}.opted_out_at` before every outbound. `meta-policy-risks.md` 2026-05-16 risk addressed in Phase 5. |
| 6 | Rate limit safe | PASS | 170 DMs/hour leaky bucket per pageId in `message-worker.js` Guard 5. Redis key: `rate:meta:dm:{pageId}`. |
| 7 | Message window valid | PASS | 24-hour window guard in policy engine. HITL escalation pauses AI replies. `POST_PURCHASE_UPDATE` tag used for order confirmations outside window. |
| 8 | Content appropriate | PASS | Guardrail service + hallucination detector + quality score gate on all AI replies. |
| 9 | Page ownership | PASS | OAuth scopes access token to the page the merchant explicitly authorised. `meta-channel.entity.js` stores per-page tokens. |
| 10 | Deduplication | PASS | Message `external_id` storage guard and Redis NX idempotency guard (Guard 1 in `message-worker.js`) prevent duplicate replies for the same Messenger message. |
| 11 | Automated-experience disclosure | PASS | **Meta Messenger Platform requires that users know they're talking to an automated system.** Every conversation's first AI reply is prepended with a mandatory, owner-uneditable clear-text disclosure ("You're chatting with {shop}'s automated AI assistant."), in en/bn/mixed. `EasyMod-backend/src/modules/shop/ai-messaging.js:20-67` (`DISCLOSURE`, `buildGreeting`). No toggle removes it — only the optional custom welcome text after it is owner-editable. |

---

## Remaining Actions Before Submission

1. Founder: Set app to **Live mode** in Meta App Dashboard (checklist item 7)
2. Founder: Complete **Meta Business Verification** for Hexabyte Limited (checklist item 8)
3. Founder: Record screencasts using storyboards in `screencast-storyboards.md`
4. Founder: Create and populate test accounts per `test-user-credentials.md`, share via 1Password secure link
5. Team: Confirm Data Deletion Callback URL is registered in Meta App Dashboard as `https://easymod.tech/api/webhooks/meta/data-deletion`
