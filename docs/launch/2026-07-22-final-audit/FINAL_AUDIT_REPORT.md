# EasyModerator — Final Audit Report
## Meta App Review Readiness + Bangladesh SME/F-Commerce Launch

**Audit date:** 2026-07-22 · **Branch:** `codex/final-audit` (3 ahead / 16 behind `origin/main`)
**Scope:** Full codebase — `EasyMod-backend`, `EasyMod-frontend`, `EasyMod-growth`, infra (docker-compose.prod.yml, Caddyfile, CI/CD), `docs/`, and all prior launch/smoke reports.
**Evidence base:** 4 parallel deep audits + empirical runs (backend Jest suite, `launch:check`).

---

## 1. Executive Verdict (honest, no sugarcoating)

**Engineering quality: B+ / A−. Launch readiness today: NOT READY — and the gap is mostly operational, not architectural.**

The core product — an AI Messenger sales assistant for BD f-commerce sellers — is genuinely well built: a disciplined queue-based pipeline (webhook → burst-coalesce → guarded AI → policy-gated send → DLQ + canary), fail-closed webhook security, encrypted tokens, a real Bangla locale, bKash/BDT/BD-courier integration, and a differentiated RTO/fake-order shield. **1,085 tests across 84 suites pass** (verified by running them this audit).

But it is not launchable today, for five reasons that have nothing to do with code quality:

1. **Meta App Review is not submitted** (`docs/launch/BD_LAUNCH_EXECUTION_TODOS.md:9`). Until approved, the app sits in Development mode and no real seller's Page can connect. This is the longest-lead-time item — start it now.
2. **Payments have never worked in production.** Zero real taka ever charged. bKash top-up returned 400 and the webhook 503 in the 07-06 live acceptance test (`docs/release/LAUNCH_BLOCKER_STABILIZATION_REPORT.md:193-213`), and the root cause is still unfixed: the CI deploy never writes `BKASH_*` credentials, `BKASH_WEBHOOK_SECRET`, `SLACK_ALERT_WEBHOOK_URL`, or backend `SENTRY_DSN` into the droplet env (`.github/workflows/ci-cd.yml:272-354` vs `.env.prod.example:66-71`).
3. **Production is running unmerged code on a freshly wiped database.** The droplet runs `f1c7ee5e` (an unmerged branch), the DB was rebuilt 2026-07-21, and **zero Facebook Pages are currently connected** (`MESSENGER_PIPELINE_RECOVERY_REPORT.md`). Meanwhile this working tree holds 13 modified load-bearing files (compose, Caddyfile, CI, message-worker, meta-channel stack) plus the entire uncommitted Growth OS module. Three divergent versions of reality exist: `main`, this branch, and the droplet.
4. **A perimeter of unauthenticated legacy endpoints bypasses all the good engineering** (details §5, findings F1–F5) — including one that lets anyone on the internet spend any shop's LLM budget and inject messages into their conversations.
5. **No off-site backups, and alerting/error-tracking are dark in prod.** Nightly dumps live on the same droplet they protect (`.github/workflows/backup.yml:32-57`); Slack alerts and Sentry are disabled because the CI-rendered env omits them. If the box dies, the business dies with it — silently.

**Realistic path:** the Meta-review blockers (§4) and the security perimeter (§5) are ~1–2 weeks of focused work. Operational hardening (env, backups, alerting, git hygiene) is days, not weeks. The long pole is Meta's own review timeline — submit as early as possible.

---

## 2. Critical Framing Correction: This Is a Messenger-DM-Only Product

The audit brief describes "comment + chat moderation." **The product does zero comment moderation — deliberately.** The `commentToDm` module is an empty shell (only `__tests__/` remains), the `feed` webhook is unsubscribed (`MetaMessengerProvider.js:33-35`), comment events are explicitly ignored, and the public marketing says so: *"Messenger DM-only … no comment or cold-DM automation"* (`EasyMod-frontend/src/i18n/locales/en.json:221`).

This is a **smart scope decision** (it shrinks the review surface to 3 low-friction scopes), but it has two consequences:

- **Every public artifact must say "Messenger DM automation" and nothing more.** If the Meta app listing, App Review submission text, screencast narration, or pitch deck mentions comment auto-moderation or private replies, that's an instant functionality-mismatch rejection.
- Comment moderation later = `pages_read_engagement` + `feed` webhooks + a **fresh App Review**. Treat it as a post-launch phase, not a patch.

---

## 3. What's Genuinely Strong (verified, not padding)

| Area | Evidence |
|---|---|
| Test suite | **84 suites / 1,085 tests passing** (ran this audit). Covers order state machine, conversation state, consent, policy engine, intent router, confidence gate, RAG, Meta webhooks, growth-os authz, pipeline jobs. Minor: one worker-process teardown leak forcing `--forceExit`. |
| Scope hygiene | Exactly 3 scopes requested — `pages_show_list`, `pages_messaging`, `pages_manage_metadata` — **all demonstrably used, zero unused**. Tests pin the scope set and forbid `instagram_*`/`business_management` (`MetaMessengerProvider.test.js:35-50`). Meta reviewers love this. |
| Webhook security | HMAC-SHA256 signature verification, timing-safe, **fail-closed when `META_APP_SECRET` is unset** (`meta-webhook.routes.js:151-162`). Three-layer idempotency (external_id dedup, unique-constraint tolerance, worker-side Redis NX 24h). |
| 24-hour policy | Fail-closed policy engine; every outside-window send denied; bilingual STOP opt-out hard-enforced with append-only consent audit events; mandatory owner-uneditable AI disclosure prepended to first reply (`message-worker.js:501-521`). Burst coalescing prevents reply spam. |
| Secrets at rest | Meta page tokens AES-256-GCM with versioned envelope (`meta-channel.entity.js:54-92`); courier/payment creds encrypted; bcrypt passwords; hashed single-use reset tokens; no secrets committed to git (verified). |
| Tenant isolation (service layer) | `verifyShopAccess` + `shop_id` in every WHERE across order/customer/product/subscription services; all raw SQL uses bound replacements. (Undermined only by F1/F2 below — at the route layer.) |
| AI pipeline resilience | Gemini-lite → Gemini-pro → OpenAI failover with circuit breaker; LLM failure → keyword matcher → static bilingual fallback + ops page; confidence gate holds low-confidence replies for humans; knowledge gaps captured for FAQ mining. |
| BD localization | Full Bangla locale with **exact 1:1 key parity (1,727 keys, verified programmatically)**; Banglish-aware AI defaults; BDT everywhere (৳999/mo Growth plan); BD phone validation; BD division/district/upazila geography data; Pathao/Steadfast/RedX courier credential + booking UI. |
| RTO Shield | Network-shared fake-order/fraud signal across shops — a genuinely differentiated f-commerce feature nobody else in the segment offers. |
| Meta review paperwork | Submission sheet, per-permission use-text, reviewer guide, screencast storyboards, test-user spec — unusually well prepared (`docs/meta-app-review-submission.md`, `.easymod/meta-app-review/`). Privacy Policy includes a Meta data-deletion section with the registered callback URL. |
| Frontend engineering | Hardened HTTP client (CSRF init, 401 refresh queue, retry/backoff), SSE realtime inbox, 24h-window enforced in the composer with merchant-friendly Bangla deny messages, per-channel health grid with reconnect CTAs, multi-page picker, dedicated "no FB page found" recovery panel. Mobile-first layout with bottom tab bar, PWA-installable. |

---

## 4. Meta App Review Readiness

### 4a. Permissions posture: READY (best part of the submission)

| Scope | Used? | Verdict |
|---|---|---|
| `pages_show_list` | Page listing in OAuth connect | Justified |
| `pages_messaging` | Inbound webhook + outbound send | Justified |
| `pages_manage_metadata` | `subscribed_apps` subscribe/unsubscribe | Justified |

Graph API pinned v22.0. No Instagram, no business_management, no comment scopes. **The permissions portion of review would likely pass as-is.**

### 4b. Rejection-risk items — fix BEFORE submitting

| # | Severity | Finding | Location |
|---|---|---|---|
| M1 | **P0** | **Data Deletion callback is a functional no-op.** Meta's `signed_request.user_id` is an **app-scoped** ID; `Customer.channel_user_id` stores **page-scoped** PSIDs → the delete matches zero rows, yet returns 200 + confirmation code. Compounded by: conversations/messages survive via `onDelete: SET NULL`, and `Order` is `onDelete: RESTRICT` so deletion **throws** for any customer with orders — the error is swallowed and Meta still gets success. Meta spot-checks deletion flows; this is the single highest technical compliance risk. | `meta-webhook-gdpr.handler.js:152-175`, `entities.js:182-185, 245-249` |
| M2 | **P1** | **Deauthorize doesn't deauthorize.** Only sets a flag on (zero-matching) Customer rows; channels stay `CONNECTED` on dead tokens; no webhook unsubscribe; no owner notification. After a merchant removes the app, inbound messages silently black-hole into the DLQ. Consent audit methods `recordDeauthorize`/`recordDataDeletion` exist but are **never called** → consent counters always read 0. | `meta-webhook-gdpr.handler.js:186-240`, `consent.service.js:219-231` |
| M3 | **P1** | **Token-invalidation blind spot.** The 6-hourly refresh job can never fire (page tokens stored `token_expires_at=null`, and `fb_exchange_token` is invalid for page tokens anyway). Send-path OAuth errors (code 190) never flip channel status, and **the shop owner is never notified in-app** — silent per-shop reply outages until someone reads Slack. | `meta-token-refresh.job.js:59-65`, `meta-oauth-exchange.js:48-78`, `MetaMessengerProvider.js:219` |
| M4 | P2 | **Stale compliance docs.** `.easymod/meta-app-review/compliance-checklist.md:35-37` claims a "170 DMs/hour leaky bucket" and `POST_PURCHASE_UPDATE` tag usage — **both false in current code** (the rate counter ZSET has no writer since Phase 5; no message tag is ever attached). Correct before anyone quotes internal docs to Meta. Same stale claim in `message-worker.js:14`. | `rateLimit.rule.js:27-52`, `MetaMessengerProvider.js:401-408` |
| M5 | P2 | **`appsecret_proof` inconsistent** — present on token exchange/listing, absent on send, subscribe, ping. If "Require App Secret Proof" is enabled in the dashboard, sends break. Pick one posture. | `MetaMessengerProvider.js:264-300, 422-426, 438-450` |
| M6 | P2 | **Raw long-lived user token round-trips the browser** as `tempToken`; the server-side stored copy is discarded unread and the client-echoed token trusted. Tighten (use the server-side copy) before any security review. | `meta-oauth.service.js:75-79, 95-108` |
| M7 | P3 | **Founder tasks pending:** Meta Business Verification, app Live mode toggle, screencast recording, 1Password credential share (`.easymod/meta-app-review/compliance-checklist.md:44-50`), plus connecting a Page to the smoke tenant and proving a positive webhook challenge (recovery-report P0s). | — |
| M8 | P3 | **Demo-script landmines:** Get Started/postback buttons produce silence (postbacks not subscribed); transactional notifications outside 24h are silently dropped (by design). Keep both out of the reviewer screencast. | `meta-webhook-events.handler.js:481-484` |

**Bottom line for Meta:** submit with the Messenger-only story and the 3-scope set — that part is strong. But fix M1 and M2 first; a data-deletion callback that deletes nothing is exactly what Meta's enforcement probes catch, and a post-approval strike is far worse than a delayed submission.

---

## 5. Security Findings (backend perimeter) — the honest bad news

The service-layer engineering is good. The problem is a ring of legacy/unauthenticated endpoints that bypass all of it. **F1–F3 must be fixed before any paid traffic.**

| # | Severity | Finding | Location |
|---|---|---|---|
| F1 | **HIGH** | **`/api/ai-chatbot/*` is completely unauthenticated.** Anyone can POST `{shop_id, customer_channel_id, message}` to `/process` and (a) burn any shop's LLM spend, (b) inject fake customer messages into their conversations, (c) drive order sessions. Also exposed: `GET /context/:conversation_id` (full chat history, no tenant check) and `POST /handoff/:conversation_id` (force human-handoff on arbitrary conversations). Legacy of the removed n8n flow — the worker replaced it. **Delete the router or gate it behind an internal secret.** Combined with F9's SSRF this is practically exploitable. | `ai-chatbot.routes.js:52,58,64`, mounted bare at `routes.js:49` |
| F2 | **HIGH** | **Cross-tenant SSE stream leaks live messages.** `getEventStream` lets a user-controlled `x-shop-id` header/`shop_id` query **override the JWT**, with no `UserShop` check. Any authenticated user can subscribe to any shop's realtime message events (which carry full message content). Live cross-tenant PII leak. | `conversation.controller.js:602-623` |
| F3 | **HIGH** | **Courier webhooks accept unsigned requests.** RedX/Steadfast/Pathao validators skip verification entirely when the signature header is omitted, and use non-timing-safe compares. Anyone who guesses a tracking number can flip delivery states — this **directly corrupts PARTNER-plan per-delivered-order billing** and RTO stats. | `courier-webhook.routes.js:57,97,130` |
| F4 | **MED** | **`/api/analytics/growth` always returns 403** — it checks `req.user.role`, which `authenticate` never sets. This silently breaks your own `launch:check` activation gate (the go/no-go tool can't read its metric). | `analytics.routes.js:103`, `auth.middleware.js:60-65` |
| F5 | **MED** | **More unauthenticated writes:** `POST /api/analytics/knowledge-gap` (plant arbitrary "unanswered questions" into any shop's FAQ queue — social-engineering vector) and `POST /api/webhooks/owner/payment-confirmation/:id/:action` (approve/reject payments with no signature, no pending-state check, no rate limit — replayable). | `analytics.routes.js:76`, `payment-webhook.routes.js:43-45` |
| F6 | **MED** | Payment-callback HMAC silently optional in all environments if `PAYMENT_CALLBACK_HMAC_SECRET` unset; IP allowlist trusts raw `X-Forwarded-For`; `timingSafeEqual` throws on length mismatch → 500. | `payment-callback-auth.middleware.js:24-58` |
| F7 | **MED** | `DELIVERY_ENCRYPTION_KEY` undocumented and unenforced in config, yet the entity **throws in prod when unset** → courier connect crashes on any fresh deploy that followed the documented env list. | `delivery-integration.entity.js:15-17`, `config.js:40-54` |
| F8 | **MED** | Telegram webhook secret optional — forged bot updates accepted when unset. | `telegram-notification.service.js:264-265` |
| F9 | **MED** | Blind SSRF: LLM image fetcher pulls arbitrary URLs server-side (no host allowlist) and forwards to Gemini. Reachable via F1. | `llm.service.js:39-45` |
| F10 | **MED** | Trap-for-the-next-dev: unused `webhook-signature.middleware.js` accepts the HMAC secret **as a request header** (self-defeating). Exported, documented "SECURITY CRITICAL". Delete it. | `webhook-signature.middleware.js:52` |
| F11 | LOW | Invoice PDFs and conversation attachments world-readable under unauthenticated `/uploads` (capability URLs, no expiry). Account-lockout DoS by email. Regex-blacklist XSS sanitizer corrupts legitimate Bangla/shop text and is bypassable. Rate limiter fails open on Redis loss (×cores with PM2). | `app.js:227`, `auth.service.js:53`, `xss-sanitize.middleware.js`, `app.js:133` |

**Also:** 22 test suites — including **all auth suites, payment webhooks, and order/product controllers** — are excluded from ever running (`jest.config.js:4-42`, admitted "never ran in CI"). The test gate exempts exactly the code most likely to break. Frontend Vitest is `continue-on-error` in CI. There is no coverage floor.

---

## 6. Bangladesh Market Fit — honest scorecard

| Requirement | Status | Notes |
|---|---|---|
| Bangla UI | ⚠️ **Exists but opt-in** | Full parity locale, quality translations — but detection is `localStorage`-only with **English fallback** (`i18n/index.ts:20-24`). A first-time Dhaka seller on a fresh browser sees English. For this market that's backwards: default to `bn`, let English be the opt-in. |
| Bangla AI | ✅ Strong | `primary_language` defaults to Banglish; greeting/closing defaults in Bangla; STOP keywords bilingual. |
| BDT pricing | ✅ | ৳999/mo Growth, ৳9,990/yr, top-ups ৳250–1,000, Partner ৳10–15/delivered order. |
| bKash | ⚠️ **Code yes, prod no** | Tokenized checkout + subscription/top-up flows written; **never charged real money**; creds missing from CI env. No Nagad/Rocket (acceptable at launch; bKash dominates). |
| COD / advance-payment rules | ✅ Strong | COD + bKash self-MFS with full/delivery/percentage/fixed advance rules — a real f-commerce pain killer. |
| Couriers | ⚠️ Code yes, prod no | Pathao/Steadfast/RedX credential + booking UI; booking returned 500 in live acceptance (no integration configured). |
| RTO/fake-order shield | ✅ **Differentiated** | Network-shared fraud signals across shops. Lead with this in marketing. |
| Trial | ✅ | 14-day card-less, auto-created, expiry job, AI pauses on expiry. |
| Revenue enforcement | ⚠️ **Fail-open by design** | Missing subscription row = free AI forever (`subscription.access.js:23-26`); conversation quota is a soft meter — overage accrues but never cuts off. Fine for a 10-shop pilot; revenue leakage at scale. |
| Support surface | ❌ **Missing** | No help docs, no in-app support, **no WhatsApp/Messenger support channel**; the landing "Contact" section contains no contact info (`LandingPage.tsx:591-615`). For low-digital-literacy sellers this is a top-3 churn driver. |
| Legal pages | ⚠️ English-only | Privacy Policy & Terms hardcoded English; merchants accept terms they can't read. Also a Meta-review optics weakness. |
| Onboarding | ⚠️ Checklist, not wizard | 4-task checklist hub works (connect channel → shop profile → first product → AI settings), good recovery states. But no Bangla-first guided path, and the landing "See demo" button is fake (links to `/signin`). |
| Signup trust | ⚠️ | No email verification step. |
| Broken windows | ❌ | 4 finished pages unreachable from nav (`/app/reports`, `/app/customers`, `/app/categories`, `/app/audit-logs`); Categories edit-nav missing `/app` prefix → NotFound; Reports channel performance hardcoded to 0; unused billing components carry stale "750 BDT/month" copy; `ErrorBoundary.tsx` contains `// ...existing code...` tool leftovers; route-error screens show raw English `error.message`. |

---

## 7. Infrastructure & Operations

- **Stack is coherent for an MVP**: single DO droplet, Caddy (auto-TLS), backend + BullMQ worker + two nginx SPAs + Postgres 15 + Redis 7 (AOF) + Qdrant; sessions/queues in Redis; webhooks enqueue-and-200.
- **But:** no container memory limits (Postgres/Qdrant unbounded → OOM contention); worker and Qdrant have **no healthchecks**; Qdrant pinned `:latest`; no log aggregation; no staging environment; no rollback job (`:latest` retag is one-way); backups on-box only, 7-day retention, unencrypted, **never restore-drilled**; deploy runs as root over SSH; **prod currently runs an unmerged branch**; `api.easymod.tech` TLS still broken.
- **Two divergent prod definitions exist** (PM2 `ecosystem.config.js` vs docker-compose) — and the PM2 one would turn every API process into a full job worker merely by opening `/health/detailed`. Pick one, delete the other.
- **Growth OS** (internal CRM console): skeleton only (one session endpoint + "No modules enabled yet" dashboard), fully uncommitted including its deploy plumbing and migration. Not a launch dependency — **but decide its fate now**: commit it as a separate PR or stash it out of the launch tree. Don't let it ride along accidentally.
- **Launch gates 4–9 of your own checklist are all open** (DLQ=0, 7-day canary, 10-shop activation, alert test, attachment round-trip), and the gates themselves can't even be measured until F4 (analytics 403) and the missing alert/Sentry env are fixed.

---

## 8. High-Value Improvements Within the Frozen Feature Set

You asked for improvements that add real value **without expanding launch scope**. Ranked by impact ÷ effort:

### Tier 1 — Do before Meta submission (week 1)

1. **Fix the GDPR pair properly (M1+M2).** Map deletion requests correctly: resolve `signed_request.user_id` (ASID) → the user's Pages → PSIDs (or store an ASID→customer mapping at opt-in), then **cascade** conversations/messages, anonymize order PII (keep the financial record, scrub name/phone/address), handle the RESTRICT path, write consent audit events, and actually disconnect channels + notify the owner on deauthorize. ~2–3 days. This is the difference between "paperwork compliance" and real compliance.
2. **Close the perimeter (F1–F3, F5).** Delete or secret-gate `/api/ai-chatbot/*`; JWT-only shop resolution on SSE; fail-closed courier webhook validation with timing-safe compares; auth + signed one-time tokens on owner payment confirmation. ~2 days. Small diffs, enormous risk reduction.
3. **Fix the CI env rendering** (add `BKASH_*`, `BKASH_WEBHOOK_SECRET`, `SLACK_ALERT_WEBHOOK_URL`, backend `SENTRY_DSN`, `VITE_SENTRY_DSN`, `DELIVERY_ENCRYPTION_KEY`, courier creds). ~1 hour of YAML. This single change un-breaks payments, alerting, error tracking, and Launch Gate 8 simultaneously.
4. **Correct the stale compliance docs** (`compliance-checklist.md`, `message-worker.js:14`) so nothing you show Meta contradicts the code. ~1 hour.

### Tier 2 — Do before first paid seller (week 2)

5. **Default the UI to Bangla** (`fallbackLng: 'bn'` + re-enable navigator detection). One-line-class change, biggest market-fit win available. While there: translate Privacy/Terms (at minimum a Bangla summary section) and the error-boundary/route-error screens.
6. **Owner-facing failure visibility.** You already have per-channel health data, the DLQ, and Telegram/web-push infra. Add: (a) in-app banner + Telegram alert when a token dies (F→M3 fix), (b) a "messages needing attention" surface when replies dead-letter. Today every failure mode ends in *owner silence* — for a tool whose entire promise is "never miss a customer," silent failure is the worst possible failure mode. ~2–3 days, reuses existing pipes.
7. **Add a real support channel.** A help/FAQ page (you already have the FAQ CMS), `support@easymod.tech` in the landing footer, and a WhatsApp or Messenger link. For this user base, being reachable *on Messenger* is itself a product demo. ~1 day.
8. **Wire or cut the orphaned pages** (Reports, Customers, Categories, Audit Logs), fix the Categories `/app` nav bug, and fix `Reports.tsx:92` hardcoded channel metrics. Either outcome is fine; the current state — finished features that are unreachable and half-wired — is pure downside in a review screenshot or a merchant's first session. ~1 day.
9. **Prove money end-to-end in prod**: run the full bKash subscription + top-up + webhook + renewal + refund cycle with real (small) amounts, add the sandbox→live return-recovery UX in `Subscription.tsx`, and flip subscription enforcement from fail-open to fail-closed for shops past grace. Revenue you can't collect and can't enforce isn't revenue.

### Tier 3 — Cheap, compounding value (can slip to launch+1)

10. **Off-site backups** (nightly dump → DO Spaces/S3, encrypted) + one documented restore drill. A few hours; converts "droplet dies = business dies" into an inconvenience.
11. **Unlock >24h transactional notifications with message tags.** Today payment confirmations and delivery updates are silently dropped outside the window (`templateRequired.rule.js` denies all tags). `POST_PURCHASE_UPDATE` is a standard tag needing no extra approval — wiring it through the policy engine you already have converts a product-limiting gap into a core commerce feature. Do it carefully (tag misuse gets pages restricted), update the compliance docs accordingly.
12. **Per-shop LLM spend cap** (daily ceiling → graceful fallback to keyword/static replies + owner alert). You have per-conversation billing but nothing stops a runaway loop or abuse from burning margin.
13. **Demo shop seed + real "See demo"** — a pre-filled demo shop (products, FAQ, sample conversation) behind the landing CTA instead of the fake `/signin` link. Doubles as your Meta screencast environment and your sales demo.
14. **Un-exclude the 22 skipped test suites** (or delete them), make frontend tests blocking, add a coverage floor. The suite is an asset; the exclusions are a liability.
15. **Knowledge-gap digest to merchants.** You already capture unanswered questions — a weekly Bangla digest ("customers asked these 5 things your AI couldn't answer — add them to your FAQ") turns a background signal into a retention loop.

**Explicitly NOT recommended pre-launch** (scope discipline): comment moderation, Instagram, Nagad/Rocket, SSLCommerz, multi-language beyond bn/en, the Growth OS business modules. All are post-launch, all require either fresh Meta review or unproven effort.

---

## 9. Recommended Sequence

```
Week 1  ├─ Commit/merge the working tree (or discard); get main == deployable truth
        ├─ Fix GDPR deletion + deauthorize (§8.1)
        ├─ Close F1–F3, F5 perimeter (§8.2)
        ├─ Fix CI env rendering; verify alerts fire + Sentry receives (§8.3)
        ├─ Correct stale compliance docs; record screencasts; finish Business Verification
        └─ SUBMIT META APP REVIEW ← start the external clock ASAP
Week 2  ├─ Bangla-default + legal/error surfaces (§8.5)
        ├─ Owner-facing failure visibility (§8.6)
        ├─ Support channel + orphan-page cleanup (§8.7, §8.8)
        ├─ Real-money bKash end-to-end + enforcement flip (§8.9)
        ├─ Off-site backups + restore drill (§8.10)
        └─ Re-certify: deploy from main, connect smoke Page, pass all 12 smoke scenarios
Week 3+ ├─ Meta review in flight (respond to feedback within 24h)
        ├─ Onboard 10 pilot shops (Launch Gates 4–9), 7-day canary watch
        └─ Sign the launch checklist; open signups
```

---

## 10. Final Honest Assessment

- **Can this pass Meta App Review?** Yes — the scope discipline and paperwork are above par — **but not as it stands**: the data-deletion/deauthorize pair is functionally hollow, and Meta probes exactly that. Fix §8.1–§8.4, then submit. Expected friction: low for these 3 scopes.
- **Is it ready for BD SME launch?** **No, not today.** The product-market fit assets are unusually strong (Bangla parity, Banglish AI, COD rules, bKash, couriers, RTO shield, ৳999 price point), but the business cannot currently collect money, cannot see its own failures, cannot survive a server loss, and is running three divergent versions of itself. None of these are hard problems — they're unglamorous ones.
- **Is the codebase good?** Yes, verifiably: 1,085 passing tests, disciplined architecture, real security fundamentals in the core. The embarrassing findings (F1–F3) are legacy perimeter code, not the core — which is precisely why they're fixable in days.
- **Biggest strategic risk:** not technical. It's that the ops discipline (env, backups, alerting, git hygiene, gate sign-offs) keeps slipping in favor of feature work — the same items were flagged in the 06-24 C-level audit and are still open four weeks later. Treat §9 as a hard sequence, not a menu.

*Report compiled from 4 independent deep audits + empirical test runs (backend Jest: 84/84 suites, 1,085/1,085 tests, 47s). All file:line citations verified against the working tree on `codex/final-audit`, 2026-07-22.*
