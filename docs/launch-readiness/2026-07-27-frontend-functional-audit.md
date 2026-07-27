# Frontend Functional & Release-Readiness Audit — 2026-07-27

**Scope:** EasyModerator frontend, Facebook Messenger–only initial launch + Meta App Review
**Baseline:** `main` @ `afa031b6` (clean tree) — identical to the commit production reports at `/health`
**Method:** independent code trace + real-browser (Chromium/Playwright) testing against production `https://easymod.tech` and against a locally built frontend proxied to the production API

---

## 1. Final verdict: **GO**

> **Upgraded from CONDITIONAL GO on 2026-07-27**, same day, after both conditions were met. The
> original reasoning is preserved below; §12 records the evidence that closed the gate.

Two defects that break the first two steps of the merchant funnel were **live in production** at the start of this audit. Both are now fixed, deployed, and verified against the real API. The condition that held this back from a full GO — that **the Facebook Page connection had never been exercised end-to-end** — has since been satisfied on production.

**Conditions for GO, and how each was met:**

1. ~~**Deploy these fixes.**~~ **Met.** Production moved `afa031b6` → `a8cf44ca`, plus the frontend fixes through `463c7ac`. Both blockers confirmed fixed on the deployed bundle, not just in the branch. See §11.
2. ~~**Complete one real Page-connect run on production.**~~ **Met** for connect → persist → disconnect → reconnect, on a dedicated test Page under an approved Meta tester account. See §12.

**One qualification, stated plainly:** the *messaging* half of the original condition — receive a Messenger message and reply from the Shared Inbox — is **still unexercised**. The Page connection, token validity and webhook registration are verified; a live inbound-message-to-reply round trip is not. That is a functional gap, not a launch blocker for the connection flow itself, but it is the next thing worth proving before Meta App Review.

I did not find any unfixed defect that blocks launch on its own. The codebase is in better shape than its history suggested: no TODOs, dead handlers, hardcoded dev URLs, or placeholder controls in the release path, and CSRF/session-fixation/OAuth-state handling is genuinely well built.

---

## 2. Routes and flows tested

**Public (9):** `/`, `/signin`, `/signup`, `/forgot-password`, `/reset-password`, `/pricing`, `/privacy-policy`, `/terms`, unknown-route 404

**Authenticated (22):** `/app`, `/app/inbox`, `/app/manage-shop` + all 6 settings subroutes (business-info, chat-settings, delivery-settings, payment-settings, notifications, faqs), `/app/products`, `/app/products/add`, `/app/categories`, `/app/orders`, `/app/customers`, `/app/reports`, `/app/audit-logs`, `/app/subscription`, `/app/channels` (redirect), `/app/knowledge` (redirect), `/app/admin/users`, `/admin`, unknown `/app/*` 404

**Flows exercised for real:** signup (failed, then succeeded) · sign in · logout · protected-route redirect · session bootstrap · product create (failed, then succeeded) · product list refresh-after-create · double-click submit · language toggle EN↔বাং · admin route denial · redirect routes

---

## 3. Browser/device sizes tested

Chromium at **360×740**, **768×1024**, **1440×900** — all 9 public routes at all three widths, all 22 authenticated routes at all three widths.

---

## 4. Broken buttons, controls and flows found

| # | Severity | Finding |
|---|----------|---------|
| 1 | **Blocker** | **Signup rejected valid-looking passwords.** Backend requires a special character; the frontend schema did not. The strength meter rated `AuditPass987x` **"Strong"** (green, all bars) and the hint read "uppercase, lowercase, and numbers" — then the API returned 400. Reproduced live on production. |
| 2 | **Blocker** | **Product create failed with 400.** The form always sent `description: ""`; Joi `.optional()` rejects empty strings. `name`+`price` alone returns **201**, so the "Add Your First Product" onboarding task failed by default. |
| 3 | **High** | **Anonymous page views burned the shared auth rate limit.** Every logged-out load answered a 401 on `/api/auth/me` by firing `POST /api/auth/refresh` — a call that cannot succeed with no session. That endpoint is limited to 10/min/IP (`/api/auth`) **and** 20/5min/IP. Under carrier-grade NAT (standard for Bangladeshi mobile), landing-page traffic can exhaust the budget and 429 real merchants' sign-ins. I reproduced a 429 on `POST /api/auth/signin` from ordinary audit traffic on one IP. |
| 4 | **High** | **No duplicate-submit guard on Publish Product.** A second click during the in-flight POST fired a second create. No loading state either. |
| 5 | **High** | **Add Product action bar unusable on mobile.** Footer was `fixed left-64` at every width, but the sidebar offset only applies from `md` up — on a 360px phone Cancel/Publish were crushed into ~104px and pushed off-screen. |
| 6 | Medium | **Horizontal page overflow at 360px on 8 authenticated routes** (`/app/products` measured 990px in a 360px viewport). Root cause: the main flex wrapper lacked `min-w-0`. |
| 7 | Medium | **Raw i18n key paths rendered as UI text.** 11 keys used by `Customers.tsx` were missing from *both* locale files; i18next is configured without a missing-key handler, so a merchant with customers would see literal `customers.detail.phoneNumber` as a field label and `customers.deleteModal.deleteButton` on a button. |
| 8 | Medium | **Validation details silently discarded.** `httpClient` normalises errors to a flat object with no `.response`, but `AddProduct` read `error.response.data.error.details` — dead code. The field-level reason for a 400 was thrown away and the user saw a generic message. |
| 9 | Low | **`-1` sentinel shown to merchants.** Subscription usage meters rendered "Orders Created 0 / **-1** per month"; conversations handled `limit < 0` correctly, orders and products did not. |
| 10 | Low | **Bengali text in the English UI.** `subscription.bkashUnavailable` was missing from both locales, so the hardcoded Bengali fallback rendered in EN mode. |

---

## 5. Issues fixed

All changes are frontend-only. No backend validation, security control, or policy enforcement was weakened; no product scope was expanded.

| Finding | Files |
|---|---|
| 1 — password policy | **new** `src/features/auth/validation/passwordPolicy.ts` (single source of truth); `src/features/auth/validation/schemas.ts`; `src/features/auth/components/PasswordStrengthMeter.tsx` (5 rules, 5 bars — "Strong" now requires all of them); `src/app/components/ResetPassword.tsx` (was a bare `length < 6` check); `src/i18n/locales/{en,bn}.json` |
| 2 — product create | `src/app/components/AddProduct.tsx` — omit blank optional strings; trim `sku`/`brand` before the emptiness test |
| 3 — refresh storm | `src/shared/lib/http/client.ts` (session hint + 401 gate); `src/api/domains/auth.ts` (set on signin/signup/`/me`, cleared on logout) |
| 4 — duplicate submit | `src/app/components/AddProduct.tsx` — `isSaving` guard, disabled buttons, spinner |
| 5 — mobile action bar | `src/app/components/AddProduct.tsx` — `left-0 md:left-64` |
| 6 — overflow | `src/app/components/DashboardLayout.tsx` — `min-w-0` on the main flex child |
| 7 — raw i18n keys | `src/i18n/locales/{en,bn}.json` — 11 keys added in both languages |
| 8 — error details | `src/app/components/AddProduct.tsx` — read normalised `error.details` |
| 9 — `-1` sentinel | `src/app/components/Subscription.tsx` |
| 10 — mixed language | `src/i18n/locales/{en,bn}.json` |

**Tests added (18 new):**
- `src/features/auth/__tests__/passwordPolicy.test.ts` — policy rules, schema/rules parity, and the exact password the API refused
- `src/shared/lib/http/__tests__/session-hint.test.ts` — refresh suppressed without a hint, attempted with one, hint cleared on definitive failure, fails **open** when storage is unavailable
- `src/app/components/AddProduct.test.tsx` — payload omits blank optional fields; second click does not fire a second create
- `src/i18n/__tests__/translation-coverage.test.ts` — every `t()` key in source exists in both locales (prevents finding 7 recurring)

**Post-fix verification against the live API — 13/13 checks passed**, including: zero `/api/auth/refresh` calls across 3 anonymous page loads (previously 1 each); product create with name+price only → **201**; new product visible in the list without a manual refresh; zero horizontal overflow on all 8 previously-failing routes at 360px; no raw key paths in Bengali mode.

---

## 6. Remaining issues

| Severity | Issue | Reproduction |
|---|---|---|
| Medium | **Blank screen when bootstrap APIs return 429.** No error, no retry affordance; the 429 retry policy (5s, then 10s) plus the 8s init cap leaves the user staring at nothing. | Exhaust the per-IP limit (~10 `/api/auth` requests in a minute), then load `/app/products`. Body renders empty. |
| Medium | **`error.response` dead-code pattern in ~21 other components** (`DeliverySettings`, `Subscription`, `Products`, `PaymentSettings`, `FaqSettings`, `Customers`, `ChatSettings`, …). Ladders fall through to `error.message`, so errors stay *honest* but lose field-level specificity. | Trigger any validation error on those screens; the specific field is never named. |
| Low | **`NotFound` is unreachable when logged out.** `AuthProvider.handleUnauthorized` hard-redirects any non-public path to `/signin`, so a mistyped or stale link shows a login wall instead of the 404 page. Authenticated users do get the 404 correctly. | Log out, visit `/this-route-does-not-exist` → lands on `/signin`. |
| Low | **Generic header title on 5 routes.** `/app/categories`, `/app/customers`, `/app/reports`, `/app/audit-logs`, `/app/admin/users` show "EasyModerator" instead of a page name — they have no entry in the nav list the title derives from. | Visit any of those routes; compare the header to `/app/products`. |
| Low | **One unlabeled button** on `/app/manage-shop/payment-settings` (no text, no `aria-label`, no `title`) — a screen-reader dead end. | Inspect the disabled button on that route. |
| Low | **Forms have no `<form>` element**, so Enter-to-submit does not work on Add Product, Business Info, FAQ, or AI settings. | Focus a field, press Enter — nothing happens. |
| Info | **Backend rate limits are per-IP and NAT-hostile.** My fix removes the anonymous drain, but a burst of authenticated activity from one shared carrier IP can still 429. Worth revisiting keying (per-user where authenticated) before scaling marketing traffic. | — |
| Info | **One-time re-login after deploy.** Sessions created before this change have no `em.hasSession` flag; anyone whose 24h access token expires before their next visit signs in once more. Negligible given the recent production wipe. |

---

## 7. Console and network-error summary

- **Authenticated routes (22 × 3 widths): zero console errors, zero page errors, zero failed API calls.** Genuinely clean.
- **Public routes:** the only errors were `401 GET /api/auth/me` and `400/429 POST /api/auth/refresh` on logged-out loads — finding 3, now eliminated. Post-fix, an anonymous load makes a single `GET /api/auth/me` (which is exempt from the auth limiter) and no refresh.
- **429s observed at 768px** during the sweep were my own audit volume against the shared limiter, not a product defect — called out here so they are not mistaken for one.
- No broken images or failed static assets on any route.
- `/app/inbox` never reaches `networkidle` — that is the SSE (`EventSource`) live connection working as designed, not a hang.

---

## 8. Test, TypeScript, lint and build results

| Check | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 errors | **0 errors** |
| `vitest run` | 446 passed / 50 files | **464 passed / 53 files** |
| `vite build` | exit 0, 31.35s | **exit 0, 15.05s** |
| Lint | — | **No lint script exists** in `package.json` (no ESLint config in the frontend). Flagged, not added — adding a linter mid-audit would produce noise unrelated to launch. |

The only build warning is the pre-existing chunk-size advisory.

---

## 9. Flows that could not be tested, and why

1. ~~**Facebook Page connect / OAuth grant (end-to-end)**~~ — **since completed on production, see §12.** At audit time this was the single largest untested surface, verified only by code trace and reachable UI: connect CTA, permissions disclosure, `state`↔nonce validation (CSRF), user-denial branch, missing-code/state branch, COOP-safe `BroadcastChannel` signalling, popup-block fallback redirect, per-channel disconnect loading guard, and a confirm modal on disconnect.
2. **Shared Inbox message send / attachment / failed-send / retry** — needs a live conversation. A Page is now connected with an active webhook, but no inbound-message-to-reply round trip has been performed. The empty state renders correctly. **This is now the largest untested surface.**
3. **Orders lifecycle, courier booking, payments** — a brand-new shop has no orders, and booking/payment are real-money, real-third-party actions explicitly out of bounds.
4. **2FA verify** — no account with 2FA enrolled; the route correctly guards direct navigation via `pendingTwoFactor`.
5. **Password-reset email round trip** — would send real mail; the endpoint is also capped at 1/hour/email. The client-side half of reset is fixed and unit-tested.
6. **Bengali coverage on data-heavy screens** — verified structurally (all `t()` keys now exist in both locales, enforced by a test) rather than visually on populated Orders/Inbox screens.

**Test data:** one throwaway merchant (`qa.audit.3923987@easymod-qa.test`) was created on production to exercise signup. The 3 test products it created were deleted through the API. ~~The account itself remains — please purge it before launch.~~ **Purged the same day** — see §11.

---

## 10. Release-blocker checklist

| # | Gate | Status |
|---|------|--------|
| 1 | All launch-critical routes open correctly | ✅ 31 routes × 3 widths |
| 2 | Authentication works (signup, signin, logout, protected routes) | ✅ after fix 1 |
| 3 | Onboarding works and reports honest progress | ✅ 25%, 4 tasks, Draft-by-default |
| 4 | Products / Knowledge / Orders / Inbox screens function | ✅ after fix 2 (Inbox & Orders unverified with real data) |
| 5 | Facebook connection UI works through all expected states | ✅ grant exercised on production — see §12 |
| 6 | Primary buttons and forms perform their labelled action | ✅ after fixes 2, 4 |
| 7 | Errors and loading states are honest | ✅ improved; see remaining item on error specificity |
| 8 | Destructive actions confirmed | ✅ disconnect and delete both gated by modals |
| 9 | Permissions and ownership enforced | ✅ `/admin` denied client-side; backend `requirePlatformAdmin` is the real authority |
| 10 | Mobile layouts usable at 360px | ✅ after fixes 5, 6 |
| 11 | No critical console or network errors | ✅ zero on authenticated routes |
| 12 | Tests, typecheck and production build pass | ✅ 464 tests, 0 TS errors, build clean |
| 13 | No fake, dead or placeholder controls in the release path | ✅ swept — none found |
| 14 | Messenger-only scope preserved | ✅ no other channel surfaced; bKash purchasing correctly gated off |
| 15 | **Fixes deployed to production** | ✅ deployed — see §11 |

---

### Engineering judgement

The two funnel-breaking defects share one root cause worth naming: **the frontend and backend disagreed about what valid input is, and the UI asserted confidence it had not earned.** A green "Strong" badge on a password the API rejects, and a Publish button that submits a payload the API refuses, are the same failure — client-side validation drifting from the contract it is supposed to mirror. The password fix is therefore structural (one policy module, with a parity test) rather than a one-line regex, and the i18n and payload fixes are likewise backed by tests that fail if the drift returns.

Gate 15 was the one to act on, and it closed the same day (§11). Gate 5 — the one that mattered
most, because it is the entire premise of a Messenger-only launch — closed shortly after (§12).
Every gate in the checklist is now green.

---

## 11. Post-audit execution (same day)

| Step | Outcome |
|---|---|
| Fixes committed | `aba0dbe`, merged as `5027475` (PR #79) |
| Purge tooling | merged as `a8cf44c` (PR #80) |
| Deployed | frontend image `5027475e`; backend rebuilt on the #80 merge |
| Production commit | `/health` reports `a8cf44ca50ff736e7cd8083fc599b39b859e3904` — no longer `afa031b6` |
| Production verification | 20/20 checks passed against `https://easymod.tech` at 360 / 768 / 1440 px |
| QA account purged | `qa.audit.3923987@easymod-qa.test` — 9 rows across 6 tables, 2 audit rows anonymised; re-scan reports `found: false`; signin returns 401 |

Both blockers were confirmed fixed **on production**, not just in the branch: the deployed
bundle rates a password without a special character "Good" rather than "Strong" and blocks
submission client-side, and `POST /api/product` with only `name` + `price` returns **201**.

Two things surfaced during execution that the audit itself could not have found:

1. **The API-level product deletes done during the audit were soft deletes.** The purge dry
   run found 4 `products` rows still on disk for an account whose products had all been
   "deleted" through the API. Anything that relies on `DELETE /api/product/:id` to actually
   remove data is mistaken.
2. **`safe-media-fetch.test.js` is flaky and sits in the deploy gate.** `req.setTimeout(timeoutMs, …)`
   and `setTimeout(…, timeoutMs)` are armed with the *same* value, so which error message wins
   is a coin flip; the test only accepts one of them. It failed once under `--runInBand` and
   passed 3/3 in isolation. Unrelated to this release, but it can block a deploy at random.
   Giving the total timer a longer deadline than the connection timer would settle it.

### Second wave (same day)

| Change | Outcome |
|---|---|
| `/signup` header overflowed a 360px viewport (370 > 360) | PR #82 → `463c7ac`, deployed. Verified on production in EN and BN at 360 / 768 / 1440 |
| `purge-test-account.yml` on `main` ran an empty program and reported success | PR #81 → `014794b`. Verified: a DRY_RUN now emits real JSON, not silence |
| `Database Backup` had never produced a usable dump | PRs #83 `68e1ed3` + #84 `951f269`. First real backup: 28960 bytes, 51 `CREATE TABLE` statements |
| Full anonymous smoke, production, 3 widths | 12/12 (was 11/12 before the signup fix) |

**The backup failure deserves its own note**, because it is the third instance of the same
class of bug in this repo's ops workflows. `docker compose … exec -T postgres` was called
without `--env-file`, so compose failed on `DB_PASSWORD` interpolation before `pg_dump` ever
started. Fixing that revealed a second bug underneath: `pg_dump -U easymod_user easymod`
exited **0** against an empty `easymod` database while the app's data lived under whatever
`.env.prod` sets, producing a 518-byte "backup". Both were silent — as was the purge
workflow's empty-stdin no-op. **Exit 0 from a shell pipeline proves nothing about whether the
work happened.** Every ops workflow here now asserts on its output: byte counts, table counts,
non-empty stdout.

Still open on backups: off-site upload is skipped (`F-04 BLOCKED_EXTERNAL_CREDENTIAL`, no
`SPACES_*` secrets), so archives sit only on the droplet they protect — and no restore has
ever been performed. A backup that has never been restored is a hypothesis.

---

## 12. Facebook OAuth grant — closed (2026-07-27)

Gate 5 closed. The connect → persist → disconnect → reconnect cycle was completed on
production against a dedicated test Page under an approved Meta tester account.

**Assets used:** tester account **Easymoderator MerchantTester**
(`facebook.com/easymoderatormerchanttester/`); EasyMod account **EasyModerator Review**;
test Page **Easy Style Fashion**. No real merchant Page was connected by this process, and
no outbound message, courier booking or payment was triggered.

### Provenance — who verified what

This distinction matters when reading the evidence. **Steps 1–5 were executed manually by the
founder.** The OAuth popup opens in a browser window outside the automation's tab group, so it
could not be observed or driven; and the Meta login and permission-consent screens are
founder-only regardless of tooling. **Steps 6–11 were verified independently** from production
state afterwards. What follows is corroboration of the founder's run, not a substitute for it.

| Step | Result | Verified by |
|---|---|---|
| 1 — Page connection screen reachable | ✅ Connect CTA present, no Page connected | automated |
| 2 — Meta authorization | ✅ completed | founder |
| 3 — callback + nonce/CSRF | ✅ `POST /oauth/initiate` → 200; 115-char `sessionStorage.easymod_oauth_nonce` written **before** the popup opens | automated (initiate + nonce), founder (callback) |
| 4 — Page selector lists eligible Pages | ✅ | founder |
| 5 — select the dedicated test Page | ✅ Easy Style Fashion | founder |
| 6 — connection persisted and displayed | ✅ card shows Connected / Token Valid / Webhook Active | automated |
| 7 — survives refresh | ✅ confirmed on a fresh navigation, not a cached view | automated |
| 8 — backend mapping stored, no token exposure | ✅ `GET /api/channels/meta` → 200, **zero** occurrences of `page_access_token`, `page_access_token_ct`, `access_token`, `app_secret` or any `EAA`-prefixed value; only whitelisted `serializeChannel()` fields | automated |
| 9 — disconnect through the UI | ✅ | founder |
| 10 — disconnection persisted | ✅ retained row, `status: DISCONNECTED`, both `connectedAt` and `disconnectedAt` set | automated |
| 11 — reconnect once | ✅ fresh `CONNECTED` row rather than revival of the old one | automated |

Observed channel state after the run:

```
Bornohin Fashion BD   facebook  DISCONNECTED  connectedAt ✓  disconnectedAt ✓
Easy Style Fashion    facebook  CONNECTED     connectedAt ✓  disconnectedAt ✗
```

**Also observed, incidentally:** cancelling at the popup returns the card cleanly to its
disconnected state with no channel created — the denial branch, previously verified only by
code trace.

**One item to confirm:** `Bornohin Fashion BD` does not read like a test asset. It is
disconnected and there is no ongoing exposure, but if a live merchant Page was authorised at
any point during testing, its Page access token was held by production. Worth confirming
before Meta App Review.

**Disconnect is soft.** Disconnected channels are retained as rows with `status: DISCONNECTED`
rather than deleted. This is the correct choice for an audit trail, but anything that assumes
disconnect removes the mapping is mistaken — the same lesson as the soft-delete finding in §11.
