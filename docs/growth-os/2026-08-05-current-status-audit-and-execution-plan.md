# Growth OS Current Status Audit and Execution Plan

Date: 2026-08-05  
Audit branch: `easymod/growt-os-plan-review`  
Audit HEAD: `f543f3eededc3717d2c22d5795f7f30887e72b3e`  
Historical Growth OS commit: `8d26dd42630817de1bdf9179ad4b78b0a08081c6`  
Canonical repository: `mr3826/easymod-backend`  
Canonical production/main commit at audit time: `2271cb8198c998fa38db28ebc475f4bb7c286458`  

## Verdict

**NO-GO for production, deployment, or continued business-module work.**

Growth OS is a recoverable application foundation, not a usable Growth OS. The only implemented business-specific capability is an authenticated, role-gated session endpoint. The frontend is a login shell whose dashboard says `No modules enabled yet`. Prospects, assignments, activities, tasks, demos, trials, customer health, scoring, reports, outreach, referrals, and testimonials are not implemented.

The right next move is not to merge the old branch. Recover its small namespaced foundation onto the current canonical production line, repair identity and telemetry, prove the access boundary in staging, and then build one narrow prospect-to-follow-up workflow.

Overall status: **3.5/10 operational readiness**.

The isolated code snapshot is healthier than the product status suggests: TypeScript, the production build, six focused authorization tests, and Compose parsing pass. Those checks do not prove integration, browser authentication, data correctness, or production safety.

## Scope and Method

This was a read-only code and runtime audit except for this report and temporary test extraction. No Growth OS implementation code, deployment file, branch, remote, database, DNS record, or production service was changed.

Evidence included:

- current checkout, local branches, refs, and Git configuration;
- the full `feature/growth-os@8d26dd4` tree and its two design/foundation documents;
- a three-way merge simulation against the current accepted code line;
- canonical GitHub repository, branch, PR, Actions, and backup state;
- live DNS and HTTPS probes;
- current analytics, funnel, CRM-like, auth, subscription, CI/CD, Caddy, and Compose code;
- isolated TypeScript, Vite build, Jest, Compose, and dependency checks;
- three parallel read-only reviews covering product/UI, backend/data/security, and test/operations.

Limits:

- Production PostgreSQL was not queried. Whether an orphan `growth_os_user_roles` table exists is runtime-unverified.
- There is no live Growth host, so authorized/merchant browser behavior could not be tested.
- No Growth OS PR or CI run exists to inspect.
- Source-level UI review was possible; screenshot-driven live UX review was blocked by the missing host.

## Current Truth

| Question | Status | Evidence |
| --- | --- | --- |
| Is Growth OS in the current checkout? | **Missing** | `EasyMod-growth/` contains only ignored `node_modules`; no tracked package/source exists. Current backend routes, entities, Caddy, Compose, and CI contain no Growth OS wiring. |
| Where is the implementation? | **Historical branch only** | `feature/growth-os@8d26dd4`, dated 2026-07-23. |
| Is that branch current? | **No** | Canonical GitHub reports 1 commit ahead and 45 commits behind `main@2271cb8`. |
| Does it have a PR? | **No** | Canonical GitHub PR query returned `[]`. |
| Did CI run for it? | **No** | Canonical GitHub Actions query returned `[]`. |
| Is the local Git remote correct? | **No, P0 blocker** | `.git/config:11-13` points `origin` at `mr3826/EasyMod-frontend`; the canonical monorepo is `mr3826/easymod-backend`. |
| Is Growth OS live? | **No** | `growth.easymod.tech` is NXDOMAIN. |
| Is the backend namespace live? | **No** | `GET https://easymod.tech/api/internal/growth-os/session` returned 404. |
| Is main production healthy? | **Yes for infrastructure** | `/health/ready` returned 200 with DB and Redis connected at commit `2271cb8`. |
| Was the Growth migration applied? | **Blocked / unverified** | No CI/deploy receipt and no production DB query. |
| Are backups ready for material Growth data? | **Partial** | Latest backup succeeded with 51 tables, but off-site upload was skipped; backups exist only on the droplet. |

### Repository state is easy to misread

This checkout has two different repository stories:

```text
Local .git/config origin
  -> mr3826/EasyMod-frontend
  -> remote main is an old May 29 line

Canonical monorepo used by PRs and production
  -> mr3826/easymod-backend
  -> main = 2271cb8 (PR #90, deployed)
  -> feature/growth-os = 8d26dd4
  -> feat/brand-logo = f543f3e (open PR #91)
```

Any future `git fetch`, `pull`, `push`, rebase, or branch-from-main command is unsafe until the remote is explicitly reconciled. A plain `git push origin ...` currently targets the wrong GitHub repository.

The current audit branch is also based on open brand PR #91, not canonical main. Growth work should not inherit that unrelated change unless the brand PR merges first or the user explicitly chooses a stacked branch.

## Intended Product

The historical design defines Growth OS as a separate internal acquisition, activation, and retention workspace for EasyModerator staff.

Planned boundary:

```text
Internal user
  -> growth.easymod.tech
  -> EasyMod-growth React SPA
  -> same-origin Caddy proxy
  -> /api/internal/growth-os/*
  -> shared Express backend
  -> explicit Growth OS role and permission guard
  -> dedicated growth_os_* records
  -> read-only links to shops, subscriptions, messages, products, and orders
```

Planned roles:

- Founder
- Growth Manager
- Business Executive
- Marketer
- Customer Success
- Read-only Analyst

Planned lifecycle:

```text
Prospect
  -> assigned lead
  -> activities and follow-up tasks
  -> demo
  -> shop/trial linkage
  -> activation intervention
  -> retained/paid customer
  -> referral/testimonial
```

The product boundary is sensible: a sibling internal SPA, a namespaced backend module, no merchant navigation, no separate backend, no scraping, and no automatic outreach. The implementation stops after the access shell.

Historical evidence locators:

- `feature/growth-os@8d26dd4:docs/growth-os/01-architecture-deployment-security-audit.md:9-21`
- `feature/growth-os@8d26dd4:docs/growth-os/01-architecture-deployment-security-audit.md:267-400`
- `feature/growth-os@8d26dd4:docs/growth-os/02-application-foundation.md:1-7`
- `feature/growth-os@8d26dd4:docs/growth-os/02-application-foundation.md:409-431`

## Repository and Branch Decision

**Decision: keep Growth OS in the canonical EasyModerator monorepo. Do not create a separate Git repository now.**

Growth OS already depends on the shared EasyModerator authentication/session model, PostgreSQL schema and migrations, Redis, background jobs, Caddy routing, environment rendering, deployment host, and release checks. A second repository would duplicate those contracts and create avoidable drift in authentication, tenant boundaries, migrations, deployment configuration, and operational ownership. It would also turn a product that is currently only an access shell into two release systems before the product boundary is proven.

The clean boundary is therefore:

- sibling frontend package: `EasyMod-growth/`
- namespaced backend routes/services/entities: `/api/internal/growth-os/*` and `growth_os_*`
- explicit Growth permissions and internal-user audience
- path-filtered CI/build/deploy work where useful, while retaining one canonical release source
- separate phase branches and reviewable commits, without a second repository

A separate repository should be reconsidered only if Growth OS later requires an independent security boundary, independent organization/team ownership, materially different deployment cadence, or a contractual isolation requirement. None of those conditions is evidenced today.

Execution branches are created only when a phase starts, each from the accepted commit of the preceding phase:

| Phase | Branch | Current state |
| --- | --- | --- |
| 0 — recovery and scope lock | `codex/growth-os-phase-0-recovery` | Create now from canonical `main` |
| 1 — telemetry repair | `codex/growth-os-phase-1-telemetry` | Create after Phase 0 gate |
| 2 — access foundation | `codex/growth-os-phase-2-access-foundation` | Create after Phase 1 gate |
| 3 — prospect ledger | `codex/growth-os-phase-3-prospect-ledger` | Create after Phase 2 gate |
| 4 — follow-up loop | `codex/growth-os-phase-4-follow-up-loop` | Create after Phase 3 gate |
| 5 — trial and customer success | `codex/growth-os-phase-5-trial-customer-success` | Create after Phase 4 gate |
| 6 — command center | `codex/growth-os-phase-6-command-center` | Create after Phase 5 gate |
| 7 — AI/advocacy (optional) | `codex/growth-os-phase-7-ai-advocacy` | Create only if Phase 6 proves demand |
| 8 — staging and production | `codex/growth-os-phase-8-staging-production` | Create only after product gates pass |

No phase branch is merged to `main`, pushed, or deployed automatically. Each phase must pass its stated exit gate before the next branch is cut.

## Implemented Surface

| Surface | Status | Reality |
| --- | --- | --- |
| Separate React/Vite SPA | **Partial** | Buildable shell on the historical branch; absent from current line and production. |
| Login page | **Partial / Broken** | Email/password only; 2FA result is ignored. |
| Route-state pages | **Partial** | Login, unauthorized, access denied, expired, 404, and root shell exist. |
| Dashboard | **Placeholder** | Explicitly says no modules are enabled. |
| Navigation | **Placeholder** | One hard-coded Overview link. |
| Growth-specific API | **Partial** | One endpoint: `GET /api/internal/growth-os/session`. |
| Server-side authorization | **Partial but sound idea** | Explicit role lookup, permission check, deny-by-default. Tested only with mocks. |
| Growth role table | **Partial** | One migration/entity; no current migration receipt or management operation. |
| Role grant/revoke | **Missing operational path** | Manual SQL only; no audited command/API/UI or cache invalidation. |
| Prospects and contacts | **Missing** | Design only. |
| Acquisition sources/campaigns | **Missing** | Design only. |
| Assignments/activities/notes | **Missing** | Design only. |
| Follow-up tasks/reminders | **Missing** | Design only. |
| Demos/trials/customer health | **Missing** | Design only. |
| Scoring/reporting/command center | **Missing** | Design only. |
| Outreach/referrals/testimonials | **Missing** | Design only. |
| Growth worker/scheduler/DLQ | **Missing** | No Growth queue or processor exists. |
| Growth mutation audit events | **Missing** | No Growth mutation endpoint exists. |
| Frontend unit/E2E/accessibility tests | **Missing** | Package has no test script. |
| Live deployment | **Missing** | No DNS, route, image run, migration receipt, or browser proof. |

## Actual Historical Request Flow

```text
Browser opens /
  -> GrowthAuthProvider calls GET /api/internal/growth-os/session
     -> 401: show /login
     -> 403: show /access-denied
     -> 200: show shell

Login form
  -> POST /api/auth/signin
  -> immediately GET /api/internal/growth-os/session
     -> authenticate shared JWT/cookie
     -> requireGrowthOsAccess()
     -> Redis key growth-os:user:<userId>:role
     -> growth_os_user_roles lookup on cache miss
     -> safe User profile lookup
     -> { internalUserId, displayName, role, permissions }
```

Historical code locators:

- `feature/growth-os@8d26dd4:EasyMod-growth/src/api/client.ts:33-72`
- `feature/growth-os@8d26dd4:EasyMod-growth/src/auth/GrowthAuthProvider.tsx:22-83`
- `feature/growth-os@8d26dd4:EasyMod-backend/src/modules/growth-os/growth-os.routes.js:8-11`
- `feature/growth-os@8d26dd4:EasyMod-backend/src/modules/growth-os/growth-os.middleware.js:8-45`
- `feature/growth-os@8d26dd4:EasyMod-backend/src/modules/growth-os/growth-os.repository.js:7-31`

## What Is Good and Worth Salvaging

1. **Separate application boundary.** Growth OS does not pollute merchant navigation or route ownership.
2. **Shared backend, separate namespace.** `/api/internal/growth-os/*` avoids a premature second backend.
3. **Explicit internal access.** Merchant shop roles and platform-admin roles do not automatically grant access.
4. **Deny by default.** Missing role records produce 403.
5. **Safe session shape.** The endpoint returns ID, display name, role, and permissions, not credentials or merchant secrets.
6. **Additive schema intent.** The only migration adds a namespaced role table and does not mutate merchant records.
7. **Human-reviewed outreach boundary.** The design rejects scraping, mass messaging, cold DMs, and automatic external sending.
8. **Focused authorization tests.** Six tests cover unauthenticated denial, merchant denial, platform-admin denial, Founder access, Executive limits, and forged frontend claims.

These pieces are a foundation to port, not evidence of a finished product.

## Detailed Findings

### P0 — Wrong Git remote makes normal recovery commands unsafe

`.git/config:11-13` points `origin` at `https://github.com/mr3826/EasyMod-frontend.git`. The canonical repo that contains current main, PR #90, PR #91, production commit `2271cb8`, and the Growth branch is `mr3826/easymod-backend`.

Impact:

- a fetch compares against the wrong `main`;
- a push may publish the monorepo branch to the wrong repository;
- local `origin/*` refs are stale and can falsely look canonical;
- ahead/behind counts from local `origin/main` are meaningless for release planning.

Required control: add/verify the canonical remote, fetch it, compare commit IDs, and only then create a recovery branch. Do not silently rewrite the remote during an audit.

### P0 — The old Growth branch cannot be merged wholesale

Canonical GitHub: `feature/growth-os` is 1 ahead and 45 behind current main.

A read-only three-way merge found three real conflict regions in `.github/workflows/ci-cd.yml`, plus overlapping edits in:

- `.env.prod.example`
- `Caddyfile`
- `EasyMod-backend/src/modules/entities.js`
- `EasyMod-backend/src/modules/routes.js`
- `.github/workflows/ci-cd.yml`

The old workflow predates current protections:

- main-only image build/deploy guard;
- security test gate;
- validated environment renderer;
- synchronized Caddy/Compose deployment files;
- candidate-image config validation;
- migrations before service replacement;
- Redis recovery handling;
- explicit Caddy reload.

Port pure Growth additions and manually integrate current production files. Do not resolve conflicts by choosing the old file.

### P0 — Privileged 2FA login is broken

Current shared auth returns `{ requires2fa, tempToken }` before issuing full tokens when TOTP is enabled (`EasyMod-backend/src/modules/auth/auth.service.js:303-309`).

The Growth client ignores the response from `POST /api/auth/signin` and immediately calls the session endpoint (`feature/growth-os:EasyMod-growth/src/api/client.ts:63-67`). The result is 401 for the accounts that should have the strongest authentication.

Required control: implement the full 2FA verification flow before staging acceptance. Mandatory 2FA for Founder/Growth Manager should be policy, not an optional afterthought.

### P0 — The API client cannot safely support mutations

The Growth client is a bare `fetch()` wrapper. It lacks:

- CSRF token initialization and `X-CSRF-Token` injection;
- refresh-token coordination and request replay;
- timeout/abort handling;
- central session-expiry propagation;
- safe retry/idempotency rules.

The existing merchant HTTP client already implements much of this contract. Reuse the pattern or extract a small shared transport package. Do not copy an outdated client and then build prospect mutations on it.

### P0 — Internal identity semantics are unresolved

The design says Growth authorization is independent of merchant shop access. Shared `authenticateUser` still rejects a user with no active shop (`EasyMod-backend/src/modules/auth/auth.service.js:311-314`).

Today the practical model is:

```text
merchant-capable User account
  + at least one active Shop
  + explicit growth_os_user_roles record
  = Growth OS user
```

That may be acceptable for a tiny founder pilot, but it is not an internal-user model. Decide explicitly:

- MVP option: require a normal EasyModerator account with shop membership, document it, and avoid auth surgery;
- complete option: add an internal auth context/token audience and refresh path that does not require a shop.

Recommendation: use the MVP constraint only for the first controlled founder canary, then implement an internal identity context before onboarding staff who should not own merchant shops.

### P1 — Role lifecycle is manual, delayed, and unaudited

The first role is inserted by direct SQL. Revocation can remain cached for 60 seconds. There is no grant/revoke service, API, CLI, GitHub workflow, audit event, reason field enforcement, or immediate cache invalidation.

Required control:

- audited Founder-only grant/revoke operation;
- immediate deletion of `growth-os:user:<userId>:role`;
- tests for grant, revoke, cached denial, cached allow, and concurrent changes;
- visible 503 for authorization-store outages rather than disguising them as 403.

### P1 — Permission lists will fail as modules grow

Checks use exact permission-string inclusion. Founder and Growth Manager permissions do not automatically include several task, activity, trial, and customer-health permissions assigned to narrower roles.

Before adding endpoints, choose one explicit model:

- complete permission sets per role generated from capability groups; or
- a documented role-inheritance expansion step before exact checks.

Recommendation: capability groups expanded into immutable explicit permission sets at startup. It stays auditable and avoids runtime wildcard surprises.

### P1 — Growth readiness can return a false positive

Historical `EasyMod-growth/nginx.conf:20-29` combines `try_files` with an unconditional `return 200`. NGINX processes rewrite-module `return` before the normal content phase, so the fallback can be bypassed. The deploy check proves an nginx process responds, not that the SPA artifact or Growth API is usable.

Required control:

- container healthcheck that proves `index.html` exists;
- separate liveness and readiness endpoints;
- readiness that checks static artifact identity/build SHA;
- external smoke for the Growth session route;
- authorized Founder and denied Merchant browser checks in staging.

Reference: [NGINX rewrite module processing order](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html).

### P1 — Growth deployment increases merchant blast radius

Historical Compose makes Caddy depend on `growth-frontend`, so an unavailable Growth image/service can interfere with the shared edge proxy. Historical Caddy proxies all `/api/*` on the Growth host, exposing the full API surface through an internal subdomain. The environment example proposes a parent-domain cookie.

Required control:

- do not make the merchant edge depend on Growth readiness;
- proxy only required auth, CSRF, health, and `/api/internal/growth-os/*` paths;
- prefer host-only cookies or a Growth-specific token audience;
- apply exact origin allowlists, no wildcard CORS;
- consider VPN/IP/access proxy for this internal tool;
- keep `GROWTH_OS_ENABLED=false` until staging acceptance.

### P1 — Dependency policy is red

The isolated lockfile audit reported 4 vulnerabilities: 3 high and 1 moderate. Affected packages include React Router, Vite, and PostCSS. Fixes are reported as available.

Some advisories concern unused RSC behavior or development-server paths, so this is not proof of production exploitability. It is proof that the branch is not dependency-clean. Upgrade, rerun the build/tests, and record any non-applicable advisory with a reason and owner.

The package also puts Vite and `@vitejs/plugin-react` in production dependencies even though the Docker runtime contains only nginx/static files. Move build-only packages to `devDependencies`.

### P1 — No frontend test system exists

Historical `package.json` defines only `dev`, `build`, and `preview`. There is no lint, unit, integration, E2E, accessibility, or dead-code script.

Minimum coverage before a business module:

- login success/failure;
- 2FA required/verify/failure;
- 401, 403, 503, and expired-session states;
- refresh coordination;
- logout backend failure;
- route guard bypass;
- keyboard/focus behavior;
- mobile navigation;
- CSRF on mutations.

### P1 — Existing activation/retention endpoint is broken

`GET /api/analytics/growth` checks `req.user.role === 'admin'` (`EasyMod-backend/src/modules/analytics/analytics.routes.js:108-121`). The shared auth middleware sets `userId`, `email`, `shopId`, and `exp`, but not `role` (`EasyMod-backend/src/middleware/auth.middleware.js:60-66`). The endpoint therefore returns 403 for every authenticated user.

Other defects:

- `recordActivation` sets a permanent Redis NX claim before the DB update; one DB failure can suppress activation forever (`growth-metrics.service.js:43-67`);
- retention numerator includes every shop with recent orders while the denominator is activated shops, so retention can exceed 100% (`growth-metrics.service.js:112-125`);
- the report performs two order counts per shop, an unbounded `2N+1` query pattern (`growth-metrics.service.js:80-92`);
- some analytics SQL errors are caught and reported as zero, turning outages into false business results (`analytics.routes.js:47-60`).

Do not build a command center on these numbers until the math and access path are repaired.

### P1 — Funnel instrumentation is useful but not durable

Current code really records landing, signup, Facebook connection, profile completion, product creation, first inbound message, first AI reply, first order, and first RTO flag.

Gaps:

- `assistant_test_passed` and `trial_day_7_active` producers were not found in code;
- public `POST /api/analytics/funnel` has no endpoint-specific limiter;
- the controller does not send a server `onceKey` for public events;
- frontend local storage marks once-only events before the request succeeds;
- request failures are swallowed;
- raw path/session fields need schema and length validation.

Treat the current rows as best-effort telemetry, not an accounting-quality funnel.

### P1 — `AuditLog` lead rows are not a CRM

Signup and Partner applications call `recordCrmLead`, which writes `resource_type='crm_lead'` into `audit_logs` (`EasyMod-backend/src/modules/analytics/crm-leads.service.js:17-59`). There is no canonical prospect table, list endpoint, assignee, transition service, task scheduler, pipeline UI, or concurrency control.

Those rows are useful import evidence. They must not become the Growth OS source of truth.

### P1 — Project Growth guidance is stale

`.easymod/skills/growth-skill.md` still describes:

- obsolete `PACKAGE_1` and `PACKAGE_2` pricing;
- Instagram and comment-keyword automation;
- unsupported churn/adoption percentages as facts.

Current product truth is Messenger-only and uses Growth 999 BDT plus Partner (`EasyMod-backend/src/modules/subscription/subscription.plans.js:4-17,106-164`; `README.md:20-25`).

`.easymod/memory/growth-insights.md` contains no observed entries. Its examples are hypotheses, not production evidence.

Repair this guidance before implementing scoring. Every metric must declare whether it is an observed value, a target, or a hypothesis.

### P2 — Frontend UX is foundation-quality only

Source-level findings on the historical branch:

- 2FA is absent;
- logout can claim success after the backend call fails;
- the Overview item uses a raw anchor and reloads the SPA;
- only inputs have clear focus styling;
- animation has no reduced-motion rule;
- some interactive targets are below 44px;
- mobile stacks desktop regions instead of providing intentional navigation;
- error reporting is only `console.error`;
- there is no build/version indicator or operational support ID.

Do a screenshot-based responsive/accessibility pass after the auth foundation runs in staging.

### P2 — Backups are not yet disaster-safe for CRM data

The 2026-08-05 canonical backup run succeeded: 83,610 compressed bytes and 51 tables. The same run reported `Off-site backup upload SKIPPED` because object-storage credentials were missing. The workflow warns that backups exist only on the droplet (`.github/workflows/backup.yml:14-24,89-143`).

Do not accumulate irreplaceable prospect notes, assignments, or customer-health history until encrypted off-site backup and a restore test pass.

## Health and Verification Dashboard

Snapshot tested: `feature/growth-os@8d26dd4`, isolated from the current checkout.

| Category | Tool/check | Result | Detail |
| --- | --- | --- | --- |
| Type check | `tsc --noEmit` | **CLEAN, 10/10** | Exit 0; about 9 seconds. |
| Production build | `npm run build` | **PASS** | 1,622 modules; JS 195.56 kB, 63.51 kB gzip. |
| Backend authz | focused Jest | **PASS** | 1 suite, 6/6 tests. |
| Compose syntax | `docker compose ... config` with example env | **PASS** | Exit 0. |
| Frontend lint | not configured | **SKIPPED** | No lint config/script. |
| Frontend tests | not configured | **SKIPPED** | No unit/integration/E2E script. |
| Dead code | not configured | **SKIPPED** | No tool/script. |
| Shell lint | no Growth shell scripts | **SKIPPED** | Not applicable. |
| Dependency audit | `npm audit --json` | **FAIL** | 3 high, 1 moderate. |
| Git diff hygiene | `git diff --check` | **PASS** | No whitespace errors in branch diff. |
| GitHub PR | canonical repo query | **MISSING** | No Growth OS PR. |
| GitHub CI | canonical repo query | **MISSING** | No Growth OS run. |
| Live DNS | DNS query | **MISSING** | NXDOMAIN. |
| Live API | HTTPS probe | **MISSING** | 404 on Growth session route. |
| Browser E2E | real host | **BLOCKED** | No live/staging host. |

Under the health skill's skipped-weight rule, the automated type-check category scores 10/10 because it is the only native category available. That score is mathematically correct and operationally misleading. Verification completeness is approximately **4/10**, and product readiness is **3.5/10**.

## Risk-Ranked Blockers

### P0 — stop before implementation

1. Correct and verify the canonical Git remote.
2. Recover from current canonical main, not local stale `main`, wrong `origin/main`, or the dirty audit branch.
3. Do not merge/cherry-pick the old workflow wholesale.
4. Resolve internal identity and mandatory 2FA.
5. Build a CSRF/refresh-aware API client before mutations.
6. Keep Growth disabled and undeployed until staging access proof passes.

### P1 — block staging or business modules

1. Add audited role lifecycle and immediate cache invalidation.
2. Complete the permission model.
3. Fix readiness and reduce Caddy/cookie blast radius.
4. Upgrade/triage dependencies.
5. Add frontend and real backend integration tests.
6. Repair growth metrics and funnel durability.
7. Replace AuditLog pseudo-leads with a canonical prospect ledger.
8. Rewrite stale Growth guidance.

### P2 — block broader rollout

1. Add frontend observability, version identity, and uptime alerts.
2. Complete responsive/accessibility design review.
3. Configure encrypted off-site backup and prove restore.
4. Add performance budgets and query plans before cross-shop dashboards.

## Clean Phase-Based Execution Plan

### Phase 0 — Source-control recovery and scope lock

Goal: establish one trustworthy code line and one accepted MVP before editing product code.

Actions:

1. Preserve the user's existing modified `docs/launch-readiness/2026-07-28-meta-app-review-readiness.md` unchanged.
2. Verify canonical repo identity: `mr3826/easymod-backend`.
3. Add or repair the canonical Git remote only with explicit user approval; fetch and verify `main` commit.
4. Do not use local `origin/main` as a base.
5. Create `codex/growth-os-foundation-recovery` from canonical main after confirming whether open brand PR #91 should remain independent.
6. Recover pure additions from `8d26dd4`:
   - `EasyMod-growth/` source and container files;
   - backend `growth-os/` module;
   - additive role migration;
   - Growth docs.
7. Manually integrate, line by line, into current `routes.js`, `entities.js`, env renderer, CI/CD, Caddy, and Compose. Do not choose the old versions during conflict resolution.
8. Rewrite the Growth specification to current Messenger-only and Growth/Partner product truth.
9. Lock MVP scope: internal acquisition CRM, no merchant routes, no billing/Meta mutation, no scraping, no auto-send, no broad reporting yet.

Exit gate:

- canonical remote and base SHA verified;
- branch is zero commits behind canonical main at creation;
- diff contains only intentional Growth work;
- no unrelated PR #91 changes unless already merged or explicitly stacked;
- no current CI/deploy/security hardening regresses;
- accepted MVP and do-not-build list recorded.

### Phase 1 — Repair current growth data foundations

Goal: make existing acquisition/activation evidence trustworthy before displaying it.

Actions:

1. Replace the broken `/api/analytics/growth` guard with explicit platform/Growth permission middleware.
2. Replace the Redis-before-DB permanent claim with a durable idempotent DB write or safely released lock.
3. Count retention only within the activated cohort.
4. Replace `2N+1` order counts with bounded grouped SQL or rollups.
5. Make metric storage/query failures observable; never turn DB failures into zero business results.
6. Add schema validation, rate limiting, and server idempotency to funnel ingestion.
7. Instrument `assistant_test_passed` and `trial_day_7_active`, or remove them.
8. Classify every metric as observed, target, or hypothesis.

Exit gate:

- fixture tests prove activation, retention, cohort, and failure behavior;
- growth endpoint returns authorized results and denies unauthorized users;
- query count is bounded;
- missing data and backend errors are visibly distinct from zero.

### Phase 2 — Make the access foundation releasable

Goal: prove a real internal user can authenticate and a merchant cannot cross the boundary.

Actions:

1. Decide and document internal identity semantics.
2. Implement 2FA verification in Growth OS and require it for privileged roles.
3. Implement a CSRF, refresh, timeout, and expiry-aware API client.
4. Add `GROWTH_OS_ENABLED=false` as the default rollout switch.
5. Complete role capability expansion.
6. Add audited Founder grant/revoke operations with immediate cache invalidation.
7. Return 403 for policy denial and controlled 503 for auth-store outage.
8. Narrow Growth-host proxy paths and session/cookie scope.
9. Add typecheck, lint, unit, integration, E2E, accessibility, and dependency scripts.
10. Fix readiness, add Compose healthcheck, build SHA, Sentry/error reporting, and uptime alerts.

Exit gate:

- real PostgreSQL/Redis integration tests pass;
- 2FA Founder 200, Merchant 403, unassigned platform admin 403, unauthenticated 401;
- revocation is immediate;
- mutation CSRF tests pass;
- dependency policy is green or exceptions are owned and justified;
- no production deployment.

### Phase 3 — Build one useful vertical slice: prospect to follow-up

Goal: replace spreadsheets for lead capture, ownership, qualification, and next action.

In scope:

- prospects and contacts;
- acquisition sources;
- normalized phone/email/Facebook Page URL;
- deduplication and merge review;
- list, filter, create, detail, edit;
- assignment/reassignment;
- deterministic lifecycle transitions;
- activities/notes;
- due and overdue follow-up tasks;
- shop linkage after conversion;
- audit event for every mutation;
- field redaction and assignment-scoped repository queries.

Not in scope:

- demos, trials, scoring, command center, outreach, referrals, testimonials;
- auto-send or scraping;
- direct mutation of subscriptions, shop setup, billing, Meta channels, or merchant automation.

Data rule: do not use `audit_logs` as the CRM source of truth. Import eligible signup and Partner pseudo-leads once, with provenance and idempotency.

Exit gate:

- Founder can capture, assign, qualify, and convert a prospect;
- Executive can see and update only assigned records;
- duplicate, IDOR, field-redaction, transition, transaction, and audit tests pass;
- one full browser E2E works without database hand-editing.

### Phase 4 — Add the human operating loop

Goal: let one executive work a lead from next action through a completed demo.

Actions:

- `My work today` queue;
- activity timeline;
- follow-up SLAs;
- replay-safe Day 1/3/7/12 task generation after cadence approval;
- demo scheduling and outcomes;
- manager workload and reassignment;
- BullMQ deterministic job IDs, retry, DLQ, alerting, and replay controls.

Exit gate:

- duplicate delivery, restart, Redis outage, DLQ, and permission tests pass;
- missed/overdue work is measurable;
- no external message is sent automatically.

### Phase 5 — Trial and customer-success loop

Goal: connect the prospect workflow to real merchant activation without mutating merchant source-of-truth.

Actions:

- prospect-to-shop/trial linkage;
- read-only signup, Page connection, profile, product, AI reply, order, RTO, subscription, and retention signals;
- trial intervention tasks;
- customer-health assessments with explainable inputs;
- consent/PII retention and deletion rules;
- CS ownership and redaction.

Exit gate:

- stalled trials are identified from tested facts;
- CS can complete an intervention with audit evidence;
- Growth OS cannot rewrite billing, channel, or merchant automation state.

### Phase 6 — Command center and reporting

Goal: expose trusted, permission-scoped operating metrics.

Metrics:

- prospect conversion by source;
- follow-up SLA;
- demo-to-trial and trial-to-paid conversion;
- time to first AI reply;
- weekly activated-cohort retention;
- executive workload/outcomes;
- aggregate-only Analyst view.

Engineering requirements:

- grouped queries or background rollups;
- pagination and query caps;
- explainable metric definitions;
- source reconciliation tests;
- performance budgets and query plans.

Exit gate: dashboard totals reconcile to source records and stay within agreed latency/query budgets.

### Phase 7 — Optional AI and advocacy features

Only after clean operational data:

- draft-only outreach copilot;
- human approval/manual send;
- prompt-data redaction and role-scoped context;
- referral and testimonial workflows;
- metadata audit without leaking sensitive prompts.

Hard boundary: no automatic Messenger, email, WhatsApp, or other external sending in this phase.

### Phase 8 — Staging, security review, and controlled production

Staging first:

1. Apply migration up/down against staging PostgreSQL.
2. Bootstrap Founder through the audited operation.
3. Run real browser tests for 401, 403, 503, 2FA, CSRF, refresh, expiry, logout, CORS, CSP, and route bypass.
4. Verify merchant routes and Messenger pipeline remain unchanged.
5. Exercise image rollback and backward-compatible migration behavior.
6. Prove alerts, error reporting, build SHA, and uptime monitoring.
7. Configure encrypted off-site backup and perform a restore test before material CRM data.

Production only after explicit approval:

1. Merge a reviewed PR with required checks. Do not deploy from a feature branch.
2. Deploy additive backend/migration behavior first.
3. Start the Growth container and validate internal health.
4. Create DNS only when the service and Caddy route are ready.
5. Canary one Founder, then a small internal team.
6. Capture an evidence bundle: workflow URL, commit SHA, health, access matrix, monitoring event, backup/restore proof, and rollback point.

Exit gate:

- production shell and authenticated API are healthy;
- unauthenticated 401, Merchant 403, Founder 200;
- merchant application regression suite passes;
- rollback is proven;
- no unresolved P0/P1 finding.

## Recommended Delivery Slices

Keep PRs small and reversible:

1. `repo/growth-recovery`: canonical remote/base verification and recovered pure files, no deploy.
2. `fix/growth-metrics`: metric access, math, idempotency, bounded query, tests.
3. `feat/growth-auth-foundation`: 2FA, API client, feature flag, role lifecycle, integration tests.
4. `feat/growth-prospects`: schema/service/API/audit only.
5. `feat/growth-prospect-ui`: list/detail/create/assignment/transition E2E.
6. `feat/growth-follow-ups`: activities/tasks/scheduler.
7. `ops/growth-staging`: current CI/Compose/Caddy integration and staging smoke.
8. Later modules only after each prior exit gate passes.

Do not combine structural recovery, metric repair, business schema, and production deployment into one PR.

## Final Recommendation

Salvage the access-control concept and small UI shell. Discard the stale deployment integration as a source file; reapply only its intent to current production code. Repair existing telemetry before trusting dashboards. Build a dedicated prospect ledger before tasks, demos, trials, or AI features.

The first meaningful milestone is not “Growth OS deployed.” It is:

> One authorized Founder can capture, assign, qualify, and follow up with a prospect; an Executive sees only assigned work; every mutation is audited; a merchant cannot enter; and no current EasyModerator production path regresses.

Until that is true, Growth OS remains a documented foundation, not an operating system for growth.
