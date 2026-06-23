# Meta Manual Test Plan — Connect → Reply (pre-App-Review)

**App:** Easy Moderator
**Scope of this document:** the **Meta integration only** — from connecting a Facebook
Page / Instagram account through to a reply going back to the customer. Use this to test
**every path** yourself before recording the screencast and submitting for App Review.
**Graph API:** v22.0 · **Login product:** Facebook Login for Business.

This is the founder/QA test plan. The reviewer-facing guide is
[`docs/meta-app-review.md`](meta-app-review.md). Keep both in sync.

> **How to use this file:** work top-to-bottom. Each row is a test with **steps**, the
> **expected result**, and a checkbox. `[ ]` = not run, `[x]` = pass, `[!]` = fail (write
> the actual result next to it). Don't submit until every **🔴 must-pass** row is `[x]`.

---

## 0. Pre-flight — environment must be correct first

Most "it didn't work" during review is environment, not code. Verify these **before** any
functional test.

| # | Check | How | Expected | Status |
|---|-------|-----|----------|--------|
| 0.1 🔴 | App is in the right **mode** | Meta App Dashboard → top toggle | **Development** for self-test; flip to **Live** only when ready for the actual reviewer (or keep Dev and use roster accounts — see 0.2) | `[ ]` |
| 0.2 🔴 | Tester accounts are on the **App Roles** roster | App Dashboard → App Roles → Roles / Testers | The FB/IG accounts you'll DM **from** are listed as Admin / Developer / **Tester** | `[ ]` |
| 0.3 🔴 | Callback URLs registered | App Dashboard → Webhooks + App Settings → Advanced | Webhook: `https://easymod.tech/api/webhooks/meta` · Data Deletion: `https://easymod.tech/api/webhooks/meta/data-deletion` · Deauthorize: `https://easymod.tech/api/webhooks/meta/deauthorize` | `[ ]` |
| 0.4 🔴 | Server env vars set | droplet `.env.prod` | `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_WEBHOOK_APP_SECRET` all present and **match the App Dashboard exactly** | `[ ]` |
| 0.5 | Webhook fields subscribed | App Dashboard → Webhooks → Page + Instagram | Page: `messages`, `messaging_postbacks`, `feed`, `message_deliveries`, `message_reads` · IG: `messages`, `comments` | `[ ]` |
| 0.6 | App is **healthy** | `curl https://easymod.tech/health` | `200` | `[ ]` |
| 0.7 | A clean **test shop** exists | log into app | a shop you can connect a real test Page to, with ≥1 product + shop profile so the AI has something to ground on | `[ ]` |

> ⚠️ **The #1 Dev-mode gotcha:** while the app is in **Development** mode, Meta delivers
> webhook events **only** for users who have a role on the app. If you DM the test Page
> from a random account, **nothing arrives in the inbox** — that's Meta gating, not a bug.
> Always DM **from a roster account** (0.2), or test while the app is **Live**.

---

## 1. Connect — Facebook Page (OAuth)

Screen for everything below: **Settings → Chat Settings.**

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| 1.1 🔴 | Happy-path connect | Chat Settings → click **"Facebook + Instagram একসাথে সংযুক্ত করুন (one popup)"** → grant consent in the FB Login for Business popup | popup lists exactly the **8 requested scopes**, no `business_management`; on close you return to the app | `[ ]` |
| 1.2 🔴 | Scope list is correct | read the consent screen | `pages_show_list, pages_messaging, pages_read_engagement, pages_manage_metadata, pages_manage_posts, instagram_basic, instagram_manage_messages, instagram_manage_comments` — and **nothing else** | `[ ]` |
| 1.3 🔴 | Asset picker shows Pages | after consent | the **asset picker** lists your tester's Page(s) (`pages_show_list`). Pick the test Page | `[ ]` |
| 1.4 | Multiple Pages | a tester with 2+ Pages | all owned Pages appear; selecting one connects only that one | `[ ]` |
| 1.5 | Cancel consent | open popup → click **Cancel** / close it | app shows no connection, no error toast loop, no half-connected channel card | `[ ]` |
| 1.6 | Partial scope grant | on consent, **un-toggle** a permission then continue | app either re-prompts or shows the channel as **degraded / not fully usable** — it must NOT claim a healthy connect when a core scope (e.g. `pages_messaging`) was denied | `[ ]` |
| 1.7 | No eligible Page | tester account that admins no Page | clear empty state ("no Pages found"), not a crash | `[ ]` |
| 1.8 | Re-connect / idempotent | connect the same Page again | no duplicate channel row; status stays **CONNECTED**; token refreshed | `[ ]` |

> **OAuth popup note (known debt):** Chat Settings has three near-identical OAuth-popup
> handlers and a latent cleanup-timing race (tracked separately). If the popup occasionally
> doesn't auto-close or the card doesn't refresh, **reload Chat Settings** and re-check the
> health grid before calling it a failure.

---

## 2. Connect — Instagram (linked to the Page)

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| 2.1 🔴 | Linked IG renders | connect a Page that **has** an IG Business account linked | the channel card shows the IG account **name + avatar** (`instagram_basic`) under the Page | `[ ]` |
| 2.2 🔴 | IG is selectable | in the asset/IG step | the linked IG is offered and can be connected for messaging | `[ ]` |
| 2.3 | Page with **no** linked IG | connect a Page with no IG | Page connects fine; IG simply absent — no error, no fake IG card | `[ ]` |

---

## 3. Webhook subscription + health verify

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| 3.1 🔴 | Webhook = Active | after connect, look at the channel **health grid** | **Webhook: Active** — this is **hard-verified server-side** via `GET /{page-id}/subscribed_apps`, not assumed (`pages_manage_metadata`) | `[ ]` |
| 3.2 | Connection state | health grid | Connection = **Connected** | `[ ]` |
| 3.3 | Re-verify | reload Chat Settings | health grid re-queries and still shows Active | `[ ]` |
| 3.4 | Disconnect unsubscribes | hit **Disconnect** | channel status → **DISCONNECTED**; webhook subscription removed (`DELETE /{page-id}/subscribed_apps`) | `[ ]` |

---

## 4. Webhook **verification** endpoint (GET challenge)

These are deterministic — run them from a terminal. (PowerShell: use `curl.exe`.)

| # | Test | Command | Expected | Status |
|---|------|---------|----------|--------|
| 4.1 🔴 | Correct token echoes challenge | `curl "https://easymod.tech/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=<YOUR_VERIFY_TOKEN>&hub.challenge=12345"` | HTTP **200**, body = `12345` | `[ ]` |
| 4.2 🔴 | Wrong token rejected | same URL with a bogus `hub.verify_token` | HTTP **403** | `[ ]` |
| 4.3 | Missing mode rejected | drop `hub.mode=subscribe` | HTTP **403** | `[ ]` |
| 4.4 | Missing token rejected | drop `hub.verify_token` | HTTP **403** | `[ ]` |

> Token compare is **constant-time** (`crypto.timingSafeEqual`) — no length/content side channel.

---

## 5. Webhook **signature** verification (POST receiver)

The POST receiver requires a valid `X-Hub-Signature-256` = `sha256=HMAC(rawBody, META_WEBHOOK_APP_SECRET)`.

| # | Test | Command | Expected | Status |
|---|------|---------|----------|--------|
| 5.1 🔴 | Bad/missing signature rejected | `curl -X POST https://easymod.tech/api/webhooks/meta -H "Content-Type: application/json" -d '{"object":"page","entry":[]}'` (no signature header) | HTTP **403** — unauthenticated payloads are rejected | `[ ]` |
| 5.2 | Valid signature accepted | only Meta (or a script that signs with the real secret) can produce this | HTTP **200** and the event dispatches | `[ ]` (verified live via real DMs in §6) |

> If the secret is **missing** on the server, the receiver returns **403** by design (fails
> closed) — it never accepts unsigned payloads.

---

## 6. Inbound message → Shared Inbox

DM **from a roster account** (see 0.2). Expect each message in the inbox within a few seconds.

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| 6.1 🔴 | Messenger DM lands | from roster account, DM the test Page | message appears in **Shared Inbox** (`pages_messaging`, webhook `messages`) | `[ ]` |
| 6.2 🔴 | Instagram DM lands | DM the connected IG account | appears in the same inbox alongside Messenger threads (`instagram_manage_messages`) | `[ ]` |
| 6.3 | Photo / attachment | send an image DM | image is received and reaches the AI (inbound photos are supported) | `[ ]` |
| 6.4 | Rapid burst | send 3 quick messages | they **coalesce** into one AI turn (~8s window), not three replies | `[ ]` |
| 6.5 | Non-roster sender (Dev mode) | DM from an account **not** on the roster | message does **not** arrive — expected Meta gating, **not** a defect (document this in the screencast narration) | `[ ]` |
| 6.6 | DM to a **disconnected** channel | disconnect, then DM the Page | no AI job is burned; the owner is nudged (SSE) to reconnect — no crash, no phantom reply | `[ ]` |

---

## 7. AI reply — Act 1: confident → auto-reply 🔴

> **§7 and §8 are a deliberate two-act demo of one feature — the confidence gate. Film both,
> in order.** This is a selling point, not a caveat: the AI **auto-replies when it's sure**
> (Act 1), and **defers to a human when it isn't** (Act 2). Act 1 proves the AI can send on
> its own; Act 2 proves the business stays in control. Narration:
> *"When the AI is confident it replies automatically; when it isn't, it routes the
> conversation to a human. The business stays in control."*
>
> **Make Act 1 fire reliably on camera** (Meta's reviewer flow specifically wants to see one
> clean auto-reply round-trip): send a message the AI is confident about — a greeting
> (`hi`, `hello`, `আসসালামু আলাইকুম`) or a question about a **seeded product/FAQ**
> (price/availability of a product in the test shop). Confident paths clear the **75%**
> default threshold and auto-send; only the generic fallback (~30%) defers. *(If you'd
> rather not think about wording, temporarily lower the test shop's `confidence_threshold`.)*

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| 7.1 🔴 | Recognized → auto-reply sent | DM a greeting or a seeded-product question | AI reply is **delivered back to the sender** (`POST /{page-id}/messages` or `/{ig-user-id}/messages`); appears in the thread as a sent AI message | `[ ]` |
| 7.2 🔴 | IG auto-reply | same from IG | reply delivered on IG | `[ ]` |
| 7.3 | Auto-reply does **not** show a redundant "suggestion" | open that thread in the inbox | **no** "AI's reply — Send this" panel for the already-sent reply (it's redundant — the customer already has it) | `[ ]` |
| 7.4 | Grounded answer | ask price/availability of a **seeded** product | answer uses real product/shop data, doesn't hallucinate price/stock | `[ ]` |

---

## 8. AI reply — Act 2: low confidence → human handoff 🔴

> The other half of the demo, and the stronger half for Meta: **when the AI isn't sure, it
> doesn't guess.** It holds its draft, reassures the customer, and routes the conversation to
> a human who reviews and sends. Demo it as **human oversight of automation**, not a failure.
> Note the send permission is still exercised here — the holding message **and** the human's
> reply both go out via `POST /messages`.

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| 8.1 🔴 | Low confidence → handoff, not auto-send | DM something vague/off-topic the AI can't ground | AI reply is **held** (not sent to customer); conversation flips to **human (HITL)** | `[ ]` |
| 8.2 🔴 | Customer gets a holding message | as customer | a short "a representative will reply shortly" message is delivered — customer is not left in silence | `[ ]` |
| 8.3 🔴 | Inbox shows the held draft | open thread in inbox | the **"AI's reply — Send this"** panel appears (only for the HELD draft) with a **"Low confidence — verify before sending"** note | `[ ]` |
| 8.4 | Panel survives the holding message | look at the same thread | the panel surfaces the **held draft**, not the delivered holding message | `[ ]` |
| 8.5 🔴 | Human reviews and sends | click **Send this** (or edit, or ignore) | the reviewed reply goes to the customer (`POST /messages`); panel clears — completes the oversight loop on camera | `[ ]` |

---

## 9. Human manual reply (compose → send)

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| 9.1 🔴 | Manual reply delivers | open a thread, type a reply, **Send** | message delivered to the customer on the correct platform (FB/IG); appears as an agent message | `[ ]` |

---

## 10. 24-hour messaging window + message tags

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| 10.1 | Warning near 24h | thread last active ~23h ago | inbox shows "time to reply directly is almost up" warning | `[ ]` |
| 10.2 🔴 | Expired window blocks free-form | thread last active >24h ago | compose is **disabled** until a **message tag** is selected; sending requires a tag (e.g. `ACCOUNT_UPDATE`) | `[ ]` |
| 10.3 | Tagged send works | pick a tag, type, send | message sends with `message_tag` | `[ ]` |

---

## 11. Comment-to-DM automation (optional but submitted)

Powers `pages_manage_posts` / `pages_read_engagement` / `instagram_manage_comments`.

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| 11.1 | FB comment trigger | comment a configured keyword on a test Page **post** | event received (`pages_read_engagement`); a **public reply** is posted (`pages_manage_posts`) and/or a DM fires | `[ ]` |
| 11.2 | IG comment trigger | comment a keyword on test IG **media** | event received; public reply / DM (`instagram_manage_comments`) | `[ ]` |

---

## 12. Disconnect / reconnect lifecycle

| # | Test | Steps | Expected | Status |
|---|------|-------|----------|--------|
| 12.1 | Disconnect | Chat Settings → Disconnect | status → DISCONNECTED, webhook unsubscribed (also §3.4) | `[ ]` |
| 12.2 | Inbound after disconnect | DM the Page | routed to the null branch → owner nudged to reconnect, no AI spend (also §6.6) | `[ ]` |
| 12.3 | Reconnect restores | connect again | CONNECTED, Webhook Active, inbound + auto-reply resume | `[ ]` |

---

## 13. GDPR — Data Deletion callback 🔴

Meta requires this to work. The callback verifies the `signed_request` signature, cascades
the delete, and returns a confirmation code.

| # | Test | How | Expected | Status |
|---|------|-----|----------|--------|
| 13.1 🔴 | Endpoint live | `curl -X POST https://easymod.tech/api/webhooks/meta/data-deletion -d "signed_request=bogus"` | **403** "Invalid signed_request signature" (rejects unsigned/forged before touching data) | `[ ]` |
| 13.2 🔴 | Real deletion via Meta | App Dashboard → remove the app from a test user's FB settings, **or** Meta's "Send Test" for the data-deletion callback | HTTP **200** with `{ url, confirmation_code: "DEL-..." }`; the customer's conversations/messages/orders are deleted and PII (name/phone/email) nullified | `[ ]` |
| 13.3 | Idempotent retry | trigger the same deletion twice | second call returns **200 + same confirmation_code**, no error (Redis 24h idempotency) | `[ ]` |

---

## 14. GDPR — Deauthorize callback

| # | Test | How | Expected | Status |
|---|------|-----|----------|--------|
| 14.1 🔴 | Endpoint live | revoke the app's access (without full deletion), or Meta "Send Test" for deauthorize → `POST /api/webhooks/meta/deauthorize` | **200**; the customer record is marked `metadata.deauthorized = true` (record kept, access revoked) | `[ ]` |

---

## 15. Public compliance pages (reviewer will open these)

| # | Test | Command / Step | Expected | Status |
|---|------|----------------|----------|--------|
| 15.1 🔴 | Privacy Policy loads | `curl -I https://easymod.tech/privacy-policy` | **200**, real privacy content renders in a browser | `[ ]` |
| 15.2 🔴 | Data-deletion instructions page | open the user-facing data-deletion URL registered in the Dashboard | loads (200), explains how a user deletes their data | `[ ]` |
| 15.3 | App name / icon / category | App Dashboard → Settings → Basic | matches a real, consistent brand (no placeholder) | `[ ]` |

---

## 16. Permission ↔ feature coverage (every scope must be demonstrably used)

Tick each once you've seen it exercised above. If any scope can't be demonstrated, it
should be **removed** from the request, not submitted.

| Scope | Demonstrated by | Status |
|-------|-----------------|--------|
| `pages_show_list` | §1.3 asset picker lists Pages | `[ ]` |
| `pages_messaging` | §6.1 inbound + §7.1 auto-reply (Messenger) | `[ ]` |
| `pages_read_engagement` | §11.1 comment event received / receipts | `[ ]` |
| `pages_manage_metadata` | §3.1 Webhook Active (subscribe/verify) | `[ ]` |
| `pages_manage_posts` | §11.1 public reply to a Page comment | `[ ]` |
| `instagram_basic` | §2.1 linked IG name + avatar render | `[ ]` |
| `instagram_manage_messages` | §6.2 inbound + §7.2 auto-reply (IG) | `[ ]` |
| `instagram_manage_comments` | §11.2 IG comment event + reply | `[ ]` |
| `business_management` | **NOT requested** — confirm it never appears on the consent screen | `[ ]` |

---

## 17. Final pre-submission checklist

- [ ] Every **🔴 must-pass** row above is `[x]`.
- [ ] Screencast recorded at ≥1280×720, narrated in English, follows the beats in
      [`docs/meta-app-review.md`](meta-app-review.md) §4.
- [ ] Screencast **states the Dev-mode roster caveat** out loud when sending the inbound DM.
- [ ] The reply demo shows **both acts**: a recognized message → auto-reply (§7), then a
      vague one → human handoff → human sends (§8). Narrate the handoff as **human
      oversight**, not a failure. Make sure Act 1 uses a recognized message so it fires.
- [ ] Tester credentials + live test URL are in the submission notes.
- [ ] Callback URLs (webhook, data-deletion, deauthorize) saved + verified in the Dashboard.
- [ ] Permission-justification text matches the 8 scopes (no `business_management`).
- [ ] After review/approval, flip the app to **Live** so webhooks fire for all users.

---

### Known caveats to keep in mind during testing (not bugs)

1. **Dev-mode webhooks only fire for roster accounts** (§0.2, §6.5). Most "inbound didn't
   arrive" reports are this.
2. **Low-confidence messages hand off to a human instead of auto-replying** (§7–§8). This is
   the confidence-gate **feature** (human oversight), not a bug — demo it as a two-act story.
   Just make sure the auto-reply act (§7) uses a recognized message so it fires on camera.
3. **The holding/handoff message has no 🤖 bot-attribution suffix** (same as the existing
   sentiment-escalation path). Pre-existing; flag if you want attribution added before
   submission.
4. **OAuth popup occasionally needs a Chat Settings reload** to refresh the health grid
   (known popup-handler debt). Reload before declaring a connect failure.
