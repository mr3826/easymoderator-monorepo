# Incident 2026-09-22 — Meta "Feature unavailable" when connecting a Facebook Page

**Status:** root cause proven and fixed. EasyModerator was invoking the classic Facebook Login contract against an app that Meta serves as **Facebook Login for Business**, which is configuration-driven. The runtime now sends `config_id`.
**Symptom:** the Meta dialog opened by *Connect Facebook Page* showed *"Feature unavailable — Facebook Login is currently unavailable for this app as we are updating additional details for this app. Please try again later."*
**App:** `2040799330176198` (`saas-easymod`), created 2026-05-14, app type Business, Live.
**Production code at time of incident:** `cf57db1e` (built 2026-09-20 23:56 UTC).
**Evidence:** Meta's developer-tools MCP (read-only), Meta's current documentation, unauthenticated probes, and the app owner's dashboard. Times are UTC.

## Root cause

Two halves, one of which was invisible from the repository:

**Meta side.** The app runs the **Facebook Login for Business** product. Under that product the permission set is owned by a dashboard **Login Configuration**, and the configuration's ID is what invokes the login dialog. The app now has a dedicated **User access token** configuration, `1685388446490514`, granting `pages_show_list`, `pages_messaging` and `pages_manage_metadata`.

**Code side.** `MetaMessengerProvider.buildAuthUrl()` was written for classic Facebook Login and was never updated when the product changed. It sent the classic contract:

```text
client_id, redirect_uri, scope=pages_show_list,pages_messaging,pages_manage_metadata, response_type=code, state
```

with **no `config_id`**. So production asserted a permission contract it no longer owned while omitting the one parameter that selects the contract Meta actually holds. Meta answered with the generic "Feature unavailable" screen.

The failure was silent from our side: the dialog fails inside Facebook and never reaches our callback, so nothing appeared in backend logs, error rates or Graph call volume. The only observer was the merchant.

**Confidence: PROVEN for the code defect** (the emitted URL is directly observable and contradicts Meta's documented contract for this product). The Meta-side configuration state is confirmed by `devtools_app_review privileges` and the owner's dashboard.

## The two contracts

Old (broken):

```text
https://www.facebook.com/v22.0/dialog/oauth
  ?client_id=2040799330176198
  &redirect_uri=https%3A%2F%2Fapp.easymod.tech%2Fchannels%2Foauth-callback
  &scope=pages_show_list%2Cpages_messaging%2Cpages_manage_metadata
  &response_type=code
  &state=...
```

New (shipped):

```text
https://www.facebook.com/v22.0/dialog/oauth
  ?client_id=2040799330176198
  &redirect_uri=https%3A%2F%2Fapp.easymod.tech%2Fchannels%2Foauth-callback
  &config_id=1685388446490514
  &response_type=code
  &state=...
```

`scope` is **absent**: Meta states that for a User access token configuration `config_id` has replaced `scope`, and recommends not sending `scope`.

`override_default_response_type` is **absent**. Meta documents it only for *business integration system user* (SUAT/BISU) configurations, where it forces the authorization-code grant in the JavaScript SDK. This is a User access token configuration driven by the manual redirect flow, where `response_type=code` is already the documented default. Copying the parameter across from the system-user flow would have been an unproven change to the authorization contract.

## Why the token architecture did not change

A **User access token** configuration returns an ordinary user access token. Every downstream step is therefore unchanged and was deliberately left alone:

```text
authorization code -> /oauth/access_token -> short-lived user token
  -> fb_exchange_token -> long-lived user token
  -> debug_token granular Page target IDs
  -> /me/accounts -> Page access token -> webhook subscription
```

A **system user** configuration would have broken this: it returns a non-expiring system-user token, for which `fb_exchange_token` is meaningless. The app's system-user configuration `35885387384409543` is preserved and intentionally unused; migrating to it is separate, deferred work (see below).

## Current production Meta contract

The supported production path is intentionally narrow and configuration-owned:

```text
Facebook Login for Business (User access token configuration 1685388446490514)
  -> long-lived User access token
  -> debug_token granular Page targets
  -> /me/accounts (Page access_token)
  -> encrypted channel Page credential
  -> /{page-id}/subscribed_apps verification
```

The approved permission set is exactly:

```text
pages_show_list
pages_messaging
pages_manage_metadata
```

The connection and webhook-health paths must not require `pages_read_engagement`,
`business_management`, or Page public-content/metadata features. The direct
Page-node `getAssetAccessToken()` lookup is not part of the approved OAuth
connection path, and the legacy direct Page-node health probe is not a supported
health signal. `subscribed_apps` verification is authoritative for webhook health.

The preserved Business Integration System User configuration
`35885387384409543` is future architecture work only and is not the production
merchant login path. Meta Access Verification remains submitted/in review with
deadline `2026-11-21`; that external review status does not justify changing the
working production contract.

## Drift protection

The class of failure here is Meta-side configuration drifting away from the application's hardcoded assumptions, surfacing only at a merchant's browser. Three guards now make that fail loudly and early:

- `META_LOGIN_CONFIG_ID` is a required production variable. `production-config.validator.js` rejects a missing or non-numeric value, so the process refuses to boot and the deploy fails.
- `render-production-env.js` requires it, so a deploy cannot render an `.env.prod` without it.
- `buildAuthUrl()` throws `META_LOGIN_CONFIG_ID_INVALID` rather than emitting a URL, in **every** environment. There is deliberately no fallback to the legacy scope-only contract: a silent downgrade is what made this incident invisible.

The value is not a secret — it travels in the authorization URL — so it lives in the `META_LOGIN_CONFIG_ID` repository *variable*, alongside `META_OAUTH_REDIRECT_URI`, not in secrets. It is never hardcoded in `MetaMessengerProvider.js`.

## Confirmed Meta state (2026-09-22, `devtools_app_review privileges` and `devtools_app basic_settings`)

| Item | Value |
|---|---|
| App mode | Live (`app_status: live_mode`) |
| Login product | Facebook Login for Business |
| `public_profile` | **Advanced** (was Standard on 2026-09-21) |
| `pages_show_list`, `pages_messaging`, `pages_manage_metadata` | Advanced, live, `DEVOPS_APPROVED` |
| `email` / `openid` | Standard / Advanced |
| Active login configuration | `1685388446490514` — User access token, never expires |
| Preserved configuration | `35885387384409543` — System-user access token, unused |
| App Review | Approved 2026-09-20 15:37 |
| Required actions / Data Use Checkup | Clear / complete |
| Access Verification (Tech Provider) | **Submitted, in review**, deadline 2026-11-21 |
| Rejections | None |

## Two proofs, kept separate

`OAUTH_APP_ROLE_PROOF` — an app admin, developer or tester completes login, callback, token exchange, Page discovery and webhook subscription. This proves the OAuth implementation.

`EXTERNAL_MERCHANT_ACCESS_PROOF` — an account with **no** app role does the same. This additionally depends on Meta's Tech Provider Access Verification, which is still in review. It may remain blocked after this fix, and that is a Meta review gate, not an application defect. Do not roll back the OAuth fix for it, and do not keep changing production code to chase it.

## Investigation history (kept for the record)

The hypotheses below were the working set while the login product and configuration were unreadable from tooling. **H1 is confirmed.** The rest are recorded because ruling them out is what made H1 safe to act on.

| # | Hypothesis | Outcome |
|---|---|---|
| H1 | Login for Business is active, a Configuration exists, and EasyModerator does not invoke it | **CONFIRMED.** Configuration `1685388446490514`; production sent no `config_id`. |
| H2 | A Configuration exists but is incomplete or invalid | Not the cause: the configuration carries the three Page permissions. |
| H3 | The product is ordinary Facebook Login, so `config_id` must not be added | Ruled out. An Aug-27 memory note claiming classic Login was a model's inference from code, not a dashboard reading. |
| H4 | An app-level restriction or details requirement blocks login independently | Not the cause. Compliance clean, review approved, no required actions. |
| H5 | Tech Provider Access Verification blocks external merchants after authentication | Still live for **external merchants only**, and unrelated to this dialog screen. Now submitted and in review. |
| H6 | Post-App-Review propagation delay | Ruled out: more than a day elapsed with the error persisting. |

`public_profile` was at Standard Access during the investigation and is now Advanced. It is a prerequisite for *external merchant* authorization, not a discriminator for an app-role login, and was correctly not changed as a login experiment.

### What was verified during the investigation

| Check | Result |
|---|---|
| Deployed code matched `origin/main` | `/health` commit equalled `git ls-remote origin main` |
| Redirect URI | Exact match: `https://app.easymod.tech/channels/oauth-callback` |
| Webhook | `page` / `messages` enabled |
| Data-deletion endpoint | 200 + instructions |
| Dialog vs Graph version | No difference; `v22.0` and `v26.0` returned identical redirects |
| Graph traffic | 0 calls in 30 days — consistent with merchants never completing a connect |

## Code assessment (post-fix)

`MetaMessengerProvider.buildAuthUrl` emits exactly `client_id`, `redirect_uri`, `config_id`, `response_type=code` and `state` against the Facebook dialog host on the shared Graph version. It ignores its `scopes` argument entirely, so consent is not negotiable at runtime, and it throws rather than emitting a URL when the configuration ID is missing or malformed.

`initiateOAuth` generates a 128-bit nonce with `crypto.randomBytes(16)` and stores the state with the user, shop and redirect URI. `handleCallback` returns 403 when the authenticated user, shop or platform differs from the initiator and 400 for a missing or expired state. `oauth-state.store.take()` consumes the state atomically (Lua `GET` + `DEL`), so an authorization code cannot be replayed. The stored redirect URI is reused for the code exchange; Meta enforces equality. None of this was changed by the hotfix.

### Test coverage and mutation proof

The regression suite pins the corrected contract: `config_id` present and equal to the configured value, `client_id`, exact `redirect_uri`, byte-identical `state`, `response_type=code`, `scope` absent, `override_default_response_type` absent, the system-user configuration ID never present, and fail-closed behaviour across 13 malformed configuration values.

Six deliberate mutations were applied locally and all six were killed by the suite — dropping `config_id`, restoring runtime `scope`, adding `override_default_response_type`, removing the fail-closed guard, removing the production requirement, and removing the format check. No mutation survived. None was committed.

## Deferred: system user migration

Not part of this hotfix. Evaluate separately whether to migrate from the User access token / Page token model to Facebook Login for Business **Business Integration System User** authorization using configuration `35885387384409543`.

That evaluation must cover: non-expiring authorization, Client Business ID, the Business Portfolio asset model, token revocation, asset discovery, Page messaging, webhooks, cross-shop isolation, migration of existing merchants, rollback, and its own Meta Access Verification implications. It is an architecture change, not a fix, and it requires `response_type=code` with `override_default_response_type=true` — which is precisely why that parameter must not be copied into the current user-token flow.

## Documentation drift register

| Location | Status |
|---|---|
| `docs/meta-app-review.md`, `docs/meta-app-review-submission.md` | "Login product: Facebook Login for Business" — **now confirmed correct**. |
| `EasyMod-backend/.easymod/meta-app-review/dashboard-setup-walkthrough.md`, `screencast-storyboards.md` | Narration says Login for Business opens — consistent with the confirmed state. |
| `EasyMod-backend/.env.example` | "Meta OAuth (Business Login)" — imprecise; the product is Facebook Login for Business. |
| `docs/meta-app-review-submission.md` | "App Mode is still Development" — stale: the app is Live. |
| Access Verification deadline | Now **2026-11-21**, submitted and in review. Earlier records saying NOT STARTED / 2026-10-19 / 2026-12-11 are superseded. |
| Data Use Checkup | Complete. |
| Graph version | Code `v22.0`; CI `v21.0`; latest `v26.0`. Not the cause. `META_GRAPH_API_VERSION` is absent from the `render-production-env.js` allowlist, so production stays on `v22.0` until a code deploy. |

## Preflight

`node EasyMod-backend/scripts/meta-readiness-preflight.js` now also shape-checks `META_LOGIN_CONFIG_ID` and **fails** when it is unset. It still cannot read access levels, Access Verification, the login product, or whether a given configuration ID actually exists and is the user-token one; those remain on its UNVERIFIED list. A clean exit does not mean Meta is ready.
