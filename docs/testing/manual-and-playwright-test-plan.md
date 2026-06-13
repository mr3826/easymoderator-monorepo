# Easy Moderator — Full Manual + Playwright Test Plan (Pre-Meta-Review)

**Purpose.** A complete, module-by-module checklist to exercise *every* feature of Easy
Moderator before submitting for Meta App Review. Use it for (a) a human manual pass and
(b) a Playwright (login-required) automated pass driven via the Playwright MCP tools.

**Last updated:** 2026-06-09 · **App:** Easy Moderator (FB + IG f-commerce inbox + AI)
· **Graph API:** v22.0 · **Login product:** Facebook Login for Business

> Companion docs:
> - Reviewer permission map & 2–4 min walkthrough → [`docs/meta-app-review.md`](../meta-app-review.md)
> - Launch hard-gates (DLQ/canary/health) → [`docs/launch/LAUNCH_GATE_CHECKLIST.md`](../launch/LAUNCH_GATE_CHECKLIST.md)

---

## 0. How to use this document

### Legend

| Mark | Meaning |
|------|---------|
| 🔒 | **Meta-review critical** — on the path a reviewer follows; must be flawless |
| 🤖 | Automatable with Playwright (MCP) |
| 🙋 | **Human-only** — cannot be fully automated (real OAuth popup, real DM from a 2nd account, TOTP, push permission) |
| ▢ | Checklist item (tick when verified) |

### Environments

| Env | URL | Notes |
|-----|-----|-------|
| Production | `https://easymod.tech` | Apex is canonical; `www`→apex 301. SPA is same-origin (empty `VITE_API_BASE_URL`). |
| Live test instance | *(per App Review submission notes)* | Used by the Meta reviewer; tester creds supplied separately. |
| Local | `http://localhost:5173` (FE) + API on `:3000` | Backend health on the API host. |

> Do **destructive/state-changing** tests (create order, send reply, connect channel) on
> a **dedicated test shop**, never on a real merchant's live shop.

### Tooling — Playwright via MCP

The Playwright MCP is accessibility-snapshot driven (snapshot → act on a `ref`), not raw
code. Core tools you will use (see Appendix A for the full list):

`browser_navigate` · `browser_snapshot` · `browser_click` · `browser_type` ·
`browser_fill_form` · `browser_select_option` · `browser_wait_for` ·
`browser_take_screenshot` · `browser_console_messages` · `browser_network_requests` ·
`browser_handle_dialog` · `browser_file_upload` · `browser_tabs`

**Always `browser_snapshot` first** to get the current element refs, then act on them.
Take a `browser_take_screenshot` at every "Expected result" checkpoint for the evidence
trail.

### Test accounts you need before starting

| Account | Why |
|---------|-----|
| **Test shop owner** (email+password, **2FA OFF**) | Primary Playwright login. 2FA breaks automation (TOTP) — keep one account without it. |
| Test shop owner **with 2FA ON** | To manually verify the 2FA path once. |
| **Platform admin** (holds `platform_role`) | To test `/admin` panel + AI kill switch. |
| **Facebook test Page + linked IG Business acct** | For the Meta connect flow. The Page admin **must be on the app's Roles roster** (Admin/Developer/Tester) so dev-mode webhooks fire. |
| **Second FB/IG account** | To send the inbound DM and the trigger comment. Also must be on the roster while in Development mode. |

---

## 1. Pre-flight — backend health (no login) 🤖

Run before any UI testing. If these fail, UI failures are downstream noise.

▢ `GET /health` → `200`
▢ `GET /health/ready` → `200` (infra up — launch gate 2)
▢ `GET /health/detailed` → Postgres connected, Redis connected, **Qdrant available**, and
  `embedding.semantic` healthy (guards the RAG price-hallucination fix; provider = `openai`, 384-dim)
▢ `GET /api/version` (or `/version`) returns the deployed build/commit you expect
▢ Launch readiness (from `EasyMod-backend/`):
  ```bash
  BASE_URL=https://easymod.tech ADMIN_TOKEN=<admin-jwt> node scripts/launch-readiness.js
  ```
  → DLQ depth `0` (gate 4), auto-reply canary **fresh** (gate 5), exit code `0`.
▢ CI **green on `main`** (Test & Build Gate) — gate 1.

> Playwright: use `browser_navigate` to the health URLs and `browser_snapshot` /
> `browser_network_requests` to capture the JSON. Most health checks are better as plain
> `curl`/Bash.

---

## 2. Public pages (unauthenticated) 🤖

Route guard note: `publicLoader` **redirects authenticated users away** from `/signin`,
`/signup`, `/forgot-password`, `/reset-password` → `/app`. Test these in a fresh
(logged-out) browser context.

| Route | Module | Verify |
|-------|--------|--------|
| `/` | Landing | Hero, pricing CTA, live-proof/ROI stats render; no console errors; CTA → `/signup` |
| `/pricing` | Pricing | Single **Growth ৳999** plan (300+50 fair-use), 14-day card-less trial copy, top-ups; numbers match `subscriptionPlans.ts` |
| `/privacy-policy` | Privacy | Loads; data-deletion + Meta data-use language present (🔒 Meta requires a reachable privacy URL) |
| `/terms` | Terms of Service | Loads, no broken layout |
| `/signin` | SignIn | Form renders (see §3) |
| `/signup` | Signup | Form renders (see §3) |
| `/forgot-password` | ForgotPassword | Email field + submit |
| `/nonexistent` | NotFound (`*`) | 404 page, link back home |

**Manual:** open each, scan for layout breakage, broken images, console errors, mixed
languages.
**🤖 Playwright per page:** `browser_navigate` → `browser_snapshot` → assert key text →
`browser_console_messages` (expect no errors) → `browser_take_screenshot`.

▢ Language toggle (BN⇄EN) flips copy on every public page; **default is Bengali**; brand
  terms stay English. (See §22.)

---

## 3. Authentication & account 🔒 🤖/🙋

Endpoints: `POST /api/auth/signup` · `/signin` · `/refresh` · `GET /me` ·
`/forgot-password` · `/reset-password` · `/logout` · `/2fa/setup|enable|verify|disable`.
**Session = httpOnly cookies** (not localStorage) — so the browser context holds the
session; Playwright `storageState` *does* capture cookies, so save it after login and
reuse.

### 3.1 Sign in (the Playwright login recipe) 🤖

Real selectors: email = `#email`, password = `#password`, remember-me = `#rememberMe`,
submit = the single `form button[type="submit"]`.

Playwright/MCP sequence:
1. `browser_navigate` → `/signin`
2. `browser_fill_form` (or `browser_type`) → `#email` = test owner email, `#password` = password
3. `browser_click` submit
4. `browser_wait_for` URL `/app` (success) **or** text "2FA" (→ §3.4)
5. Save session: in Playwright code use `context.storageState({ path: 'auth.json' })`; in
   later runs load it so you skip login. With the MCP, the browser context persists within
   a session, so subsequent `browser_navigate('/app/...')` calls stay authenticated.

▢ Valid creds → lands on `/app` (Dashboard)
▢ Wrong password → red error banner ("invalid credentials"), stays on `/signin`
▢ "Remember me" persists (`sessionStorage.rememberMe`)
▢ Email is trimmed + lowercased before submit
▢ Logged-in user hitting `/signin` is redirected to `/app` (publicLoader)

### 3.2 Sign up 🤖
▢ Password-strength meter reacts; weak password rejected (validation schema)
▢ Duplicate email → friendly error
▢ Successful signup → lands authenticated and **Onboarding Wizard opens** (§4)

### 3.3 Forgot / reset password 🤖/🙋
▢ `/forgot-password` with known email → success message (no account enumeration leak)
▢ Reset link/token → `/reset-password` → new password sets → can sign in with it
  (🙋 needs the emailed token unless you can read it from the test mailbox/DB)

### 3.4 Two-factor (TOTP) 🙋
▢ `2fa/setup` shows QR/secret; `2fa/enable` with a valid code turns it on
▢ On next signin, `REQUIRES_2FA` → app routes to `/2fa-verify` (no error banner shown)
▢ Correct TOTP → `/app`; wrong code → error; verify is **rate-limited** (`totpVerifyLimiter`)
▢ Direct nav to `/2fa-verify` without a pending login is guarded (component checks `pendingTwoFactor`)
▢ `2fa/disable` turns it back off
> Automation note: TOTP needs a live code. Either keep the primary test account **2FA-off**,
> or feed Playwright the shared secret and compute the code (`otplib`). Otherwise do 3.4 manually.

### 3.5 Session & logout 🤖
▢ `/logout` clears httpOnly cookies + blacklists token; protected routes now redirect to `/`
▢ Token refresh (`/refresh`) keeps a long session alive without re-login
▢ `protectedLoader`: hitting `/app/*` while logged out → redirect to `/`

---

## 4. Onboarding Wizard 🤖 (`OnboardingWizard.tsx`)

Opens automatically after first signup. Steps (per launch runbook):
▢ Step 1 — **Connect** FB Page / IG (links into Chat Settings — see §6b 🔒)
▢ Step 2 — Add 3–5 products
▢ Step 3 — **"✨ Starter FAQ যোগ করুন (১ ট্যাপে)"** seeds the BD f-commerce FAQ pack
▢ Step 4 — AI mode defaults to **DRAFT** (safe-by-default for first 7–14 days)
▢ Send a test message → AI reply produced → this flips the shop to **Activated**
▢ Wizard is dismissable and does not reappear once completed
▢ Resuming mid-wizard restores the correct step

---

## 5. Dashboard — "আজকের অবস্থা" (Today's status) 🤖 `/app`

▢ Loads as the index route of `/app`
▢ KPI cards populate (today's orders/messages/AI replies) without `NaN`/"Invalid Date"
  (timestamp-serializer gotcha — watch for `createdAt` vs `created_at`)
▢ Empty-state copy renders for a brand-new shop
▢ Quick links navigate correctly
▢ No console/network errors; `browser_take_screenshot`

---

## 6. Manage Shop (`/app/manage-shop`)

Hub (`SettingsHub`) lists: Business Info, Chat, Delivery, Payment.

### 6a. Business Info — "ব্যবসার তথ্য" 🤖 `/manage-shop/business-info`
▢ Loads current shop profile; edit name/phone/address/hours; **Save** persists (reload shows it)
▢ This data **grounds the AI** (shop-operating-context) — e.g. a COD-only shop must not let AI invent bKash. Set COD-only here, then confirm in §9 the AI doesn't hallucinate bKash.
▢ Validation on required fields; error toast on bad input

### 6b. Chat Settings — "চ্যাট" 🔒🙋 `/manage-shop/chat-settings`  ← THE reviewer screen

This single screen drives **all 8 requested Meta permissions** (connect → configure →
monitor). It is the most important screen in the app for review.

**Connect (🙋 human-only — real Facebook popup):**
▢ Click **"Facebook + Instagram একসাথে সংযুক্ত করুন (one popup)"** → a single Facebook
  Login for Business popup opens (`unifiedScopes` = the de-duped 8-permission union)
▢ Consent dialog lists exactly the 8 scopes — **no `business_management`**
▢ After consent, the **asset picker** lists the tester's Page(s) (`pages_show_list`); pick
  the test Page; linked IG Business account is offered if present
▢ Connected channel card shows the **health grid**: Connection = Connected, **Webhook =
  Active** (hard-verified via `GET /{page-id}/subscribed_apps`, not assumed), linked IG
  name + avatar render (`instagram_basic`)

> ⚠️ Playwright **cannot** drive the facebook.com popup reliably (real OAuth + 2FA + bot
> detection). Treat Connect/Disconnect as 🙋 manual. There are **3 near-identical OAuth
> popup handlers** in `ChatSettings.tsx` with a latent cleanup-timing race — watch for the
> popup failing to close or a double-callback; report if seen.

**Auto-reply configuration tab (🤖 once connected):**
▢ Toggle AI mode **OFF / DRAFT / AUTO**; DRAFT writes a suggestion, AUTO sends
▢ `isAiActive` gate respects subscription (trial/Growth active vs lapsed — see §16)
▢ Keyword triggers for comment-to-DM (links to §7)
▢ "Also reply publicly to comments" option present (`pages_manage_posts`)
▢ Persona/tone settings save and reflect in generated replies

**Disconnect (🙋):**
▢ Disconnect unsubscribes the Page webhooks (`pages_manage_metadata` DELETE) and clears the card cleanly

### 6c. Delivery Settings — "ডেলিভারি" 🤖 `/manage-shop/delivery-settings`
▢ List couriers (e.g. Pathao); add credentials (`client_id`/`client_secret`) → saved
▢ Default zones / charges configurable and feed order creation (§12) and delivery RAG
▢ Bad credentials → clear validation error

### 6d. Payment Settings — "পেমেন্ট" 🤖 `/manage-shop/payment-settings`
▢ List gateways (bKash etc.); enable a method with `app_key`/`app_secret`
▢ Toggle enabled/disabled persists
▢ Enabling bKash makes it an allowed payment in the AI grounding (so AI may offer it);
  disabling keeps AI on COD only — cross-check §9

---

## 7. Channels & Comment-to-DM 🔒🙋 `/app/channels/comment-to-dm`

(`/app/channels` redirects to Chat Settings.)
▢ Configure a **trigger keyword** + the public reply + the DM template
▢ 🙋 From the 2nd account, **comment the keyword** on a test Page post / IG media
▢ Event received (`pages_read_engagement` / `instagram_manage_comments`)
▢ Public reply posted on the comment (`pages_manage_posts` / IG comment reply)
▢ DM opened to the commenter and appears in the Inbox (§8)
▢ State machine doesn't double-fire on the same comment (idempotency)

> Dev-mode caveat (not a bug): in **Development mode** Meta only delivers webhooks for
> users **on the App Roles roster**. Comment/DM from a roster account, or test post-approval
> in **Live** mode.

---

## 8. Unified Inbox — "বার্তা" 🔒🤖/🙋 `/app/inbox` (`UnifiedInbox`)

The core product surface. This is the *simplified plain-Bengali* inbox (PR #19) — dev
noise (SSE chip, status enums, confidence %, Meta tag codes) is intentionally stripped;
verify it stays clean.

**Inbound (🙋 needs a real DM from the 2nd account):**
▢ DM the test Page (Messenger) → thread appears within a few seconds (`pages_messaging`, webhook `messages`)
▢ DM the IG account → thread appears in the **same** inbox (`instagram_manage_messages`)
▢ Inbound **photo** reaches the thread and is visible to the AI (burst-coalescer change)

**Reading & filtering (🤖):**
▢ Thread list loads; open a thread → message history renders in order, correct timestamps (no "Invalid Date" — the PR #18 fix)
▢ Channel filter (Messenger / Instagram) works; unread indicators correct
▢ Search finds threads/messages (search wiring fix)
▢ Tags show as **plain-Bengali reasons**, not raw enum codes; tag *values* unchanged (policy-safe)

**Replying (🤖 outbound — works regardless of app mode):**
▢ Type a manual reply → **Send** → delivered back to sender (`POST /{page-id}/messages` / `/{ig-user-id}/messages`); appears in thread as outbound
▢ AI **DRAFT** mode: a suggested reply is offered for the human to edit/send
▢ AI **AUTO** mode: reply is sent automatically (see §9 for quality)
▢ SSE real-time: a new inbound message appears without manual refresh (`useInboxSSE`)
▢ No console errors during compose/send; `browser_take_screenshot` of a completed round-trip

---

## 9. AI auto-reply engine 🔒🙋 (the differentiator)

Exercised through real inbound messages (§8) but verified for *quality* here.

▢ **Round-trip (🔒 the reviewer's beat):** inbound DM → AI auto-reply delivered back to sender
▢ **Burst coalescing:** fire 3–4 rapid messages → AI responds **once** (8s window), no typing-dot, context merged
▢ **RAG grounding / price accuracy (regression):** ask a product price in chat → AI quotes the **live** price from the catalog, never a hallucinated number (Qdrant UUIDv5 fix + live-price enrichment). If `/health/detailed.embedding.semantic` is unhealthy, expect degraded answers — fix infra first.
▢ **Shop-context grounding:** on a **COD-only** shop, ask "bKash এ দেওয়া যাবে?" → AI must **not** invent bKash (shop-operating-context). Flip on bKash in §6d → AI may now offer it.
▢ **Banglish / Bengali intent:** romanized Bengali ("dam koto?") is understood; replies in Bengali by default
▢ **Sentiment:** angry/negative message is detected (routing/flagging)
▢ **Voice:** a voice note inbound is transcribed/handled (voice-processing) — if enabled
▢ **DRAFT vs AUTO** honored per Chat Settings
▢ **Plan gate:** when subscription is lapsed/trial-expired, `isAiActive=false` → AI does **not** auto-send (see §16)
▢ **Emergency kill switch** (admin §21): flipping it OFF immediately stops auto-replies platform-wide

---

## 10. Products & Categories 🤖

**Products** (`/app/products`, `/add`, `/:id`, `/:id/edit`):
▢ List loads with images/prices; pagination/search work
▢ **Add product**: name, price, description, image upload (`browser_file_upload`), category → Save → appears in list
▢ Product detail page renders; **Edit** updates persist
▢ Newly added/edited product is **embedded for RAG** (after save, its price is answerable by the AI in §9) — confirms the embedding store accepted it
▢ Validation: negative/empty price rejected

**Categories** (`/app/categories`, `/create`, `/:id`, `/:id/edit`, `/:id/:subId`):
▢ Create category + subcategory; assign products; rename; delete (guard against deleting non-empty?)
▢ Category/subcategory detail pages load correct children

---

## 11. Customers 🤖 `/app/customers`
▢ List of customers (auto-created from conversations/orders) loads
▢ Customer detail shows order/message history; name placeholder bug fixed (real name shown, not literal placeholder)
▢ Search/filter works

---

## 12. Orders — "অর্ডারসমূহ" 🤖 `/app/orders`
▢ Order list loads; statuses render (no "Invalid Date")
▢ **Manual order creation** (the PR #14 fix): create an order with a **structured
  `delivery_address` object** (not a string) → succeeds (no 400). Validator uses
  `Joi.alternatives`; entity JSON-(de)serializes the address.
▢ Order links to a customer + products; totals compute (incl. delivery charge from §6c)
▢ Status transitions (pending → confirmed → shipped …) persist
▢ Order session flow (`/order-session`) — cart/checkout state from chat — produces an order
▢ COD vs online-payment order reflects the shop's enabled methods (§6d)

---

## 13. Knowledge base / FAQ (RAG) 🤖 `/app/knowledge`
▢ **"✨ Starter FAQ যোগ করুন (১ ট্যাপে)"** seeds the BD f-commerce pack in one tap
▢ Add a custom FAQ (Q/A) → Save → it is **embedded** and the AI can answer from it (§9)
▢ Edit/delete an entry; AI stops citing deleted content
▢ Knowledge entries with non-ASCII IDs store correctly (UUIDv5 normalization — no silent drop)

---

## 14. Delivery / courier / RTO shield 🤖
▢ Delivery RAG answers delivery-time/zone questions in chat from configured zones
▢ Courier webhook updates an order's delivery status (`/webhooks/courier`) — simulate a status callback
▢ **RTO Shield** (`/rto-shield`): risky-order signal surfaces (high return-to-origin risk flag) where exposed in UI

---

## 15. Payments + payment webhooks 🤖/🙋
▢ Bangladesh payment (bKash) initiation from an order produces a valid payment intent (if a sandbox is configured)
▢ Payment webhook (`/webhooks/payment`) marks the order paid (simulate callback)
▢ Reconciliation/invoice records created (`invoice`, `reconciliation` modules)
▢ Failed/cancelled payment leaves the order in a correct non-paid state

---

## 16. Subscription & billing 🤖 `/app/subscription`
▢ New shop shows **14-day card-less trial** as a *status*, with days remaining
▢ Plan card shows **Growth ৳999** (300 included + 50 fair-use); usage meter accurate
▢ **Notify-before-limit**: approaching the message cap surfaces a warning (push/in-app)
▢ **Top-up** purchase flow increments the allowance
▢ Trial-expired / lapsed → `isAiActive=false` → AI auto-reply disabled (cross-check §9) and an upgrade prompt shows
▢ **Partner program**: `/partner` apply form submits; `/admin/partner` (platform) can review/approve; partner per-order billing spine records charges
▢ No referral/reseller UI anywhere (both removed) — confirm no dead links

---

## 17. Notifications (web-push) 🤖/🙋
▢ 🙋 Browser asks for notification permission on opt-in; granting subscribes (`push-subscription`)
▢ A new inbound message / near-limit event fires a push (the push-notif bug was fixed)
▢ Unsubscribe stops pushes; no duplicate subscriptions on re-grant
▢ In-app notification bell (DashboardLayout) shows unread count

---

## 18. Reports & Analytics 🤖 `/app/reports`
▢ Reports page loads charts/tables without errors; date ranges filter
▢ Numbers reconcile with Dashboard KPIs and `/api/analytics/growth` (activation/retention)
▢ Export (if present) downloads a valid file

---

## 19. Audit logs 🤖 `/app/audit-logs`
▢ Sensitive actions (channel connect/disconnect, AI mode change, payment-cred change, role change) are logged with actor + timestamp
▢ Filter/search by action/date works
▢ Log entries are read-only (no client-side tampering)

---

## 20. Shop user management (shop admin) 🤖 `/app/admin/users` (`AdminRoute`)
▢ Only a shop **admin** role can open it (non-admin → guarded/redirect)
▢ Invite/add a team user; assign role; role change is audited (§19)
▢ Remove a user revokes their access

---

## 21. Platform Admin panel 🔒🤖 `/admin` (internal ops — `PlatformAdminRoute` + backend `requirePlatformAdmin`)
▢ A user **without** `platform_role` hitting `/admin` is blocked (frontend guard is UX-only; **backend is the real authority** — confirm the API 403s too)
▢ A `platform_role` user sees: **Dashboard**, **Shops** (`/admin/shops`), **Shop detail** (`/admin/shops/:id`), **Audit logs** (`/admin/audit-logs`)
▢ Shops list/search/paginate; shop detail shows plan, channels, health
▢ **Emergency AI kill switch** toggles platform-wide auto-reply OFF/ON (cross-check §9) — action is audited
▢ Admin audit logs render (reuses AuditService)
▢ Failed-jobs view (`/admin/failed-jobs`) shows DLQ/retry state
> Reminder: `main` is **not** branch-protected; the admin migration must be in the
> **custom runner format** (`{name, up, down}` raw SQL) or deploy crashes. Not a UI test,
> but verify the panel loads post-deploy (a bad migration previously caused a ~7-min outage).

---

## 22. Internationalization 🤖
▢ Default language = **Bengali**; brand terms stay English
▢ Toggle EN⇄BN on a public page **and** inside `/app` — copy switches, no missing-key
  fallbacks like `auth.signin.x` showing raw
▢ Legal pages (Privacy/Terms) — watch for known **hardcoded** strings that don't translate
▢ No layout breakage when Bengali text is longer than English

---

## 23. Consent / GDPR / data deletion 🔒
Meta requires a working data-deletion path and clear data use.
▢ Privacy Policy (§2) is publicly reachable and states what Meta data is used + retention
▢ Consent is recorded at connect time (`consent` module) and visible/auditable
▢ **Data deletion request** (deauthorize / deletion callback) removes the user's data and returns Meta's expected confirmation/status URL
▢ Disconnecting a channel stops all further data collection for it (webhook unsubscribed — §6b)

---

## 24. Webhooks — verification 🔒 (mostly backend)
▢ **Meta webhook verify** (`GET` with `hub.challenge`) echoes the challenge using the
  configured verify token (config reads `META_APP_SECRET` — the webhook-secret incident fix)
▢ Signed event POSTs validate the `X-Hub-Signature-256` against the **app secret** (403 on bad signature)
▢ `messages`, `messaging_postbacks`, `feed`/`comments`, `message_deliveries`/`reads` fields are handled
▢ Courier + payment webhooks (§14/§15) validate and update state
> Don't confuse `META_WEBHOOK_APP_SECRET` (stale) with `META_APP_SECRET` (correct) — past 403 incident.

---

## 25. 🔒 Meta App Review critical path (consolidated reviewer flow)

This is the exact end-to-end the reviewer runs (from `meta-app-review.md` §3). Run it last
as the single most important rehearsal. Record a screenshot/clip at each beat.

1. ▢ Log in to the live test instance (tester creds from submission notes) → `/app`
2. ▢ Go to **Settings → Chat Settings** (`/app/manage-shop/chat-settings`)
3. ▢ Click **"Facebook + Instagram একসাথে সংযুক্ত করুন (one popup)"** → single FB Login for Business popup
4. ▢ Grant consent — the 8 scopes, **no `business_management`**
5. ▢ Asset picker lists the Page (`pages_show_list`); pick Page + linked IG
6. ▢ Channel card health grid: Connected + **Webhook: Active** (hard-verified) + IG name/avatar (`instagram_basic`)
7. ▢ From a **roster** 2nd account, DM the Page **and** the IG → both land in the Shared Inbox (`pages_messaging`, `instagram_manage_messages`)
8. ▢ AI **auto-reply** delivered back to the sender
9. ▢ Open the thread → send a **manual** human reply (compose→send path)
10. ▢ *(optional)* Comment a trigger keyword on a post/IG media → event received → public reply + DM (`pages_read_engagement`, `pages_manage_posts`, `instagram_manage_comments`)

**State the dev-mode caveat in narration** when sending the inbound DM ("sent from a tester
account on the app roster, as required in Development mode"). Outbound sends (8–9) and
connect/verify (1–6) work regardless of app mode; only inbound (7,10) is roster-gated in dev.

---

## 26. Cross-cutting / non-functional 🤖
▢ **Responsive**: `browser_resize` to 390×844 (mobile) — sidebar collapses, inbox usable, no overflow. The target user is a non-tech BD shop owner on a phone.
▢ **401 handling**: with an expired/cleared session, protected API calls redirect to login, not a white screen
▢ **Error boundaries**: every route has `RouteError`; force a failed load → graceful error, not a crash
▢ **Empty states**: brand-new shop shows helpful empty states across Inbox/Orders/Products/Customers
▢ **Console hygiene**: `browser_console_messages` shows no errors on the main flows
▢ **Network**: `browser_network_requests` — no 4xx/5xx on happy paths; no secrets/tokens in URLs
▢ **Security headers / rate limits**: login + 2FA-verify are rate-limited (don't lock the test account during automation)

---

## 27. Master checklist (printable)

**Pre-flight**
- [ ] 1. Backend health (DB/Redis/Qdrant/embedding) + version + DLQ 0 + canary fresh + CI green

**Unauthenticated**
- [ ] 2. Public pages (Landing/Pricing/Privacy/Terms/404) + language toggle
- [ ] 3. Auth — signin/signup/forgot+reset/2FA/logout/session/guards

**Authenticated core**
- [ ] 4. Onboarding wizard
- [ ] 5. Dashboard
- [ ] 6a. Business Info  · [ ] 6b. **Chat Settings (Meta connect) 🔒** · [ ] 6c. Delivery · [ ] 6d. Payment
- [ ] 7. Comment-to-DM 🔒
- [ ] 8. Unified Inbox 🔒
- [ ] 9. AI auto-reply (round-trip, burst, RAG price, grounding, banglish) 🔒

**Commerce / data**
- [ ] 10. Products & Categories · [ ] 11. Customers · [ ] 12. Orders (+manual order) · [ ] 13. Knowledge/FAQ

**Ops / billing**
- [ ] 14. Delivery/RTO · [ ] 15. Payments+webhooks · [ ] 16. Subscription/trial/partner · [ ] 17. Notifications · [ ] 18. Reports/Analytics · [ ] 19. Audit logs

**Admin / platform**
- [ ] 20. Shop user mgmt · [ ] 21. Platform admin panel + AI kill switch 🔒

**Compliance / cross-cutting**
- [ ] 22. i18n · [ ] 23. Consent/GDPR/deletion 🔒 · [ ] 24. Webhook verify 🔒 · [ ] 26. Responsive/errors/empty/console

**Final**
- [ ] 25. **Meta reviewer critical path — full rehearsal 🔒**

**Sign-off:** ____________________  **Date:** __________  **Build/commit:** __________

---

## Appendix A — Playwright MCP quick reference

| Tool | Use |
|------|-----|
| `browser_navigate` | Go to a URL |
| `browser_snapshot` | **Accessibility tree + refs** — do this before acting |
| `browser_click` | Click an element by `ref` |
| `browser_type` | Type into a field |
| `browser_fill_form` | Fill multiple fields at once |
| `browser_select_option` | Pick from a `<select>` |
| `browser_press_key` | Keyboard input |
| `browser_hover` / `browser_drag` / `browser_drop` | Pointer interactions |
| `browser_file_upload` | Product/image uploads (§10) |
| `browser_wait_for` | Wait for text/URL/timeout |
| `browser_take_screenshot` | Evidence at each checkpoint |
| `browser_console_messages` | Assert no console errors (§26) |
| `browser_network_requests` | Inspect API calls/status (§1, §26) |
| `browser_handle_dialog` | Accept/dismiss native dialogs |
| `browser_tabs` | Manage tabs (the OAuth popup opens a new tab — but see 🙋 limits) |
| `browser_resize` | Mobile/responsive (§26) |
| `browser_evaluate` / `browser_run_code_unsafe` | Read storage, compute, or assert in-page (use sparingly) |

**Known selectors:** SignIn `#email` · `#password` · `#rememberMe` · `form button[type="submit"]`.
Sidebar nav is Bengali (`আজকের অবস্থা`=Dashboard, `অর্ডারসমূহ`=Orders, `বার্তা`=Inbox,
`পণ্যসমূহ`=Products, `চ্যাট`=Chat, `ডেলিভারি`=Delivery, `পেমেন্ট`=Payment, `সাবস্ক্রিপশন`=Subscription) —
prefer `getByRole('link', { name: 'বার্তা' })` or snapshot-refs over English text.

**Session reuse:** save `context.storageState()` after a successful login (httpOnly cookies
*are* captured) and load it in later runs to skip the login form.

---

## Appendix B — Test data fixtures (prepare before the run)

- **Test shop** (dedicated, disposable) with: 5 sample products (with images + prices), 2
  categories + 1 subcategory, the Starter FAQ pack seeded.
- **Business Info** set to **COD-only first** (to prove the bKash anti-hallucination), then
  a second pass with bKash enabled.
- **Delivery**: at least one courier + one zone with a charge.
- **FB test Page + linked IG Business account**, Page admin **on the App Roles roster**.
- **Second FB/IG account** (also on the roster in dev mode) to send DMs/comments.
- **Platform-admin** account (`platform_role`) for §21.
- Known product + price to verify the AI quotes it exactly (RAG check, §9/§10).

---

## Appendix C — Known caveats & gotchas (read before filing a "bug")

1. **Dev-mode webhooks are roster-gated** — inbound DMs/comments only arrive for users with
   an app role. Not a defect (§7, §25).
2. **OAuth popup is human-only** — Playwright can't drive facebook.com login reliably; and
   `ChatSettings.tsx` has 3 near-duplicate popup handlers + a latent cleanup-timing race.
   Watch for a popup that won't close / double callback (§6b).
3. **2FA blocks automation** — keep one test account 2FA-off, or compute TOTP from the secret.
4. **Timestamp serializer** — Sequelize `underscored` returns `createdAt` (not `created_at`);
   regressions show as "Invalid Date". Already fixed in Inbox/Orders — re-check after any change.
5. **Embedding/RAG depends on infra** — if `/health/detailed.embedding.semantic` is
   unhealthy or Qdrant is down, AI price answers degrade. Fix infra before judging AI quality.
6. **Webhook secret** — must read `META_APP_SECRET` (not stale `META_WEBHOOK_APP_SECRET`),
   or events 403 (§24).
7. **Migration format** — custom runner needs `{name, up(sequelize), down(sequelize)}` raw
   idempotent SQL; wrong format crashes deploy → outage. Verify §21 panel loads post-deploy.
8. **Don't test on a real merchant shop** — connect/send/order are real, outward-facing actions.
