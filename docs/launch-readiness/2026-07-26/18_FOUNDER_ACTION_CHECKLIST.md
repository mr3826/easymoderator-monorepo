# 18 — Founder Action Checklist

Ordered. Steps 1-3 are sequential and must not be reordered — step 1 is the one that is
unrecoverable if done wrong.

**No agent may perform any of these.** They involve credentials, Meta Dashboard access, or
real money. Every value below stays between the founder and the platform.

---

## PHASE 1 — Unblock the deploy (required before pilot)

### Step 1 ⚠️ — `PAYMENT_ENCRYPTION_KEY` (do this FIRST, and read it twice)

**Where:** GitHub → repo → Settings → Secrets and variables → Actions

**Do NOT generate a fresh random key.** The runtime currently derives its AES key as
`sha256(current_value)` because the current value is not 64 hex characters. A new random
hex key changes that derived key and makes every stored merchant payment credential
permanently undecryptable (AES-256-CBC has no auth tag, so it fails as garbage, not as an
error).

**Exact command** — run locally, substituting the *current* secret value:

```bash
printf '%s' 'CURRENT_PAYMENT_ENCRYPTION_KEY_VALUE' | openssl dgst -sha256 -hex | awk '{print $NF}'
```

**Expected result:** 64 lowercase hex characters. Set `PAYMENT_ENCRYPTION_KEY` to exactly
that. The derived AES key is byte-identical to what production already uses, so nothing
breaks, and the validator's `/^[a-f0-9]{64}$/i` check now passes.

**Verify:** the deploy preflight no longer lists `invalid: PAYMENT_ENCRYPTION_KEY`. After
deploy, open a merchant's payment settings and confirm saved credentials still decrypt.

**Save as evidence:** a screenshot of the preflight step passing. **Never** save the value.

**Required before:** pilot. **Caveat:** if the current value is a weak placeholder, this
preserves that weakness. A true rotation needs a decrypt-old/re-encrypt-new migration that
does not exist yet — track it as post-launch work.

---

### Step 2 — Decide the bKash posture

**Where:** `.github/workflows/ci-cd.yml:246`

Two options. Pick one:

**Option A (recommended for pilot) — turn bKash off.**
Change `BKASH_ENABLED: "true"` → `"false"`. The requirement drops from six secrets to one
(`BKASH_WEBHOOK_SECRET`, still in `CORE_REQUIRED`), and removes live-money exposure until
a real end-to-end payment test has been done.
*Trade-off:* merchants cannot subscribe during the pilot, so the 14-day trial must cover
the pilot window. For 10 shops on DRAFT for 7-14 days, it does.

**Option B — go live now.** Set all six `BKASH_*` secrets from your bKash merchant portal.
Note the validator forces `BKASH_SANDBOX` to be exactly `'false'`, i.e. **real money**.
Requires your explicit approval and a real-money test (Step 8).

**Verify:** deploy preflight no longer lists the `BKASH_*` names.
**Required before:** pilot.

---

### Step 3 — Set the remaining secrets

**Where:** GitHub → Settings → Secrets and variables → Actions

| Secret | Value | How to generate |
|---|---|---|
| `CSRF_SECRET` | ≥32 chars | `openssl rand -hex 32` |
| `SENTRY_DSN` **or** `SLACK_ALERT_WEBHOOK_URL` | your DSN / webhook URL | Sentry project settings, or Slack → Incoming Webhooks |

```bash
openssl rand -hex 32
```

Note: the repo has `VITE_SENTRY_DSN` (frontend). The backend reads **`SENTRY_DSN`** — a
separate secret.

**Verify:** deploy preflight passes and the deploy proceeds past "Render and validate .env.prod".
**Required before:** pilot. This also closes launch gate 8.

---

### Step 4 — Re-run the deploy

```bash
gh run rerun 30189476291 --failed
```

**Expected:** `Deploy to DO Droplet` completes; `Copy .env.prod to droplet` and
`Deploy via SSH` both run. Migrations execute from the candidate image before service
replacement.

**Verify:** `docker exec easymod-backend-1 node -e "require('http').get('http://127.0.0.1:3000/health/ready', r => console.log(r.statusCode))"` → `200`.
**Save:** the successful run URL.
**Required before:** pilot.

---

## PHASE 2 — Meta App Review submission

### Step 5 — Meta App Dashboard configuration

> ⚠️ **SUPERSEDED — do not enter the values in this table.** They predate the
> 2026-08 domain split (`easymod.tech` marketing / `app.easymod.tech` app /
> `api.easymod.tech` API) and are preserved only as the 2026-07-26 record.
> The OAuth redirect below is now actively rejected: production config
> validation refuses any `META_OAUTH_REDIRECT_URI` outside
> `https://app.easymod.tech/channels/oauth-callback`, and the old apex URL only
> 302-redirects — which Meta does not accept for a redirect URI.
>
> **Use the current values in
> [`docs/meta-app-review-submission.md`](../../meta-app-review-submission.md)
> and [`docs/infrastructure/DOMAIN_AND_ROUTE_ARCHITECTURE.md`](../../infrastructure/DOMAIN_AND_ROUTE_ARCHITECTURE.md).**

**Where:** developers.facebook.com → your app

| Field | Exact value (2026-07-26 — SUPERSEDED) |
|---|---|
| App Domains | `easymod.tech` |
| Privacy Policy URL | `https://easymod.tech/privacy-policy` |
| Terms of Service URL | `https://easymod.tech/terms` |
| Category | Business / Messaging |
| Webhook Callback URL | `https://easymod.tech/api/webhooks/meta` |
| Webhook Verify Token | the production `META_WEBHOOK_VERIFY_TOKEN` value |
| Webhook field | **`messages` only**, on the `page` object |
| Data Deletion Callback | `https://easymod.tech/api/webhooks/meta/data-deletion` |
| Deauthorize Callback | `https://easymod.tech/api/webhooks/meta/deauthorize` |
| Valid OAuth Redirect URI | `https://easymod.tech/app/channels/oauth-callback` |
| Permissions requested | `pages_show_list`, `pages_messaging`, `pages_manage_metadata` — **and nothing else** |

**Verify:** all four callback URLs already respond correctly in production (confirmed this
audit). Confirm no fifth permission and no extra webhook field is selected.
**Required before:** submission.

### Step 6 — App icon and business verification

> ✅ **DONE — confirmed against the live dashboard 2026-08-20.** App icon is
> uploaded, and Business Verification shows **HexaByte Technologies**, ID
> `1268762121859445`, ● Verified. Finding F-10 is closed: the procedure is now
> documented in
> [`.easymod/meta-app-review/business-verification.md`](../../../EasyMod-backend/.easymod/meta-app-review/business-verification.md).
> (Note the legal entity reads "HexaByte Technologies" in the dashboard, not
> "Hexabyte Limited" as written below.)

Upload the app icon (1024×1024 PNG) and complete Meta Business Verification for Hexabyte
Limited. **Neither is covered by any current document** (finding F-10).
**Verify:** dashboard shows the icon and "Verified".
**Required before:** approval.

### Step 6b — Access verification (Tech Provider) ⛔ NOT STARTED

> **Added 2026-08-20. This step was missing from the original audit and it is
> the only Meta gate with a hard deadline.**

Business verification is *not* the last verification. Because EasyModerator
connects **other businesses'** Pages, `pages_show_list` falls in the dashboard's
Tech-Provider-gated section, and HexaByte must additionally be verified as a
**Tech Provider**. The dashboard warns:

> To avoid restrictions to 1 app, this must be completed by **10/19/2026**.

Without it, once the app leaves Development mode every merchant who does not
hold a role on the app fails with Graph error code 100. Passing App Review does
not satisfy this — they are independent gates.

**Where:** App settings → Basic → Business portfolio → Access verification →
*View details* → **Start verification**
(<https://developers.facebook.com/1268762121859445/access-verification/>)
**Who:** a Business admin of HexaByte Technologies — the founder. An app role is
not enough.
**Answer from:** `.easymod/meta-app-review/permissions-justification.md`, so the
story matches App Review.
**Turnaround:** ~5 days.
**Verify:** dashboard shows the business as a verified Tech Provider.
**Required before:** any non-tester merchant can connect a Page.
**Full procedure:** `.easymod/meta-app-review/business-verification.md` §6.

### Step 7 — Test assets and reviewer credentials (finding F-09)

1. Create a **test Facebook Page**.
2. Add a **customer tester account** with an app role (in Development mode Meta only
   delivers webhooks from users with a role).
3. Create a **test merchant account** in EasyModerator and record its login for the
   reviewer.
4. Add all three to `docs/meta-app-review-submission.md` in a credentials block.

**Verify:** the tester account can DM the test Page and the message appears in the test
merchant's Shared Inbox.
**Required before:** submission.

> ⚠️ Before recording, get **F-02** fixed (silent message drop). If the reviewer's Page is
> in any non-`CONNECTED` state their DM disappears with no diagnostic, and the review
> fails with no explanation.

### Step 8 — Record the screencast (finding F-08)

Must show, in order: sign in → open the Page connection flow → **the Meta authorization
screen** → select the Page → connected Page appears → **tester sends a real Messenger text
message** → it appears in the Shared Inbox → merchant sends a text reply → **the tester
receives the exact reply**.

Steps 6 and 9 are the mandatory text round-trip and **cannot** be replaced by attachment
demos. No Instagram, WhatsApp, comments, or any unrequested permission may appear on
screen. Subtitles are fine; voice-over is optional.

**Save:** the video plus a timestamp map per permission.
**Required before:** submission.

---

## PHASE 3 — Pilot launch

### Step 9 — Off-site encrypted backups (finding F-04)

Create a DigitalOcean Spaces (or S3) bucket and add its credentials as GitHub secrets, then
have engineering add an encrypted upload step to `.github/workflows/backup.yml`. Today
every backup sits on the droplet it is meant to protect.

**Verify:** a backup object appears in the bucket after the next scheduled run.
**Required before:** pilot.

### Step 10 — Perform one real restore

Restore the latest dump into an **isolated** database (never production) and confirm the
schema and row counts. Until this happens the backups are unproven artifacts.

**Save:** the restore log and the measured RTO.
**Required before:** public launch. *(Strongly recommended before pilot.)*

### Step 11 — Confirm alerting reaches a human

Trigger a test ops alert and confirm you personally receive it in Slack or Sentry.
**Verify:** the alert arrives on a device you actually watch.
**Required before:** pilot. Closes launch gate 8.

### Step 12 — Confirm Meta identity coverage

`GET /api/admin/meta-identity-readiness` with a platform-admin token must report
`connectedChannelsMissingMappings: 0`. Channels connected before the identity work need a
legitimate reconnect. Until then their deletion requests correctly resolve to
`IDENTITY_NOT_RESOLVED` rather than a false `COMPLETED`.
**Required before:** submission and pilot. Closes launch gate 10.

### Step 13 — Onboard 10 pilot shops

Follow the runbook in `docs/launch/LAUNCH_GATE_CHECKLIST.md`. Keep every shop on **DRAFT**
mode for the first 7-14 days.
**Required before:** public launch. Closes launch gate 7.

---

## PHASE 4 — Public launch

### Step 14 — 7-day canary observation

No STALE / DLQ / enqueue-failure alerts for seven consecutive days.
**Prerequisite:** Step 11, and engineering must fix **F-05** first — the DLQ gate currently
reports PASS while knowing nothing (`dlq=n/a`), so a green week today proves nothing.
**Required before:** public launch. Closes launch gate 6.

### Step 15 — Real-money bKash test (only if you chose Option B)

Perform one real charge and one refund with a real bKash account and a small amount.
**Save:** transaction IDs and the reconciliation report.
**Required before:** public launch, and before any merchant is charged.

### Step 16 — Real courier booking test

One real booking with a configured provider, plus cancellation.
**Required before:** advertising courier integrations as live (finding F-24).

### Step 17 — Correct the marketing claims

- ROI calculator: soften or substantiate "~20% COD return rate avoided" (F-23).
- Courier feature card: mark "coming soon" until Step 16 passes (F-24).
- Footer copyright: 2025 → 2026 (F-32).

**Required before:** paid marketing spend.

---

## Summary by gate

| Required before | Steps |
|---|---|
| **Pilot** | 1, 2, 3, 4, 9, 11, 12, and engineering fixes F-02/F-03/F-05 |
| **Meta submission** | 5, 7, 8, 12 (+ F-02 fixed) |
| **Meta approval** | 6 |
| **Public launch** | 10, 13, 14, 15, 16, 17 |
