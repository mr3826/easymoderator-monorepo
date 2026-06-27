# Meta App Review Master Guide

**App:** Easy Moderator
**Last updated:** 2026-06-27 (Messenger-only launch; Comment-to-DM removed)

Easy Moderator launches with Facebook Page Messenger DMs only. Customers must message the Page directly. The app does not read Page post comments, subscribe to `feed`, send public comment replies, or trigger workflows from comments.

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

## Reviewer Demo

1. Sign in to Easy Moderator.
2. Open **Settings -> Chat Settings**.
3. Connect the supplied Facebook Page.
4. Show the OAuth dialog requesting the three permissions.
5. Select the Page in the picker.
6. Show webhook active state.
7. Send a direct Messenger DM to the Page from the tester customer account.
8. Show the DM in Shared Inbox.
9. Show AI reply with automated-assistant disclosure.
10. Send a manual reply.

Do not demonstrate comments or Page post automation.

## Canonical Files

- Reviewer guide: `docs/meta-app-review.md`
- Submission sheet: `docs/meta-app-review-submission.md`
- Permission justifications: `EasyMod-backend/.easymod/meta-app-review/permissions-justification.md`
- Dashboard setup: `EasyMod-backend/.easymod/meta-app-review/dashboard-setup-walkthrough.md`
- Screencast storyboard: `EasyMod-backend/.easymod/meta-app-review/screencast-storyboards.md`

## Acceptance Checklist

- [ ] Meta App Dashboard requests only the three permissions listed above.
- [ ] Page webhook subscription contains `messages` only.
- [ ] Privacy policy lists only the three permissions.
- [ ] Screencast shows direct Messenger DM flow only.
- [ ] No UI or docs promise Comment-to-DM.
- [ ] App Roles tester account is used for Development-mode inbound DM testing.
