# Meta App Review - Reviewer Guide

**App:** EasyModerator
**Last updated:** 2026-07-28 (Messenger-only launch; Comment-to-DM removed)
**Graph API version:** v22.0
**Login product:** Facebook Login for Business

EasyModerator launches as a Facebook Page Messenger inbox with AI-assisted replies and order support. Customers must message the Page directly. The app does not read, process, reply to, or trigger workflows from Facebook post comments.

## Requested Permissions

Final requested set: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`.

`business_management`, all `instagram_*` permissions, `pages_read_engagement`, and `pages_manage_engagement` are not requested for the initial launch.

| # | Permission | Feature it powers | Key Graph API call(s) | Webhook field | Reviewer proof |
|---|------------|-------------------|------------------------|---------------|----------------|
| 1 | `pages_show_list` | Shows the merchant the Facebook Pages they selected/authorized for EasyModerator | `GET /me/accounts` intersected with `debug_token` granular target IDs | - | After OAuth, the Page picker lists only the tester-selected Page(s) |
| 2 | `pages_messaging` | Receives direct Messenger DMs and sends AI/manual replies | `POST /me/messages` | `messages` | Tester DMs the Page; message appears in Shared Inbox; AI/manual reply is delivered |
| 3 | `pages_manage_metadata` | Subscribes/verifies/unsubscribes the Page Messenger webhook | `POST` / `GET` / `DELETE /{page-id}/subscribed_apps` | - | Connected channel card shows webhook active after server-side verification |

## Code Cross-Check

The requested scope list lives in `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js` as `DEFAULT_SCOPES`.

The webhook subscription list in the same provider is `WEBHOOK_FIELDS = ['messages']`.

Regression tests enforce that the provider:

- Requests exactly the three permissions above.
- Does not request `pages_read_engagement`, `pages_manage_engagement`, `business_management`, or any `instagram_*` scope.
- Subscribes only to `messages`.
- Ignores `feed` / comment changes.

## Reviewer Flow

1. Log in to the live test instance at `https://app.easymod.tech/signin` with the
   supplied tester credentials.
2. In the left sidebar, under the **SETTINGS** heading, click **Chat**. (Direct
   URL: `https://app.easymod.tech/manage-shop/chat-settings`.)
3. Click **Connect Facebook Page**.
4. Grant the three requested permissions.
5. Select the test Page in the Page picker and connect it.
6. Confirm the channel card shows connected status and webhook active status.
7. From a separate tester account, send a direct Messenger DM to the Page.
8. Confirm the DM appears in the Shared Inbox.
9. Confirm the AI auto-reply is sent through Messenger and includes the automated-assistant disclosure.
10. Send a manual reply from the inbox to confirm the human reply path.

Development-mode caveat: while the Meta app is in Development mode, webhook events only arrive for users who have an app role. Use the supplied App Roles tester account for the inbound DM.

## Screencast Script

Target length: 2-3 minutes.

1. Show the logged-in EasyModerator dashboard.
2. Open **Settings → Chat** and start the Facebook Page connection.
3. Show the OAuth dialog with the three permissions.
4. Show the Page picker after consent.
5. Connect the test Page and show webhook active state.
6. Send a direct DM from the tester account.
7. Show the message in Shared Inbox.
8. Show AI auto-reply and the required automated-assistant disclosure.
9. Send one manual reply.

Do not demonstrate comments, Page post keywords, public comment replies, or private replies to comments. Those features are out of scope for the initial launch.

## Troubleshooting For The Reviewer

If a step does not behave as described, this table explains the likely cause
before you record it as a defect. Contact: `support@easymod.tech`.

| What you see | Why | What to do |
|---|---|---|
| The OAuth popup is blocked by the browser | The app deliberately falls back to a same-tab redirect | Continue in the same tab — the flow is unchanged |
| The popup does not close itself, but EasyModerator advances anyway | Cross-Origin-Opener-Policy blocks `window.close()` from the opener; the result is delivered over `BroadcastChannel` instead | Close the popup manually and continue |
| The Page picker is empty, or your Page is missing | Facebook's granular Page selection was not granted for that Page. EasyModerator intersects `/me/accounts` with the `debug_token` granular target IDs and refuses to show a Page you did not select | Re-run the connect flow and tick the Page on the Facebook consent screen |
| You cancel at Facebook and see "Connection failed" | The denial branch. No channel is created | Expected — re-run and approve |
| The Page connects, but a Messenger DM never reaches the Shared Inbox | While the app is in Development mode Meta only delivers webhook events for accounts holding an app role | Send the DM from the supplied tester **customer** account, which is on App Roles → Testers |
| A previously connected Page still appears in the database after disconnect | Channels are retained with `status: DISCONNECTED` for the audit trail rather than hard-deleted; the UI filters them out | Expected behaviour, not a leak — no token is used or returned for a disconnected channel |
| A "Get Started" or menu button produces no response | Messenger postbacks are not subscribed in this release; only the `messages` field is | Out of scope — use a typed text message |
| A message sent more than 24 hours after the customer's last message is not delivered | Enforced by the policy engine; the app sends no message tags in this release | Expected — the app deliberately stays inside the standard messaging window |

## Permission Minimization

EasyModerator intentionally removed Comment-to-DM for launch. That removed the need for:

- `pages_read_engagement`
- `pages_manage_engagement`
- `feed` webhook subscription
- Any Facebook Page public-comment automation

The remaining permissions map only to direct Messenger DM conversations and Page webhook setup.
