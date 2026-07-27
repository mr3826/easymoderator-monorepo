# Meta OAuth connect–persist–disconnect–reconnect runbook

**Purpose:** close the last open launch gate — the Facebook authorization grant itself has never been exercised end to end. Every state *around* it (nonce validation, denial, popup-block fallback, disconnect confirmation) was verified during the 2026-07-27 audit by code trace and UI walk. What has never run is a real merchant authorizing a real Page.

**Why this is founder-executed:** step 2 requires signing in to Facebook. Entering credentials is something I will not do on your behalf, so the flow stops at the Meta login screen and resumes after you complete it. Everything either side of that is verifiable.

**Prerequisites**

- A Meta account listed under **Roles → Testers** (or Developers/Admins) on the EasyModerator Meta app.
- A **dedicated test Facebook Page** that account administers. Do not use a real merchant Page.
- Production deployed with the audit fixes (see the deploy gate in the main report).

**Do not** send a message to any real customer during this run. Steps 1–11 involve no outbound messaging.

---

## Where the flow lives

| Piece | Location |
|---|---|
| Connection screen | `https://easymod.tech/app/manage-shop/chat-settings` |
| OAuth popup callback | `/app/channels/oauth-callback` (standalone route, outside the auth shell) |
| Initiate | `POST /api/channels/meta/oauth/initiate` |
| Callback exchange | `POST /api/channels/meta/oauth/callback` |
| Persist selection | `POST /api/channels/meta/oauth/connect-asset` |
| List channels | `GET /api/channels/meta` |
| Disconnect | `POST /api/channels/meta/:channelId/disconnect` |

---

## Procedure

### Step 1 — Reach the connection screen

1. Sign in at `https://easymod.tech/signin`.
2. Navigate to **Manage Shop → Chat Settings** (or go straight to `/app/manage-shop/chat-settings`).
3. Open DevTools (`F12`) → **Console** and **Network** tabs before continuing. Leave them open for the whole run.

**Expect:** a Facebook card with a **Connect** button, and no already-connected Page listed.

### Step 2 — Start authorization *(you must do this part)*

1. Click **Connect**.
2. A popup opens on `facebook.com`. If your browser blocks it, the app falls back to a same-tab redirect — that is expected behaviour, not a failure.
3. Sign in to Facebook **with the tester account**.
4. On the permissions screen, keep the default scopes and choose **only the dedicated test Page** when Facebook asks which Pages to grant access to.
5. Click **Continue / Save**.

**Expect:** the popup closes itself and the EasyModerator tab advances on its own. If the popup lingers, that is the `BroadcastChannel` fallback path — note it and continue.

> If you want to verify the **denial** branch instead, click **Cancel** here. The app should show a "connection failed" toast and return the card to its disconnected state, with no channel created. Then re-run from step 2 and approve.

### Step 3 — Callback and nonce validation

Nothing to click. In the **Network** tab confirm:

- `POST /api/channels/meta/oauth/callback` → **200**.
- The request carries both `code` and `state`.

The frontend compares the returned `state` against the nonce it stored in `sessionStorage` under `easymod_oauth_nonce` before opening the popup, and refuses the result on a mismatch. A mismatch surfaces as the toast *"OAuth validation failed — please try again"* and no Page selector.

**Record:** the callback status code, and whether the nonce toast appeared (it should not).

### Step 4 — Page selector

**Expect:** a multi-select list of the Pages the tester account administers, with the dedicated test Page present and named correctly.

**Record:** how many Pages are listed and whether the test Page appears exactly once.

### Step 5 — Select the test Page

Tick **only** the dedicated test Page, then confirm.

**Expect:** `POST /api/channels/meta/oauth/connect-asset` → **200/201**.

### Step 6 — Connection persisted and displayed

**Expect:** the card now shows the Page name, its picture, and a connected status. The **Connect** button is replaced by **Disconnect**.

**Record:** the displayed name matches the Facebook Page name.

### Step 7 — Survives a reload

Press `Ctrl+R`.

**Expect:** the connected Page is still shown after the reload, sourced from `GET /api/channels/meta`, not from client state.

### Step 8 — Backend mapping, no token exposure

In the Network tab open the `GET /api/channels/meta` response.

**Expect** each entry to contain `id`, `shopId`, `platform: "facebook"`, `metaAssetId` (the Page ID), `displayName`, `status`, `webhookSubscribedFields`, `connectedAt`.

**Expect it to contain no token of any kind** — no `page_access_token`, no `access_token`, no `pageAccessToken`. The serializer whitelists fields explicitly (`meta-channel.controller.js:28`) and the encrypted column `page_access_token_ct` is not among them, so a token appearing here would be a release blocker.

**Record:** paste the response with `metaAssetId` intact — Page IDs are public. Do not paste anything that looks like a token; if you see one, stop and say so.

### Step 9 — Disconnect

Click **Disconnect** and confirm in the dialog.

**Expect:** `POST /api/channels/meta/:channelId/disconnect` → **200**, and the card returns to its disconnected state.

### Step 10 — Disconnection persisted

Press `Ctrl+R`.

**Expect:** still disconnected. The channel row is retained with `status: "DISCONNECTED"` — the list filters those out, so the card shows the unconnected state. This is intended: the audit trail survives the disconnect.

### Step 11 — Reconnect once

Repeat steps 2 and 5 with the same Page.

**Expect:** it connects again without an error about a duplicate or already-registered asset. This is the step that catches a disconnect which cleaned up too little (unique-constraint collision) or too much (orphaned settings).

---

## What to send back

For each of the 11 steps: **pass / fail**, plus for the failures the HTTP status, the console error, and what the screen actually showed. Also worth capturing regardless:

- Any red console error during the run.
- Any request in the Network tab with a 4xx/5xx status.
- The `GET /api/channels/meta` response body from step 8.

I can verify steps 3, 5, 8, 9, 10 and 11 directly from the network responses once you paste them, and re-check the persisted state against the API.

---

## Known-good failure modes (not defects)

| What you see | Why |
|---|---|
| Popup blocked, flow continues in the same tab | Deliberate `closeOrRedirect` fallback. |
| Popup does not auto-close, but the app advances | COOP blocks `window.close()` from the opener; `BroadcastChannel` delivers the result instead. |
| Cancelling at Facebook shows "Connection failed" | The denial branch. No channel is created. |
| Disconnected Page still exists in the database | Rows are kept as `DISCONNECTED` for the audit trail rather than deleted. |
