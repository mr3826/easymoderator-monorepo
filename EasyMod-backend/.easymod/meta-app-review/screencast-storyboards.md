# Meta App Review Screencast — Storyboard and Narration Script

**App:** EasyModerator
**Last updated:** 2026-07-28
**Target length:** 3–4 minutes
**Deliverable:** one continuous unedited screen recording, uploaded to the App
Dashboard against **all three** permissions (Meta lets you attach the same video
to each — do that rather than cutting three shorter clips).

---

## Non-negotiables

Meta rejects on these more than on anything else, so read this list twice.

1. **One continuous take.** Cuts read as "the missing part is where it failed".
   If you fumble, restart — do not splice.
2. **Show the Facebook permission dialog itself.** A recording that jumps from
   "Connect" straight to a connected Page proves nothing about what you asked for.
3. **Show a real text message going out and a real text message coming back**,
   in that order, in the same take. This is the proof for `pages_messaging` and
   there is no substitute — an image/attachment demo does not count.
4. **Show both sides.** Split the screen, or alternate between the Messenger
   window (customer) and EasyModerator (merchant). The reviewer must see that
   the message the customer typed is the message that arrived, and that the
   reply the merchant typed is the reply the customer received.
5. **Screen recording only** — no phone filmed with another phone.
6. **1280×720 minimum.** Text in the inbox must be legible.
7. Narration in **English**, either voice-over or burnt-in captions. Bengali UI
   is fine and honest — the product is Bangladesh-first — but narrate in English.

## Do not show

- Comment-to-DM, Page post comment triggers, `feed` webhook events, public
  comment replies, private replies to comments, live selling from comments.
  None of it exists in this build and none of it is requested.
- Instagram or WhatsApp anywhere on screen.
- **"Get Started" / persistent-menu postback buttons** — postbacks are not
  subscribed, so tapping one produces silence and looks like a broken app.
- Any transactional message sent outside the 24-hour window — those are
  deliberately dropped, and on camera that also looks like a bug.
- Any real merchant's Page, any real customer's name, any real order.
- Browser tabs, bookmarks, notifications, or a desktop showing unrelated work.
  Use a clean profile.

## Before you hit record

- [ ] Test Page and tester customer account exist and are on **App Roles →
      Testers** (see `test-user-credentials.md`). In Development mode a
      non-tester's DM never fires the webhook and the demo dies on camera.
- [ ] Log in as the reviewer merchant account, and **disconnect** any Page —
      the video must start from the disconnected state.
- [ ] Both windows arranged: EasyModerator left, Messenger right.
- [ ] Notifications silenced. Clean browser profile, no extra tabs.
- [ ] Do a full dry run. Confirm the round trip actually works *today* before
      you record it.

---

## Storyboard + narration

Read the narration close to verbatim. It is written to name the permission at
the moment the reviewer sees it being used — that mapping is what a reviewer is
scoring.

### Shot 1 — Identify the product (0:00–0:15)

**Screen:** EasyModerator dashboard, logged in as the reviewer merchant account.

> "This is EasyModerator, a shared Facebook Messenger inbox for small
> businesses in Bangladesh. Merchants use it to answer customer messages sent
> directly to their Facebook Page, with optional AI-assisted replies. It does
> not read or reply to Page post comments."

### Shot 2 — Start the connection (0:15–0:30)

**Screen:** In the left sidebar under **SETTINGS**, click **Chat**
(`/app/manage-shop/chat-settings`). The Facebook card shows **Connect** and no
connected Page.

> "The merchant opens their chat settings. No Facebook Page is connected yet.
> They click Connect to start Facebook Login for Business."

Click **Connect**. Let the popup open on camera.

### Shot 3 — The permission dialog *(mandatory)* (0:30–1:00)

**Screen:** The Facebook consent screen. **Pause here.** Scroll so the requested
permissions are visible and readable.

> "Facebook asks the merchant to authorise three permissions:
> `pages_show_list`, so we can list the Pages they choose to grant;
> `pages_messaging`, so we can receive and send Messenger messages for that
> Page; and `pages_manage_metadata`, so we can subscribe the Page's webhook.
> The merchant selects only the Page they want to connect."

Select **only the test Page**, then continue.

### Shot 4 — Page picker and `pages_show_list` (1:00–1:20)

**Screen:** EasyModerator's Page picker after consent.

> "Using `pages_show_list`, EasyModerator calls `/me/accounts` and cross-checks
> it against the granular permission target IDs Facebook returned. Only the
> Pages the merchant actually selected in Facebook appear here. Any other Page
> is neither shown nor connectable."

Select the test Page and confirm.

### Shot 5 — Connected, webhook live, `pages_manage_metadata` (1:20–1:40)

**Screen:** The connected channel card — Page name, picture, connected status,
webhook active.

> "The Page is connected. Using `pages_manage_metadata`, EasyModerator
> subscribed the Page to the `messages` webhook field only, then read the
> subscription back to confirm it. That is what the webhook-active state here
> reports. We do not subscribe to `feed` or to any comment field."

### Shot 6 — Customer sends a real text message *(mandatory)* (1:40–2:00)

**Screen:** Switch to the Messenger window, logged in as the **tester customer
account**, in a conversation with the test Page.

Type a message that is obviously unique to this recording, so the reviewer can
match it end to end. Use exactly:

> `Hi, is the blue kurti available in size M?`

> "Now a customer messages the Page directly in Messenger. This is a private
> Messenger conversation, not a comment on a post."

Send it. Leave the sent message visible on screen.

### Shot 7 — Message arrives in the Shared Inbox (2:00–2:20)

**Screen:** Back to EasyModerator → **Shared Inbox**.

> "The message arrives in the merchant's Shared Inbox in real time through the
> `messages` webhook. This is `pages_messaging` on the receive side."

Point at the thread. The text must be readable and identical to Shot 6.

### Shot 8 — AI reply and the automated-assistant disclosure (2:20–2:45)

**Screen:** Same thread. The AI reply appears.

> "EasyModerator can draft and send an AI-assisted reply. Every conversation's
> first automated reply carries a clear disclosure that the customer is talking
> to an automated assistant — the merchant cannot switch that disclosure off."

Show the disclosure text on screen. Switch to Messenger and show the same reply
arriving on the customer side.

*If the AI reply is slow or unstable on the day, cut this shot entirely and go
straight to Shot 9. Shot 9 is mandatory; Shot 8 is not.*

### Shot 9 — Merchant sends a manual text reply *(mandatory)* (2:45–3:05)

**Screen:** Shared Inbox composer.

Type exactly:

> `Yes, the blue kurti is in stock in size M. It is 1,450 taka.`

> "The merchant types a reply and sends it through EasyModerator. This is
> `pages_messaging` on the send side, using the Page access token."

Send it.

### Shot 10 — Customer receives that exact reply *(mandatory)* (3:05–3:20)

**Screen:** Switch to the Messenger window. **Do not cut.**

> "The reply is delivered to the customer in Messenger — the same text the
> merchant just typed."

Hold on screen long enough that the reviewer can read both messages in the
thread and see they match Shots 6 and 9. **This shot is the single most
important frame in the video.** If it is not there, the submission fails on
`pages_messaging`.

### Shot 11 — Disconnect (3:20–3:40)

**Screen:** Back to **Settings → Chat**. Click **Disconnect**, confirm.

> "When a merchant disconnects, EasyModerator unsubscribes the Page webhook and
> stops all access. The merchant can reconnect at any time."

Show the card back in its disconnected state.

### Shot 12 — Close (3:40–end)

> "That is the complete flow: connect a Page, receive a direct Messenger
> message, reply, and disconnect. EasyModerator uses only `pages_show_list`,
> `pages_messaging`, and `pages_manage_metadata`, and subscribes only to the
> `messages` webhook field."

Stop recording.

---

## Coverage check — every required point

Meta's reviewer is looking for these twelve. Tick each against the take you
actually recorded before uploading.

| # | Required | Shot | Recorded? |
|---|---|---|---|
| 1 | Merchant signs in | 1 | ☐ |
| 2 | Page connection flow opened | 2 | ☐ |
| 3 | **Meta authorization screen shown** | 3 | ☐ |
| 4 | Merchant selects the intended Page | 3–4 | ☐ |
| 5 | Connected Page appears in EasyModerator | 5 | ☐ |
| 6 | **Tester sends a real Messenger text message** | 6 | ☐ |
| 7 | Message appears in the Shared Inbox | 7 | ☐ |
| 8 | Merchant sends a text reply | 9 | ☐ |
| 9 | **Tester receives the exact reply** | 10 | ☐ |
| 10 | AI/draft behaviour — only if stable | 8 | ☐ (optional) |
| 11 | Disconnect / reconnect | 11 | ☐ |
| 12 | No unsupported channel or permission on screen | all | ☐ |

## Per-permission upload notes

The Dashboard asks for a justification alongside the video for each permission.
Paste the text from `../../../../docs/meta-app-review-submission.md` §"Permission
Use Text" verbatim — it is already written to match this recording — and add the
timestamp where that permission is exercised:

| Permission | Point the reviewer at |
|---|---|
| `pages_show_list` | ~1:00 — Page picker showing only merchant-selected Pages |
| `pages_messaging` | ~1:40–3:20 — inbound message, reply, delivery |
| `pages_manage_metadata` | ~1:20 — webhook subscribed and verified on connect |
