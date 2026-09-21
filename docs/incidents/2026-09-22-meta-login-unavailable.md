# Incident 2026-09-22 — Meta "Feature unavailable" when connecting a Facebook Page

**Status:** open, not proven. The primary unresolved question is whether this app's login dialog must invoke a Facebook Login for Business **Configuration ID** (`config_id`). No runtime change has shipped.
**Symptom:** the Meta dialog opened by *Connect Facebook Page* shows *"Feature unavailable — Facebook Login is currently unavailable for this app as we are updating additional details for this app. Please try again later."*
**App:** `2040799330176198` (`saas-easymod`), created 2026-05-14, app type Business.
**Production code:** `GET https://api.easymod.tech/health` reported commit `cf57db1e` (built 2026-09-20 23:56 UTC), and `git ls-remote origin main` returned the same commit.
**Evidence:** 2026-09-21 about 18:55–19:40 UTC and 2026-09-22, from Meta's developer-tools MCP (read-only), Meta's documentation, unauthenticated probes, and the owner's own dashboard captures. Times below are UTC.

## Verdict

EasyModerator sends a classic scope-based dialog: `client_id`, `redirect_uri`, `scope`, `response_type=code`, `state`, and no `config_id`. That matches Meta's documented manual flow for **Facebook Login**. Meta's documentation for **Facebook Login for Business** says login is driven by a Configuration created in the App Dashboard, that the Configuration ID is "used in your code to invoke the login dialog", and that for a User access token configuration `config_id` replaces `scope` ("although `scope` can still be included, we recommend that you do not use it").

The owner's dashboard captures of 2026-09-13 (kept outside the repo) show an app of type **Business** whose Products list has an entry labelled "Facebook Login for Bus…" (truncated). That points at Facebook Login for Business, but it is nine days old, truncated, and says nothing about whether a Configuration exists. No available tool can read the active login product or any configuration.

So the earlier statement that the URL "matches Meta's documented flow" holds only for classic Facebook Login. Whether it holds for this app is undecided, and that is now the primary discriminator.

**No Configuration ID exists in the repo, in GitHub Actions variables or secrets, or in any local env file** (variable names checked; values not printed). If a Configuration exists in the dashboard, production has never invoked it.

## Hypotheses

| # | Hypothesis | For | Against or unknown | Settled by |
|---|---|---|---|---|
| H1 | Login for Business is active, a Configuration exists, and EasyModerator does not invoke it | Business-type app; an FBLB-labelled product in the 2026-09-13 captures; the submission sheet says FBLB; production sends no `config_id`; Meta documents `config_id` as how a FBLB login is invoked; third-party reports of `config_id` clearing this screen (anecdotal) | Meta says `scope` "can still be included"; no Configuration ID is visible anywhere | Owner values below |
| H2 | A Configuration exists but is incomplete or invalid | Nothing shows one exists | Unknown until it can be read | Configuration status, permissions, assets |
| H3 | The product is ordinary Facebook Login, so `config_id` must not be added | The dialog shape matches classic; an Aug-27 memory note says classic, but that is a small model's inference from reading code, not a dashboard reading | The 2026-09-13 captures show an FBLB-labelled product | `LOGIN_PRODUCT` |
| H4 | An app-level restriction or details requirement blocks login independently | The message says "updating additional details"; contact email unverified; description and support URL empty; legal pages are client-rendered | Compliance clean; review approved; no required actions | Retry after fixing details |
| H5 | Tech Provider Access Verification blocks external merchants after authentication | Recorded not submitted (2026-09-13 receipt); documented failure is Graph error 100 on later calls | Not this dialog screen; unreadable by tooling | Dashboard status; an external-merchant login |
| H6 | Post-App-Review propagation | Approved 2026-09-20 15:37 UTC | More than a day elapsed and it still failed at the last report | Retry |

`public_profile` is at Standard Access. It is recorded as evidence, not as a leading cause, and nothing about it should be changed as a login experiment. Meta's Login for Business page says `email` and `public_profile` are automatically granted, but its FAQ also says Advanced `public_profile` is required for such apps "before they go live… to support authorization from users who do not have an app role". That makes it a prerequisite for **external merchants**, not a discriminator for an app-role login (see the proof split in the planned hotfix).

**First discriminator not recorded in the original report: which account saw the error?** If an admin, developer or tester account also sees it, the cause is app-wide, which weakens every role-based explanation.

## What was verified

| Check | Result | Evidence |
|---|---|---|
| App mode | Live | `app_status: live_mode` |
| Login product (owner capture, 2026-09-13) | Business-type app; Products lists "Facebook Login for Bus…" (truncated) | Screenshots kept outside the repo. Dated and truncated, so evidence, not proof |
| `pages_show_list`, `pages_messaging`, `pages_manage_metadata` | Advanced, live, approved | `access_level: advanced`, `DEVOPS_APPROVED` |
| `public_profile` | **Standard** | `access_level: standard`; not in any submission |
| `email` / `openid` | Standard / Advanced | privileges |
| Compliance | Clean | `compliant`, no required actions, 0 violations |
| App Review | Approved 2026-09-20 15:37 | submission `ACTIONED`, `is_approved: true` |
| Submission requirements | Screencast step incomplete for all three permissions; `can_submit: true` | `requirements` |
| Business Verification | Passes | `business_verification_passes: true` |
| Redirect URI | Exact match | `https://app.easymod.tech/channels/oauth-callback` |
| Restrictions | None beyond 13+ | `restrictions` |
| Webhook | `page` / `messages` enabled | `list_subscriptions` |
| Graph traffic | 0 calls reported in 30 days | `call_volume`. The metric is not documented and the `api_precheck` step is complete, so read this as "no meaningful production traffic", not proof that no merchant ever connected |
| Dialog vs Graph version | No difference | `v22.0` and `v26.0` returned identical redirects |
| Data-deletion endpoint | Live | `GET https://api.easymod.tech/webhooks/meta/data-deletion` returns 200 + instructions |
| Deployed code | Matches `origin/main` | `/health` commit equals `git ls-remote origin main` |

Not readable with any available tool: the enabled login product and its configuration, Access Verification state, and whether Meta has anything pending outside the compliance API.

## Owner runbook (dashboard reads and changes; the MCP is read-only for app settings)

Change one thing at a time and retry the connect flow after each change. Record what cleared the screen at the bottom of this file.

0. **Note which account saw the error, then retry with it and with an account that has no role on the app.** Free, and tests H6.
1. **Read the login product and configuration, and send back the values below.** Read-only. In the App Dashboard open the left nav entry that starts "Facebook Login for Bus…", then **Configurations**. This unblocks the code change; nothing else does.
2. **Basic settings:** verify the contact email `info@easymod.tech`; fill in the description, short description and support URL. Check whether the Data Deletion Request callback `https://api.easymod.tech/webhooks/meta/data-deletion` is registered: a 2026-09-13 submission receipt (kept outside the repo) says it is, while the MCP reports `data_deletion_url: null`, which may be only the instructions-URL field.
3. **Access Verification:** open `https://developers.facebook.com/1268762121859445/access-verification/`, record its status, and start it if it is not submitted (a Business admin is required; about 5 days per [business-verification.md](../../EasyMod-backend/.easymod/meta-app-review/business-verification.md)). It blocks external merchants, not the app-role login.
4. **`public_profile` Advanced Access:** a prerequisite for external merchants. Decide it separately; do not change it as a login experiment.

### Values to send back (no secrets; a Configuration ID is not a secret)

```text
LOGIN_PRODUCT=            Facebook Login | Facebook Login for Business | other
CONFIGURATION_EXISTS=     YES | NO
CONFIGURATION_ID=
TOKEN_TYPE=               User access token | System-user access token
CONFIGURED_PERMISSIONS=
CONFIGURED_ASSETS=
```

Also useful if visible: the configuration's name, login variation, and status.

### Confirming the fix with the Meta developer-tools MCP

| Tool | Expected |
|---|---|
| `devtools_app_review` `privileges` | `public_profile` is `advanced`; the three `pages_*` are `advanced` with `is_live: true` |
| `devtools_app` `basic_settings` | `app_status: live_mode`; `data_deletion_url` set; `contact_email_verified: true` |
| `devtools_app` `advanced_settings` | `oauth_redirect_uris` is exactly the callback URL above |
| `devtools_compliance` `status` | `compliant`, `required_actions: []` |
| `devtools_api_usage` `call_volume` | `total_calls` greater than 0 after a real connect |
| `devtools_webhook_list` `list_subscriptions` | `page` / `messages` enabled |

Then walk the whole flow with the no-role account: consent, callback, Page picker, Page connected, webhook active. Confirm one inbound DM is received once and one reply is sent once. Do not probe by sending a message from an unverified Page: a single failed outbound send can disable the channel.

`node EasyMod-backend/scripts/meta-readiness-preflight.js` automates only the data-deletion endpoint and the redirect-URI string shape. It **cannot** read access levels, Access Verification or the login product, and prints them as unverified on every run. A clean exit from it does not mean Meta is ready.

## Code assessment

`MetaMessengerProvider.buildAuthUrl` (`EasyMod-backend/src/modules/channel-providers/providers/MetaMessengerProvider.js:215`) emits exactly `client_id`, `redirect_uri`, `scope`, `response_type=code` and `state` against the Facebook dialog host, using the shared Graph version. It ignores its `scopes` argument, so consent is fixed to the three approved permissions. `initiateOAuth` generates a 128-bit nonce with `crypto.randomBytes(16)` and stores the state with the user, shop and redirect URI. `handleCallback` returns 403 when the authenticated user, shop or platform differs from the initiator and 400 for a missing or expired state; the stored redirect URI is reused for the code exchange, not compared at callback, and Meta enforces equality. Production config fails closed on missing Meta variables.

The regression tests added with this record pin the dialog URL contract and the state, nonce and redirect binding (`MetaMessengerProvider.test.js`, `meta-oauth.service.test.js`). They do not cover provider-side redirect allowlisting, Meta's own `redirect_uri` enforcement, or how the controller derives the authenticated identity.

## Planned hotfix (not implemented; blocked on the values above)

If `LOGIN_PRODUCT` is Facebook Login for Business and a **User access token** Configuration exists with the three Page permissions and Pages as its asset:

- Add `META_LOGIN_CONFIG_ID`. It is not a secret, so it belongs in a GitHub Actions variable. Wire it through `config.js`, `production-config.validator.js`, the `render-production-env.js` allowlist and both `ci-cd.yml` env blocks. Do not hardcode it.
- `buildAuthUrl` then sends `client_id`, `redirect_uri`, `config_id`, `response_type=code` and `state`, and no `scope`. `override_default_response_type` is not added: Meta documents it in `FB.login` examples and for System User tokens, and `response_type=code` is the manual dialog's default.
- Production refuses to boot when the ID is missing or malformed. There is no scope-only fallback in production.
- The token model is unchanged: code, then user access token, then `/me/accounts`, then Page token, then webhook subscription. A User access token Configuration matches that model; a System User Configuration does not and is out of scope for a hotfix.
- State, callback and code-exchange handling are unchanged, including `redirect_uri` on the exchange, which Meta's manual flow requires.

If `LOGIN_PRODUCT` is ordinary Facebook Login, `config_id` must not be added and H4 to H6 remain.

**Two proofs, kept separate.** `OAUTH_APP_ROLE_PROOF`: an app admin or tester completes the login, callback, token exchange, Page discovery and webhook subscription, which proves the OAuth implementation. `EXTERNAL_MERCHANT_ACCESS_PROOF`: an account with no app role does the same, which additionally needs Access Verification and Advanced `public_profile`, and may stay blocked after the fix.

## Drift register (documentation vs verified state)

Line numbers are as of `cf57db1e`, before this record's status notes shift later lines in the two annotated files.

| Location | Says | Note |
|---|---|---|
| `docs/meta-app-review.md:6`, `docs/meta-app-review-submission.md:4` | Login product: Facebook Login for Business | Unconfirmed since 2026-08-20; the runtime dialog sends `scope` and no `config_id`. Only the submission sheet carries a status note: `meta-app-review.md` is the reviewer-facing guide, so internal incident text is kept out of it. |
| `EasyMod-backend/.easymod/meta-app-review/dashboard-setup-walkthrough.md:33`, `screencast-storyboards.md:111` | Heading and on-camera narration say Login for Business opens | Confirm against the dashboard before re-recording. |
| `EasyMod-backend/.env.example:112` | "Meta OAuth (Business Login)" | Business Login is a different Meta product; unverified. |
| `docs/meta-app-review-submission.md:77` | App Mode is still Development | Stale: the app is Live. |
| `docs/meta-app-review-submission.md:76`, `docs/META_APP_REVIEW_MASTER_GUIDE.md:6` | Access Verification NOT STARTED, deadline 2026-10-19 | State unverified. Main says 2026-10-19; a 2026-09-13 submission receipt kept outside the repo says 2026-12-11 and "not submitted yet". Read the deadline off the dashboard. |
| `docs/META_APP_REVIEW_MASTER_GUIDE.md:293` | Data Use Checkup box unchecked | Meta reports the Data Use Checkup step complete for all three permissions. |
| Graph version | Code `v22.0` (`MetaMessengerProvider.js`, `meta-oauth-exchange.js`, `customer-profile.service.js`); CI `v21.0` (`.github/workflows/ci-cd.yml:522`); latest `v26.0` | Not the cause. `META_GRAPH_API_VERSION` is absent from the `render-production-env.js` allowlist, so production stays on `v22.0` until a code deploy. |

## Outcome

_To be filled in by the owner: which account saw the error, which step cleared it, the date, and the MCP output that confirms it._
