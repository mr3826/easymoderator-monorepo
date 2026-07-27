# Permissions Justification

**App:** Easy Moderator
**Last updated:** 2026-07-28 (Messenger-only launch; Comment-to-DM removed)

Easy Moderator requests three Facebook Page permissions for the initial launch:

- `pages_show_list`
- `pages_messaging`
- `pages_manage_metadata`

The app does not request `pages_read_engagement`, `pages_manage_engagement`, `business_management`, or any `instagram_*` permission.

## 1. `pages_show_list`

**Use case:** List the Facebook Pages the merchant administers so they can select which Page(s) to connect.

**User-facing screen:** Settings → Chat (`/app/manage-shop/chat-settings`), after OAuth consent.

**Graph API call:** `GET /me/accounts`.

**Data retention:** Only selected connected Pages are stored in `meta_channels`. Pages displayed but not selected are not persisted.

## 2. `pages_messaging`

**Use case:** Receive direct Messenger DMs and send AI/manual replies on behalf of the connected Facebook Page.

**User-facing screen:** Shared Inbox and Settings → Chat (`/app/manage-shop/chat-settings`).

**Graph API calls and webhook fields:**

- Webhook field `messages` for direct customer DMs.
- `POST /me/messages` for AI-assisted and human replies.

**Data retention:** Message content is stored in shop-scoped `conversations` and `messages` tables until the merchant deletes it or closes the account. Meta data deletion callbacks hard-delete affected customer records within 30 days.

## 3. `pages_manage_metadata`

**Use case:** Subscribe, verify, and unsubscribe the connected Page's Messenger webhook.

**User-facing screen:** Settings → Chat (`/app/manage-shop/chat-settings`) channel health card.

**Graph API calls:**

- `POST /{page-id}/subscribed_apps` with `subscribed_fields=messages`.
- `GET /{page-id}/subscribed_apps` to verify subscription.
- `DELETE /{page-id}/subscribed_apps` on disconnect.

**Data retention:** Only webhook status metadata is stored: subscribed fields and last verified timestamp in `meta_channels`.

## Data Minimization Statement

Easy Moderator stores only the data necessary to operate Facebook Messenger DM conversations, AI replies, order creation, customer records, and billing usage metering.

The app does not:

- Read Page post comments.
- Subscribe to the `feed` webhook field.
- Send public comment replies.
- Trigger workflows from comments.
- Request ads, catalog, commerce, Instagram, Page engagement, or Business Management permissions.
