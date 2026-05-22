# Meta Developer App Dashboard — Step-by-Step Setup

**App:** Easy Moderator
**Canonical origin:** `https://easymod.tech` (apex)
**Local dev origin:** `http://localhost:5173`
**Last updated:** 2026-05-21

This walkthrough takes you from "no app" to "fully configured Development-mode app with OAuth + webhooks working." Each section says exactly what to click in [developers.facebook.com](https://developers.facebook.com) and what value to paste.

> **Order matters.** Steps 1–9 unblock local dev. Step 10 covers what to add for App Review prep. Do not switch to **Live Mode** until you reach the App Review phase.

---

## 0. Prerequisites

- [ ] You have a Facebook personal account that is a member of the **Hexabyte Limited Business Manager** (or you'll create one in step 0b).
- [ ] You have a test FB Page ("Easy Moderator Test Shop") — you can create this later but need it before testing the OAuth flow.
- [ ] You have generated values for these env vars locally and saved them somewhere safe:
  - `CHANNEL_ENCRYPTION_KEY` — run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 0a. Create a Meta Business Account (skip if Hexabyte Limited already exists)
1. Go to <https://business.facebook.com>
2. Click **Create Account** → enter "Hexabyte Limited" + your work email
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
7. **Business Account:** select Hexabyte Limited
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
META_WEBHOOK_APP_SECRET=<same value as META_APP_SECRET>
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
   - `pages_manage_posts`
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
   - `messaging_postbacks`
   - `messaging_optins`
   - `message_deliveries`
   - `message_reads`
   - `feed`

### 6b. Instagram object

1. From the dropdown, switch to **Instagram**
2. Click **Subscribe to this object**
3. **Callback URL:** same as above
4. **Verify Token:** same token (re-use; the bootstrap row matches both)
5. Click **Verify and Save**
6. In the subscription field list, check:
   - `messages`
   - `messaging_postbacks`
   - `message_reactions`
   - `comments`
   - `live_comments`

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
| `pages_manage_posts` | Storyboard 1 (public reply toggle) |
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

1. Confirm production env vars (`META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_APP_SECRET`, `META_OAUTH_REDIRECT_URI=https://easymod.tech/app/channels/oauth-callback`) are set in your prod deployment secrets.
2. Real merchants can now complete the OAuth flow.
3. Monitor:
   - Webhook 200 rate (target >99%)
   - Token refresh job logs (every 6h)
   - Policy decisions table for any unexpected `BLOCK` decisions

---

## Reference

- Code paths: see [../../C:/Users/ahmee/.claude/plans/using-em-ochestrator-agent-to-composed-meadow.md](../../C:/Users/ahmee/.claude/plans/using-em-ochestrator-agent-to-composed-meadow.md) §1
- Architecture plan: [../../C:/Users/ahmee/.claude/plans/redesign-and-restructure-the-enchanted-feigenbaum.md](../../C:/Users/ahmee/.claude/plans/redesign-and-restructure-the-enchanted-feigenbaum.md)
- Permissions justifications: [permissions-justification.md](permissions-justification.md)
- Screencast scripts: [screencast-storyboards.md](screencast-storyboards.md)
- Compliance checklist: [compliance-checklist.md](compliance-checklist.md)
- Data deletion flow: [data-deletion-flow.md](data-deletion-flow.md)
- Test user setup: [test-user-credentials.md](test-user-credentials.md)
