# EasyModerator Domain and Route Architecture

Status: implementation branch; production cutover not yet approved
Last verified: 2026-08-05 (Asia/Dhaka)
Branch: `easymod/domain-route-architecture-migration`
Authoritative repository: `mr3826/easymod-backend`

## Decision

EasyModerator uses three canonical HTTPS origins:

| Origin | Owner | Public/indexable | Credentials |
|---|---|---:|---:|
| `https://easymod.tech` | Marketing, pricing, privacy, terms | Yes | No API credentials |
| `https://app.easymod.tech` | Sign-in, signup, OAuth completion, merchant and admin UI | No | Credentialed calls to API |
| `https://api.easymod.tech` | JSON API, webhooks, health, SSE, generated/public assets | No | Host-only auth/session cookies |

This is a domain separation, not an AWS migration. The initial rollout remains on
the existing DigitalOcean deployment so routing and infrastructure migrations do
not fail at the same time.

## Verified pre-migration state

- Production runs on one DigitalOcean Singapore droplet (`139.59.249.141`).
- Caddy is the only public listener and proxies the frontend/backend containers.
- The authoritative live release on 2026-08-05 was
  `2271cb8198c998fa38db28ebc475f4bb7c286458`.
- `https://easymod.tech/health/ready` and `/api/version` reported that release.
- `app.easymod.tech` was NXDOMAIN.
- `api.easymod.tech` resolved to the droplet but its TLS handshake failed.
- HSTS already included subdomains, increasing the urgency of valid TLS before use.
- DNS is on Namecheap BasicDNS (`dns1/dns2.registrar-servers.com`), not Route53.
- The connected AWS account had no EasyModerator Route53 zone or active application
  infrastructure in the inspected regions.
- The standalone `mr3826/EasyMod-frontend` repository retained an independent
  production workflow and is a second-writer risk.
- GitHub Actions used per-commit path filtering with cancelled in-progress runs,
  allowing cumulative frontend changes to be omitted from a later deployment.

## Canonical route ownership

### Marketing origin

- `/`
- `/pricing`
- `/privacy-policy`
- `/terms`
- `/robots.txt`
- `/sitemap.xml`
- static brand assets

Marketing calls only these public API endpoints and always uses
`credentials: omit`:

- `GET https://api.easymod.tech/api/public/live-stats`
- `POST https://api.easymod.tech/api/analytics/funnel`
- `POST https://api.easymod.tech/api/partner/apply`

The marketing origin is not in global credentialed `CORS_ORIGINS`.

### Merchant app origin

- `/signin`, `/signup`, `/forgot-password`, `/reset-password`, `/2fa-verify`
- `/app/channels/oauth-callback`
- `/app/**`
- `/admin/**`

The app root redirects to `/signin`. Public/legal routes reached on the app host
redirect to their marketing equivalents. App responses include
`X-Robots-Tag: noindex, nofollow`.

### API origin

- `/api/**`
- `/api/webhooks/**`
- `/health`, `/health/**`
- `/uploads/**`

`/webhooks/**` is an internal compatibility rewrite to `/api/webhooks/**`.
Webhook POST requests must never use an HTTP redirect because methods, bodies, and
provider signatures must be preserved.

## Transitional compatibility

During the measured migration window, the apex continues to proxy:

- `/api/**`
- `/health`, `/health/**`
- `/uploads/**`
- `/webhooks/**` via an internal rewrite

Legacy browser routes on the apex temporarily return `302` to the app hostname,
preserving path and query. Promote redirects to permanent status only after the
new hosts have been stable and provider dashboards are confirmed.

Compatibility removal requires separate evidence that bookmarks, reset links,
attachments, provider callbacks, and launch tooling no longer use the apex.

## Environment contract

| Variable | Production value / rule |
|---|---|
| `MARKETING_URL` | `https://easymod.tech` |
| `APP_URL` | `https://app.easymod.tech` |
| `API_URL` | `https://api.easymod.tech` |
| `PUBLIC_ASSET_URL` | `https://api.easymod.tech` |
| `FRONTEND_URL` | compatibility alias equal to `APP_URL` |
| `BASE_URL` | compatibility alias equal to `API_URL` |
| `PUBLIC_BASE_URL` | compatibility alias equal to `PUBLIC_ASSET_URL` |
| `CORS_ORIGINS` | `https://app.easymod.tech` only |
| `META_OAUTH_REDIRECT_URI` | `https://app.easymod.tech/app/channels/oauth-callback` |
| `COOKIE_DOMAIN` | unset; production validation rejects it |
| `LEGACY_COOKIE_DOMAIN` | `easymod.tech` temporarily, to expire old parent-domain cookies |
| `VITE_API_BASE_URL` | `https://api.easymod.tech` |
| `VITE_APP_URL` | `https://app.easymod.tech` |
| `VITE_MARKETING_URL` | `https://easymod.tech` |

The production preflight rejects HTTP origins, URL paths in origin variables,
alias mismatches, wildcard CORS, marketing in credentialed CORS, a parent cookie
domain, and an OAuth callback outside the exact app route.

## Cookie, CSRF, CORS, and OAuth model

- Access, refresh, CSRF, and session cookies are Secure and SameSite=Lax.
- Auth cookies are host-only to `api.easymod.tech`; no parent-domain auth cookie is
  needed for app-to-API requests because the hosts are same-site.
- The app is the only credentialed cross-origin caller.
- Marketing access is restricted to an exact public-route list with credentials
  disabled and independent rate limits.
- Authenticated auth mutations (logout, TOTP setup/enable/disable, sessions) remain
  CSRF-protected; only exact anonymous auth flows are exempt.
- Every exempt authentication POST is separately bound to the exact merchant app
  `Origin`; production rejects missing, marketing, hostile sibling, and lookalike origins
  before any cookie can be issued or refreshed.
- OAuth state is single-use, atomically consumed, bound to user/shop/platform, and
  retains the exact redirect URI used at initiation.
- The frontend requires an exact stored OAuth nonce; missing state fails closed.
- Public uploads opt into cross-origin resource policy so Meta and the app can
  render API-hosted assets.

## Meta App configuration

EasyModerator requests Facebook Page Messenger only. Do not add Instagram,
Comment-to-DM, feed subscriptions, `business_management`, or Instagram scopes.

| Meta field | Canonical value |
|---|---|
| Website / App Domains | `easymod.tech` and required subdomains |
| Privacy Policy | `https://easymod.tech/privacy-policy` |
| Terms | `https://easymod.tech/terms` |
| Reviewer sign-in | `https://app.easymod.tech/signin` |
| OAuth redirect | `https://app.easymod.tech/app/channels/oauth-callback` |
| Messenger webhook | `https://api.easymod.tech/api/webhooks/meta` |
| Data deletion callback | `https://api.easymod.tech/api/webhooks/meta/data-deletion` |
| Deauthorize callback | `https://api.easymod.tech/api/webhooks/meta/deauthorize` |

Dashboard changes must happen only after `api` and `app` TLS and routing pass.
Old callback paths stay internally proxied during the transition.

## Staged rollout

### Stage 0 — release control

1. Review and merge this branch only after CI and security gates pass.
2. Disable the standalone frontend production workflow or revoke its deploy key.
3. Keep deployment concurrency serialized and build both images on every main push.
4. Record current immutable image SHAs, Caddyfile, Compose file, DNS records, and
   domain configuration before deployment.

### Stage 1 — compatibility deployment

1. Deploy Caddy blocks and application origin support while apex behavior remains.
2. Validate Caddy before reload.
3. Do not update Meta or publish app links yet.
4. Verify the existing apex app, API, auth, uploads, and webhooks still work.

### Stage 2 — API hostname

1. Keep/create Namecheap `A api -> 139.59.249.141` with a short TTL.
2. Verify Caddy obtains a valid certificate before client traffic.
3. Verify public readiness, version identity, uploads, webhook GET challenge and
   signed POST behavior, CORS, cookies, CSRF, SSE, and security headers.

### Stage 3 — app hostname

1. Create Namecheap `A app -> 139.59.249.141` with the same short TTL.
2. Verify TLS, app noindex headers, sign-in/signup/reset, app-to-API credentials,
   logout, TOTP/session CSRF, invoice PDFs, and OAuth popup completion.
3. Update Meta dashboard fields to the canonical values and reconnect the test Page.
4. Run a real inbound Messenger DM, AI/manual reply, and attachment proof.

### Stage 4 — apex marketing

1. Verify metadata, canonical URLs, structured data, robots, sitemap, pricing,
   privacy, terms, signup CTAs, partner form, and live stats.
2. Verify marketing cannot make credentialed protected API calls.
3. Monitor temporary redirects and legacy proxy traffic for at least 48–72 hours.

### Stage 5 — retirement

1. Remove `LEGACY_COOKIE_DOMAIN` after the agreed cookie lifetime/migration window.
2. Retire legacy apex backend paths only after access logs and external dashboard
   inventory show no remaining callers.
3. Promote safe browser redirects to permanent redirects in a later release.

## Verification matrix

| Check | Pre-cutover expectation |
|---|---|
| apex marketing and legal routes | 200, canonical apex, indexable |
| app root | 302 `/signin` |
| app product/auth routes | SPA 200 + noindex |
| api readiness/version | backend identity and deployed SHA |
| app credentialed CORS | allowed with credentials |
| marketing public CORS | allowed without credentials |
| marketing protected CORS | denied |
| hostile origin | denied everywhere |
| cookies | Secure, HttpOnly, Lax, no Domain attribute |
| legacy cookies | parent-domain variants expired |
| CSRF | protected mutations reject missing/invalid token |
| auth origin binding | sign-in/signup/refresh/reset/2FA reject non-app origins |
| OAuth | exact app redirect, nonce and user/shop binding |
| uploads/invoice PDFs | absolute API URLs and cross-origin render/download |
| SSE | app connects to API with credentials and tenant binding |
| legacy webhook | POST/body/signature preserved through rewrite |
| SEO | per-route title/description/canonical, OG, JSON-LD, robots, sitemap |
| Meta Messenger | real inbound, reply, attachment, consent/deletion evidence |

## Rollback

Rollback is proxy/config first, DNS last:

1. Restore the previous Caddyfile so the apex again owns all browser and API paths.
2. Restore the previous pinned frontend/backend image SHAs; do not rely on `latest`.
3. Restore the previous environment snapshot and rebuild the frontend if its
   compiled origin values changed.
4. Leave `app` and `api` DNS in place while rolling back routing; this avoids
   negative-cache and certificate churn.
5. Revert apex DNS only if a later phase moved marketing to a separate target.
6. Never delete `caddy_data`, database, Redis, uploads, or vector-store volumes as
   part of a domain rollback.
7. Do not use the destructive `wipe_db_first` workflow input.
8. Re-run apex readiness/version/auth/webhook checks and confirm the exact deployed SHA.

## Cutover blockers and human-owned actions

- Namecheap DNS write access is required to create `app` and confirm/fix `api`.
- Production merge/deploy approval is required; this branch must not self-merge.
- Meta App Dashboard ownership is required for callback/OAuth/reviewer URL updates.
- The real Facebook Page owner/tester must approve OAuth and generate Messenger proof.
- The standalone frontend workflow must be disabled by a repository administrator.
- A confirmed bKash settlement-binding/race flaw discovered during security review is
  independent of domain routing but blocks enabling live payments and a broad public
  launch. Keep `BKASH_ENABLED=false` until it has its own reviewed fix and tests.

Until these actions and live checks are complete, the architecture implementation
may be code-ready but production cutover remains a NO-GO.
