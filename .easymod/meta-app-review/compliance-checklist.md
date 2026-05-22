# App Review Readiness Checklist

**App:** Easy Moderator
**Last updated:** 2026-05-20
**Source:** Copied from `.easymod/skills/meta-policy-skill.md` (App Review Readiness Checklist, lines 144–156) with current pass/fail state and file:line evidence.

---

## Checklist Items

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Privacy Policy live at `/privacy-policy` route | PASS | `EasyMod-frontend/src/app/routes.ts` — route `/privacy-policy` renders `PrivacyPolicy.tsx`. Live at `https://www.easymod.tech/privacy-policy`. WhatsApp references removed 2026-05-20. |
| 2 | Terms of Service live at `/terms` route | PASS | `EasyMod-frontend/src/app/routes.ts` — route `/terms` renders `TermsOfService.tsx`. Live at `https://www.easymod.tech/terms`. No WhatsApp references. |
| 3 | Data Deletion Callback endpoint live: `POST /api/webhooks/meta/data-deletion` (also accepts `/webhooks/meta/data-deletion`) | PASS | `EasyMod-backend/src/modules/integration/meta-webhook-gdpr.handler.js` — signed_request validation, idempotency guard, `Customer.destroy` cascade, 200 + confirmation_code response. See `data-deletion-flow.md`. |
| 4 | Webhook verification (`hub.challenge` response) tested | PASS | `EasyMod-backend/src/modules/integration/meta-webhook.routes.js` — `GET /webhooks/meta` handles `hub.verify_token` + `hub.challenge` response per Meta spec. |
| 5 | All requested permissions have written use case justifications | PASS | See `permissions-justification.md` in this directory — 5 permissions each with use case, screen, API call, and data retention policy. |
| 6 | No test/sandbox data visible in production screenshots | PENDING | Screencasts must be recorded using the test accounts specified in `test-user-credentials.md`. Production environment has no seeded test data. |
| 7 | App mode is LIVE (not development) for production use | PENDING | Founder to verify in Meta App Dashboard. Set app to Live mode before recording screencasts. |
| 8 | Business Verification completed on Meta Business Manager | PENDING | Founder to complete Meta Business Verification for Hexabyte Limited. Required before any Page permission (pages_messaging etc.) can be granted to non-test users. |

---

## Policy Engine Safety Checks (Pre-Implementation Checklist from meta-policy-skill.md)

These 10 checks are verified against the codebase:

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | User-initiated trigger | PASS | Comment-to-DM only fires on keyword match in comment; Messenger DMs only sent in response to inbound. `meta-webhook-comments.handler.js` |
| 2 | No cold outreach | PASS | No broadcast feature; all sends are reactive. Policy engine `policy.engine.js` blocks outbound without prior inbound. |
| 3 | No fake engagement | PASS | No auto-like, auto-follow, or auto-share implemented anywhere in codebase. Grep confirms zero. |
| 4 | Consent present | PASS | `consentService.recordInbound()` called on every inbound event. `messaging_consent` JSONB updated. |
| 5 | Opt-out honored | PASS | `policy.engine.js` checks `messaging_consent.{platform}.opted_out_at` before every outbound. `meta-policy-risks.md` 2026-05-16 risk addressed in Phase 5. |
| 6 | Rate limit safe | PASS | 170 DMs/hour leaky bucket per pageId in `message-worker.js` Guard 5. Redis key: `rate:meta:dm:{pageId}`. |
| 7 | Message window valid | PASS | 24-hour window guard in policy engine. HITL escalation pauses AI replies. `POST_PURCHASE_UPDATE` tag used for order confirmations outside window. |
| 8 | Content appropriate | PASS | Guardrail service + hallucination detector + quality score gate on all AI replies. |
| 9 | Page ownership | PASS | OAuth scopes access token to the page the merchant explicitly authorised. `meta-channel.entity.js` stores per-page tokens. |
| 10 | Deduplication | PASS | Redis NX idempotency guard (Guard 1 in `message-worker.js`) prevents duplicate DMs for same comment event. |

---

## Remaining Actions Before Submission

1. Founder: Set app to **Live mode** in Meta App Dashboard (checklist item 7)
2. Founder: Complete **Meta Business Verification** for Hexabyte Limited (checklist item 8)
3. Founder: Record screencasts using storyboards in `screencast-storyboards.md`
4. Founder: Create and populate test accounts per `test-user-credentials.md`, share via 1Password secure link
5. Team: Confirm Data Deletion Callback URL is registered in Meta App Dashboard as `https://easymod.tech/api/webhooks/meta/data-deletion`
