# Meta App Review — Submission Sheet (copy-paste)

**App:** Easy Moderator · **Graph API:** v22.0 · **Login product:** Facebook Login for Business
**Last updated:** 2026-06-23

This is the **fill-in-the-form** sheet. Every value below is copied straight into the Meta
App Dashboard. The *why* behind each permission lives in the reviewer guide
([`docs/meta-app-review.md`](./meta-app-review.md)) and the per-permission detail in
[`EasyMod-backend/.easymod/meta-app-review/permissions-justification.md`](../EasyMod-backend/.easymod/meta-app-review/permissions-justification.md)
(canonical). Code was re-verified against every claim on 2026-06-13 — scopes, webhook
callback, and the data-deletion/deauthorize endpoints all match.

---

## A. App Dashboard field values

| Dashboard field | Where in dashboard | Value to paste |
|---|---|---|
| **App Domains** | Settings → Basic | `easymod.tech` |
| **Privacy Policy URL** | Settings → Basic | `https://easymod.tech/privacy-policy` |
| **Terms of Service URL** | Settings → Basic | `https://easymod.tech/terms-of-service` |
| **Category** | Settings → Basic | Business / Messaging |
| **Webhook Callback URL** | Webhooks (or product → Webhooks) | `https://easymod.tech/api/webhooks/meta` |
| **Webhook Verify Token** | same row → "Verify and Save" | the value of env `META_WEBHOOK_VERIFY_TOKEN` on the droplet (do **not** paste a guess — read it from the server `.env`) |
| **Data Deletion Request Callback URL** | Settings → Advanced → Data Deletion | `https://easymod.tech/api/webhooks/meta/data-deletion` |
| **Deauthorize Callback URL** | Settings → Advanced | `https://easymod.tech/api/webhooks/meta/deauthorize` |
| **Valid OAuth Redirect URIs** | FB Login for Business → Settings | the app's OAuth callback (confirm against `META_REDIRECT_URI` on the droplet) |

**Webhook subscription fields**:
Page `subscribed_apps` uses `messages` and `feed` on connect. The Meta App Dashboard
Instagram object must also be subscribed to `messages` and `comments`; that object-level
subscription is what delivers IG DMs/comments for review.

> Note: links use the apex `easymod.tech`. `www.easymod.tech` 301-redirects to apex, so both
> resolve, but paste the apex form to avoid a redirect hop during Meta's automated check.

---

## B. Permissions — paste into each "How will your app use this permission?" box

All 8 are demonstrated in the screencast (storyboard refs in
`EasyMod-backend/.easymod/meta-app-review/screencast-storyboards.md`). Reviewer screen for
every permission: **Settings → Chat Settings.**

**1. `pages_show_list`**
> After the merchant grants consent, we call `GET /me/accounts` to list the Facebook Pages
> they administer and show them in a picker so they can choose which Page to connect. Only
> the Page they explicitly select is stored; Pages shown but not chosen are never persisted.
> Demonstrated: the asset picker listing the tester's Page right after consent.

**2. `pages_messaging`**
> Core feature — a shared inbox for the merchant's Page. We receive Messenger DMs via the
> `messages` webhook and send replies (human and AI auto-reply) via
> `POST /me/messages` with the connected Page token. Inbound messages are webhook-driven;
> we do not poll `GET /me/conversations`. Demonstrated: a tester DMs the Page, the message
> appears in the inbox, and a reply is delivered back.

**3. `pages_read_engagement`**
> Used to receive comment events on the Page's posts through the `feed` webhook so a
> configured keyword in a comment can trigger a private reply / DM handoff. We do not poll
> historical comments during the reviewer flow. Demonstrated: a tester comments a trigger
> keyword on a Page post and the event is received.

**4. `pages_manage_metadata`**
> Used to subscribe the connected Page to our webhooks on connect and unsubscribe on
> disconnect (`POST`/`GET`/`DELETE /{page-id}/subscribed_apps`). We hard-verify the
> subscription with `GET subscribed_apps` so the channel health grid shows a real status, not
> an assumed one. No customer data is accessed through this permission. Demonstrated: the
> channel card showing **Webhook: Active** after connect.

**5. `pages_manage_engagement`**
> Used to post a public reply to a customer's comment when the merchant enables "also reply
> publicly" alongside the comment-to-DM automation (`POST /{comment-id}/comments`). The reply
> text is a merchant-configured template. Demonstrated: a keyword comment receiving a public
> reply.

**6. `instagram_basic`**
> Used to read the Instagram Business account linked to the connected Page through the
> `instagram_business_account{id,name,username,profile_picture_url}` field nested on
> `GET /me/accounts`, so we can display it and gate IG webhooks. Stored only for display;
> access token stored encrypted.
> Demonstrated: the linked IG account name and avatar rendering on the channel card.

**7. `instagram_manage_messages`**
> The Instagram half of the shared inbox — receive IG Direct Messages via the `messages`
> webhook and send replies via `POST /me/messages` with the connected Page token, exactly
> like Messenger.
> Demonstrated: a tester sends an IG DM and it appears in the same inbox as Messenger threads,
> with a reply delivered back.

**8. `instagram_manage_comments`**
> The Instagram half of comment automation — read comments on the business's IG media
> through the `comments` webhook and post public replies
> (`POST /{ig-comment-id}/replies`) for keyword-triggered responses. Mirrors
> `pages_read_engagement` + `pages_manage_engagement` on the Facebook side. Demonstrated: a keyword
> comment on IG media triggering a public reply.

---

## C. "Notes to reviewer" box (paste verbatim)

> Easy Moderator is a unified Messenger + Instagram inbox with AI auto-reply for small
> businesses. Sign in to the live test instance with the tester credentials below, go to
> **Settings → Chat Settings**, and click **"Connect Facebook + Instagram (one popup)"** — a
> single Facebook Login for Business dialog requests all permissions. After consent, pick the
> test Page (and its linked Instagram account); the channel card shows **Webhook: Active**.
> Send a DM to the Page and to the IG account from the provided customer account — each
> appears in the Shared Inbox and receives an AI auto-reply. Optionally comment the keyword
> "interested" on the test post to see the comment-to-DM automation.
>
> **Important (not a bug):** while the app is in Development mode, Meta only delivers webhook
> events for users with a role on the app. Please send the inbound test DM/comment from the
> provided customer account, which is on the app's Tester roster. Outbound send, connect, and
> health-verify paths work regardless of app mode.

---

## D. Tester assets the reviewer needs (founder to provision)

Spec (no live secrets in repo): `EasyMod-backend/.easymod/meta-app-review/` →
`test-user-credentials.md`. Provide via the App Review submission's secure notes / 1Password
share — **never commit passwords or tokens.**

- [ ] Test **Facebook Page** "Easy Moderator Test Shop" — published, category Shopping & Retail, ≥1 product post with keyword **"interested"** configured in auto-reply.
- [ ] Test **Instagram Business** account `@easymod_test_shop` linked to that Page.
- [ ] Test **merchant** Easy Moderator login (admin of the Page), active subscription, signs in at `https://easymod.tech/signin`.
- [ ] Test **customer** account — a *separate* personal FB account (not the Page admin), added to **App Roles → Testers** so its webhook events fire in Dev mode.
- [ ] Tester credentials shared with reviewer via secure link (30-day expiry).

---

## E. Pre-submit checklist (founder, non-code)

1. [ ] Set the 4 callback URLs + App Domains + Privacy/Terms URLs (section A) in the App Dashboard.
2. [ ] Click **Verify and Save** on the webhook — confirm it returns the challenge (uses `META_WEBHOOK_VERIFY_TOKEN`).
3. [ ] Subscribe the app to the webhook fields (section A) on **page** and **instagram** objects.
4. [ ] Provision the 4 test assets (section D) and connect the test Page + IG inside the app.
5. [ ] Record the ~3-minute screencast per `docs/meta-app-review.md` §4 + the storyboards.
6. [ ] In the App Review request, add each permission, paste its box (section B), attach the screencast, and paste the reviewer notes (section C).
7. [ ] Add the tester customer account under **App Roles → Testers** (Dev-mode webhook gating).
8. [ ] Confirm the live data-deletion URL responds: open `https://easymod.tech/api/webhooks/meta/data-deletion` in a browser — it returns human-readable deletion instructions (GET), which is also what users see.
9. [ ] Submit.

---

## F. Code ↔ submission verification (done 2026-06-13)

| Claim | Verified against | Result |
|---|---|---|
| Requested scopes = the 8 boxes in §B | `MetaMessengerProvider.DEFAULT_SCOPES` ∪ `MetaInstagramProvider.DEFAULT_SCOPES` = `unifiedScopes` in `meta-oauth.service.js` | ✓ exact 8, no `business_management` or `pages_manage_posts` |
| Webhook callback URL | `app.js` mounts `meta-webhook.routes` at `/api/webhooks/meta`; GET handles `hub.challenge` | ✓ |
| Data-deletion + deauthorize URLs | `meta-webhook-gdpr.handler.js` → `POST /data-deletion`, `POST /deauthorize` (HMAC-verified) | ✓ |
| Privacy / Terms URLs | FE routes `privacy-policy`, `terms-of-service` exist | ✓ |

Anything Meta inspects in the live app will agree with what is written in this sheet.
