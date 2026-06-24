# EasyModerator — Launch Gate Checklist

The 10-shop smoke test is the acceptance test for the whole launch-hardening effort.
**Do not launch publicly until every hard gate below is green.** Most are checked
automatically by `scripts/launch-readiness.js`; the rest are human steps.

Run the automated gates any time with:

```bash
# from EasyMod-backend/
BASE_URL=https://easymod.tech ADMIN_TOKEN=<admin-jwt> ACTIVATION_TARGET=10 \
  node scripts/launch-readiness.js
# or: npm run launch:check   (reads the same env vars)
```

Exit code `0` = all hard gates pass. The script prints PASS/FAIL per gate.

---

## Hard gates (must all be ✅ before launch)

| # | Gate | How it's verified | Owner |
|---|------|-------------------|-------|
| 1 | **CI is green on `main`** — backend tests + frontend build pass; build/deploy only run after the test gate | GitHub Actions: the `Test & Build Gate` job is green on the latest `main` push | Eng |
| 2 | **Infra up** — API answers `/health/ready` 200 | `launch-readiness.js` gate 1 | Auto |
| 3 | **DB + Redis + Vector store healthy** — Postgres connected, Redis connected, Qdrant available | `launch-readiness.js` gate 2 (`/health/detailed`) | Auto |
| 4 | **No silent reply failures** — `message-dlq` depth = 0 | `launch-readiness.js` gate 3 (`autoReplyDlq`) | Auto |
| 5 | **Auto-reply canary fresh** — the message worker has completed a synthetic probe within `CANARY_MAX_STALENESS_MS` | `launch-readiness.js` gate 4 (`autoReplyCanary.fresh`) | Auto |
| 6 | **Canary green for 7 straight days** — no STALE / DLQ / enqueue-failure ops alerts fired in the alert channel for a week | Review Slack/Sentry ops-alert history | Eng |
| 7 | **≥10 shops activated** — 10 real shops reached their first successful AI reply | `launch-readiness.js` gate 5 (`/api/analytics/growth` → `totals.activated`) | Auto |
| 8 | **Alerting actually reaches a human** — `SLACK_ALERT_WEBHOOK_URL` and/or `SENTRY_DSN` set in prod and a test alert was received | Trigger a test alert; confirm receipt | Eng |
| 9 | **Shared Inbox upload volume ready** — outbound attachments persist on the droplet and are publicly reachable for Meta Messenger | Manual upload smoke test below | Eng |

## Informational (track, not blocking)

- **Retention** — how many activated shops transacted this week (`/api/analytics/growth` → `totals.retainedThisWeek` / `retentionRate`). Watch the week-1 → week-2 trend before spending on ads.
- **Activation speed** — `daysToActivation` per shop. A high number means onboarding friction.

---

## Human runbook — onboarding the 10 smoke-test shops

For each of the 10 pilot shops:

1. Sign up → the **Onboarding Wizard** opens automatically.
2. **Connect** the Facebook Page (wizard step 1).
3. Add 3–5 products (step 2).
4. Tap **"✨ Starter FAQ যোগ করুন (১ ট্যাপে)"** to seed the BD f-commerce FAQ pack
   (step 3) — gives the AI a working knowledge base immediately.
5. Leave AI mode on **DRAFT** for the first 7–14 days (step 4).
6. Send a test customer message and confirm an AI reply is produced.
   - This is what flips the shop to **Activated** (gate 7).

Then watch for one week:
- `npm run launch:check` shows activation climbing toward 10.
- The ops-alert channel stays quiet (gate 6).
- DLQ stays at 0 (gate 4).

---

## Shared Inbox attachment launch check

Run these on every initial-launch deploy before testing with real shops:

```bash
ssh root@<droplet>
cd /opt/easymod
docker compose --env-file .env.prod -f docker-compose.prod.yml config --volumes
docker volume ls | grep backend_uploads
df -h
docker system df
```

Expected:
- `backend_uploads` exists as a Docker named volume.
- Backend has `BASE_URL=https://easymod.tech` and `BODY_SIZE_LIMIT=35mb` in `/opt/easymod/.env.prod`.
- Droplet disk has enough free space for launch testing and pilot-shop attachments.
- Daily backup workflow archives both Postgres and `easymod-uploads-*.tar.gz`.

Then verify the live Shared Inbox flow with a Facebook Page tester:

1. Send an inbound Messenger DM from a roster tester account.
2. Reply with text; confirm customer receives it.
3. Reply with an image; confirm customer receives it and the message metadata URL opens over HTTPS.
4. Reply with a PDF/common file; confirm customer receives it and the metadata URL opens over HTTPS.
5. Force or observe an attachment failure; confirm failed/retry appears and retry sends a fresh outbound message.
6. Re-check the 24-hour window/tag behavior still blocks/allows correctly.

---

## Sign-off

- [ ] Gate 1 — CI green on `main`
- [ ] Gate 2 — Infra up
- [ ] Gate 3 — DB + Redis + Qdrant healthy
- [ ] Gate 4 — DLQ empty
- [ ] Gate 5 — Canary fresh
- [ ] Gate 6 — Canary green 7 days, no ops alerts
- [ ] Gate 7 — ≥10 shops activated
- [ ] Gate 8 — Alerting verified reaching a human
- [ ] Gate 9 — Shared Inbox upload volume + attachment round-trip verified

**Launch approved by:** ______________________  **Date:** ____________
