# Meta App Review — Reviewer Guide

**App:** Easy Moderator
**Last updated:** 2026-06-04
**Graph API version:** v22.0
**Login product:** Facebook Login for Business

This is the single entry point for the Meta App Review reviewer. It maps every requested
permission to the concrete feature, screen, and Graph API call that exercises it; gives a
2–4 minute end-to-end test walkthrough; and records the permission-minimization decision.

Per-permission data-use and retention detail lives in
[`EasyMod-backend/.easymod/meta-app-review/permissions-justification.md`](../EasyMod-backend/.easymod/meta-app-review/permissions-justification.md).

---

## 1. Requested permissions (final set: 8)

Easy Moderator is a unified inbox + AI auto-reply tool for Bangladeshi f-commerce
businesses. One merchant connects their Facebook Page and the Instagram Business account
linked to it, and the app handles Messenger DMs, Instagram DMs, and comment-to-DM
automation from a single shared inbox.

Every permission below is requested. **`business_management` is NOT requested** — it was
removed before submission (see §5).

| # | Permission | Feature it powers | Merchant screen | Key Graph API call(s) | Webhook field | How the reviewer sees it used |
|---|------------|-------------------|-----------------|-----------------------|---------------|-------------------------------|
| 1 | `pages_show_list` | Lists the merchant's Pages so they can pick which one to connect | Settings → Chat Settings (asset picker after consent) | `GET /me/accounts` | — | After granting consent, the picker shows the tester's Page(s) to choose from |
| 2 | `pages_messaging` | Send/receive Messenger DMs — core inbox reply + AI auto-reply | Settings → Chat Settings → Shared Inbox | `POST /{page-id}/messages`, `GET /me/conversations` | `messages`, `messaging_postbacks` | Tester sends a Page DM → it appears in the inbox → AI auto-reply is sent back |
| 3 | `pages_read_engagement` | Delivery/read receipts + read Page comment events for keyword triggers | Settings → Chat Settings → Auto-reply tab | `GET /{post-id}/comments`, receipt webhooks | `feed`, `message_deliveries`, `message_reads` | Tester comments a trigger keyword on a Page post → event is received |
| 4 | `pages_manage_metadata` | Subscribe/verify/unsubscribe the Page's webhooks on connect/disconnect | Settings → Chat Settings (health grid) | `POST` / `GET` / `DELETE /{page-id}/subscribed_apps` | — (manages subscription) | On connect the health grid shows **Webhook: Active** (hard-verified via `GET subscribed_apps`) |
| 5 | `pages_manage_posts` | Public reply to a Page comment (alongside the DM) | Settings → Chat Settings → Auto-reply tab ("also reply publicly") | `POST /{comment-id}/replies` | — | Tester's keyword comment receives a public reply comment |
| 6 | `instagram_basic` | Read the IG Business account linked to the Page; display it; gate IG webhooks | Settings → Chat Settings (IG shows under the linked Page) | `GET /me?fields=instagram_business_account`, `GET /{ig-user-id}?fields=name,profile_picture_url` | — | The connected Page's linked IG account name + avatar render in the channel card |
| 7 | `instagram_manage_messages` | Send/receive Instagram DMs in the same inbox | Settings → Chat Settings → Shared Inbox | `POST /{ig-user-id}/messages` | `messages` (IG) | Tester sends an IG DM → it appears in the inbox alongside Messenger threads |
| 8 | `instagram_manage_comments` | Read/reply to Instagram comments — IG comment-to-DM automation | Settings → Chat Settings → Auto-reply tab | `POST /{ig-comment-id}/replies`, `GET /{ig-media-id}/comments` | `comments` (IG) | Tester comments a keyword on IG media → event received → public reply / DM fires |

The reviewer screen for **every** permission is **Settings → Chat Settings** — one screen
drives the entire connect + configure + monitor flow.

---

## 2. Scope ↔ code cross-check

This table verifies the docs match the code exactly. The requested set is the **union** of
three lists in the backend; after removing `business_management`, that union is exactly the
8 permissions above — no more, no less.

| Source in code | File | Scopes |
|----------------|------|--------|
| `MetaMessengerProvider.DEFAULT_SCOPES` | `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js` | `pages_show_list`, `pages_messaging`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_posts` |
| `MetaInstagramProvider.DEFAULT_SCOPES` | `EasyMod-backend/src/modules/channel-providers/providers/MetaInstagramProvider.js` | `pages_show_list`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_posts` |
| `unifiedScopes` (single FB+IG popup) | `EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js` | all 8 (the de-duped union) |

**Union = the 8-permission set.** Each scope appears in this guide, in
`permissions-justification.md`, and in at least one `DEFAULT_SCOPES`/`unifiedScopes` list.
No scope is documented that the code does not request, and no requested scope is
undocumented. A regression test asserts `business_management` is never requested:
`EasyMod-backend/src/modules/channel-providers/__tests__/meta-oauth.service.test.js`
(`does NOT request business_management`).

---

## 3. Reviewer test flow (2–4 minutes)

Live test instance and tester credentials are supplied in the App Review submission notes.
The deeper live-server setup is in
[`EasyMod-backend/.easymod/meta-app-review/dashboard-setup-walkthrough.md`](../EasyMod-backend/.easymod/meta-app-review/dashboard-setup-walkthrough.md) §12;
shot-by-shot storyboards are in
[`EasyMod-backend/.easymod/meta-app-review/screencast-storyboards.md`](../EasyMod-backend/.easymod/meta-app-review/screencast-storyboards.md).

1. **Log in** to the live test instance with the supplied tester credentials.
2. Go to **Settings → Chat Settings**.
3. Click **"Facebook + Instagram একসাথে সংযুক্ত করুন (one popup)"** (English: "Connect
   Facebook + Instagram together"). A single Facebook Login for Business popup opens.
4. **Grant consent** for the requested permissions in the popup.
5. Back in the app, the **asset picker** lists the tester's Page(s) (`pages_show_list`).
   Pick the test Page; if it has a linked IG Business account, that is offered too.
6. Confirm the connected channel card shows the **health grid** with **Webhook: Active**
   (this is hard-verified server-side via `GET /{page-id}/subscribed_apps`, not assumed).
   The linked Instagram account name + avatar also render here (`instagram_basic`).
7. **Inbound DM:** from a second account, send a DM to the test Page (and to the IG
   account). Each message appears in the **Shared Inbox** within a few seconds
   (`pages_messaging`, `instagram_manage_messages`, webhook `messages`).
8. **AI auto-reply round-trip:** the AI replies automatically to the inbound DM; the
   reply is delivered back to the sender (`POST /{page-id}/messages` /
   `POST /{ig-user-id}/messages`).
9. **Human reply:** open the thread in the inbox and send a manual reply to confirm the
   compose → send path.
10. *(Optional — comment automation)* Comment a configured trigger keyword on a test Page
    post / IG media. The app receives the comment event (`pages_read_engagement` /
    `instagram_manage_comments`) and posts a public reply (`pages_manage_posts` /
    `instagram_manage_comments`) and/or sends a DM.

### Dev-mode webhook caveat (important — not a bug)

While the app is in **Development mode**, Meta only delivers webhook events for users who
have a **role on the app** (Admin / Developer / Tester). If the reviewer sends the
inbound DM (step 7) from an account that is *not* on the App Roles roster, the message
will **not** arrive in the inbox — this is Meta's gating, not an app defect.

To demonstrate the inbound path, either:
- send the test DM from an account that is on the **App Roles** roster, **or**
- review while the app is **Live** (post-approval), when webhooks fire for any user.

The outbound send paths (steps 8–9) and the connect/health-verify paths (steps 1–6) work
regardless of app mode.

---

## 4. Screencast script

Target length **~3 minutes**. Record at 1280×720+, narrate in English. Map each beat to
the storyboards in `screencast-storyboards.md`.

1. **(0:00–0:20) Intro.** "This is Easy Moderator, a unified Messenger + Instagram inbox
   for small businesses. I'll connect a Facebook Page and its Instagram account, then show
   each permission in use." Show the logged-in dashboard.
2. **(0:20–0:45) Connect.** Settings → Chat Settings → click "Facebook + Instagram
   একসাথে সংযুক্ত করুন". Show the consent dialog and the permissions list on screen.
3. **(0:45–1:05) Pick assets.** Grant consent; show the asset picker listing the Page
   (`pages_show_list`); select the Page + linked IG.
4. **(1:05–1:30) Health grid.** Show the channel card: Connection = Connected, **Webhook =
   Active**, linked IG name + avatar (`pages_manage_metadata`, `instagram_basic`).
5. **(1:30–2:10) Inbound + auto-reply.** Send a DM from a roster test account to the Page
   and IG; show both landing in the Shared Inbox; show the AI auto-reply being delivered
   (`pages_messaging`, `instagram_manage_messages`).
6. **(2:10–2:35) Human reply.** Open a thread, type and send a manual reply.
7. **(2:35–3:00) Comment automation.** Comment a trigger keyword on a post; show the
   received event and the public reply (`pages_read_engagement`, `pages_manage_posts`,
   `instagram_manage_comments`). Close with a one-line recap.

State the dev-mode caveat in narration when sending the inbound DM ("sending from a tester
account on the app roster, as required in Development mode").

---

## 5. Permission minimization decision

**Decided 2026-06-04. Outcome: Option A — keep the comment/post scopes, remove
`business_management`.**

**Final requested set (8):** `pages_show_list`, `pages_messaging`, `pages_read_engagement`,
`pages_manage_metadata`, `pages_manage_posts`, `instagram_basic`,
`instagram_manage_messages`, `instagram_manage_comments`.

**Removed:** `business_management`.

### Why `business_management` was removed

It is a high-sensitivity scope, and the only capability it bought us was discovering Pages
owned by a **Business Portfolio** that `/me/accounts` does not return. Our target users —
Bangladeshi f-commerce merchants — are overwhelmingly **personal Page admins**, whose Pages
already appear in `GET /me/accounts`. Portfolio discovery is now **opt-in and isolated**
(`MetaMessengerProvider.listManagedAssets({ includeBusinessPortfolio })`, default `false`),
so its absence degrades gracefully to the `/me/accounts` path. Dropping it materially
reduces App Review surface and the consent the merchant must grant, at no cost to the common
case. (The removal is enforced by a regression test — see §2.)

### Why the comment/post scopes were kept (Option A, not Option B)

`pages_manage_posts` and `instagram_manage_comments` power the **comment-to-DM automation**
— a first-class, shipped feature (a merchant comments a keyword auto-replies publicly and/or
opens a DM). Deferring them (Option B) would have meant shipping the inbox without comment
automation and running a second App Review later. We chose to submit the comment scopes now,
with a screencast demonstrating the comment-reply flow, rather than split the review.

### Minimization summary

- **Requested:** only the 8 scopes that map to a shipped, demonstrable feature (§1 matrix).
- **Refused:** `business_management` (replaced by opt-in, isolated portfolio discovery).
- **Not requested:** any ads, catalog, or commerce scopes — Easy Moderator does not touch
  advertising or the commerce platform.
