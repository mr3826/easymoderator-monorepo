# Meta App Review — Submission Sheet

**App:** EasyModerator · **App ID:** `2040799330176198` (Dashboard display name still reads `saas-easymod`; rename before recording)
**Graph API:** v22.0 · **Login product:** Facebook Login for Business
**Business Verification:** ✅ Verified
**Last updated:** 2026-08-20 (Messenger-only launch; Facebook only)
**Dashboard audit:** every value below verified against the live dashboard on 2026-08-20.

Paste-ready values for the Meta App Dashboard. Process and video script live in
[META_APP_REVIEW_MASTER_GUIDE.md](META_APP_REVIEW_MASTER_GUIDE.md).

## Dashboard Values

| Dashboard field | Value |
|---|---|
| App Domains | `easymod.tech` |
| App Icon | upload `EasyMod-frontend/public/icon-1024.png` (1024×1024) |
| Privacy Policy URL | `https://easymod.tech/privacy-policy` |
| Terms of Service URL | `https://easymod.tech/terms` — **not** `/terms-of-service`, which 404s |
| Support / contact email | `support@easymod.tech` (privacy enquiries: `privacy@easymod.tech`) |
| Category | Business / Messaging |
| Webhook Callback URL | `https://api.easymod.tech/webhooks/meta` |
| Webhook Verify Token | value of production `META_WEBHOOK_VERIFY_TOKEN` |
| Data Deletion Request Callback URL | `https://api.easymod.tech/webhooks/meta/data-deletion` |
| Deauthorize Callback URL | `https://api.easymod.tech/webhooks/meta/deauthorize` |
| Valid OAuth Redirect URI | `https://app.easymod.tech/channels/oauth-callback` — must match production `META_OAUTH_REDIRECT_URI` exactly |

Use the **apex domain** everywhere. `www.easymod.tech` 301-redirects to the apex,
and Meta treats a 301 in an OAuth redirect URI as a mismatch.

Webhook subscription field: **`messages` on the `page` object only.**

After saving the webhook config, confirm the verify-token handshake with the
self-check in
`EasyMod-backend/.easymod/meta-app-review/compliance-checklist.md` (item 5) — a
mismatch between the pasted token and `META_WEBHOOK_VERIFY_TOKEN` makes "Verify
and Save" fail with no useful error.

## Permission Use Text

**1. `pages_show_list`**

> EasyModerator uses this permission after Facebook Login to call `GET /me/accounts`, then intersects the returned Pages with Meta `debug_token` granular permission target IDs. The merchant sees and can connect only the Facebook Page(s) they selected/authorized in Facebook. Pages not selected in Facebook are not shown and are rejected by the connect endpoint.

**2. `pages_messaging`**

> EasyModerator uses this permission to operate a shared Facebook Messenger inbox for the connected Page. We receive direct customer DMs through the `messages` webhook and send AI-assisted or human replies through `POST /me/messages` with the Page token. We do not use this permission for comments or public-comment automation.

**3. `pages_manage_metadata`**

> EasyModerator uses this permission to subscribe, verify, and unsubscribe the connected Page's webhook subscription through `/{page-id}/subscribed_apps`. The app subscribes only to the `messages` field so direct Messenger DMs can arrive in real time.

## Notes To Reviewer

> EasyModerator is a Facebook Page Messenger inbox with AI-assisted customer replies and order support, built for small retailers in Bangladesh. Sign in to the test instance at `https://app.easymod.tech/signin` with the supplied credentials. You will land on the dashboard. In the left sidebar under **SETTINGS**, click **Chat** (direct URL: `https://app.easymod.tech/manage-shop/chat-settings`). Before connecting, you can expand **"What permissions are needed?"** to see the same three permissions listed in-app. Click **Connect Facebook Page**, authorize the supplied Facebook Page, and select it in the picker. The connected channel card shows connection, webhook, and token health, and a **Test** button that re-verifies the webhook subscription on demand.
>
> Then send a direct Messenger DM to that Page from the supplied tester customer account. The message appears in **Messages** (the shared inbox) and can be answered either by the AI-assisted reply or by typing a manual reply — both are delivered to the customer through Messenger. Comment-to-DM, Page post keyword automation, public comment replies, and comment-triggered DMs are not part of this launch, are not implemented in the product, and are not requested in App Review.
>
> While the app is in Development mode, Meta only delivers webhook events from users with an app role. Please use the provided customer tester account to send the inbound message.
>
> Three behaviours are intentional and are not defects: Messenger postbacks (for example a "Get Started" button) are not subscribed, because this release subscribes only to the `messages` field; out-of-window AI/system order-support follow-ups use the `POST_PURCHASE_UPDATE` Send API tag (live Meta delivery for that path is still a verification item, so it is not part of the screencast claim); and out-of-window manual/agent replies are blocked outright rather than tagged, since the correct tag for that case (`HUMAN_AGENT`) requires a separate Meta permission this app has not requested.

## Pre-Submit Checklist

1. ✅ The **App Review request** contains only these three permissions: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`. Verified 2026-08-20 — App Review → Requests reads *Not submitted* with exactly those three under **New requests**.
2. ✅ Webhook subscription uses only the `messages` field on the `page` object. Verified 2026-08-20.
3. ⚠️ `pages_read_engagement`, `pages_manage_engagement`, `business_management`, `ads_management` and the `instagram_*` scopes are **not absent from the dashboard** — every Business app is auto-granted them at Standard access, and ours shows real traffic against several (`pages_read_engagement` 60 calls, Page Public Metadata Access 40, `pages_read_user_content` 32, `business_management` 18, `ads_management` 7, `instagram_basic` / `instagram_manage_comments` / `instagram_manage_messages` 5 each, as of 2026-08-20). What matters — and what is true — is that **none of them are in the review request**. Keep it that way. Be ready to explain the Instagram traffic if a reviewer asks, since this submission describes a Facebook-Messenger-only launch.
4. Screencast demonstrates direct Messenger DM only, in one take, with the Facebook consent dialog visible.
5. Test Page and tester customer account are added to App Roles, **and the invites are accepted from those accounts** — a pending invite does not enable webhook delivery.
6. Privacy policy and Terms URLs resolve without authentication.
7. ✅ Data deletion and deauthorize callback URLs are configured. Verified 2026-08-20: Settings → Basic → User data deletion is set to **Data deletion callback URL** = `https://api.easymod.tech/webhooks/meta/data-deletion`, and both endpoints answer a bare POST with `400 {"error":"Missing signed_request"}`.
8. App icon uploaded.
9. Reviewer credentials entered in the Dashboard's test-credentials fields, not just in the notes box — and **2FA is disabled** on that account.
10. Reviewer account has an active subscription, conversation usage under 75%, and populated products/business info, so no setup checklist or upgrade banner greets the reviewer.
11. ✅ Business Verification complete — **HexaByte Technologies**, ID `1268762121859445`, Verified (confirmed 2026-08-20).
12. ⛔ **Access Verification (Tech Provider) — NOT STARTED. Deadline 2026-10-19.** Separate gate from App Review and not satisfied by it. `pages_show_list` sits in the dashboard's Tech-Provider-gated section, so without it every merchant who lacks a role on the app fails with error 100 once the app goes Live. Only a Business admin can complete it; ~5-day decision. Procedure: `.easymod/meta-app-review/business-verification.md` §6.
13. ⬜ App Mode is still **Development**. Advanced Access to `pages_messaging` goes live for non-testers only after App Review approves *and* the app is switched to Live.

### Known drift from this sheet (2026-08-20)

| Field | This sheet says | Dashboard has |
|---|---|---|
| Display name | rename before recording | still `saas-easymod` |
| Support / contact email | `support@easymod.tech` | `info@easymod.tech`, unverified |
| Category | Business / **Messaging** | `Business and pages`, no sub-category |

API-call prerequisite is satisfied for all three requested permissions —
`pages_messaging` 172, `pages_show_list` 114, `pages_manage_metadata` 112 calls
logged as of 2026-08-20, well past the "at least 1 within 30 days" bar.
