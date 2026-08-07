# Meta App Review - Submission Sheet

**App:** Easy Moderator
**Graph API:** v22.0
**Login product:** Facebook Login for Business
**Last updated:** 2026-07-28 (Messenger-only launch; Comment-to-DM removed)

Use this sheet for the Meta App Dashboard submission.

## Dashboard Values

| Dashboard field | Value |
|---|---|
| App Domains | `easymod.tech` |
| App Icon | upload `EasyMod-frontend/public/icon-1024.png` (1024×1024) |
| Privacy Policy URL | `https://easymod.tech/privacy-policy` |
| Terms of Service URL | `https://easymod.tech/terms` — **not** `/terms-of-service`, which 404s |
| Support / contact email | `support@easymod.tech` (privacy enquiries: `privacy@easymod.tech`) |
| Category | Business / Messaging |
| Webhook Callback URL | `https://api.easymod.tech/webhooks/meta` |
| Webhook Verify Token | Value of production `META_WEBHOOK_VERIFY_TOKEN` |
| Data Deletion Request Callback URL | `https://api.easymod.tech/webhooks/meta/data-deletion` |
| Deauthorize Callback URL | `https://api.easymod.tech/webhooks/meta/deauthorize` |
| Valid OAuth Redirect URI | `https://app.easymod.tech/channels/oauth-callback` — must match production `META_OAUTH_REDIRECT_URI` exactly |

Use the **apex domain** everywhere. `www.easymod.tech` 301-redirects to the apex,
and a 301 in an OAuth redirect URI is a mismatch as far as Meta is concerned.

Webhook subscription field: `messages` on the `page` object only.

After saving the webhook config, confirm the verify-token handshake with the
self-check in
`EasyMod-backend/.easymod/meta-app-review/compliance-checklist.md` (item 5) — a
mismatch between the pasted token and `META_WEBHOOK_VERIFY_TOKEN` makes "Verify
and Save" fail with no useful error.

## Permission Use Text

**1. `pages_show_list`**

> Easy Moderator uses this permission after Facebook Login to call `GET /me/accounts`, then intersects the returned Pages with Meta `debug_token` granular permission target IDs. The merchant sees and can connect only the Facebook Page(s) they selected/authorized in Facebook. Pages not selected in Facebook are not shown and are rejected by the connect endpoint.

**2. `pages_messaging`**

> Easy Moderator uses this permission to operate a shared Facebook Messenger inbox for the connected Page. We receive direct customer DMs through the `messages` webhook and send AI-assisted or human replies through `POST /me/messages` with the Page token. We do not use this permission for comments or public-comment automation.

**3. `pages_manage_metadata`**

> Easy Moderator uses this permission to subscribe, verify, and unsubscribe the connected Page's webhook subscription through `/{page-id}/subscribed_apps`. The app subscribes only to the `messages` field so direct Messenger DMs can arrive in real time.

## Notes To Reviewer

> Easy Moderator is a Facebook Page Messenger inbox with AI-assisted customer replies and order support, built for small retailers in Bangladesh. Sign in to the test instance at `https://app.easymod.tech/signin` with the supplied credentials, then in the left sidebar under **SETTINGS** click **Chat** (direct URL: `https://app.easymod.tech/manage-shop/chat-settings`). Connect the provided Facebook Page, then send a direct Messenger DM to that Page from the supplied tester customer account. The message appears in the Shared Inbox and receives an AI reply through Messenger; you can also type a manual reply and see it delivered to the customer. Comment-to-DM, Page post keyword automation, public comment replies, and comment-triggered DMs are not part of this launch and are not requested in App Review.
>
> While the app is in Development mode, Meta only delivers webhook events from users with an app role. Please use the provided customer tester account to send the inbound message.
>
> Two behaviours are intentional and are not defects: Messenger postbacks (for example a "Get Started" button) are not subscribed, because this release subscribes only to the `messages` field; and messages sent more than 24 hours after the customer's last message are not delivered, because the app sends no message tags and stays inside the standard messaging window.

## Pre-Submit Checklist

1. App Dashboard contains only these permissions: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`.
2. Webhook subscription uses only the `messages` field on the `page` object.
3. `pages_read_engagement`, `pages_manage_engagement`, `business_management`, and all `instagram_*` scopes are absent.
4. Screencast demonstrates direct Messenger DM only.
5. Test Page and tester customer account are added to App Roles as needed for Development mode, **and the invites are accepted from those accounts** — a pending invite does not enable webhook delivery.
6. Privacy policy and Terms URLs resolve without authentication.
7. Data deletion and deauthorize callback URLs are configured.
8. App icon uploaded.
9. Reviewer credentials entered in the Dashboard's test-credentials fields, not just in the notes box.
10. Business Verification submitted — see `EasyMod-backend/.easymod/meta-app-review/business-verification.md`. Advanced Access to `pages_messaging` does not go live for non-testers until it clears.
