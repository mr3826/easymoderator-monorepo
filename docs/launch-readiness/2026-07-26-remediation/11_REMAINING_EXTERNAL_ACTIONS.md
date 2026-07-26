# 11 — Remaining External Actions (founder / operator owned)

None of these can be performed by the engineering agent; each needs a credential, portal access, real money, or human confirmation.

## Required before the controlled pilot

1. **Confirm alert receipt (F-06, gate 8).** After deploy, `POST /api/admin/ops/test-alert` with a SUPER_ADMIN token, then confirm the alert actually arrives in Sentry (currently via the shared `VITE_SENTRY_DSN` project) on a device you watch. Optionally set a dedicated backend `SENTRY_DSN` and/or a `SLACK_ALERT_WEBHOOK_URL`. `BLOCKED_EXTERNAL_CREDENTIAL` until a human confirms receipt.
2. **Off-site encrypted backups (F-04).** Create a DigitalOcean Spaces (or S3) bucket and set repo secrets: `SPACES_ACCESS_KEY_ID`, `SPACES_SECRET_ACCESS_KEY`, `SPACES_ENDPOINT`, `BACKUP_BUCKET`, and `BACKUP_ENCRYPTION_KEY` (generate with `openssl rand -hex 32` and **store a copy in your password manager** — a GitHub secret can't be read back, and losing it makes every off-site archive unrecoverable). The upload step then activates automatically. `BLOCKED_EXTERNAL_CREDENTIAL`.
3. **Perform one real restore (F-04).** Restore the latest off-site dump into an isolated DB; confirm schema + row counts; record the RTO. Strongly recommended before pilot, required before public launch.
4. **Meta identity coverage (gate 10).** `GET /api/admin/meta-identity-readiness` must report `connectedChannelsMissingMappings: 0`.

## Required before Meta App Review submission

5. **Test Page + tester account + reviewer credentials** — provision and add to `docs/meta-app-review-submission.md`. (F-02 is now fixed, so a reviewer's Page landing unmapped no longer silently drops their DM — it is durably held and retried.)
6. **App icon (1024×1024) + Business Verification** for Hexabyte Limited.
7. **Screencast** — the mandatory text round-trip (sign in → Page connect → Meta auth screen → Page selected → tester sends a Messenger text → appears in Shared Inbox → merchant replies → tester receives the exact reply). Record only after the hardened deploy and a real text round-trip pass.

## Optional (only if going live on payments during the pilot)

8. **bKash go-live** — set all `BKASH_*` secrets, flip the `BKASH_ENABLED` Actions **variable** to `"true"`, and perform one real-money charge + refund test. Until then bKash stays disabled and the UI shows no purchasing surface.

## Public-launch gates (later)

9. 7-day canary observation with no STALE/DLQ/enqueue alerts (needs F-05 fixed — done — and alert receipt confirmed).
10. ≥10 pilot shops activated.
11. Marketing-claim corrections: ROI figure, courier "coming soon", footer year (from the prior audit's `18_`).
