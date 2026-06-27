# Superseded Audit: Instagram Removal And Launch Readiness

**Original date:** 2026-06-24
**Superseded on:** 2026-06-27

This audit is retained only as historical context for the Instagram removal work. It has been superseded by the Messenger-only launch scope.

Current launch scope:

- Facebook Page Messenger DMs only.
- Customers must message the Page directly.
- No Comment-to-DM.
- No Page post comment triggers.
- No public comment replies.
- No `feed` webhook subscription.
- No Instagram product surface.

Current Meta App Review request:

- `pages_show_list`
- `pages_messaging`
- `pages_manage_metadata`

Current webhook subscription:

- `messages` on the `page` object only.

Do not use the original 2026-06-24 scope notes for App Review or launch decisions.
