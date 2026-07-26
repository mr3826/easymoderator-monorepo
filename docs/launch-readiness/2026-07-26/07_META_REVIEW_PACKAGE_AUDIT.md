# 07 — Meta App Review Package Audit (Workstream F)

**Verdict for this workstream: READY AFTER FOUNDER ACTION.**

The written package is accurate, narrowly scoped, and consistent with the code. What is
missing is entirely founder-owned: reviewer credentials, test assets, and the screencast.

## Location correction

The brief referenced `.easymod/meta-app-review/`. **That directory does not exist.** The
current materials are:

- `docs/meta-app-review-submission.md` (dashboard values + permission text)
- `docs/meta-app-review.md` (justifications)
- `docs/META_APP_REVIEW_MASTER_GUIDE.md` (checklist)

All three carry `Last updated: 2026-06-27 (Messenger-only launch; Comment-to-DM removed)`.

## Package completeness

| Required item | Present? | Note |
|---|---|---|
| Product name | ✅ | "Easy Moderator" |
| App domain | ✅ | `easymod.tech` |
| Privacy Policy URL | ✅ | `https://easymod.tech/privacy-policy` — **verified 200, renders without auth** |
| Terms URL | ✅ | `https://easymod.tech/terms` — **verified 200** |
| Data deletion URL | ✅ | `https://easymod.tech/api/webhooks/meta/data-deletion` — **verified live, fails closed** |
| Deauthorize callback | ✅ | `https://easymod.tech/api/webhooks/meta/deauthorize` — **verified live, fails closed** |
| OAuth redirect URL | ✅ | `https://easymod.tech/app/channels/oauth-callback` — verified 200 |
| Webhook callback URL | ✅ | `https://easymod.tech/api/webhooks/meta` — **verified live, 403 on bad signature** |
| Webhook verify setup | ✅ | documented as the value of `META_WEBHOOK_VERIFY_TOKEN` |
| Graph API version | ✅ | v22.0, matches `GRAPH_VERSION` in code |
| App icon | ❌ | **not covered** in any document |
| Business verification state | ❌ | **not covered** |
| App-mode requirement | ⚠️ | Development-mode caveat is noted in "Notes To Reviewer"; no explicit switch-to-Live instruction |
| Reviewer/test-user setup | ⚠️ | referenced ("the supplied tester customer account") but **no credentials block exists** |
| Test Facebook Page | ❌ | **no named test Page** |
| Test merchant credentials | ❌ | **absent** |
| Exact navigation steps | ✅ | Settings → Chat Settings → connect Page → send DM |
| Expected results | ✅ | message appears in Shared Inbox, AI reply returns |
| Troubleshooting notes | ❌ | absent |

## Permission → feature → API mapping

Reconstructed from the submission sheet and **verified against the code**:

| Permission | User-visible feature | Graph API usage | Code receipt | Reviewer step | Video evidence |
|---|---|---|---|---|---|
| `pages_show_list` | Page picker in Settings → Chat Settings | `GET /me/accounts`, intersected with `debug_token` granular target IDs | `MetaMessengerProvider.js:156-192` | Connect flow, step 4 | **not yet recorded** |
| `pages_messaging` | Shared Inbox: receive DMs, send AI/human replies | `messages` webhook; `POST /me/messages` | `MetaMessengerProvider.js:434-492` | Steps 6-9 | **not yet recorded** |
| `pages_manage_metadata` | Webhook subscribe / verify / unsubscribe | `POST` + `GET /{page-id}/subscribed_apps` | `MetaMessengerProvider.js:330-372` | Step 5 (implicit on connect) | **not yet recorded** |

Every permission description in the submission sheet is **narrow, truthful, and matches
the implementation.** No permission is justified by a feature the reviewer cannot see.

## Prohibited mentions — clean

Checked all three documents for Instagram, WhatsApp, omnichannel, Facebook comments,
comment-to-DM, unsupported marketing messages, and unsupported payment/courier claims.

**Every hit is an explicit negative statement**, e.g.:

- `meta-app-review.md:31` — "Does not request `pages_read_engagement`, `pages_manage_engagement`, `business_management`, or any `instagram_*` scope."
- `META_APP_REVIEW_MASTER_GUIDE.md:6` — "The app does not read Page post comments, subscribe to `feed`, send public comment replies, or trigger workflows from comments."

This is correct usage: stating what is out of scope, not claiming it.

## Screencast plan — NOT READY

The brief's 12-point recording requirement is **not** documented anywhere. There is no
storyboard, no shot list, no timestamp mapping. `META_APP_REVIEW_MASTER_GUIDE.md:56` has a
single checkbox ("No UI or docs promise Comment-to-DM") but no recording plan.

Required and currently unaddressed:

1. Merchant signs in
2. Opens the Facebook Page connection flow
3. **Meta authorization screen is shown**
4. Merchant selects the intended Page
5. Connected Page appears in EasyModerator
6. **A tester sends a real Messenger text message**
7. Message appears in the Shared Inbox
8. Merchant sends a text reply
9. **The tester receives the exact reply**
10. AI/draft behaviour, only if stable
11. Disconnect/reconnect if needed for justification
12. No unsupported channel or permission on screen

Items 6 and 9 are the mandatory text-message proof and **cannot be substituted with
attachment demos**.

## Assessment against the brief's four options

- Ready to record? — **Yes, once the test Page and tester account exist.** The product
  supports every required step and the scope is clean.
- Ready to submit? — **No.** No video, no reviewer credentials, no app icon/business
  verification confirmation.
- Missing test assets? — **Yes**: test Page, customer tester account, reviewer merchant login.
- Inconsistent with implementation? — **No.** This is the package's strongest attribute.
- Likely to cause reviewer confusion? — **One risk**: if the reviewer's Page lands in a
  non-`CONNECTED` state, their DM is dropped silently with no diagnostic (finding F-02).
  Fix F-02 before submission, or the reviewer may experience an unexplained "nothing
  happened".

## Findings

| ID | Sev | Finding |
|---|---|---|
| F-08 | P1 | No screencast storyboard; the mandatory text-message round-trip proof is unrecorded |
| F-09 | P1 | No reviewer credentials, test Page, or tester account documented |
| F-10 | P2 | App icon and business-verification state absent from the package |
| F-34 | P3 | No troubleshooting section for the reviewer |
