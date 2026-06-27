# Meta App Review - Submission Sheet

**App:** Easy Moderator
**Graph API:** v22.0
**Login product:** Facebook Login for Business
**Last updated:** 2026-06-27 (Messenger-only launch; Comment-to-DM removed)

Use this sheet for the Meta App Dashboard submission.

## Dashboard Values

| Dashboard field | Value |
|---|---|
| App Domains | `easymod.tech` |
| Privacy Policy URL | `https://easymod.tech/privacy-policy` |
| Terms of Service URL | `https://easymod.tech/terms` |
| Category | Business / Messaging |
| Webhook Callback URL | `https://easymod.tech/api/webhooks/meta` |
| Webhook Verify Token | Value of production `META_WEBHOOK_VERIFY_TOKEN` |
| Data Deletion Request Callback URL | `https://easymod.tech/api/webhooks/meta/data-deletion` |
| Deauthorize Callback URL | `https://easymod.tech/api/webhooks/meta/deauthorize` |
| Valid OAuth Redirect URI | Production Meta OAuth callback from `META_OAUTH_REDIRECT_URI` |

Webhook subscription field: `messages` on the `page` object only.

## Permission Use Text

**1. `pages_show_list`**

> Easy Moderator uses this permission after Facebook Login to call `GET /me/accounts` and show the merchant the Facebook Pages they administer. The merchant selects the Page(s) they want to connect. Pages shown but not selected are not stored.

**2. `pages_messaging`**

> Easy Moderator uses this permission to operate a shared Facebook Messenger inbox for the connected Page. We receive direct customer DMs through the `messages` webhook and send AI-assisted or human replies through `POST /me/messages` with the Page token. We do not use this permission for comments or public-comment automation.

**3. `pages_manage_metadata`**

> Easy Moderator uses this permission to subscribe, verify, and unsubscribe the connected Page's webhook subscription through `/{page-id}/subscribed_apps`. The app subscribes only to the `messages` field so direct Messenger DMs can arrive in real time.

## Notes To Reviewer

> Easy Moderator is a Facebook Page Messenger inbox with AI-assisted customer replies and order support. Sign in to the test instance, go to **Settings -> Chat Settings**, connect the provided Facebook Page, then send a direct Messenger DM to the Page from the supplied tester customer account. The message appears in the Shared Inbox and receives an AI reply through Messenger. Comment-to-DM, Page post keyword automation, public comment replies, and comment-triggered DMs are not part of this launch and are not requested in App Review.
>
> While the app is in Development mode, Meta only delivers webhook events from users with an app role. Please use the provided customer tester account.

## Pre-Submit Checklist

1. App Dashboard contains only these permissions: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`.
2. Webhook subscription uses only the `messages` field on the `page` object.
3. `pages_read_engagement`, `pages_manage_engagement`, `business_management`, and all `instagram_*` scopes are absent.
4. Screencast demonstrates direct Messenger DM only.
5. Test Page and tester customer account are added to App Roles as needed for Development mode.
6. Privacy policy and Terms URLs resolve without authentication.
7. Data deletion and deauthorize callback URLs are configured.
