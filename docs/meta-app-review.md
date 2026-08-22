# Meta App Review - Reviewer Guide

**App:** EasyModerator · **App ID:** `2040799330176198` (Dashboard display name still reads `saas-easymod`; rename before recording)
**Last updated:** 2026-08-14 (Messenger-only launch; Facebook only; Business Verification complete)
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
6. Confirm the channel card shows connected status and webhook active status. The
   **Test** button on the card re-verifies the webhook subscription on demand.
7. From a separate tester account, send a direct Messenger DM to the Page.
8. Confirm the DM appears in the shared inbox (**Messages** in the sidebar).
9. Confirm the assistant's reply. In the product's default **"Review first"** mode
   the reply appears as a draft for the merchant to approve, and carries no
   automated-assistant disclosure because nothing was auto-sent. In
   **"Send automatically"** mode the reply is delivered by the app, and the first
   automated reply of each conversation carries the automated-assistant
   disclosure. Reply mode is set at **Settings → Business Info → Reply Settings**.
10. Send a manual reply from the inbox to confirm the human reply path.

Development-mode caveat: while the Meta app is in Development mode, webhook events only arrive for users who have an app role. Use the supplied App Roles tester account for the inbound DM.

## Screencast Script

The shot-by-shot script, narration, and capture rules live in
`EasyMod-backend/.easymod/meta-app-review/screencast-storyboards.md`. It is the
only copy — do not maintain a second one here.

Do not demonstrate comments, Page post keywords, public comment replies, or private replies to comments. Those features are out of scope for the initial launch.

## Troubleshooting For The Reviewer

If a step does not behave as described, this table explains the likely cause
before you record it as a defect. Contact: `support@easymod.tech`.

| What you see | Why | What to do |
|---|---|---|
| The OAuth popup is blocked by the browser | The connect flow opens Facebook Login in a 600×700 popup and waits for it. A blocked popup leaves the card on "Log in to Meta in the pop-up…" | Allow pop-ups for `app.easymod.tech`, click **Cancel** on the card, and click **Connect Facebook Page** again |
| The popup does not close itself, but EasyModerator advances anyway | Cross-Origin-Opener-Policy blocks `window.close()` from the opener; the result is delivered over `BroadcastChannel` instead | Close the popup manually and continue |
| The Page picker is empty, or your Page is missing | Facebook's granular Page selection was not granted for that Page. EasyModerator intersects `/me/accounts` with the `debug_token` granular target IDs and refuses to show a Page you did not select | Re-run the connect flow and tick the Page on the Facebook consent screen |
| You cancel at Facebook and see "Connection failed" | The denial branch. No channel is created | Expected — re-run and approve |
| The Page connects, but a Messenger DM never reaches the Shared Inbox | While the app is in Development mode Meta only delivers webhook events for accounts holding an app role | Send the DM from the supplied tester **customer** account, which is on App Roles → Testers |
| A previously connected Page still appears in the database after disconnect | Channels are retained with `status: DISCONNECTED` for the audit trail rather than hard-deleted; the UI filters them out | Expected behaviour, not a leak — no token is used or returned for a disconnected channel |
| A "Get Started" or menu button produces no response | Messenger postbacks are not subscribed in this release; only the `messages` field is | Out of scope — use a typed text message |
| An out-of-window AI/system order-support follow-up is held or rejected | The policy path attaches `POST_PURCHASE_UPDATE` to AI/system-initiated out-of-window follow-ups | Do not use this as live-review evidence until a real Page send is verified |
| An out-of-window manual/agent reply is blocked entirely, even though the composer never opened | Correct behaviour, not a defect. `HUMAN_AGENT` is Meta's tag for this case, but this app has not requested/received that permission — the backend blocks the send outright rather than mis-tagging a free-form reply as a purchase update | Wait for the window to reopen (a fresh inbound DM), or request `HUMAN_AGENT` before demoing this path live |

## Permission Minimization

EasyModerator intentionally removed Comment-to-DM for launch. That removed the need for:

- `pages_read_engagement`
- `pages_manage_engagement`
- `feed` webhook subscription
- Any Facebook Page public-comment automation

The remaining permissions map only to direct Messenger DM conversations and Page webhook setup.
