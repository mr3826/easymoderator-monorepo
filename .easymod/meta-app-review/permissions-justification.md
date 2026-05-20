# Permissions Justification

**App:** Easy Moderator
**Last updated:** 2026-05-20

Each permission below is justified with: use case, user-facing screen, specific Graph API call, and data retention policy.

---

## 1. `pages_messaging`

**Use case:** Send and receive Facebook Messenger messages on behalf of the business's connected Facebook Page — the core comment-to-DM and inbox reply flows.

**User-facing screen:** Channels page (connect FB Page via OAuth) and Unified Inbox (compose + send replies).

**Graph API calls that require it:**

- `POST /{page-id}/messages` — sends a DM reply to a customer
- `GET /me/conversations` — lists active Messenger conversations for the inbox
- Webhook subscription field: `messages`, `messaging_postbacks`, `message_deliveries`, `message_reads`

**Data retention:** Message content is stored in the `conversations` and `messages` tables, scoped to the shop tenant. Retained until the shop owner deletes the conversation or closes their account. On Meta Data Deletion Callback, all records for the affected `channel_user_id` are hard-deleted within 30 days.

---

## 2. `pages_read_engagement`

**Use case:** Receive delivery and read receipts for Messenger messages, and read comment events on Page posts so the keyword-trigger detection can fire a DM when a customer comments with the configured word.

**User-facing screen:** Comment Automation settings (Channels page, "Auto-reply" tab) where merchants configure trigger keywords per post.

**Graph API calls that require it:**

- Webhook subscription field: `feed` — receives `comment` events on the Page's posts
- `GET /{post-id}/comments` — used during initial setup to verify keyword matching against historical comments
- Delivery/read receipt webhooks: `message_deliveries`, `message_reads`

**Data retention:** Comment content is not stored. Only the fact that a comment triggered a DM (stored as a `comment_to_dm_events` row with the commenter's PSID and timestamp) is retained for deduplication. Retained for 90 days, then purged automatically.

---

## 3. `pages_manage_posts`

**Use case:** Reply to comments on Page posts (not just DMs). When a merchant configures a public comment reply alongside the DM trigger, Easy Moderator posts a reply comment such as "Hi! We've sent you a message."

**User-facing screen:** Comment Automation settings — "Also reply publicly to comment" toggle.

**Graph API calls that require it:**

- `POST /{comment-id}/replies` — posts a reply to a customer comment

**Data retention:** The content of the reply comment is the merchant-configured template. No customer data is stored beyond the comment ID (used for deduplication). Retained for 90 days.

---

## 4. `instagram_basic`

**Use case:** Access the Instagram Business account linked to the merchant's Facebook Page. Required to verify the IG account is connected, read the IG user's profile for display in the dashboard, and subscribe to IG comment webhooks.

**User-facing screen:** Channels page — "Connect Instagram" step displays the linked IG account name and profile picture after OAuth.

**Graph API calls that require it:**

- `GET /me?fields=instagram_business_account` — retrieves the IG Business Account ID linked to the Page
- `GET /{ig-user-id}?fields=name,profile_picture_url` — displays account info in the dashboard

**Data retention:** IG account name and profile picture URL are stored in the `meta_channels` table for display purposes only. Access token stored encrypted (AES-256-GCM). Retained until the channel is disconnected.

---

## 5. `instagram_manage_messages`

**Use case:** Read inbound Instagram Direct Messages and send replies on behalf of the business's Instagram account — same inbox and AI-reply flow as Messenger.

**User-facing screen:** Unified Inbox — IG DMs appear alongside Messenger threads. Compose panel sends IG replies.

**Graph API calls that require it:**

- Webhook subscription field: `messages` (IG) — receives inbound DMs and story mentions
- `POST /{ig-user-id}/messages` — sends a reply DM to an Instagram user

**Data retention:** Same as `pages_messaging` — message content stored per-tenant, hard-deleted on Meta Data Deletion Callback within 30 days.

---

## Data Minimisation Statement

Easy Moderator stores only the data necessary to operate the inbox, process orders, and enforce policy safety. We do not:

- Store raw comment content beyond the deduplication window
- Use Meta platform data for advertising targeting
- Share Meta data with any party not listed in the Privacy Policy
- Use message content to train AI models (confirmed with OpenAI and Google under our API agreements)
