# Meta App Review Readiness Audit

**App:** Easy Moderator
**Audit date:** 2026-06-23
**Audit type:** Static repository audit plus current Meta developer-reference check
**Verdict:** **Code-side remediation complete; live Meta review checks still pending**

This verdict is based on code and repository evidence only. I did not log in to the live
Meta App Dashboard, verify production secrets, run a live webhook challenge, or inspect a
recorded screencast. Those remain required pre-submit checks and are the only known
remaining blockers outside the codebase.

## Executive Summary

Easy Moderator has most of the right architecture for Meta review:

- OAuth is unified for Facebook Page + linked Instagram account.
- `business_management` is not requested by the current unified OAuth scope list.
- Webhook verification, HMAC validation, GDPR data deletion, and deauthorize callbacks
  are implemented under the canonical `/api/webhooks/meta` route.
- The product has reviewer-facing Privacy Policy, Terms, channel connection, webhook
  health, and shared inbox screens.
- Outbound sends pass through consent, opt-out, 24-hour-window, message-tag, and rate-limit
  policy gates.

The codebase has now been remediated for the review risks found in the audit:

1. Facebook comment replies now request `pages_manage_engagement`, matching
   `POST /{comment-id}/comments`.
2. Production webhook configuration now consistently uses `META_WEBHOOK_VERIFY_TOKEN`,
   and production/staging config requires it.
3. Webhook POST, data deletion, and deauthorize signatures now use `META_APP_SECRET`
   directly; there is no separate `META_WEBHOOK_APP_SECRET` deployment requirement.
4. Reviewer submission docs now match the implemented webhook-driven flows and Graph API
   endpoints.
5. Page webhook subscriptions are trimmed to the valid demonstrated fields
   `messages` and `feed`; the Instagram app-level webhook object remains responsible for
   IG `messages` and `comments`.
6. Comment-to-DM no longer treats an empty keyword list as "match every comment".
7. `HUMAN_AGENT` is no longer sent or offered as a message tag in the reviewed flow.

The app should still **not** be submitted until the live, non-code items are verified:
   Business Verification, test Page/IG assets, tester credentials, dashboard callback URLs,
   successful live callback tests, and the permission-by-permission screencast.

## Readiness Score

| Area | Status | Notes |
|---|---:|---|
| Permission minimization | **Pass** | `business_management` removed and Facebook comment replies now use `pages_manage_engagement`. |
| OAuth + asset picker | **Pass** | Unified scopes and `/me/accounts` picker exist. |
| Webhook callback implementation | **Pass** | Route, signature verification, and canonical verify token naming are implemented. |
| Data deletion / deauthorize | **Pass** | Signed callbacks exist and are mounted under `/api/webhooks/meta`. |
| Reviewer documentation | **Pass** | Review docs now describe the implemented webhook-driven flows and corrected permissions. |
| Policy safety | **Pass** | Empty keyword lists are blocked for comment-to-DM automation and `HUMAN_AGENT` is removed from the reviewed flow. |
| Live submission readiness | **Unknown / pending** | Requires dashboard, assets, credentials, live endpoint, and screencast verification. |

## Requested Permission Inventory

The generated implementation audit and source scan show the current OAuth scope union is:

| Permission | Code evidence | Review posture |
|---|---|---|
| `pages_show_list` | `DEFAULT_SCOPES` and `unifiedScopes`; `/me/accounts` asset picker | Ready, if screencast shows Page picker. |
| `pages_messaging` | Messenger webhooks, `POST /me/messages`, private replies | Ready, if reviewer sees inbound DM + reply. |
| `pages_read_engagement` | `feed` webhook comment events | Ready, but describe as webhook-driven, not comment polling. |
| `pages_manage_metadata` | `POST` / `GET` / `DELETE /{page-id}/subscribed_apps` | Ready, if webhook health is shown. |
| `pages_manage_engagement` | Facebook public comment reply via `POST /{comment-id}/comments` | Ready, if reviewer sees Page comment reply flow. |
| `instagram_basic` | Linked IG account fields nested in `/me/accounts` | Ready, if linked IG card is shown. |
| `instagram_manage_messages` | IG webhooks and `POST /me/messages` | Ready, if reviewer sees IG DM round-trip. |
| `instagram_manage_comments` | IG `comments` webhook, `/private_replies`, `/replies` | Ready, if reviewer sees IG comment flow. |

`business_management` is correctly absent from the extracted scope list. The only Business
Portfolio discovery code is behind an opt-in path and is not used by the unified OAuth flow.

## Resolved Code Findings

### B1. Facebook comment replies need `pages_manage_engagement`

**Severity:** Resolved code blocker
**Evidence:**
- The actual Facebook public comment reply call is
  `POST /{comment-id}/comments` in
  `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js:442`.
- Meta's current permissions reference search result states `pages_manage_engagement`
  allows apps to create/edit/delete comments on Page content, while `pages_manage_posts`
  is for creating/editing/deleting Page posts.
- Code now requests `pages_manage_engagement` in provider scopes and unified OAuth.

**Status:** Code and docs have been updated. Before final submission, make one successful
live Page comment reply call with a token containing the final reviewed scope list.

### B2. Production webhook verify token env var mismatch

**Severity:** Resolved code blocker
**Evidence:**
- Backend config reads `META_WEBHOOK_VERIFY_TOKEN` at
  `EasyMod-backend/src/config/config.js:100`.
- Webhook verification compares Meta's `hub.verify_token` against
  `config.metaWebhookVerifyToken` in
  `EasyMod-backend/src/modules/integration/meta-webhook.routes.js:106`.
- Backend `.env.example:82` uses the correct name, `META_WEBHOOK_VERIFY_TOKEN`.
- Root `.env.prod.example` now also uses `META_WEBHOOK_VERIFY_TOKEN`.
- Production/staging config now requires `META_WEBHOOK_VERIFY_TOKEN`.

**Status:** Code and env examples are aligned. Confirm the live dashboard challenge:

```text
GET https://easymod.tech/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=123
```

Expected response: status `200`, body `123`.

### B3. Submission sheet contradicted code

**Severity:** Resolved code/docs blocker
**Evidence:** `docs/meta-app-review-submission.md` has been updated so it no longer claims
the stale endpoint patterns that previously contradicted code:

- `POST /{page-id}/messages` and `GET /me/conversations` for `pages_messaging`;
  the code uses webhook inbound and `POST /me/messages`.
- `GET /{post-id}/comments` for `pages_read_engagement`;
  the code consumes comment content from `feed` webhooks.
- `POST /{comment-id}/replies` for Facebook public replies;
  the code uses `POST /{comment-id}/comments`.
- `GET /me?fields=instagram_business_account` / standalone IG user lookups;
  the code reads linked IG fields nested on `/me/accounts`.

**Status:** Reviewer-facing copy now matches the implemented endpoints and webhook fields.

### B4. Live review assets are not verified

**Severity:** Blocker
**Evidence:** The repository lists required founder tasks and assets in
`docs/meta-app-review-submission.md` and `EasyMod-backend/.easymod/meta-app-review/*`.
I did not find live evidence in the repo proving these are complete.

**Required action:** Confirm all of the following before submission:

- Business Verification complete for the owning business.
- App Domains, Privacy Policy URL, Terms URL, Webhook URL, Data Deletion Callback URL,
  Deauthorize Callback URL, and OAuth redirect URI set in Meta App Dashboard.
- Live `https://easymod.tech/privacy-policy` and `https://easymod.tech/terms-of-service`
  load without auth or redirect problems.
- Test merchant login works.
- Test Facebook Page is published and has at least one post with a configured trigger.
- Test Instagram Business account is linked to that Page.
- Test customer account is a separate account and is on App Roles while app is in Dev mode.
- The screencast clearly demonstrates each requested permission in use.

## Resolved High-Priority Risks

### R1. Extra webhook fields are subscribed without visible handlers

**Severity:** Resolved high risk
**Evidence:** Page subscriptions have been trimmed to valid review-demonstrated fields:

- Facebook: `messages`, `feed`.
- Linked IG parent Page: `messages`, `feed`.
- Meta App Dashboard Instagram object: `messages`, `comments`.

**Status:** The app no longer subscribes to fields it does not demonstrate in the review
story.

### R2. Comment-to-DM can match every comment when keywords are empty

**Severity:** Resolved high risk
**Evidence:** `comment-to-dm.service.js` now records `BLOCKED` when no keyword matches,
and `comment-to-dm.controller.js` rejects enabling comment-to-DM without at least one
trigger keyword.

**Status:** Empty keyword lists no longer become broad comment-to-DM automation.

### R3. `HUMAN_AGENT` use needs explicit review posture

**Severity:** Resolved high risk
**Evidence:** Manual inbox sends no longer attach `HUMAN_AGENT`, policy validation no
longer allows it, and the inbox composer no longer offers it.

Meta's Human Agent feature reference says the `human_agent` tag allows a human agent to
respond within seven days of the user's message. That is a feature/use case that needs to
be treated separately from bot/AI automation.

**Status:** The reviewed flow relies on the 24-hour window and approved transactional tags
only.

### R4. Webhook health verifies only `messages`

**Severity:** Resolved medium risk
**Evidence:** `verifyWebhookSubscription()` now verifies every provider-required Page
field: Facebook `messages` + `feed`, linked IG parent Page `messages` + `feed`. IG
`comments` are verified in the Meta Dashboard Instagram object setup, not via Page
`subscribed_apps`.

**Status:** Webhook health can no longer pass when a required review-critical field is
missing.

### R5. Root docs still contain obsolete callback paths

**Severity:** Resolved medium risk
**Evidence:** Internal runbooks and standards now use the canonical
`/api/webhooks/meta/data-deletion` path.

## Passing Evidence

### OAuth and permission minimization

- `business_management` is intentionally removed from unified OAuth.
- `pages_show_list` is justified by `/me/accounts` asset discovery.
- Linked IG account discovery is nested on `/me/accounts`, which keeps the review story
  simple.

### Webhook implementation

- `app.js` mounts the canonical route at `/api/webhooks/meta`.
- Webhook routes are mounted before JSON parsing.
- POST webhooks use `express.raw({ type: '*/*' })`.
- Signature verification uses `x-hub-signature-256` and HMAC-SHA256.
- Invalid or missing app secret fails closed.
- GDPR data deletion and deauthorize callbacks verify `signed_request`.

### Policy safety

- Outbound sends run through the policy engine.
- Consent and opt-out checks use per-platform `customers.messaging_consent`.
- The 24-hour window rule feeds a template-required rule.
- Allowed transactional tags are explicitly enumerated.
- Rate limiting is set at 170 sends/hour/page.
- Redis idempotency protects both regular AI sends and comment-to-DM flows.

### User-facing review screens

- Privacy policy route exists at `/privacy-policy`.
- Terms route exists at `/terms-of-service`.
- Chat Settings has the unified Facebook + Instagram connect UI.
- Chat Settings has webhook health/status UI.
- Privacy Policy documents Meta data categories and the data deletion endpoint.

## Pre-Submit Checklist

Do not submit until every live/non-code item below is complete:

- [x] Resolve Facebook comment replies with `pages_manage_engagement`.
- [x] Fix `META_WEBHOOK_VERIFY_TOKEN` env naming in root production env docs and production config.
- [x] Use `META_APP_SECRET` for webhook POST, data deletion, and deauthorize signatures.
- [x] Update `docs/meta-app-review-submission.md` so every endpoint claim matches code.
- [x] Trim subscribed webhook fields to review-demonstrated fields.
- [x] Remove `HUMAN_AGENT` from the reviewed flow.
- [x] Remove "empty keywords means all comments" from the reviewed comment-to-DM flow.
- [ ] Verify live Privacy Policy and Terms URLs.
- [ ] Verify live webhook challenge response.
- [ ] Verify live data deletion GET and POST callback behavior.
- [ ] Verify deauthorize callback behavior.
- [ ] Provision test merchant, test customer, Page, IG Business account, and configured trigger post.
- [ ] Add the customer tester account to App Roles if the app remains in Development mode.
- [ ] Record a 1080p+ screencast showing every requested permission in use.
- [ ] Make at least one successful live API call for every requested permission shortly before submission.

## Current Best Submission Shape

If the blockers are fixed, the strongest review story is:

1. Merchant logs in to Easy Moderator.
2. Merchant opens Settings -> Chat Settings.
3. Merchant clicks the unified Facebook + Instagram connect button.
4. Facebook Login for Business consent shows the final reviewed scope list.
5. Asset picker lists the Page (`pages_show_list`) and linked IG account (`instagram_basic`).
6. Channel card shows Webhook Active (`pages_manage_metadata`).
7. Tester sends a Page DM; it appears in the inbox; AI/manual reply is delivered
   (`pages_messaging`).
8. Tester sends an IG DM; it appears in the same inbox; reply is delivered
   (`instagram_manage_messages`).
9. Tester comments a trigger keyword on a Page post; app receives `feed` webhook and posts
   the supported public/private reply flow (`pages_read_engagement` plus the corrected
   Facebook comment permission).
10. Tester comments on IG media; app receives `comments` webhook and replies
    (`instagram_manage_comments`).

## Sources Checked

Repository evidence:

- `EasyMod-backend/scripts/meta-implementation-audit.js`
- `docs/meta-implementation-audit.generated.md`
- `docs/meta-app-review.md`
- `docs/meta-app-review-submission.md`
- `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js`
- `EasyMod-backend/src/modules/channel-providers/providers/MetaInstagramProvider.js`
- `EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js`
- `EasyMod-backend/src/modules/integration/meta-webhook.routes.js`
- `EasyMod-backend/src/modules/integration/meta-webhook-gdpr.handler.js`
- `EasyMod-backend/src/modules/commentToDm/comment-to-dm.service.js`
- `EasyMod-backend/src/modules/policy/*`
- `EasyMod-frontend/src/app/components/PrivacyPolicy.tsx`
- `EasyMod-frontend/src/app/components/TermsOfService.tsx`
- `EasyMod-frontend/src/app/components/ChatSettings.tsx`

Official/current Meta references consulted:

- Meta Permissions Reference: https://developers.facebook.com/docs/permissions/
- Facebook Pages API comments and mentions: https://developers.facebook.com/docs/pages-api/comments-mentions/
- Page `subscribed_apps` reference: https://developers.facebook.com/docs/graph-api/reference/page/subscribed_apps/
- Page webhooks reference: https://developers.facebook.com/docs/graph-api/webhooks/reference/page/
- Instagram App Review: https://developers.facebook.com/docs/instagram-platform/app-review/
- Human Agent feature reference: https://developers.facebook.com/docs/features-reference/human-agent/
- Data deletion callback reference: https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
