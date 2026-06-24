# Permissions Justification

**App:** Easy Moderator
**Last updated:** 2026-06-24 (Instagram removed — Facebook-only launch)

Each permission below is justified with: use case, user-facing screen, specific Graph API call, and data retention policy.

The app requests **5 permissions** in total — all Facebook Pages permissions. `business_management` and all Instagram permissions (`instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`) are intentionally **not** requested (see the minimization decision in [`docs/meta-app-review.md`](../../../docs/meta-app-review.md) §5); the permission→feature→reviewer matrix lives in that same file.

---

## 1. `pages_show_list`

**Use case:** Enumerate the Facebook Pages the merchant administers so they can choose which Page(s) to connect during onboarding. The picker is multi-select — a merchant can connect one or several Pages at once. Without it the OAuth flow cannot present a page picker.

**User-facing screen:** Channels page (Settings → Chat Settings) — after granting consent, the asset picker lists every Page the merchant manages so they can select one or more.

**Graph API calls that require it:**

- `GET /me/accounts` — lists the Pages the authenticated user administers (id, name, category, Page access token)

**Data retention:** Only the Page(s) the merchant explicitly selects and connects are persisted (to the `meta_channels` table). Pages shown in the picker but not chosen are never stored. Retained until the channel is disconnected.

---

## 2. `pages_messaging`

**Use case:** Send and receive Facebook Messenger messages on behalf of the business's connected Facebook Page — the core comment-to-DM and inbox reply flows.

**User-facing screen:** Channels page (connect FB Page via OAuth) and Shared Inbox (compose + send replies).

**Graph API calls that require it:**

- `POST /me/messages` with the connected Page token — sends a DM reply to a customer
- Webhook subscription field: `messages` — receives inbound Messenger messages

**Data retention:** Message content is stored in the `conversations` and `messages` tables, scoped to the shop tenant. Retained until the shop owner deletes the conversation or closes their account. On Meta Data Deletion Callback, all records for the affected `channel_user_id` are hard-deleted within 30 days.

---

## 3. `pages_read_engagement`

**Use case:** Receive comment events on Page posts so the keyword-trigger detection can fire a private reply / DM handoff when a customer comments with the configured word.

**User-facing screen:** Comment Automation settings (Channels page, "Auto-reply" tab) where merchants configure trigger keywords per post.

**Graph API calls that require it:**

- Webhook subscription field: `feed` — receives `comment` events on the Page's posts

**Data retention:** Comment content is not stored. Only the fact that a comment triggered a DM (stored as a `comment_to_dm_events` row with the commenter's PSID and timestamp) is retained for deduplication. Retained for 90 days, then purged automatically.

---

## 4. `pages_manage_metadata`

**Use case:** Subscribe the connected Page to the app's webhooks on connect (and unsubscribe on disconnect) so inbound messages and comment events are delivered in real time. This is the permission that authorizes managing the Page's `subscribed_apps` edge.

**User-facing screen:** Channels page (Settings → Chat Settings) — webhook subscription happens automatically on connect; the per-channel health grid then shows **Webhook: Active** once the subscription is hard-verified.

**Graph API calls that require it:**

- `POST /{page-id}/subscribed_apps` — subscribes the app to the Page's webhook fields (`messages`, `feed`)
- `GET /{page-id}/subscribed_apps` — verifies the subscription succeeded (hard-verification on connect; a missing required field marks the channel **Action Required** instead of a false "Connected")
- `DELETE /{page-id}/subscribed_apps` — removes the subscription when the merchant disconnects the channel

**Data retention:** No customer data is accessed through this permission. Only the list of subscribed webhook fields and the last-verified timestamp are stored in `meta_channels` (`webhook_subscribed_fields`, `webhook_last_verified_at`). Retained until the channel is disconnected.

---

## 5. `pages_manage_engagement`

**Use case:** Reply to comments on Page posts (not just DMs). When a merchant configures a public comment reply alongside the DM trigger, Easy Moderator posts a reply comment such as "Hi! We've sent you a message."

**User-facing screen:** Comment Automation settings — "Also reply publicly to comment" toggle.

**Graph API calls that require it:**

- `POST /{comment-id}/comments` — posts a reply to a customer comment

**Data retention:** The content of the reply comment is the merchant-configured template. No customer data is stored beyond the comment ID (used for deduplication). Retained for 90 days.

---

## Data Minimisation Statement

Easy Moderator stores only the data necessary to operate the inbox, process orders, and enforce policy safety. We do not:

- Store raw comment content beyond the deduplication window
- Use Meta platform data for advertising targeting
- Share Meta data with any party not listed in the Privacy Policy
- Use message content to train AI models (confirmed with OpenAI and Google under our API agreements)
- Request any Instagram, ads, catalog, or commerce permissions
