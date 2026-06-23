# Meta Integration — Implementation Audit (code-grounded)

**Audited:** 2026-06-20 · **Branch:** `codex/admin-panel-hardening`
**Method:** read the actual integration code and traced every Graph API call, every
subscribed webhook field, and every requested OAuth scope back to the line that uses it.
Nothing below is inferred from the existing reviewer guide — where the guide and the code
disagree, the code wins and the gap is listed in §5.

**Verdict:** all 8 requested scopes are exercised by real code; `business_management` is
genuinely not requested (only used by an opt-in path that defaults off). The reviewer guide
([`docs/meta-app-review.md`](./meta-app-review.md)) is **directionally correct but names
several endpoints the code does not call** — fix those before submission so a reviewer
inspecting traffic does not catch a mismatch. See §5.

---

## 1. Graph API surface — every endpoint actually called

Source of truth: `EasyMod-backend/src/modules/channel-providers/providers/*` plus three
support files. `GRAPH_BASE = https://graph.facebook.com/${META_GRAPH_API_VERSION || v22.0}`.

| # | Method + endpoint | Purpose | Called from |
|---|-------------------|---------|-------------|
| 1 | `GET www.facebook.com/v22.0/dialog/oauth` | Consent dialog (auth URL) | `MetaMessengerProvider.js:67`, `MetaInstagramProvider.js:70` |
| 2 | `GET /oauth/access_token` (`code` → short token) | Code exchange | `MetaMessengerProvider.js:72`, `MetaInstagramProvider.js:75` |
| 3 | `GET /oauth/access_token` (`fb_exchange_token` → long-lived) | Extend to ~60-day token; token-refresh cron | `MetaMessengerProvider.js:83,245`, `MetaInstagramProvider.js:85,173`, `utils/meta-oauth-exchange.js:56` |
| 4 | `GET /me/accounts` (`fields=id,name,category,access_token,picture,instagram_business_account{…},tasks`) | List Pages + nested linked IG account for the picker | `MetaMessengerProvider.js:113`, `MetaInstagramProvider.js:107,137` |
| 5 | `GET /{asset-id}` (`fields=access_token`) | Fetch the Page Access Token for the chosen asset | `MetaMessengerProvider.js:226`, `MetaInstagramProvider.js:150` |
| 6 | `POST /{page-id}/subscribed_apps` (`subscribed_fields=…`) | Subscribe the app to the Page's webhooks on connect | `MetaMessengerProvider.js:279`, `MetaInstagramProvider.js:207` |
| 7 | `GET /{page-id}/subscribed_apps` | **Hard-verify** the subscription actually took (keeps `CONNECTED` only if `messages` present) | `MetaMessengerProvider.js:312`, `MetaInstagramProvider.js:240` |
| 8 | `DELETE /{page-id}/subscribed_apps` | Unsubscribe on disconnect | `MetaMessengerProvider.js:298`, `MetaInstagramProvider.js:227` |
| 9 | `POST /me/messages` (page token; `messaging_type=RESPONSE` or `MESSAGE_TAG`) | **Send the DM reply** (both FB and IG ride the Page token) | `MetaMessengerProvider.js:412`, `MetaInstagramProvider.js:339` |
| 10 | `POST /{comment-id}/private_replies` | Comment-to-DM: open a DM from a comment | `MetaMessengerProvider.js:427`, `MetaInstagramProvider.js:354` |
| 11 | `POST /{comment-id}/comments` *(FB)* | Public reply to a **Facebook** comment | `MetaMessengerProvider.js:442` |
| 12 | `POST /{comment-id}/replies` *(IG)* | Public reply to an **Instagram** comment | `MetaInstagramProvider.js:369` |
| 13 | `GET /{asset-id}` (`fields=id`) | Channel health ping | `MetaMessengerProvider.js:457`, `MetaInstagramProvider.js:384` |
| 14 | `GET /{psid}` (`fields=first_name,last_name,name,profile_pic`) | Enrich customer name/avatar after first inbound | `customer/customer-profile.service.js:88` |
| 15 | `GET graph.instagram.com/v18.0/{media-id}` (`fields=media_type,media_product_type`) | Download IG media (voice/image) for AI | `ai/voice-processing.service.js:105,113` ⚠️ see §5-G |
| — | `GET /me/businesses`, `GET /{biz}/owned_pages`, `/client_pages` | **Opt-in only**, default OFF; needs `business_management` (not requested) | `MetaMessengerProvider.js:141,160` |

There is **no** `GET /me/conversations`, **no** `GET /{post-id}/comments`, and **no**
standalone `GET /{ig-user-id}` in the codebase — inbound messages and comment content
arrive entirely via webhook (§2). The guide currently implies otherwise (§5).

---

## 2. Webhook surface — what the code actually subscribes & receives

### Receiver
- Mounted at **`POST /api/webhooks/meta`** (`app.js:157`).
- **GET `/`** verification: 403 unless `hub.mode=subscribe` + token; constant-time compare
  against `metaWebhookVerifyToken`, then per-channel token fallback (`meta-webhook.routes.js:95`).
- **POST `/`** signature: HMAC-SHA256 over the raw body vs `x-hub-signature-256`; **fails
  closed** (403) if the secret is missing or the signature is invalid (`meta-webhook.routes.js:137`).
- Only `channel.status === 'CONNECTED'` routes; otherwise the owner is nudged to reconnect
  (no AI quota burned) (`meta-webhook.routes.js:81`).

### Subscribed fields (`subscribed_fields` POSTed at connect)

| Platform | Fields sent to `subscribed_apps` | Defined in |
|----------|----------------------------------|------------|
| Facebook | `messages`, `messaging_postbacks`, `messaging_optins`, `message_deliveries`, `message_reads`, `feed` | `MetaMessengerProvider.js:33` |
| Instagram | `messages`, `messaging_postbacks`, `message_reactions`, `comments`, `live_comments` | `MetaInstagramProvider.js:37` |

IG subscription is POSTed to the **parent Page's** `subscribed_apps`
(`linked_fb_page_id`) — IG messaging rides the linked Page (`MetaInstagramProvider.js:202`).

### Parsed envelopes (what the handler acts on)
- FB (`object: 'page'`): `entry[].messaging[].message` (echoes dropped) and
  `entry[].changes[]` where `field === 'feed'` and `value.item === 'comment'`
  (`MetaMessengerProvider.js:338`).
- IG (`object: 'instagram'`): `entry[].messaging[].message` and `entry[].changes[]` where
  `field === 'comments'` (`MetaInstagramProvider.js:265`).

So of the subscribed fields, the handler only *consumes* `messages` + `feed`/`comments`
today. `messaging_optins`, `message_reactions`, `live_comments`, `message_deliveries`,
`message_reads`, `messaging_postbacks` are subscribed but have no consuming branch — see §5-F.

---

## 3. Permission → code verification (all 8 truly required)

Every requested scope maps to at least one real call above. None is requested "just in case."

| Scope | Proven by | Required? |
|-------|-----------|-----------|
| `pages_show_list` | `GET /me/accounts` builds the asset picker (#4) | ✅ direct |
| `pages_messaging` | `POST /me/messages` FB send (#9) + `GET /{psid}` profile (#14) + receive `messages` webhook | ✅ direct |
| `pages_read_engagement` | Authorizes reading the `feed` comment content delivered by webhook + the user-profile read (#14). **No explicit `GET` engagement call** — it gates webhook content, not a fetch. | ✅ (gating, not a fetch — be ready to explain) |
| `pages_manage_metadata` | `POST`/`GET`/`DELETE /{page-id}/subscribed_apps` (#6–8) | ✅ direct |
| `pages_manage_posts` | `POST /{comment-id}/comments` — FB public reply (#11) | ✅ direct |
| `instagram_basic` | `instagram_business_account{…}` nested field on `/me/accounts` (#4) | ✅ direct |
| `instagram_manage_messages` | `POST /me/messages` IG send (#9) + receive IG `messages` webhook | ✅ direct |
| `instagram_manage_comments` | `POST /{comment-id}/replies` — IG public reply (#12) + `comments` webhook | ✅ direct |

`business_management` is **not** requested: the only path that needs it (`/me/businesses`,
`owned_pages`, `client_pages`) is behind `includeBusinessPortfolio` which defaults `false`
(`meta-oauth.service.js:215` passes `false`), and a regression test asserts it is never in
the scope list (`__tests__/meta-oauth.service.test.js`). ✅ minimization holds.

---

## 4. Connect → reply flow, as the code runs it

1. **Initiate** — `POST /api/channels/meta/oauth/initiate-unified` → `buildAuthUrl` with the
   8 de-duped scopes → one Facebook Login popup (`meta-oauth.service.js:161`).
2. **Callback** — `handleUnifiedCallback`: `GET /oauth/access_token` (×2, long-lived) →
   `GET /me/accounts` → returns `{ facebookPages, instagramAccounts }` for the picker
   (`meta-oauth.service.js:201`).
3. **Connect asset** — `connectPage`: `GET /{asset-id}?fields=access_token` → upsert
   `meta_channels` → `POST /{page-id}/subscribed_apps` → **`GET subscribed_apps` hard-verify**
   → `CONNECTED` only if `messages` is really subscribed, else `ERROR` + warning
   (`meta-oauth.service.js:96`).
4. **Inbound** — Meta POSTs to `/api/webhooks/meta` → signature verified → channel resolved
   (must be `CONNECTED`) → message stored, customer name enriched via `GET /{psid}` (#14),
   AI dispatched.
5. **Reply** — confident → `POST /me/messages` auto-send; low-confidence → held + human
   sends via the same `POST /me/messages`. (Confidence gate per
   [`inbox-confidence-handoff`](../EasyMod-backend) memory.)
6. **Comment-to-DM** — `feed`/`comments` webhook → public reply (#11/#12) and/or
   `private_replies` (#10).

---

## 5. Discrepancies the reviewer guide must fix before submission

These are places where [`docs/meta-app-review.md`](./meta-app-review.md) names an endpoint
or call the code does **not** make. None changes the *scope* set (still the correct 8), but
each is a factual claim a reviewer inspecting network traffic could falsify.

- **5-A · Send endpoint label.** Guide rows 2 & 7 say `POST /{page-id}/messages` and
  `POST /{ig-user-id}/messages`. Code calls **`POST /me/messages`** with the Page token for
  *both* (#9). Same result, different literal path — change the guide to `/me/messages`.
- **5-B · `GET /me/conversations` is not called.** Guide row 2 lists it. Inbound is 100%
  webhook-driven; there is no conversation polling. **Remove it.**
- **5-C · Comment *reads* are not fetched.** Guide rows 3 & 8 list `GET /{post-id}/comments`
  and `GET /{ig-media-id}/comments`. Comment content arrives in the `feed`/`comments`
  **webhook payload**; there is no GET. Reword to "received via webhook," not a fetch.
- **5-D · FB public-reply endpoint is wrong.** Guide row 5 says `POST /{comment-id}/replies`.
  Facebook code posts to **`/{comment-id}/comments`** (#11); only **Instagram** uses
  `/replies` (#12). Split the row by platform.
- **5-E · IG basic is a nested field, not `GET /{ig-user-id}`.** Guide row 6 lists
  `GET /me?fields=instagram_business_account` and `GET /{ig-user-id}?fields=…`. Code reads
  `instagram_business_account{id,name,username,profile_picture_url}` **nested on
  `/me/accounts`** (#4). There is no standalone IG-user GET. Reword.
- **5-F · Undocumented subscribed webhook fields.** Code subscribes fields the guide never
  declares and the handler never consumes: FB `messaging_optins`; IG `messaging_postbacks`,
  `message_reactions`, `live_comments`. Either (a) document them, or (b) **trim them to what
  the handler actually reads** (`messages`, `feed`/`comments`, plus receipts if you keep
  them). Trimming is the cleaner App-Review story — fewer unexplained subscriptions.
- **5-G · Graph host/version drift in the IG media path.** `voice-processing.service.js:105,113`
  calls **`graph.instagram.com/v18.0`** while the entire rest of the integration uses
  `graph.facebook.com/v22.0` (config-driven). Pin it to the same host/version
  (`GRAPH_BASE`) so it can't age out independently and so the reviewer sees one consistent API.
- **5-H · Missing call in the matrix.** `GET /{psid}?fields=first_name,last_name,name,profile_pic`
  (#14, customer name enrichment) runs on every first inbound but is absent from the guide's
  call list. Add it under `pages_messaging` / `instagram_manage_messages`.

Recommended fix order: **5-F and 5-G are code changes** (trim fields / pin host) and should
each land with a test; **5-A–5-E and 5-H are doc edits** to `meta-app-review.md`.

---

## 6. Corrected reviewer script (generated from the code)

Use this verbatim in the submission notes / screencast narration. Every endpoint here is one
the code actually calls.

| # | Permission | What the reviewer does | Endpoint the code hits |
|---|------------|------------------------|------------------------|
| 1 | `pages_show_list` | After consent, the asset picker lists the tester's Page(s) | `GET /me/accounts` |
| 2 | `instagram_basic` | The Page's linked IG account (name + avatar) renders on the channel card | `instagram_business_account{…}` nested on `GET /me/accounts` |
| 3 | `pages_manage_metadata` | Channel card shows **Webhook: Active** (hard-verified) | `POST` then `GET /{page-id}/subscribed_apps` |
| 4 | `pages_messaging` | Tester DMs the Page → it lands in the inbox → reply is sent | inbound `messages` webhook → `POST /me/messages`; name via `GET /{psid}` |
| 5 | `instagram_manage_messages` | Tester DMs the IG account → lands in the same inbox → reply sent | inbound IG `messages` webhook → `POST /me/messages` |
| 6 | `pages_read_engagement` | Tester comments a keyword on a Page post → event received | `feed` webhook (comment content); profile read |
| 7 | `pages_manage_posts` | App posts a **public** reply to that Facebook comment | `POST /{comment-id}/comments` |
| 8 | `instagram_manage_comments` | Tester comments on IG media → public reply and/or DM | `comments` webhook → `POST /{comment-id}/replies` / `private_replies` |

**Dev-mode note (unchanged, still true):** in Development mode Meta only delivers webhooks
for accounts with a role on the app. Send the inbound DM/comment (steps 4–8) from a roster
**Tester/Admin/Developer** account, or review while Live. The connect + health-verify steps
(1–3) and the outbound sends work regardless of app mode.

**Reply demo (two acts — the confidence gate is a feature, not a caveat):** a recognized
message → AI auto-reply via `POST /me/messages` (Act 1); a vague message → held →
**human** reviews and sends via the same `POST /me/messages` (Act 2). Both acts exercise the
send permission. Narrate Act 2 as human oversight of automation.
