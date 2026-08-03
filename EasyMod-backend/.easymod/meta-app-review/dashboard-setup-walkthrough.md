# Meta Dashboard Setup Walkthrough

**App:** Easy Moderator
**Last updated:** 2026-07-28 (Messenger-only launch; Comment-to-DM removed)

This walkthrough configures the Meta app for the initial launch. Easy Moderator supports Facebook Page Messenger DMs only. Do not configure comment/feed automation or Instagram products for this version.

## Permissions

Request only:

- `pages_show_list`
- `pages_messaging`
- `pages_manage_metadata`

Do not request:

- `pages_read_engagement`
- `pages_manage_engagement`
- `business_management`
- Any `instagram_*` permission

## Webhook Product

Configure the `page` object callback:

- Callback URL: `https://easymod.tech/api/webhooks/meta`
- Verify token: production `META_WEBHOOK_VERIFY_TOKEN`
- Subscribed field: `messages`

Do not subscribe to `feed`.

## Facebook Login For Business

Set the valid OAuth redirect URI to the production `META_OAUTH_REDIRECT_URI`.

The reviewer flow is:

1. Merchant logs in to Easy Moderator.
2. Merchant opens **Settings → Chat** (`/app/manage-shop/chat-settings`).
3. Merchant clicks **Connect Facebook Page**.
4. Facebook Login requests the three permissions above.
5. Easy Moderator lists Pages via `GET /me/accounts`.
6. Merchant selects a Page.
7. Easy Moderator subscribes the Page to `messages`.
8. Channel health shows webhook active after `GET /{page-id}/subscribed_apps` verification.

## App Review Demo

Demonstrate only direct Messenger DMs:

1. Send a DM from the tester customer account to the connected Page.
2. Show the message in Shared Inbox.
3. Show AI auto-reply delivered through Messenger.
4. Show manual reply from the inbox.

Do not demonstrate Page post comments, keyword comments, public comment replies, or private replies to comments.

## Graph API Explorer Checks

With the Page token:

```bash
curl -X GET "https://graph.facebook.com/v22.0/me/subscribed_apps?access_token=$PAGE_TOKEN"
```

Expected: the app is subscribed and `subscribed_fields` contains `messages`.

Manual subscription command, if needed:

```bash
curl -X POST "https://graph.facebook.com/v22.0/$PAGE_ID/subscribed_apps" \
  -d "access_token=$PAGE_TOKEN" \
  -d "subscribed_fields=messages"
```

Expected: `{"success":true}`.

## Development Mode Caveat

In Development mode, Meta delivers webhook events only for accounts with an app role. Add the customer tester account under App Roles -> Testers before recording the demo.
