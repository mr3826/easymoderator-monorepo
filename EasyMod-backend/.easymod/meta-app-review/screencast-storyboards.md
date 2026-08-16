# Meta App Review Screencast — Storyboard and Narration Script

**App:** EasyModerator · **App ID:** `1609451646619088`
**Last updated:** 2026-08-14
**Target length:** 3:30–4:30 · **Deliverable:** one continuous unedited screen
recording, uploaded against **all three** permissions.
**Written against:** the shipped frontend. Every screen, button label, and toast
named below exists in `EasyMod-frontend/src` today.

Business Verification is complete. This recording is the remaining deliverable.

---

## Capture setup

**Record the whole desktop.** The Facebook consent dialog opens as a separate
600×700 popup window (`ChatSettings.tsx` `handleConnect`). A tab-scoped or
single-window capture will not contain it — and a video without the consent
screen is the most common single cause of rejection.

- Clean browser profile: no bookmarks bar, no extensions, no extra tabs, OS
  notifications silenced.
- Two windows arranged side by side: **EasyModerator left, Messenger right**.
  Both must be visible in the same frame for the message round trip.
- App UI language set to **English** (sidebar footer toggle).
- 1280×720 minimum. Inbox message text must be readable at full-size playback.
- Narration in English — voice-over, or burnt-in captions if you prefer.

## Before you hit record

- [ ] Test Page and tester customer account are **accepted** into App Roles →
      Testers. In Development mode a non-tester's DM never fires the webhook and
      the demo dies on camera. A pending invite does not count.
- [ ] Reviewer merchant account: 2FA **off**, subscription active, conversation
      usage under 75%, products and business info populated.
- [ ] Chat Settings shows **no connected Page** — disconnect first. With a Page
      already connected the button relabels to *"Add another Facebook Page"* and
      the picker greys the Page out with a **Connected** badge.
- [ ] Reply mode decided (see the note before Shot 8) and saved.
- [ ] Full dry run completed today, round trip confirmed working.

---

## Do / Do not

**Do**

- One continuous take. Fumble → restart, never splice.
- Pause on the Facebook consent dialog long enough to read the permissions.
- Send a **unique** text message and show that exact text arriving; reply and
  show that exact reply landing.
- Say each permission name at the moment its effect is on screen.
- Keep both Messenger and EasyModerator in frame during Shots 6–10.

**Do not**

- No comment automation, Comment-to-DM, `feed` events, public comment replies, or
  private replies to comments — none of it exists in this build.
- No Instagram, no WhatsApp, anywhere on screen.
- No "Get Started" or persistent-menu buttons — postbacks are not subscribed, so
  tapping one produces silence and reads as a broken app.
- No reply outside the 24-hour window — the composer disables itself with
  *"Meta's 24-hour messaging window has expired…"*, which is correct behaviour
  that looks like a bug on camera. Message the Page fresh before recording.
- No Subscription page, upgrade modal, or usage banner.
- No real merchant Page, real customer name, or real order.
- No cuts, no speed ramps, no music.

---

## Storyboard + narration

Read the narration close to verbatim. It is written to name each permission at
the moment the reviewer sees it working — that mapping is what gets scored.

### Shot 1 — The product (0:00–0:20)

**Screen:** `https://app.easymod.tech/dashboard`, signed in as the reviewer
merchant account. The dashboard shows today's sales, orders, and reply activity.

> "This is EasyModerator, a shared Facebook Messenger inbox for small retail
> businesses in Bangladesh. Merchants use it to answer messages customers send
> directly to their Facebook Page, with optional AI-assisted replies. It does not
> read or reply to Page post comments."

### Shot 2 — Open Chat Settings (0:20–0:35)

**Screen:** Left sidebar → under **SETTINGS**, click **Chat**. Lands on
`/manage-shop/chat-settings`. One button is visible: **Connect Facebook Page**.

> "The merchant opens Chat Settings. No Facebook Page is connected yet."

### Shot 3 — Show the in-app permission disclosure (0:35–0:50)

**Screen:** Click **"What permissions are needed?"** below the connect button.
It expands to list the three permissions with plain-language descriptions.

> "Before connecting, EasyModerator tells the merchant exactly which permissions
> it will request: `pages_show_list` to see their Page list, `pages_messaging` to
> read and send Messenger messages, and `pages_manage_metadata` to subscribe to
> realtime webhooks. These three are the only permissions the app requests."

*This shot costs fifteen seconds and demonstrates informed consent before the
Facebook dialog is even opened. Do not skip it.*

### Shot 4 — The Facebook consent dialog *(mandatory)* (0:50–1:25)

**Screen:** Click **Connect Facebook Page**. The popup opens. **Pause.** Scroll
so the requested permissions are visible and readable.

> "The merchant clicks Connect, and Facebook Login for Business opens. Facebook
> asks them to authorise the same three permissions: `pages_show_list`,
> `pages_messaging`, and `pages_manage_metadata`. The merchant chooses which
> Pages to grant access to — here, only the test Page."

Select **only the test Page** in Facebook's own selector, then continue.

### Shot 5 — Page picker and `pages_show_list` (1:25–1:45)

**Screen:** The popup closes and EasyModerator shows its Page picker with
checkboxes.

> "Using `pages_show_list`, EasyModerator calls `/me/accounts` and cross-checks
> the result against the granular permission target IDs Facebook returned. Only
> the Pages the merchant actually authorised appear here. Any other Page is
> neither shown nor connectable."

Tick the test Page. Click **Connect (1)**.

### Shot 6 — Connected, webhook live, `pages_manage_metadata` (1:45–2:15)

**Screen:** The connected channel card. Point at the 2×2 health grid:
**Connection: Connected · Webhook: Active · Token: Valid · Last webhook**.

> "The Page is connected. Using `pages_manage_metadata`, EasyModerator subscribed
> the Page to the `messages` webhook field only, then read the subscription back
> to confirm it. That is what the Webhook: Active row reports. We do not
> subscribe to the feed field or to any comment field."

Click **Test**. Wait for the `Webhook OK (…ms)` toast and let it sit on screen.

> "The merchant can verify that subscription at any time from here."

### Shot 7 — Customer sends a real message *(mandatory)* (2:15–2:35)

**Screen:** Switch to the Messenger window, logged in as the **tester customer
account**, in a conversation with the test Page.

Type a message obviously unique to this recording — use exactly:

> `Hi, is the blue kurti available in size M?`

> "Now a customer messages the Page directly in Messenger. This is a private
> Messenger conversation — not a comment on a post."

Send it. Leave it visible.

### Shot 8 — Message arrives in the Inbox (2:35–3:00)

**Screen:** Back to EasyModerator → **Messages** in the sidebar. Open the thread.

> "The message arrives in the merchant's shared inbox in real time through the
> `messages` webhook. This is `pages_messaging` on the receive side."

Hold on the message text — it must be readable and identical to Shot 7.

**Reply-mode fork — pick one before you record:**

- **Account is in "Send automatically":** the AI reply sends on its own and the
  first automated reply of the conversation carries the disclosure *"You are
  chatting with the automated assistant of \<shop\>."*
  > "EasyModerator sent an AI-assisted reply. The first automated reply in a
  > conversation always carries a disclosure telling the customer they are
  > talking to an automated assistant. The merchant cannot switch that off."
- **Account is in "Review first" (the product default):** the AI reply appears as
  a suggestion panel with **Send this** / **Edit & send** / **Dismiss**, and
  carries no disclosure because nothing was auto-sent.
  > "By default EasyModerator drafts a reply and waits for the merchant to
  > approve it. Nothing reaches the customer without a human sending it."

Do not narrate the disclosure while filming draft mode — the two do not match,
and a claim the screen contradicts is worse than no claim.

### Shot 9 — Merchant sends a manual reply *(mandatory)* (3:00–3:20)

**Screen:** The inbox composer.

Type exactly:

> `Yes, the blue kurti is in stock in size M. It is 1,450 taka.`

> "The merchant types a reply and sends it through EasyModerator. This is
> `pages_messaging` on the send side, using the Page access token."

Send it.

### Shot 10 — Customer receives that exact reply *(mandatory)* (3:20–3:40)

**Screen:** Switch to the Messenger window. **Do not cut.**

> "The reply is delivered to the customer in Messenger — the same text the
> merchant just typed."

Hold long enough for the reviewer to read both messages in the thread and match
them against Shots 7 and 9. **This is the single most important frame in the
video.** Without it the submission fails on `pages_messaging`.

### Shot 11 — Consent and control (3:40–3:55)

**Screen:** Back to Chat Settings. Expand **Consent activity** on the channel
card — opt-in / opt-out / deauthorized / erased counters with recent events.

> "EasyModerator records consent activity per Page — opt-ins, opt-outs,
> deauthorizations, and data deletions — so the merchant can see how customer
> data on this channel is being handled."

### Shot 12 — Disconnect (3:55–4:15)

**Screen:** Click **Disconnect**, confirm in the modal.

> "When a merchant disconnects, EasyModerator unsubscribes the Page's webhook and
> stops all access. They can reconnect at any time."

Show the card back in its disconnected state.

### Shot 13 — Close (4:15–end)

> "That is the complete flow: connect a Page, receive a direct Messenger message,
> reply, and disconnect. EasyModerator uses only `pages_show_list`,
> `pages_messaging`, and `pages_manage_metadata`, and subscribes only to the
> `messages` webhook field."

Stop recording.

---

## Coverage check

Tick each against the take you actually recorded, before uploading.

| # | Required | Shot | Recorded? |
|---|---|---|---|
| 1 | Merchant signed in, product identified | 1 | ☐ |
| 2 | Page connection flow opened | 2 | ☐ |
| 3 | In-app permission disclosure shown | 3 | ☐ |
| 4 | **Facebook authorization dialog shown and readable** | 4 | ☐ |
| 5 | Merchant selects only the intended Page | 4–5 | ☐ |
| 6 | Connected Page + webhook active in EasyModerator | 6 | ☐ |
| 7 | **Tester sends a real Messenger text message** | 7 | ☐ |
| 8 | Message appears in the shared inbox, same text | 8 | ☐ |
| 9 | AI reply or draft behaviour, matching the account's mode | 8 | ☐ |
| 10 | Merchant sends a text reply | 9 | ☐ |
| 11 | **Tester receives that exact reply** | 10 | ☐ |
| 12 | Consent activity shown | 11 | ☐ |
| 13 | Disconnect shown | 12 | ☐ |
| 14 | No comments, Instagram, WhatsApp, postbacks, or billing on screen | all | ☐ |

## Per-permission upload notes

Attach the same video to all three permissions. Paste the justification from
`docs/meta-app-review-submission.md` §"Permission Use Text" verbatim, then append
the timestamp:

| Permission | Point the reviewer at |
|---|---|
| `pages_show_list` | ~1:25 — Page picker showing only merchant-authorised Pages |
| `pages_messaging` | ~2:15–3:40 — inbound message, reply, delivery |
| `pages_manage_metadata` | ~1:45 — webhook subscribed, verified, and re-tested on demand |
