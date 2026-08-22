# Meta App Review — Master Guide (Dashboard → Submit)

**App:** EasyModerator · **App ID:** `2040799330176198` (Dashboard display name still reads `saas-easymod`; rename before recording)
**Legal entity:** Hexabyte Technologies (Bangladesh)
**Business Verification:** ✅ **Verified** — HexaByte Technologies, ID `1268762121859445`.
**Access Verification (Tech Provider):** ⛔ **NOT STARTED — deadline 2026-10-19.** This is a
*second, separate* Meta gate, confirmed in the dashboard on 2026-08-20. App Review does not
satisfy it and it does not satisfy App Review. See §1a.
**Last updated:** 2026-08-20
**Source of truth for this document:** the shipped frontend
(`EasyMod-frontend/src`). Where a doc and the UI disagree, the UI wins and the
doc is wrong.

This is the single runbook from opening the App Dashboard to pressing Submit.
Paste-ready field values live in [meta-app-review-submission.md](meta-app-review-submission.md).
The recording script lives in
[screencast-storyboards.md](../EasyMod-backend/.easymod/meta-app-review/screencast-storyboards.md).

---

## 0. What we are asking for

Exactly three permissions, no more:

| Permission | Why we need it | Where the reviewer sees it |
|---|---|---|
| `pages_show_list` | List the Pages the merchant authorised, so they can pick one to connect | Page picker after Facebook Login |
| `pages_messaging` | Receive customer DMs via the `messages` webhook and send replies | Shared Inbox — message in, reply out |
| `pages_manage_metadata` | Subscribe/verify/unsubscribe the Page's `messages` webhook | "Webhook: Active" health row on the connected card |

Webhook subscription: **`messages` on the `page` object only.**

**Not requested, not implemented:** `pages_read_engagement`,
`pages_manage_engagement`, `business_management`, every `instagram_*` scope,
every `whatsapp_*` scope.

The frontend states the same three permissions in two merchant-visible places —
Chat Settings → *"What permissions are needed?"*
([ChatSettings.tsx:602-613](../EasyMod-frontend/src/app/components/ChatSettings.tsx#L602-L613))
and the public Privacy Policy permissions table
([PrivacyPolicy.tsx:230-256](../EasyMod-frontend/src/app/components/PrivacyPolicy.tsx#L230-L256)).
Reviewers check that the app's own disclosures match the request. They do.

**Facebook-only launch.** Instagram was removed from product scope; there is no
Instagram code path in the frontend. Comment automation, Comment-to-DM, `feed`
webhooks, and public comment replies do not exist in this build, and the Terms
of Service says so explicitly
([TermsOfService.tsx:70-71](../EasyMod-frontend/src/app/components/TermsOfService.tsx#L70-L71)).

---

## 1. Running order

Business Verification is done. Two gates remain, and they run **in parallel** —
start row 1 today, because it has the only external deadline in the list.

| # | Step | Gate |
|---|---|---|
| 1 | **Start Access Verification (Tech Provider) — §1a. Do this first; it runs in the background while you do everything else.** | ~5 days · **deadline 2026-10-19** |
| 2 | Confirm Dashboard config matches §2 | 30 min |
| 3 | Set up reviewer merchant account + test Page + tester customer (§3) | 1 hour |
| 4 | Run the pre-flight dry run (§4) | 30 min — **do not skip** |
| 5 | Record the screencast (§5 + storyboard doc) | 1 hour |
| 6 | Fill permission justifications + upload video + submit (§6) | 30 min |
| 7 | Answer a Data Protection Assessment if one arrives | days |
| 8 | Switch the app to **Live** mode after approval **and** Tech Provider verification | — |

---

## 1a. Access Verification (Tech Provider) — start this first

Confirmed in the dashboard 2026-08-20 and previously undocumented in this guide.

Because EasyModerator connects **other businesses'** Pages, `pages_show_list`
falls in the dashboard's Tech-Provider-gated section. Until HexaByte
Technologies is verified as a Tech Provider, any merchant who does not hold a
role on the app fails with Graph **error code 100** the moment the app leaves
Development mode — i.e. every real customer. The dashboard warns:

> To avoid restrictions to 1 app, this must be completed by **10/19/2026**.

**Where:** App settings → Basic → Business portfolio → Access verification →
*View details* → **Start verification**
(<https://developers.facebook.com/1268762121859445/access-verification/>)
**Who:** a Business admin of HexaByte Technologies. An app role is not enough.
**Answer from:** `permissions-justification.md`, so the story matches §6.
**Turnaround:** ~5 days.

Prerequisites are already met (business verified, no account restrictions), so
this is a form-fill and a wait. Nothing else in this guide blocks on it, and it
blocks going Live — which is exactly why it goes first.

Full procedure: `.easymod/meta-app-review/business-verification.md` §6.

---

## 2. App Dashboard configuration

Full paste values: [meta-app-review-submission.md](meta-app-review-submission.md).
The four that cause silent failures:

**Valid OAuth Redirect URI** — `https://app.easymod.tech/channels/oauth-callback`

Must match production `META_OAUTH_REDIRECT_URI` character for character. The
frontend opens this in a 600×700 popup and the callback route is deliberately
mounted *outside* the authenticated shell
([routes.ts:152-157](../EasyMod-frontend/src/app/routes.ts#L152-L157)), so the
popup loads a bare spinner and posts the result back. Use the **apex** domain
everywhere — `www.easymod.tech` 301-redirects, and Meta treats a 301 as a
mismatch.

**Terms of Service URL** — `https://easymod.tech/terms`

The router defines `/terms`, not `/terms-of-service`
([routes.ts:130-134](../EasyMod-frontend/src/app/routes.ts#L130-L134)). The
wrong path hits the catch-all NotFound and reads as a dead legal link.

**Privacy Policy URL** — `https://easymod.tech/privacy-policy`

Public, unauthenticated route ([routes.ts:125-129](../EasyMod-frontend/src/app/routes.ts#L125-L129)).

**Webhook** — `messages` field on `page`, callback `https://api.easymod.tech/webhooks/meta`.
After saving, prove the verify-token handshake with item 5 of
[compliance-checklist.md](../EasyMod-backend/.easymod/meta-app-review/compliance-checklist.md).
A token mismatch fails "Verify and Save" with no useful error.

---

## 3. Reviewer access

Meta reviews from outside your session. Everything below must work in a fresh
incognito window with no prior state.

- [ ] Reviewer merchant account created, credentials entered in the Dashboard's
      **dedicated test-credentials fields** — not only in the notes box.
- [ ] **Two-factor auth OFF** on that account. Sign-in routes to `/2fa-verify`
      when 2FA is enabled ([SignIn.tsx:56-61](../EasyMod-frontend/src/app/components/SignIn.tsx#L56-L61))
      and the reviewer cannot receive your code. This alone fails a submission.
- [ ] Subscription active (trial or Growth). A `suspended` / `trial_expired` /
      `past_due` state paints a billing banner on the Subscription page
      ([Subscription.tsx:542](../EasyMod-frontend/src/app/components/Subscription.tsx#L542)).
- [ ] Conversation usage **below 75%** — at or above that the app shows an
      upgrade banner across every dashboard page
      ([ConversationAlertBanner.tsx:40-42](../EasyMod-frontend/src/app/components/ConversationAlertBanner.tsx#L40-L42)).
      An upsell banner in a review video invites questions you do not want.
- [ ] Shop has ≥3 active products and business info filled — otherwise
      `/dashboard` renders the first-run setup checklist instead of the real
      dashboard ([Dashboard.tsx](../EasyMod-frontend/src/app/components/Dashboard.tsx)),
      and the app looks empty.
- [ ] Test Facebook Page + tester customer account both accepted into
      **App Roles → Testers**. In Development mode a non-tester's DM never fires
      the webhook. A *pending* invite does not count — it must be accepted from
      those accounts.
- [ ] UI language set to **English** via the sidebar toggle. Language comes from
      `localStorage.easymod_lang` with an `en` fallback
      ([i18n/index.ts:20-24](../EasyMod-frontend/src/i18n/index.ts#L20-L24)); a
      clean profile is English, your working profile may not be.

Reviewer path, verbatim for the notes box:

> `https://app.easymod.tech/signin` → sign in → left sidebar, under
> **SETTINGS**, click **Chat** → `https://app.easymod.tech/manage-shop/chat-settings`

Give the clean path. `/app/...` legacy URLs still redirect
([routes.ts:79-87](../EasyMod-frontend/src/app/routes.ts#L79-L87)) but a
redirect on a reviewer's first click is a needless risk.

---

## 4. Pre-flight dry run — do this the day you record

Run the whole flow once, for real, before recording. Most rejected videos are
recordings of a flow that broke on camera.

1. Sign in to the reviewer account in a clean browser profile.
2. Chat Settings → **Disconnect** any connected Page and confirm the modal. The
   video must start from zero connections; the picker greys out and badges
   already-connected Pages
   ([ChatSettings.tsx:513-552](../EasyMod-frontend/src/app/components/ChatSettings.tsx#L513-L552)),
   and the connect button relabels itself to *"Add another Facebook Page"*.
3. Connect the test Page. Confirm the health grid reads **Connection: Connected**
   and **Webhook: Active**.
4. Press **Test** on the channel card. You want the `Webhook OK (…ms)` toast, not
   the failure toast.
5. Send a DM from the tester customer account. Confirm it lands in the Inbox.
6. Reply from the Inbox. Confirm it arrives in Messenger.
7. Disconnect again, so the recording can start clean.

**Decide the reply mode before recording.** Settings → **Business Info** →
*Reply Settings* is where automation mode lives
([BusinessInfoSettings.tsx:81-85](../EasyMod-frontend/src/app/components/BusinessInfoSettings.tsx#L81-L85)),
not Chat Settings. Default is **"Review first"** (draft), and the automated-
assistant disclosure is attached **only to the first auto-sent reply** —
the UI states plainly that *"Draft/manual suggestions do not include it"*
([AISettingsForm.tsx:289-293](../EasyMod-frontend/src/app/components/AISettingsForm.tsx#L289-L293)).

So: if the narration says "the customer is told they are talking to an automated
assistant", the account must be in **"Send automatically"** mode for that shot,
or the reviewer sees a claim the screen does not support. Either switch the mode
before recording, or drop the disclosure claim and film the draft-approval flow
instead. Both are honest; a mismatch is not.

---

## 5. The video — rules that decide approval

Full shot-by-shot script:
[screencast-storyboards.md](../EasyMod-backend/.easymod/meta-app-review/screencast-storyboards.md).
The rules that decide pass/fail:

### Do

- **Capture the full desktop, not a single browser tab.** The Facebook consent
  dialog opens in a separate 600×700 popup window
  ([ChatSettings.tsx:177-181](../EasyMod-frontend/src/app/components/ChatSettings.tsx#L177-L181)).
  A tab-scoped recording misses it — and a video without the consent screen is
  the single most common rejection.
- **One continuous unedited take.** Cuts read as "the failure is in the gap".
- **Show both sides.** Messenger (customer) and EasyModerator (merchant) in the
  same frame, or alternate without cutting.
- **Send a unique text message and show that exact text arriving**, then reply
  and show that exact reply landing. This is the entire proof for
  `pages_messaging`; attachments and screenshots do not substitute.
- **Narrate in English**, voice-over or burnt-in captions. Bengali UI is fine
  and honest — but here, run the UI in English too.
- **1280×720 minimum**, inbox text legible.
- Name each permission out loud at the moment the screen shows it being used.

### Do not

- **Do not show comment automation, Comment-to-DM, `feed` events, public comment
  replies, or private replies to comments.** None exist in this build; showing a
  mock-up is grounds for rejection and for a policy strike.
- **Do not show Instagram or WhatsApp** anywhere on screen — no tabs, no
  connector cards, no marketing slides.
- **Do not tap a "Get Started" or persistent-menu button.** Postbacks are not
  subscribed, so it produces silence and looks broken.
- **Do not demo a reply after the 24-hour window.** The composer disables itself
  and shows *"Meta's 24-hour messaging window has expired…"*
  ([inbox i18n `outsideWindowDisabled`](../EasyMod-frontend/src/i18n/locales/en.json)).
  Correct behaviour — but on camera it looks like a bug. Message the Page fresh
  right before recording.
- **Do not show a real merchant's Page, a real customer's name, or a real order.**
- **Do not show the Subscription page, upgrade prompts, or the usage banner.**
- **Do not show browser bookmarks, notifications, or unrelated tabs.** Clean
  profile only.
- **Do not splice, speed-ramp, or add background music.**

---

## 6. Submitting

1. Upload the **same video against all three permissions** — Meta allows it, and
   three short clips are weaker than one complete flow.
2. Paste the permission-use text from
   [meta-app-review-submission.md §Permission Use Text](meta-app-review-submission.md)
   verbatim, appending the timestamp where that permission is exercised (table
   at the end of the storyboard doc).
3. Paste the **Notes to Reviewer** block from the same file. It pre-empts the
   three behaviours that otherwise read as defects: unsubscribed postbacks;
   `POST_PURCHASE_UPDATE` attached to out-of-window AI/system order-support
   follow-ups (still requires live Page verification before it is presented as
   delivery evidence); and out-of-window manual/agent replies being blocked
   outright rather than tagged, pending a separate `HUMAN_AGENT` permission
   request this app has not made.
4. Final acceptance sweep (§7).
5. Submit. Then leave the app in Development mode until approval lands — the
   tester accounts keep working.

---

## 7. Acceptance checklist

Verification gates

- [x] Business Verification — HexaByte Technologies, ID `1268762121859445`, Verified (2026-08-20)
- [ ] **Access Verification (Tech Provider) — NOT STARTED, deadline 2026-10-19** (§1a).
      Blocks going Live independently of App Review.

Configuration

- [ ] Dashboard requests only `pages_show_list`, `pages_messaging`, `pages_manage_metadata`
- [ ] Page webhook subscription contains `messages` and nothing else
- [ ] No `pages_read_engagement` / `pages_manage_engagement` / `business_management` /
      `instagram_*` **in the review request**. They cannot be removed from the dashboard
      — every Business app carries them at Standard access, and ours has live traffic on
      several (checked 2026-08-20). The request is what must stay clean.
- [ ] Redirect URI matches `META_OAUTH_REDIRECT_URI` exactly, apex domain
- [ ] Terms URL is `/terms`; Privacy URL is `/privacy-policy`; both load logged out
- [ ] Data-deletion and deauthorize callbacks configured
- [ ] App icon uploaded (`EasyMod-frontend/public/icon-1024.png`, 1024×1024)
- [ ] Webhook verify-token handshake self-checked
- [ ] **Data Use Checkup completed** — Meta requires it on all three permissions and
      the submission gate will not open without it (`devtools_app_review requirements`)
- [ ] **API pre-check cleared for `pages_messaging`** — needs at least one successful
      live call. Verify with `devtools_api_usage call_volume`; `total_calls` must be
      non-zero
- [ ] **Test Page designated** in the Dashboard for `pages_messaging`
- [ ] App display name reads **EasyModerator**, not `saas-easymod` — that name is on
      the consent dialog the screencast records
- [ ] Contact email verified; app description and short description filled in
- [ ] GitHub secret `VITE_META_APP_ID` equals the submitted App ID. CI feeds it to
      both the frontend and the backend (`ci-cd.yml:187,336`), so a wrong value aims
      the entire OAuth flow at a different app

Reviewer account

- [ ] Credentials in the Dashboard test-credentials fields
- [ ] 2FA disabled · subscription active · usage under 75%
- [ ] Products and business info populated
- [ ] Test Page and tester customer accepted as Testers
- [ ] Reply mode matches what the narration claims

Video

- [ ] Full-desktop capture, one take, ≥720p, English narration
- [ ] Facebook consent dialog visible and readable
- [ ] Page picker shows only merchant-authorised Pages
- [ ] Webhook health row visible after connect
- [ ] Unique inbound text → same text in Inbox
- [ ] Merchant reply → same text in Messenger
- [ ] Disconnect shown
- [ ] No comments, no Instagram, no WhatsApp, no postbacks, no billing surfaces

Submission

- [ ] Same video attached to all three permissions, with timestamps
- [ ] Permission-use text pasted verbatim
- [ ] Notes to Reviewer pasted verbatim

---

## 8. Why a first-pass approval is realistic

The three usual rejection causes are already closed:

1. **Over-asking.** We request three permissions and the code path uses exactly
   three — the app's own permission disclosure and privacy policy list the same
   three, so nothing contradicts the request.
2. **Unproven use.** The video shows every permission in the act of being used,
   in one take, on both sides of the conversation.
3. **Scope contradictions.** No Instagram, no comment automation, no postbacks
   anywhere in the frontend, and the Terms of Service disclaims them in writing.

What is left to get wrong is operational, not architectural: a missed consent
dialog, a 2FA prompt, an expired messaging window, an upsell banner. §3 and §4
exist to close exactly those.

## Canonical files

| Purpose | Path |
|---|---|
| This runbook | `docs/META_APP_REVIEW_MASTER_GUIDE.md` |
| Dashboard values + permission text | `docs/meta-app-review-submission.md` |
| Video script | `EasyMod-backend/.easymod/meta-app-review/screencast-storyboards.md` |
| Reviewer-facing guide | `docs/meta-app-review.md` |
| Permission justifications (long form) | `EasyMod-backend/.easymod/meta-app-review/permissions-justification.md` |
| Business verification record | `EasyMod-backend/.easymod/meta-app-review/business-verification.md` |
| Test accounts | `EasyMod-backend/.easymod/meta-app-review/test-user-credentials.md` |
| Data deletion mechanics | `EasyMod-backend/.easymod/meta-app-review/data-deletion-flow.md` |
| Readiness evidence | `EasyMod-backend/.easymod/meta-app-review/compliance-checklist.md` |
