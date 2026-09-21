# Incident 2026-09-22 — Meta "Feature unavailable" when connecting a Facebook Page

**Status:** open. The Meta-side cause has not been identified. Nothing found so far shows the EasyModerator OAuth code is at fault, and no code change was made for the outage itself.
**Symptom:** the Meta dialog opened by *Connect Facebook Page* shows *"Feature unavailable — Facebook Login is currently unavailable for this app as we are updating additional details for this app. Please try again later."*
**App:** `2040799330176198` (`saas-easymod`), created 2026-05-14.
**Production code:** `GET https://api.easymod.tech/health` reported commit `cf57db1e` (built 2026-09-20 23:56 UTC), and `git ls-remote origin main` returned the same commit.
**Evidence collected:** 2026-09-21 about 18:55–19:40 UTC (2026-09-22 morning, UTC+6), from Meta's developer-tools MCP (read-only), Meta's documentation, unauthenticated probes, and an independent second pass over the same MCP. Times below are UTC.

## Verdict

The dialog URL production emits matches Meta's documented manual-login flow, and every Meta setting that tooling can read is healthy. That does **not** identify the trigger: Meta does not document what produces this screen, the screen is only shown after login (an unauthenticated request with a deliberately wrong `redirect_uri` still redirects to `login.php`), and the login product and Access Verification state cannot be read by any available tool.

**First discriminator (not recorded in the original report): which account saw the error?** If an admin, developer or tester account also sees it, the cause is app-wide, which rules out both role-based explanations below (1 and 2) and points at 3 and 4.

Candidates, ranked by likelihood rather than cost to test. None is proven.

1. **`public_profile` is at Standard Access on a Live app.** Meta: Standard Access permissions "can only be requested from app users who have a role on the requesting app", `public_profile` cannot be removed, and Meta's Login for Business FAQ says Advanced `public_profile` is required before going live "to support authorization from users who do not have an app role". Community reports pair this exact message with "enable advanced access" (anecdotal).
2. **Login product and configuration.** The submission sheet records the login product as Facebook Login for Business (dashboard-verified 2026-08-20), while the runtime dialog sends `scope` and no `config_id`. Meta documents `scope` as optional for that product ("can still be included, we recommend that you do not use it") but does not say what a non-role user sees when a Login for Business app sends no `config_id`. Third-party repositories report `config_id` clearing this screen for non-admin users (anecdotal). The login product cannot be read by tooling, so this is decided by runbook step 1.
3. **Incomplete app details.** `data_deletion_url` is `null` (the endpoint is live, only unregistered); `contact_email_verified` is `false`; `description`, `short_description`, `support_url` and `sub_category` are empty; the display name is the slug `saas-easymod`; and the registered privacy and terms URLs (`https://easymod.tech/privacy-policy`, `/terms`) return the same 4,175-byte client-rendered shell as any other path, with no policy text for a crawler that does not run JavaScript. The message says "updating additional details".
4. **Post-approval propagation.** App Review was approved 2026-09-20 15:37 UTC, more than 28 hours before the second pass, so this is weakening. Retrying is still free.

**Not a cause of this screen, but the next guaranteed blocker: Tech Provider Access Verification.** Recorded NOT STARTED in these docs (2026-08-20) and unreadable by tooling. Meta's documented failure is Graph error 100 for non-role merchants on later calls such as `/me/accounts`, not this dialog. It takes about 5 days, so start it now rather than after the other steps.

## What was verified

| Check | Result | Evidence |
|---|---|---|
| App mode | Live | `app_status: live_mode` |
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

## Owner runbook (dashboard changes; the MCP is read-only for app settings)

Change one thing at a time and retry the connect flow after each step, so you can tell which one cleared the screen. Use both the account that saw the error and a Facebook account that has **no role** on the app: role accounts already pass under Standard Access, so they prove nothing about candidates 1 and 2. Record what cleared it at the bottom of this file.

0. **Note which account saw the error, then retry with it and with a no-role account.** Free, and tests candidate 4.
1. **Read the login product** in the dashboard (Facebook Login vs Facebook Login for Business). If it is Login for Business, capture the configuration ID, its permissions and assets, and its status. Read-only. This decides whether `config_id` is on the table.
2. **Switch `public_profile` to Advanced Access** (App Review → Permissions and Features). Meta describes this as a manual switch for consumer apps; whether App Review is required for this Business app is not confirmed, so follow what the dashboard shows. If a submission opens, include only `public_profile`, never `pages_read_engagement` or `pages_manage_engagement`.
3. **Basic settings:** register `https://api.easymod.tech/webhooks/meta/data-deletion` as the Data Deletion Request callback (the POST handler in `meta-webhook-gdpr.handler.js` verifies Meta's signed request; the GET returns JSON, so it is not a friendly instructions page); verify the contact email `info@easymod.tech`; fill in the description, short description and support URL. Consider serving the privacy and terms pages as server-rendered text.
4. **Start Access Verification now, in parallel:** `https://developers.facebook.com/1268762121859445/access-verification/`. A Business admin is required and it takes about 5 days ([business-verification.md](../../EasyMod-backend/.easymod/meta-app-review/business-verification.md)). Do this whether or not the screen clears; read the deadline off the dashboard because the docs may be stale.

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

## Decision record: `config_id` is not adopted by this change

Adopting `config_id` blind would change working code without evidence that it is the gate, and it needs a Meta-side configuration ID that no available tool can read. It is **not ruled out**. It becomes warranted if runbook step 1 shows Facebook Login for Business with a configuration **and** the screen persists once step 2 is done. The smallest change then is an opt-in setting, off by default, that adds `config_id` to the dialog URL. It would also need the variable added to the allowlist in `render-production-env.js` and to both `ci-cd.yml` env blocks, or it never reaches production. The exact-parameter provider test would change deliberately in the same PR.

## Drift register (documentation vs verified state)

Line numbers are as of `cf57db1e`, before this record's status notes shift later lines in the two annotated files.

| Location | Says | Note |
|---|---|---|
| `docs/meta-app-review.md:6`, `docs/meta-app-review-submission.md:4` | Login product: Facebook Login for Business | Unconfirmed since 2026-08-20; the runtime dialog sends `scope` and no `config_id`. Only the submission sheet carries a status note: `meta-app-review.md` is the reviewer-facing guide, so internal incident text is kept out of it. |
| `EasyMod-backend/.easymod/meta-app-review/dashboard-setup-walkthrough.md:33`, `screencast-storyboards.md:111` | Heading and on-camera narration say Login for Business opens | Confirm against the dashboard before re-recording. |
| `EasyMod-backend/.env.example:112` | "Meta OAuth (Business Login)" | Business Login is a different Meta product; unverified. |
| `docs/meta-app-review-submission.md:77` | App Mode is still Development | Stale: the app is Live. |
| `docs/meta-app-review-submission.md:76`, `docs/META_APP_REVIEW_MASTER_GUIDE.md:6` | Access Verification NOT STARTED, deadline 2026-10-19 | State unverified; read the deadline off the dashboard. |
| `docs/META_APP_REVIEW_MASTER_GUIDE.md:293` | Data Use Checkup box unchecked | Meta reports the Data Use Checkup step complete for all three permissions. |
| Graph version | Code `v22.0` (`MetaMessengerProvider.js`, `meta-oauth-exchange.js`, `customer-profile.service.js`); CI `v21.0` (`.github/workflows/ci-cd.yml:522`); latest `v26.0` | Not the cause. `META_GRAPH_API_VERSION` is absent from the `render-production-env.js` allowlist, so production stays on `v22.0` until a code deploy. |

## Outcome

_To be filled in by the owner: which account saw the error, which step cleared it, the date, and the MCP output that confirms it._
