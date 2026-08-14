# Live Meta provider verification — pre-merge checklist

CI cannot close this gate: it needs the founder-controlled test Page/account
and manual Meta UI actions (OAuth consent, real DM exchange) I cannot perform
myself — no browser/Meta UI access from this environment. This checklist
splits each required item into **who does the action** and **what I can
independently verify from the backend once you have**, so nothing here gets
marked PASS on your say-so alone — only on an actual observed signal.

Reuses the founder-only nature of `docs/launch-readiness/2026-07-26/18_FOUNDER_ACTION_CHECKLIST.md`
steps 7-8 rather than re-describing that flow; this is the narrower,
technical smoke-test companion to it, scoped to exactly the items PR #1's
merge gate requires.

**Status: `POST_CUTOVER_META_SMOKE=READY_NOT_RUN`** — nothing below has been
executed yet.

## How to use this

For each row: perform the **Action** against the test Page/account, then
either paste me the result or give me a moment to query the **Verification**
command/endpoint myself. `GET /health/detailed` and the admin routes below
require a platform-admin token — use the same one from prior launch-readiness
passes, or issue a fresh one.

| # | Item | Action (you) | Verification (me, from backend evidence) |
|---|---|---|---|
| 1 | OAuth Page connection | Sign in to the test merchant account → Settings → Chat → Connect Facebook Page → complete the Facebook consent screen | Channel row appears with `status: 'CONNECTED'`; token stored encrypted. I'll query the channel via the admin API rather than the DB directly. |
| 2 | Page selection | On the Page picker, select the test Page (not "select all") | The connected channel's `meta_asset_id` matches only the selected Page — confirms the granular-scope intersection (`DEFAULT_SCOPES` / `debug_token` logic) actually filtered correctly, not just that *a* Page connected |
| 3 | Webhook subscription | Click **Test** on the channel card, or let auto-verification run | `GET /{page-id}/subscribed_apps` via the channel's own verify path — the card shows "webhook active"; I can confirm via `GET /api/admin/meta-identity-readiness` if the channel is included with `connectedChannelsMissingMappings: 0` |
| 4 | Real inbound DM | From the separate tester **customer** account, send a text DM to the test Page | Message appears in the Shared Inbox; `webhookReceipts.deadLettered`/`held` in `GET /health/detailed` stay unchanged (no new dead letters from this send) |
| 5 | Manual outbound reply | From the merchant inbox, type and send a reply within the 24h window | Delivered; tester receives the exact text. Confirms `senderRole: 'agent'` path end-to-end post-fix (this session added a policy-level block for this path *outside* the window — within-window sends are unaffected and this proves that) |
| 6 | AI reply | Let the AI auto-reply (or approve a drafted suggestion, depending on the shop's automation mode) | Delivered; tester receives it; if the shop is in "Review first" mode, confirm the draft appears instead and nothing sends until approved |
| 7 | Image/file flow | Send an image or file attachment from the merchant inbox (or trigger a product-image auto-reply) | Tester receives the attachment; Graph API call body has `messaging_type` matching in/out-of-window state |
| 8 | 24-hour-policy behavior | Wait until >24h since the customer's last inbound message (or use a test conversation already stale), then: (a) try a manual reply — composer should already refuse; (b) trigger an AI/system follow-up | (a) Composer blocked client-side; if somehow submitted anyway, backend now denies with `HUMAN_AGENT_OUTSIDE_WINDOW_BLOCKED` (this session's fix — first real-world exercise of it). (b) AI/system send goes out tagged `POST_PURCHASE_UPDATE`; confirm via the actual Graph payload (`tag` field) if you have network visibility, or via the delivered message's timing relative to last inbound |
| 9 | Wrong-Page isolation | With two test Pages connected (or one test + one distinct dev Page), send a DM to Page A and confirm nothing appears on any conversation scoped to Page B's channel | No cross-channel leakage in the Shared Inbox; confirms `meta_channel_id` FK pinning (not just shop+platform fallback) actually routes to the right Page |
| 10 | DLQ = 0 | No action — this is a standing health check during/after the above | `GET /health/detailed` → `autoReplyDlq === 0` and `webhookReceipts.deadLettered === 0` throughout. A non-zero value during this checklist means a real send or ingest failed silently and must be investigated before this gate can close |
| 11 | Canary fresh | No action — standing check | `GET /health/detailed` → `autoReplyCanary.fresh === true`, `lastOkAgeMs` under `CANARY_MAX_STALENESS_MS` (default 15 min) — proves the message-processing worker is alive and consuming the queue while you're testing, not just that the API responds |

## What I will NOT do

- Click through the Meta OAuth consent screen, select a Page, or type into
  the inbox composer myself — all require your browser session and the test
  Page's actual Meta permissions.
- Mark any row PASS without a corresponding backend signal (a channel row, a
  health-check field, a Shared Inbox message) — "you said it worked" alone
  doesn't close this gate.
- Touch `PRODUCTION_DEPLOY_ENABLED` or any production data as a side effect
  of running this checklist.

## After this checklist

Once all 11 rows are genuinely observed (not assumed), `POST_CUTOVER_META_SMOKE`
moves from `READY_NOT_RUN` to a real PASS/FAIL with evidence per row, and
`META_LIVE_PROVIDER_PROOF` in the merge-gate report can close. This can happen
either pre-merge (against the test Page, safe regardless of merge state since
it doesn't touch production) or immediately post-cutover against the same
test assets — your call on timing, but it must happen at least once before
declaring the Meta integration genuinely proven end-to-end.
