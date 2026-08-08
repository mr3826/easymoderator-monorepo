# Meta App Review Master Guide

**App:** EasyModerator
**Legal entity:** Hexabyte Technologies (Bangladesh) — <https://hexabyte.tech>
**Last updated:** 2026-07-28

EasyModerator launches with Facebook Page Messenger DMs only. Customers must
message the Page directly. The app does not read Page post comments, subscribe
to `feed`, send public comment replies, or trigger workflows from comments.

This file is the index and the running order. Each step links to the document
that actually contains the detail.

---

## Requested Scope

Requested permissions:

- `pages_show_list`
- `pages_messaging`
- `pages_manage_metadata`

Webhook field:

- `messages` on the `page` object

Not requested:

- `pages_read_engagement`
- `pages_manage_engagement`
- `business_management`
- Any `instagram_*` permission

Source of truth is `DEFAULT_SCOPES` / `WEBHOOK_FIELDS` in
`EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js:27-35`.
Regression tests assert the negative set. If a document ever disagrees with that
constant, the constant wins.

---

## Running order

These are not strictly sequential — steps 1 and 4 should overlap, because Meta's
two review queues run independently and business verification is the long pole.

| # | Step | Owner | Document |
|---|---|---|---|
| 1 | **Business Verification** (Trade License etc.) | Founder | `EasyMod-backend/.easymod/meta-app-review/business-verification.md` |
| 2 | Domain verification for `easymod.tech` | Founder | same file, §2 |
| 3 | Configure the App Dashboard | Founder | `EasyMod-backend/.easymod/meta-app-review/dashboard-setup-walkthrough.md` + `docs/meta-app-review-submission.md` |
| 4 | Create test accounts and Page | Founder | `EasyMod-backend/.easymod/meta-app-review/test-user-credentials.md` |
| 5 | Record the screencast | Founder | `EasyMod-backend/.easymod/meta-app-review/screencast-storyboards.md` |
| 6 | Submit App Review | Founder | `docs/meta-app-review-submission.md` |
| 7 | Answer a Data Protection Assessment if one arrives | Founder | `business-verification.md` §5 |
| 8 | Switch the app to Live mode | Founder | after 1 and 6 both clear |

## Canonical Files

| Purpose | Path |
|---|---|
| Reviewer-facing guide | `docs/meta-app-review.md` |
| Dashboard values + permission text | `docs/meta-app-review-submission.md` |
| Business verification (BD Trade License) | `EasyMod-backend/.easymod/meta-app-review/business-verification.md` |
| Permission justifications | `EasyMod-backend/.easymod/meta-app-review/permissions-justification.md` |
| Dashboard setup walkthrough | `EasyMod-backend/.easymod/meta-app-review/dashboard-setup-walkthrough.md` |
| Screencast storyboard + narration script | `EasyMod-backend/.easymod/meta-app-review/screencast-storyboards.md` |
| Test accounts + reviewer credentials | `EasyMod-backend/.easymod/meta-app-review/test-user-credentials.md` |
| Data deletion mechanics | `EasyMod-backend/.easymod/meta-app-review/data-deletion-flow.md` |
| Readiness checklist with evidence | `EasyMod-backend/.easymod/meta-app-review/compliance-checklist.md` |
| Current readiness assessment | `docs/launch-readiness/2026-07-28-meta-app-review-readiness.md` |

> An earlier audit (`docs/launch-readiness/2026-07-26/07_META_REVIEW_PACKAGE_AUDIT.md`)
> reported that `.easymod/meta-app-review/` "does not exist" and that no
> screencast storyboard or test-user documentation existed. That was a
> path error — the directory is under `EasyMod-backend/`, and all three files
> were present. Its findings F-08 and F-09 should be read as "not verified"
> rather than "missing".

## Reviewer Demo

1. Sign in to EasyModerator.
2. In the left sidebar under **SETTINGS**, click **Chat**
   (direct URL: `https://app.easymod.tech/manage-shop/chat-settings`).
3. Connect the supplied Facebook Page.
4. Show the OAuth dialog requesting the three permissions.
5. Select the Page in the picker.
6. Show webhook active state.
7. Send a direct Messenger DM to the Page from the tester customer account.
8. Show the DM in Shared Inbox.
9. Show AI reply with the automated-assistant disclosure.
10. Send a manual reply and show it arriving on the customer's side.

Do not demonstrate comments or Page post automation. Do not tap a "Get Started"
or persistent-menu button — postbacks are not subscribed and produce silence.

## Acceptance Checklist

- [ ] Meta App Dashboard requests only the three permissions listed above.
- [ ] Page webhook subscription contains `messages` only.
- [ ] Privacy policy lists only the three permissions.
- [ ] Terms URL is `/terms` — **not** `/terms-of-service`, which 404s.
- [ ] App icon uploaded (`EasyMod-frontend/public/icon-1024.png`).
- [ ] Business Verification submitted.
- [ ] Webhook verify token handshake self-checked (`compliance-checklist.md`, item 5).
- [ ] Screencast shows the direct Messenger DM flow only, with a real text
      message out **and** the exact reply arriving back.
- [ ] No UI or docs promise Comment-to-DM.
- [ ] App Roles tester account is used for Development-mode inbound DM testing.
- [ ] Reviewer credentials entered in the App Dashboard fields.
