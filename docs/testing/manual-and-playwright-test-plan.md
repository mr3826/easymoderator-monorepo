# Manual And Playwright Test Plan

**Last updated:** 2026-06-27 (Messenger-only launch; Comment-to-DM removed)

## Meta Scope

Easy Moderator supports Facebook Page Messenger DMs only for initial launch.

Required permissions:

- `pages_show_list`
- `pages_messaging`
- `pages_manage_metadata`

Webhook field:

- `messages`

Do not test or document Comment-to-DM, Page post comment triggers, public comment replies, or `feed` webhooks for launch.

## Core Manual QA

1. Sign in as a merchant.
2. Connect a Facebook Page from **Settings -> Chat Settings**.
3. Confirm OAuth requests only the three permissions above.
4. Confirm the connected channel card shows webhook active.
5. Send a direct Messenger DM to the Page from a tester customer account.
6. Confirm the DM appears in Shared Inbox.
7. Confirm the customer record is created or updated.
8. Confirm the AI reply is generated and sent.
9. Confirm a manual text reply sends.
10. Confirm an attachment reply sends.
11. Create an order from the Messenger conversation.
12. Confirm billing conversation usage is metered for the new 24-hour conversation window.
13. Confirm templates still load and can be used in the inbox.
14. Confirm product grounding/RAG answers product questions from the direct DM.

## Automated Checks

Run:

```bash
npm test --prefix EasyMod-backend
npm run launch:check --prefix EasyMod-backend
npm run build --prefix EasyMod-frontend
npm run test:unit --prefix EasyMod-frontend
```

Run Playwright/e2e checks when the required local/prod test environment and credentials are available:

```bash
npm run test:e2e --prefix EasyMod-frontend
```

## Launch Gate

- [ ] Backend tests pass.
- [ ] Backend launch readiness check passes.
- [ ] Frontend production build passes.
- [ ] Frontend unit tests pass or known pre-existing failures are documented.
- [ ] Production `/health/ready` returns 200 after deployment.
- [ ] Direct Messenger DM arrives in the inbox after deployment.
- [ ] AI reply sends after deployment.
- [ ] Order creation from Messenger conversation works after deployment.
