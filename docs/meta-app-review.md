# Meta App Review — Reviewer Guide

**App:** Easy Moderator
**Last updated:** 2026-06-24 (Instagram removed from product scope — Facebook-only launch)
**Graph API version:** v22.0
**Login product:** Facebook Login for Business

This is the single entry point for the Meta App Review reviewer. It maps every requested
permission to the concrete feature, screen, and Graph API call that exercises it; gives a
2–4 minute end-to-end test walkthrough; and records the permission-minimization decision.

Per-permission data-use and retention detail lives in
[`EasyMod-backend/.easymod/meta-app-review/permissions-justification.md`](../EasyMod-backend/.easymod/meta-app-review/permissions-justification.md).

> **Scope note (2026-06-24):** Easy Moderator launches with **Facebook Pages only**.
> Instagram (Messenger DM, IG comments) was removed from product scope. The previously
> requested `instagram_basic`, `instagram_manage_messages`, and `instagram_manage_comments`
> are **no longer requested** — the requested set is now the 5 Facebook permissions below.

---

## 1. Requested permissions (final set: 5)

Easy Moderator is a unified inbox + AI auto-reply tool for Bangladeshi f-commerce
businesses. One merchant connects one or more **Facebook Pages**, and the app handles
Messenger DMs and comment-to-DM automation from a single shared inbox.

Every permission below is requested. **`business_management` is NOT requested** — it was
removed before submission (see §5). **No Instagram permissions are requested.**

| # | Permission | Feature it powers | Merchant screen | Key Graph API call(s) | Webhook field | How the reviewer sees it used |
|---|------------|-------------------|-----------------|-----------------------|---------------|-------------------------------|
| 1 | `pages_show_list` | Lists the merchant's Pages so they can pick which one(s) to connect | Settings → Chat Settings (asset picker after consent) | `GET /me/accounts` | — | After granting consent, the picker shows the tester's Page(s) to choose from (single or multiple) |
| 2 | `pages_messaging` | Send/receive Messenger DMs — core inbox reply + AI auto-reply | Settings → Chat Settings → Shared Inbox | `POST /me/messages` (Page token), `GET /{psid}?fields=first_name,last_name,name,profile_pic` (name enrichment) | `messages` | Tester sends a Page DM → it appears in the inbox (via webhook) → AI auto-reply is sent back |
| 3 | `pages_read_engagement` | Read Page comment events for keyword triggers | Settings → Chat Settings → Auto-reply tab | comment content arrives in the `feed` webhook (no GET) | `feed` | Tester comments a trigger keyword on a Page post → event is received |
| 4 | `pages_manage_metadata` | Subscribe/verify/unsubscribe the Page's webhooks on connect/disconnect | Settings → Chat Settings (health grid) | `POST` / `GET` / `DELETE /{page-id}/subscribed_apps` | — (manages subscription) | On connect the health grid shows **Webhook: Active** (hard-verified via `GET subscribed_apps`) |
| 5 | `pages_manage_engagement` | Public reply to a Page comment (alongside the DM) | Settings → Chat Settings → Auto-reply tab ("also reply publicly") | `POST /{comment-id}/comments` | — | Tester's keyword comment receives a public reply comment |

The reviewer screen for **every** permission is **Settings → Chat Settings** — one screen
drives the entire connect + configure + monitor flow.

---

## 2. Scope ↔ code cross-check

This table verifies the docs match the code exactly. The requested set is exactly the
single `DEFAULT_SCOPES` list in the Facebook provider — no more, no less.

| Source in code | File | Scopes |
|----------------|------|--------|
| `MetaMessengerProvider.DEFAULT_SCOPES` | `EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js` | `pages_show_list`, `pages_messaging`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_engagement` |

The OAuth service (`meta-oauth.service.js`) calls `buildAuthUrl({ scopes: [] })`, which falls
back to `DEFAULT_SCOPES` — so the dialog requests exactly these 5 permissions. There is no
Instagram provider and no "unified" multi-scope flow (both removed 2026-06-24).

Two regression tests enforce this:
- `__tests__/MetaMessengerProvider.test.js` — `buildAuthUrl()` requests **exactly** the 5
  Facebook scopes and **never** any `instagram_*` or `business_management` scope.
- `__tests__/meta-oauth.service.test.js` — the OAuth service never injects Instagram or
  `business_management` scopes.

---

## 3. Reviewer test flow (2–4 minutes)

Live test instance and tester credentials are supplied in the App Review submission notes.
The deeper live-server setup is in
[`EasyMod-backend/.easymod/meta-app-review/dashboard-setup-walkthrough.md`](../EasyMod-backend/.easymod/meta-app-review/dashboard-setup-walkthrough.md);
shot-by-shot storyboards are in
[`EasyMod-backend/.easymod/meta-app-review/screencast-storyboards.md`](../EasyMod-backend/.easymod/meta-app-review/screencast-storyboards.md).

1. **Log in** to the live test instance with the supplied tester credentials.
2. Go to **Settings → Chat Settings**.
3. Click **"Facebook Page সংযুক্ত করুন"** (English: "Connect Facebook Page"). A single
   Facebook Login for Business popup opens.
4. **Grant consent** for the 5 requested permissions in the popup.
5. Back in the app, the **asset picker** lists the tester's Page(s) (`pages_show_list`).
   Select one **or several** Pages — the picker is multi-select — then Connect.
6. Confirm each connected channel card shows the **health grid** with **Webhook: Active**
   (this is hard-verified server-side via `GET /{page-id}/subscribed_apps`, not assumed).
7. **Inbound DM:** from a second account, send a DM to the test Page. The message appears in
   the **Shared Inbox** within a few seconds (`pages_messaging`, webhook `messages`).
8. **AI auto-reply round-trip:** the AI replies automatically to the inbound DM; the reply is
   delivered back to the sender (`POST /me/messages` with the Page token).
9. **Human reply:** open the thread in the inbox and send a manual reply to confirm the
   compose → send path.
10. *(Optional — comment automation)* Comment a configured trigger keyword on a test Page
    post. The app receives the comment event (`pages_read_engagement`) and posts a public
    reply (`pages_manage_engagement`) and/or sends a DM.

### Dev-mode webhook caveat (important — not a bug)

While the app is in **Development mode**, Meta only delivers webhook events for users who
have a **role on the app** (Admin / Developer / Tester). If the reviewer sends the inbound
DM (step 7) from an account that is *not* on the App Roles roster, the message will **not**
arrive in the inbox — this is Meta's gating, not an app defect.

To demonstrate the inbound path, either:
- send the test DM from an account that is on the **App Roles** roster, **or**
- review while the app is **Live** (post-approval), when webhooks fire for any user.

The outbound send paths (steps 8–9) and the connect/health-verify paths (steps 1–6) work
regardless of app mode.

---

## 4. Screencast script

Target length **~2.5 minutes**. Record at 1280×720+, narrate in English. Map each beat to
the storyboards in `screencast-storyboards.md`.

1. **(0:00–0:20) Intro.** "This is Easy Moderator, a unified Messenger inbox for small
   businesses. I'll connect a Facebook Page, then show each permission in use." Show the
   logged-in dashboard.
2. **(0:20–0:45) Connect.** Settings → Chat Settings → click "Facebook Page সংযুক্ত করুন".
   Show the consent dialog and the 5 permissions on screen.
3. **(0:45–1:05) Pick assets.** Grant consent; show the asset picker listing the Page(s)
   (`pages_show_list`); select one or more Pages and Connect.
4. **(1:05–1:30) Health grid.** Show the channel card: Connection = Connected, **Webhook =
   Active** (`pages_manage_metadata`).
5. **(1:30–2:05) Inbound + auto-reply.** Send a DM from a roster test account to the Page;
   show it landing in the Shared Inbox; show the AI auto-reply being delivered
   (`pages_messaging`).
6. **(2:05–2:20) Human reply.** Open a thread, type and send a manual reply.
7. **(2:20–2:30) Comment automation.** Comment a trigger keyword on a post; show the received
   event and the public reply (`pages_read_engagement`, `pages_manage_engagement`). Close with
   a one-line recap.

State the dev-mode caveat in narration when sending the inbound DM ("sending from a tester
account on the app roster, as required in Development mode").

---

## 5. Permission minimization decision

**Final requested set (5):** `pages_show_list`, `pages_messaging`, `pages_read_engagement`,
`pages_manage_metadata`, `pages_manage_engagement`.

**Removed / not requested:** `business_management`, `instagram_basic`,
`instagram_manage_messages`, `instagram_manage_comments`.

### Why Instagram scopes were removed (2026-06-24)

Easy Moderator launches **Facebook Pages only**. Instagram (IG DM + IG comment-to-DM) is out
of scope for the initial launch, so the three Instagram permissions are no longer requested
and the Instagram code path (provider, OAuth, webhook handler) has been removed. This
materially shrinks the review surface and the consent the merchant must grant. (Instagram may
be reintroduced later via a separate App Review.)

### Why `business_management` was removed

It is a high-sensitivity scope, and the only capability it bought was discovering Pages owned
by a **Business Portfolio** that `/me/accounts` does not return. Our target users —
Bangladeshi f-commerce merchants — are overwhelmingly **personal Page admins**, whose Pages
already appear in `GET /me/accounts`. Portfolio discovery is **opt-in and isolated**
(`MetaMessengerProvider.listManagedAssets({ includeBusinessPortfolio })`, default `false`),
so its absence degrades gracefully to the `/me/accounts` path.

### Why the comment/post scopes were kept

`pages_read_engagement` and `pages_manage_engagement` power the **comment-to-DM automation**
for Facebook — a first-class, shipped feature (a merchant comments a keyword → auto-reply
publicly and/or opens a DM). We submit these now, with a screencast demonstrating the
comment-reply flow.

### Minimization summary

- **Requested:** only the 5 scopes that map to a shipped, demonstrable Facebook feature (§1).
- **Refused:** `business_management` (replaced by opt-in, isolated portfolio discovery) and
  all Instagram scopes (out of product scope).
- **Not requested:** any ads, catalog, or commerce scopes — Easy Moderator does not touch
  advertising or the commerce platform.
