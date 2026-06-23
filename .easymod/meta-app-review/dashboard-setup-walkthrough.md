# Meta Developer App Dashboard — Step-by-Step Setup

**App:** Easy Moderator
**Canonical origin:** `https://easymod.tech` (apex)
**Local dev origin:** `http://localhost:5173`
**Last updated:** 2026-05-21

This walkthrough takes you from "no app" to "fully configured Development-mode app with OAuth + webhooks working." Each section says exactly what to click in [developers.facebook.com](https://developers.facebook.com) and what value to paste.

> **Order matters.** Steps 1–9 unblock local dev. Step 10 covers what to add for App Review prep. Do not switch to **Live Mode** until you reach the App Review phase.

---

## 0. Prerequisites

- [ ] You have a Facebook personal account that is a member of the **Hexabyte Technologies Business Manager** (or you'll create one in step 0b).
- [ ] You have a test FB Page ("Easy Moderator Test Shop") — you can create this later but need it before testing the OAuth flow.
- [ ] You have generated values for these env vars locally and saved them somewhere safe:
  - `CHANNEL_ENCRYPTION_KEY` — run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 0a. Create a Meta Business Account (skip if Hexabyte Technologies already exists)
1. Go to <https://business.facebook.com>
2. Click **Create Account** → enter "Hexabyte Technologies" + your work email
3. Save the Business Manager ID — you'll need it for App Review

---

## 1. Create the App

1. Go to <https://developers.facebook.com/apps>
2. Click **Create App**
3. **Use case:** select **Other** → **Next**
4. **App type:** **Business** → **Next**
   (Required for `pages_messaging` / Messenger Platform access.)
5. **App name:** `Easy Moderator`
6. **App contact email:** `work.evan.ahmed@gmail.com`
7. **Business Account:** select Hexabyte Technologies
8. Click **Create App** → enter your FB password to confirm

You're now in the app dashboard. Note the **App ID** (top of page) and the **App Secret** (Settings → Basic → Show).

---

## 2. Settings → Basic

Navigate: **App Settings → Basic** (left sidebar)

Fill in:

| Field | Value |
|---|---|
| Display Name | Easy Moderator |
| App Domains | `easymod.tech` (press Enter), `www.easymod.tech` (press Enter) |
| Contact Email | `work.evan.ahmed@gmail.com` |
| Privacy Policy URL | `https://easymod.tech/privacy-policy` |
| Terms of Service URL | `https://easymod.tech/terms` |
| User data deletion | Choose **Data Deletion Callback URL** → `https://easymod.tech/api/webhooks/meta/data-deletion` |
| Category | **Business and Pages** |
| App Icon | Upload a 1024×1024 PNG (placeholder OK in dev; final logo before App Review) |

Scroll down to **Business Use Case** → click **Add Use Case** → select **Other**. Description: *"Help BD f-commerce merchants moderate Facebook and Instagram comments and DMs to automate replies, capture orders, and respect opt-outs."*

Click **Save Changes**.

### Copy these values into `EasyMod-backend/.env`:
```env
META_APP_ID=<App ID from top of page>
META_APP_SECRET=<App Secret from Settings → Basic → Show>
META_OAUTH_REDIRECT_URI=http://localhost:5173/app/channels/oauth-callback
META_GRAPH_API_VERSION=v22.0
CHANNEL_ENCRYPTION_KEY=<the hex string you generated in step 0>
FRONTEND_URL=http://localhost:5173
```

---

## 3. Settings → Advanced

Navigate: **App Settings → Advanced**

| Field | Value |
|---|---|
| Deauthorize Callback URL | `https://easymod.tech/api/webhooks/meta/deauthorize` |
| Data Deletion Request Callback URL | `https://easymod.tech/api/webhooks/meta/data-deletion` (confirms what you set in step 2) |
| Server IP Allowlist | leave empty (we use App Secret Proof on all calls) |

Click **Save Changes**.

---

## 4. Add Products

Navigate: **+ Add Product** (left sidebar bottom)

Click **Set Up** on each:

1. **Facebook Login for Business**
2. **Messenger**
3. **Instagram**
4. **Webhooks** (auto-included with Messenger/Instagram but verify it's present)

---

## 5. Facebook Login for Business — Settings

Navigate: **Facebook Login for Business → Settings** (left sidebar)

| Field | Value |
|---|---|
| Client OAuth Login | **Yes** |
| Web OAuth Login | **Yes** |
| Force Web OAuth Reauthentication | **No** |
| Use Strict Mode for redirect URIs | **Yes** |
| Embedded Browser OAuth Login | **No** |
| Login with the JavaScript SDK | **No** (we use server-side redirect, not the JS SDK) |
| Valid OAuth Redirect URIs | `http://localhost:5173/app/channels/oauth-callback` (newline) `https://easymod.tech/app/channels/oauth-callback` |
| Allowed Domains for the JavaScript SDK | leave empty |

Click **Save Changes**.

### Configurations sub-tab (Business Login)

1. Click **Configurations** → **Create configuration**
2. **Name:** `Easy Moderator Connect`
3. **Login type:** Business Login
4. **Assets:** Pages, Instagram accounts
5. **Permissions:** check all of these
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_metadata`
   - `pages_manage_engagement`
   - `pages_messaging`
   - `instagram_basic`
   - `instagram_manage_messages`
   - `instagram_manage_comments`
6. Click **Create**
7. Note the **Configuration ID** if you use one — the current codebase uses standard OAuth scopes, so this is optional for now.

---

## 6. Webhooks Product — Configure Subscriptions

> **Pre-step:** Before clicking *Verify and Save*, you must seed a verify token. Run this in `EasyMod-backend`:
> ```bash
> npm run seed:meta-bootstrap
> ```
> Copy the token it prints. After your first real channel connects, run:
> ```bash
> npm run seed:meta-bootstrap -- --cleanup
> ```

Navigate: **Webhooks** (left sidebar)

### 6a. Page object

1. From the dropdown at top, select **Page**
2. Click **Subscribe to this object**
3. **Callback URL:** `https://easymod.tech/api/webhooks/meta`
   - For local dev with ngrok: `https://<your-tunnel-id>.ngrok.app/api/webhooks/meta`
4. **Verify Token:** paste the token from `npm run seed:meta-bootstrap`
5. Click **Verify and Save** — should return 200 instantly
6. In the subscription field list, check:
   - `messages`
   - `feed`

### 6b. Instagram object

1. From the dropdown, switch to **Instagram**
2. Click **Subscribe to this object**
3. **Callback URL:** same as above
4. **Verify Token:** same token (re-use; the bootstrap row matches both)
5. Click **Verify and Save**
6. In the subscription field list, check:
   - `messages`
   - `comments`

---

## 7. Messenger Product — Settings

Navigate: **Messenger → Settings**

- **Access Tokens:** leave empty — tokens are generated per-Page at runtime by the OAuth flow.
- **Webhooks:** confirm "Page" and "Instagram" appear under "Connected Webhook Subscriptions" (configured in step 6).
- **Built-in NLP:** Off (we use our own LLM).
- **App Review for Messenger:** comes later (step 10).

---

## 8. Add Testers (Roles)

Navigate: **App Roles → Roles**

1. Click **Add People** → **Testers**
2. Add the merchant test FB account
3. Add the customer test FB account
4. Each must accept the invite via the notification in their FB account.
5. (Optional) Add yourself as Developer if not already.

> In Development Mode, **only** Testers/Developers/Admins can complete OAuth. Real users get an error until the app goes Live.

---

## 9. Smoke Test (Dev Mode)

Now verify the full flow works locally:

```bash
# Terminal 1 — backend
cd EasyMod-backend
npm run seed                  # creates dev shop if not present
npm run seed:meta-bootstrap   # creates bootstrap webhook row, prints verify token
npm run dev

# Terminal 2 — frontend
cd EasyMod-frontend
npm run dev
```

Visit `http://localhost:5173/app/channels`:

1. Click **Connect Facebook** — should redirect to Facebook OAuth consent screen
2. Approve the permissions for your test FB Page
3. Should redirect back to `/app/channels/oauth-callback`
4. The Channels page should show your test Page as **Connected**
5. Check DB: `meta_channels` should have a real row (status `CONNECTED`, real `meta_asset_id`)
6. Run `npm run seed:meta-bootstrap -- --cleanup` to remove the bootstrap row
7. Have your test customer comment on a Page post → backend logs should show a webhook hit with `signature OK`

If all 7 pass, dev mode is good. Stop here until you're ready for App Review.

---

## 10. App Review Preparation (do these BEFORE submitting)

> **Don't switch to Live Mode until everything below is complete.** Once Live, your OAuth screen is visible to everyone but advanced permissions still require approval.

### 10a. Complete Business Verification

Navigate: **business.facebook.com → Business Settings → Security Center → Business Verification → Start Verification**

Required documents (Bangladesh):
- Trade License (PDF)
- TIN certificate (PDF)
- Bank statement or utility bill matching the business address

Timeline: 3–10 business days. Cannot proceed with most permission requests until this is approved.

### 10b. Data Use Checkup

Navigate: **App Dashboard → Data Use Checkup**

For each permission requested, confirm:
- Data is used only to operate the inbox + automate replies
- Not shared with third parties
- Not used for advertising targeting
- Not used to train AI models that serve other customers

### 10c. App Review → Permissions and Features

Navigate: **App Review → Permissions and Features**

For each permission below, click **Request advanced access** → fill the justification → upload the screencast.

| Permission | Screencast |
|---|---|
| `pages_show_list` | OAuth grant + page list step |
| `pages_messaging` | Storyboard 1 + Storyboard 2 |
| `pages_read_engagement` | Storyboard 1 |
| `pages_manage_metadata` | OAuth flow showing webhook subscribe |
| `pages_manage_engagement` | Storyboard 1 (public reply toggle) |
| `instagram_basic` | OAuth flow → IG account appears in dashboard |
| `instagram_manage_messages` | IG DM round-trip |
| `instagram_manage_comments` | IG comment → DM trigger + public reply on IG post |

Use the prompts in [permissions-justification.md](permissions-justification.md) and the storyboards in [screencast-storyboards.md](screencast-storyboards.md).

### 10d. App Review → Submission

Navigate: **App Review → Requests**

Required items:
- App icon (1024×1024 — final, not placeholder)
- 1–3 in-app screenshots (PNG/JPG)
- Long description (~250 words) — explain what Easy Moderator does, who uses it, and how each permission is used
- Demo video (60–120 sec) — combine Storyboards 1+2 with English captions
- Tester credentials → submit via the in-form text field (link to 1Password share or paste plaintext)

### 10e. Switch to Live Mode

Toggle the **App Mode** switch (top right of dashboard) from Development → Live.

Submit for review.

---

## 11. Post-Approval — Production Cutover

After App Review approval:

1. Confirm production env vars (`META_APP_ID`, `META_APP_SECRET`, `META_OAUTH_REDIRECT_URI=https://easymod.tech/app/channels/oauth-callback`) are set in your prod deployment secrets.
2. Real merchants can now complete the OAuth flow.
3. Monitor:
   - Webhook 200 rate (target >99%)
   - Token refresh job logs (every 6h)
   - Policy decisions table for any unexpected `BLOCK` decisions

---

## 12. Production Smoke Test — Live Server with Named Test Accounts

Run this after any deploy that touches OAuth, webhooks, env vars, or `meta_channels`. It uses the two accounts you actually have:

| Role | Account | Meta App role | Notes |
|---|---|---|---|
| Owner | `work.evan.ahmed@gmail.com` | **Admin** | Owns Hexabyte Technologies portfolio |
| Tester | `ahmmed.evan@gmail.com` | **Tester** | Co-owner on Hexabyte Technologies portfolio |

> **Why two accounts:** in Development mode Meta delivers webhooks **only** for messages whose sender is on the App Roles roster. So one account connects a Page (the Owner), and a second account messages that Page as if it were a real customer (the Tester). Both must be on the App Roles roster.

### 12.1 One-time pre-flight

- [ ] `ahmmed.evan@gmail.com` has **accepted** the Tester invite. Log into facebook.com as that account → bell/notifications → accept "You've been added as a Tester on Easy Moderator". Until accepted, the role is `Pending` and Meta drops their webhooks silently.
- [ ] Both accounts appear in **Meta App Dashboard → App Roles → Roles** (not just Hexabyte Technologies portfolio — that's separate).
- [ ] Hexabyte Technologies portfolio has at least one Page connectable to the app (visible at `business.facebook.com/settings/pages` under the portfolio).
- [ ] Prod env vars present on the droplet (SSH and `env | grep META`):
  - `META_APP_ID`
  - `META_APP_SECRET`
  - `META_APP_SECRET` — used for OAuth, webhook POST HMAC verification, data deletion, and deauthorize signatures
  - `META_OAUTH_REDIRECT_URI=https://easymod.tech/app/channels/oauth-callback`
  - `META_GRAPH_API_VERSION=v22.0`
  - `CHANNEL_ENCRYPTION_KEY` — same value used to encrypt existing rows (never rotate without re-OAuthing every channel; see §14.2)
- [ ] `curl -s https://easymod.tech/api/version | jq` returns the expected `gitSha` and `migrations.count`.

### 12.2 Owner connects a Page

1. Open https://easymod.tech in a fresh browser session (or incognito).
2. Log in as `work.evan.ahmed@gmail.com`.
3. Settings → Chat Settings → **Connect Facebook**.
4. Complete OAuth — grant all requested permissions.
5. Pick the test Page from the Hexabyte Technologies portfolio.
6. Verify the Page appears in Chat Settings with status `CONNECTED`.

### 12.3 Verify per-page webhook subscription (CRITICAL)

`provider.subscribeWebhook` in [meta-oauth.service.js:140-148](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L140) is best-effort — it logs a warning on failure but still marks the channel CONNECTED. **A page can look connected in our UI while Meta never delivers webhooks for it.** Always verify after connect:

Easiest path — Graph API Explorer (https://developers.facebook.com/tools/explorer):
1. Top right: set Application to **Easy Moderator**.
2. Set Access Token to the **Page Access Token** for the page you just connected (drop-down → User Token → pick the page).
3. Run: `GET me/subscribed_apps`
4. Expect a row for `Easy Moderator` / `saas-easymod` with `subscribed_fields` containing at least: `messages`, `feed`.

Or via curl with the page token:
```bash
PAGE_TOKEN="<paste page access token>"
curl -s "https://graph.facebook.com/v22.0/me/subscribed_apps?access_token=$PAGE_TOKEN" | jq
```

**If the app is missing OR fields are incomplete, re-subscribe manually:**
```bash
PAGE_ID="<page id>"
PAGE_TOKEN="<page token>"
curl -X POST "https://graph.facebook.com/v22.0/$PAGE_ID/subscribed_apps" \
  -d "access_token=$PAGE_TOKEN" \
  -d "subscribed_fields=messages,feed"
# Expected: {"success":true}
```

Then re-run the GET above to confirm.

### 12.4 Tester sends an inbound message

1. On a phone or second browser, open Messenger as `ahmmed.evan@gmail.com`.
2. Search for the connected Page by name.
3. Send a short text — e.g. `Hello from tester`.

### 12.5 Verify end-to-end delivery

Within ~2 seconds of send, all three must be true:

**(a) Backend log on prod droplet:**
```bash
ssh root@<droplet>
docker logs --since=2m easymod-backend-1 2>&1 | grep -iE "asset $PAGE_ID|stored facebook"
# Expected:
#   Received page event for asset <PAGE_ID>
#   Stored facebook message  customerId=… convId=… msgId=…
```

**(b) Owner's inbox on https://easymod.tech/app/inbox:**
- New conversation card from the tester appears at the top of the list, real-time, no refresh.
- Driven by SSE — see [useInboxSSE.ts:46](../../EasyMod-frontend/src/app/lib/useInboxSSE.ts#L46).

**(c) DB sanity check** (optional):
```sql
SELECT c.id, c.meta_channel_id, c.updated_at, m.content
FROM conversations c
JOIN messages m ON m.conversation_id = c.id
WHERE c.shop_id = '<owner-shop-id>'
ORDER BY m.created_at DESC LIMIT 5;
```

### 12.6 Reply path (outbound)

1. Owner clicks the conversation in /app/inbox and types a reply.
2. Tester's Messenger should show the reply within 1-2 seconds.
3. Backend log: `Message sent via webhook service shim` with the correct shopId + platform.

If reply fails — check `meta_channels.last_error` and `meta_channels.token_expires_at`.

---

## 13. Diagnostic Cookbook

Use this when §12.5 doesn't behave. Match the symptom row to your evidence.

| Symptom | Likely root cause | Confirm with | Fix |
|---|---|---|---|
| **No backend log entry within 30s** of send | Meta isn't delivering. Either Dev mode + sender not in App Roles, OR per-page subscription is missing. | Meta App Dashboard → Webhooks → Page → **Recent Activity / Recent Deliveries** tab. Empty = Meta-side. | Confirm tester invite accepted (§12.1). Re-subscribe page (§12.3). |
| Log: `Invalid signature for asset <id>` | `META_APP_SECRET` does not match the current Meta App Secret. | On droplet: confirm the deployed `META_APP_SECRET` against Meta Dashboard → Settings → Basic → Show App Secret. | Update `META_APP_SECRET`, redeploy (§14.1). |
| Log: `No CONNECTED facebook channel for page_id=<id>` | `meta_channels` row missing or `status != CONNECTED`. | `SELECT shop_id, status, last_error FROM meta_channels WHERE meta_asset_id='<id>';` | Disconnect + reconnect via UI to recreate the row. |
| `Stored facebook message` logged but inbox doesn't update | SSE listener not connected on FE. | DevTools → Network → look for an open `EventSource` to `/api/conversation/events` (status 200, type `eventsource`). | Hard refresh; confirm auth cookie not expired; confirm `shop_id` in URL matches current session. |
| Meta Recent Deliveries shows **403** | Same as `Invalid signature`. | (same) | (same) |
| Meta Recent Deliveries shows **5xx** | Backend exception during handler. | `docker logs --since=5m easymod-backend-1 \| grep -i "UNEXPECTED webhook"` | Read stack trace, fix at source. |
| `/me/subscribed_apps` lists no apps for the page | `subscribeWebhook` failed silently at connect. | Re-run §12.3 query. | Re-subscribe via curl (§12.3); review original connect logs for the warning. |
| Tester OAuth error: "You don't have permission" | Tester role not accepted, OR `pages_messaging` not approved in Live mode. | App Roles → tester shows `Pending`. | Tester accepts invite via FB notifications, OR keep app in Dev mode until App Review approves the permission. |
| Public Graph lookup of a "page id" returns *"Object does not exist or missing permissions"* | The ID is a personal profile, not a Page (matches `profile.php?id=…` URLs). | `curl "https://graph.facebook.com/v22.0/<id>?access_token=<page-token>"` | Personal profiles can't receive Messenger Platform webhooks — only Pages. Use a real Page in the portfolio. |

### Useful Graph API probes

```bash
# Token introspection — reveals token type (USER/PAGE), scopes, target page, expiry:
curl -s "https://graph.facebook.com/v22.0/debug_token?input_token=$TOKEN&access_token=$TOKEN" | jq

# Public lookup of an ID — confirms it's a Page (not a personal profile):
curl -s "https://graph.facebook.com/v22.0/<id>?fields=id,name,category&access_token=$TOKEN" | jq

# List all pages this user can manage:
curl -s "https://graph.facebook.com/v22.0/me/accounts?access_token=$USER_TOKEN" | jq
```

---

## 14. Operational Runbook

### 14.1 App Secret rotation (at least every 90 days)

1. Meta App Dashboard → Settings → Basic → **Reset App Secret**.
2. Immediately update prod env var `META_APP_SECRET`.
3. Redeploy backend so the new value loads (`gh workflow run ci-cd.yml -f environment=prod`).
4. During the gap between rotation and redeploy, incoming webhooks fail signature → 403. Meta retries with exponential backoff (~5 attempts over ~24h). Keep the gap to seconds.
5. After redeploy: run §12.4–12.5. `Stored facebook message` proves signature validates under the new secret.

### 14.2 `CHANNEL_ENCRYPTION_KEY` — never rotate without re-OAuth

This key encrypts page tokens at rest in `meta_channels.page_access_token_ct`. **Rotating it without first re-OAuthing every connected channel permanently bricks every stored token** — the tokens are still valid on Meta's side but undecryptable on ours. If you must rotate: build a one-shot migration that decrypts under the old key, re-encrypts under the new key, in a single transaction, then atomically swap the env var.

### 14.3 Token health monitoring

- Long-lived Page tokens normally have `token_expires_at = NULL`. A non-null value or one < 60 days out means refresh isn't working.
- The token refresh job (BullMQ, every 6h) handles renewals; failures bump `meta_channels.token_refresh_attempts`.
- Alert on: `SELECT count(*) FROM meta_channels WHERE status = 'TOKEN_EXPIRED'` > 0 for > 1h.
- Alert on: any row where `token_refresh_attempts > 3`.

### 14.4 Going Live (Dev → Live App Mode)

Flipping the App Mode toggle (top-right of dashboard) Development → Live:
- OAuth dialog becomes visible to ALL Facebook users, not just App Roles roster.
- Advanced permissions (`pages_messaging`, `instagram_manage_messages`, etc.) still gated by App Review approval — until granted, real users can complete OAuth but messaging API calls return empty/permission-denied results. Tester accounts continue to work without restriction.
- Don't flip until §10 is complete and Business Verification is approved.

### 14.5 Disconnect / reconnect flow

If a tenant reports stale data or webhook failures:
1. UI: Settings → Chat Settings → click the page → **Disconnect** (calls `POST /api/channels/meta/:channelId/disconnect`, best-effort unsubscribes the page and clears the encrypted token; row preserved for audit).
2. Reconnect via the same UI.
3. Verify per §12.3.

### 14.6 What's left to harden in code (known gaps)

These are not blockers for launch but should be tracked:

- [meta-oauth.service.js:140-148](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L140) — `subscribeWebhook` failure currently logs a warning; should also surface `webhook_subscription_failed` to the UI so the user can hit a Retry button instead of needing this runbook.
- [meta-oauth.service.js:130-138](../../EasyMod-backend/src/modules/channel-providers/meta-oauth.service.js#L130) — `connectPage` never generates/passes `webhookVerifyToken` per channel, so `meta_channels.webhook_verify_token` is NULL on OAuth-created rows. Doesn't break ongoing delivery (verify tokens only matter at GET-handshake time during initial dashboard subscription), but means re-verifying via `?hub.verify_token=…` will 403 — confusing during diagnosis.
- `webhook_last_verified_at` column on `meta_channels` is declared but never written. Either start writing it (on successful POST handler) or drop it.

---

## Reference

- Code paths: see [../../C:/Users/ahmee/.claude/plans/using-em-ochestrator-agent-to-composed-meadow.md](../../C:/Users/ahmee/.claude/plans/using-em-ochestrator-agent-to-composed-meadow.md) §1
- Architecture plan: [../../C:/Users/ahmee/.claude/plans/redesign-and-restructure-the-enchanted-feigenbaum.md](../../C:/Users/ahmee/.claude/plans/redesign-and-restructure-the-enchanted-feigenbaum.md)
- Permissions justifications: [permissions-justification.md](permissions-justification.md)
- Screencast scripts: [screencast-storyboards.md](screencast-storyboards.md)
- Compliance checklist: [compliance-checklist.md](compliance-checklist.md)
- Data deletion flow: [data-deletion-flow.md](data-deletion-flow.md)
- Test user setup: [test-user-credentials.md](test-user-credentials.md)
