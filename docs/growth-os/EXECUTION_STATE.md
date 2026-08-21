# Growth OS Execution State

Updated: 2026-08-21

## Current execution

- `CURRENT_MAIN`: `e455b0c69ce8aca1a18d7dc4085f1cd6854d25d0`
- `BASE_MAIN`: latest `origin/main` after PR #45 squash merge
- `WORKTREE`: `D:\easymod\easy-moderator-growth-docs`
- `BRANCH`: `docs/growth-os-phase-c-publication`
- `PHASE`: Phase C — publish the safety mechanism before authorizing rollout
- `STATUS`: pre-deploy receipts pass; the restore mechanism is being published; human authorization and live release evidence remain blocked
- `RELEASE_STATUS`: NO-GO until live Growth-origin browser/DNS/TLS and operator-delivery evidence are complete
- `PRODUCTION_CHANGED`: NO

## Phase 1 base proof

Phase 1 was merged through PR #34 using squash merge:

- `PR_34_STATE`: `MERGED`
- `PR_34_MERGE_SHA`: `b786c1ecfd4d4f03cf3f47c2945bc8c3ba8780de`
- `MERGE_METHOD`: `SQUASH`
- Original Phase 1 commit `0041311dd3f4ac8c48347a24f8adb41aec6a6e10` is intentionally not required to be an ancestor of `main`.
- The current base contains the Phase 1 telemetry/idempotency implementation, regression tests, and completion evidence.

Phase 1 evidence reused:

- unsupported funnel events remain rejected;
- browser telemetry markers are set only after successful server acceptance;
- idempotency is bound to tenant/user/payload identity;
- analytics dependency failures return sanitized `503` responses rather than false zero-valued success;
- activation writes are atomic;
- deployed analytics rate limiting uses Redis;
- Phase 1 focused evidence remains 5 backend suites/34 tests, 27 backend security suites/183 tests, 59 merchant frontend files/483 tests, PostgreSQL/Redis integration, Meta-shaped E2E, secret scan, dependency audit, and changed-service checks.

## Phase 2 merge proof

PR #35 was squash-merged into `main` after the final current-head checks
passed:

- `PR_35_STATE`: `MERGED`
- `PR_35_MERGE_SHA`: `a0e41ab5dcfdcafe11d6acc410c5cd5144602719`
- `PR_35_HEAD`: `62a542dce4066872a64594205b5c973b554bb176`
- The Phase 2 head is intentionally not an ancestor of `main` because the PR
  used squash merge; the resulting main tree and content are the authoritative
  verification.

## Access contract

### Authorized identities and roles

Growth OS reuses EasyModerator's authenticated JWT/httpOnly-cookie identity and the authoritative `users` records. Access requires an active `growth_os_user_roles` record and a matching permission in the server-side policy:

- `FOUNDER`
- `GROWTH_MANAGER`
- `BUSINESS_EXECUTIVE`
- `MARKETER`
- `CUSTOMER_SUCCESS`
- `READ_ONLY_ANALYST`

`FOUNDER` and `GROWTH_MANAGER` require the server-issued `mfaVerified=true` assurance claim. Normal password sessions issue `mfaVerified=false`; only the existing TOTP verification path issues the privileged claim. `users.platform_role` and merchant `user_shops.role` do not authorize Growth OS.

### Unauthorized identities and roles

- unauthenticated, malformed, expired, revoked, or token-version-invalid sessions;
- ordinary merchant accounts, even when they know the URL or supply a different shop/merchant identifier;
- EasyModerator platform/admin accounts without an explicit Growth OS role;
- internal users with no active Growth role or without the permission required by an endpoint;
- privileged Growth roles whose session lacks the required MFA assurance;
- any request that attempts to use a frontend-only claim or client-side state as authorization.

### Enforcement and data scope

- Backend authority: `authenticate` followed by `requireGrowthOsAccess` on the Growth router and on privileged endpoints.
- Frontend defense: `GrowthAuthProvider` and `ProtectedRoute` control navigation and show explicit denied/temporary-unavailable states; these checks are UX only.
- Current Growth APIs expose a safe internal session profile and an intentionally internal cross-shop analytics endpoint. The current Phase 2 surface does not accept merchant/customer/prospect resource IDs.
- Cross-shop analytics is allowed only through the explicit `growth_os.reports.read_all` permission. Merchant shop context is never used to grant Growth access, and forged shop identifiers do not expand access.
- Future resource endpoints must derive authorization from the server-side Growth role/policy and must add resource-scope tests before implementation.

### Failure contract

- missing, malformed, expired, revoked, or invalid-version authentication: sanitized `401`;
- authenticated without Growth authorization: sanitized `403 GROWTH_OS_FORBIDDEN`;
- privileged role without MFA assurance: `403 GROWTH_OS_MFA_REQUIRED`;
- Growth disabled by configuration: `503 GROWTH_OS_DISABLED`;
- unavailable role database/authentication store: sanitized `503`;
- unavailable deployed Redis authorization cache, including strict-cache read/write failure: sanitized `503`, never an in-memory authorization decision;
- unavailable analytics/data dependency: Phase 1 sanitized `503`, never fabricated analytics success.

## Phase 2 evidence matrix

| Capability | Status | Current evidence and expected property | Remaining gap |
| --- | --- | --- | --- |
| Authentication | COMPLETE for bounded gate | Shared JWT/cookie auth, token-version and blacklist checks; invalid/expired claims return `401`; revocation-store failures return sanitized `503`. | Live browser/session proof remains outside the local gate. |
| Internal Growth authorization | COMPLETE for bounded gate | Explicit six-role table, permission policy, default-deny middleware, MFA assurance for Founder/Growth Manager. | Operator bootstrap and production enablement remain separate gates. |
| Frontend route protection | PARTIAL | Growth provider/route guard reflects `401`, `403`, `503`, refresh, and logout failure states. | Live cross-origin browser verification is not available in this worktree. |
| Backend Growth APIs | COMPLETE for bounded gate | Session, analytics, prospect, and role routes enforce backend auth and server-side permission/scope predicates; remote Test & Build Gate passed for the merged release. | No live host proof. |
| Direct endpoint bypass | COMPLETE | Real integration and mocked security tests call protected endpoints directly; merchant calls receive `403`. | No live host proof. |
| Tenant/resource isolation | COMPLETE for current surface | Merchant tokens with forged frontend claims and foreign shop IDs remain denied; no current Growth resource-ID lookup exists. | Future resource APIs require new IDOR tests. |
| Privileged mutations | COMPLETE for bounded gate | Founder-only grant/revoke policy, input validation, transaction, last-Founder guard, cache invalidation, and audit rows. | No role-management UI; API is intentionally internal. |
| Auditability | COMPLETE for implemented mutation | Role grant/revoke write `AuditLog` records in the same database transaction. | Future Growth mutations remain out of scope. |
| Invalid/expired sessions | COMPLETE | Unit/security/integration coverage includes no credentials, invalid/expired credentials, token version, and valid signed sessions. | Live cookie expiry flow remains unverified. |
| PostgreSQL runtime | COMPLETE locally | Disposable PostgreSQL migrations and Growth access integration pass; real constraints and transactional role lifecycle exercised. | No production database was touched. |
| Redis runtime | COMPLETE locally | Disposable Redis supports role cache, invalidation, startup probe, and strict authorization cache operations; outage path returns `503`. | No production Redis was touched. |
| Phase 1 telemetry/error contract | COMPLETE | Phase 1 focused analytics suites pass after Phase 2 changes; sanitized dependency failures and idempotency behavior remain intact. | None identified in the bounded suite. |
| Deployment/readiness | COMPLETE for config gate | Caddy validates; Growth frontend has exact health/readiness paths and Compose healthcheck; Growth host rejects unsupported API paths with `404`. | Live DNS/TLS/host checks remain unverified. |
| Remote CI/build gate | COMPLETE for bounded gate | Draft PR #35 remote checks passed: Test & Build Gate, backend PostgreSQL/Redis integration, Meta-shaped E2E, Growth build, secret scan, dependency audit, deployment dry run, and no-push Docker validation; publish/deploy jobs were skipped. | Live delivery proof is still required for release. |

## Phase 2 implementation

Existing implementation reused:

- shared EasyModerator authentication, refresh, token-version, blacklist, TOTP, CSRF, session, `User`, `AuditLog`, PostgreSQL, Redis, Caddy, Compose, and deployment workflows;
- existing Growth role entity/migration, permission map, session controller, analytics route, and separate `EasyMod-growth` frontend;
- existing sanitized `AppError`/global error handling and Phase 1 telemetry/idempotency behavior.

Bounded changes made:

- added exact Growth origin configuration and production CSRF trust for `growth.easymod.tech`;
- made privileged MFA assurance explicit in server-issued tokens and Growth authorization;
- added audited Founder-only Growth role grant/revoke operations with validation, transactional last-Founder protection, and cache invalidation;
- prevented Growth authorization from falling back to generic in-memory cache behavior; lazy Redis startup is probed with a bounded timeout and strict role-cache operations fail closed;
- added sanitized authentication service failure behavior for revocation-store outages;
- fixed Growth client CSRF behavior for authenticated mutations, refresh/retry behavior, logout failure handling, and temporary dependency-unavailable UI;
- narrowed the Growth host proxy to the Growth auth/session contract and made unsupported API paths deterministic `404` responses;
- added Growth frontend readiness/build identity, Compose healthcheck, behavioral test execution in CI, and Windows-compatible integration migration/test discovery;
- made the existing Growth role migration DDL transactional and corrected its migration log identifier.

No new merchant-facing feature, CRM feature, prospect discovery, enrichment, outreach, retention, referral, AI, or Phase 3 implementation was added.

## Runtime and validation evidence

- Disposable PostgreSQL/Redis stack: migrations completed successfully, including `20260820_001_growth_os_user_roles`.
- Real Growth access integration: final disposable PostgreSQL/Redis gate passed 2 suites/22 tests after the strict Redis/startup-probe correction; migrations completed before the test run.
- Growth authorization focused suite: final combined affected suite passed 4 suites/29 tests, including 13 Growth authorization tests and the authentication, CSRF, and origin regressions.
- Merchant frontend unit suite: 59 files/483 tests passed.
- Growth frontend behavioral test: passed; Growth frontend TypeScript check and production build passed.
- Backend build/syntax check: passed.
- Phase 1 analytics focused regression: 4 suites/27 tests passed in the current checkout; historical merged Phase 1 acceptance remains 5 suites/34 tests.
- Production Compose parse: passed; Caddy configuration validation: passed; Growth Docker image build: passed.
- Dependency audit: `npm audit --audit-level=high --omit=dev` passed with 0 vulnerabilities.
- Changed-code Gitleaks directory scans passed for backend, Growth frontend, and workflow paths.

## Phase 3 merged-release validation evidence (pre-hardening)

- Prospect backend focused unit/security/migration gate: **4 suites, 26 tests
  passed**.
- Disposable PostgreSQL/Redis integration gate: **4 suites, 28 tests passed**,
  including prospect CRUD, scope/IDOR, scoped duplicate conflict redaction,
  multi-field search, concurrent duplicate creation, merge index release, audit
  rollback, and import dry-run/idempotency.
- Growth frontend Vitest/jsdom/typecheck gate: **3 files, 17 tests passed**.
- Growth production build: passed.
- Backend syntax/build check: passed.
- Fresh bootstrap smoke check: passed; prospect tables were absent before the
  migration and both migrated tables contained the required `CHECK` constraints.
- Complete backend unit gate: **170 suites, 2,006 tests passed** (including the
  Growth role bootstrap CLI check).
- Backend security gate: **29 suites, 198 tests passed**.
- Focused auth/analytics/Growth regression: **11 suites, 92 tests passed**.
- Backend test discovery: **177 tracked files, 177 with exactly one execution
  home**; 2 quarantined files remain within the existing allowance.

## Phase 3 merge and post-merge release evidence

- `PR_37_STATE`: `MERGED`
- `PR_37_HEAD`: `0f09704` (`feat(growth-os): ship prospect ledger and operator bootstrap`)
- `PR_37_MERGE_SHA`: `974533af5e9783100dbf7db8b00f775623e3d5a1`
- PR #37 remote gates passed: Test & Build Gate, PostgreSQL/Redis integration,
  Meta-shaped E2E, security scan, Growth OS build, deployment dry run, and
  no-push Docker validation.
- `PR_38_STATE`: `MERGED` — release-state evidence documentation;
  `PR_38_MERGE_SHA`: `52819cc07098863ede1adef2a89cfa479cd096d9`.
- `PR_39_STATE`: `MERGED` — corrected the production DB probe's image path;
  `PR_39_MERGE_SHA`: `f3c1b6314ee467f4ffa3d2fd9444706fe67443ae`.
- `PR_40_STATE`: `MERGED` — made the production DB probe standalone and added
  regression coverage; `PR_40_MERGE_SHA`:
  `0e1251c73ba9d1d56f8e27344eb0b72ca8a6aabf`.
- `PR_42_STATE`: `MERGED`.
- `PR_42_HEAD`: `a673aa5204485e22613313ff14eb1b6976af8549`.
- `PR_42_MERGE_SHA`: `c65919238b608b5329aa0c152be4387dbafbfb67`.
- `PR_42_MERGE_METHOD`: `SQUASH`.
- `PR_42_MERGED_SHA_E2E_RUN`: `32412540978` passed; the browser gate reported
  12 of 12 Chromium scenarios.
- `PR_42_MERGED_SHA_CI_RUN`: `32412540977` passed; image publication completed
  and the deploy job was skipped.
- Growth image publication run `32412540978` passed after the merge.
- `PR_42_GHCR_IMAGE_GROWTH_CANDIDATE`: `ghcr.io/mr3826/easymoderator-growth-os@sha256:353e55de49eff657e9304c54e10b54ce005a8ffdd22ea82eab400f74e7d506c0` (historical; superseded by the PR #43 publication below).
- `PR_43_STATE`: `MERGED`.
- `PR_43_HEAD`: `f808e5913932a6c2ec3b65bd61fc3d1909ce024b`.
- `PR_43_MERGE_SHA`: `ff33c056c3e3c8a0ffd80b92e30f9589c05486fa`.
- `PR_43_MERGE_METHOD`: `SQUASH`.
- `PR_43_MERGED_SHA_CI_RUN`: `32449959064` passed; Test & Build, Meta-shaped E2E, PostgreSQL/Redis integration, deployment configuration, and Build & Push passed; Docker build validation (no push) and `Deploy to DO Droplet` were skipped.
- `PR_43_MERGED_SHA_GROWTH_RUN`: `32449958917` passed; Growth typecheck/tests/build, browser E2E reported 12 of 12 Chromium scenarios, and Growth image publication passed.
- `PR_43_MERGED_SHA_SECURITY_RUN`: `32449958900` passed; historical secret scan and production dependency audit passed.
- `PR_43_GROWTH_RUNTIME_SOURCE_SHA`: `c65919238b608b5329aa0c152be4387dbafbfb67` — PR #43 changed no `EasyMod-growth/**` files; `ff33c056c3e3c8a0ffd80b92e30f9589c05486fa` is the later deploy/CI/docs SHA.
- `PR_43_GROWTH_IMAGE_DIGEST`: `ghcr.io/mr3826/easymoderator-growth-os@sha256:353e55de49eff657e9304c54e10b54ce005a8ffdd22ea82eab400f74e7d506c0` (verified 64-hex first-rollout candidate for runtime source SHA `c65919238b608b5329aa0c152be4387dbafbfb67`; the invalid 63-hex handoff value is rejected).
- `PR_44_STATE`: `MERGED`.
- `PR_44_HEAD`: `82ba19f97fcfb0c87a4f118fb7ed409cec435a18`.
- `PR_44_MERGE_SHA`: `0f327dd4728c649a3ed849f6915043f0410af278`.
- `PR_44_MERGE_METHOD`: `SQUASH`.
- `PR_44_MERGED_SHA_CI_RUN`: `32456686329` passed; deployment configuration dry run, including the executable rollback rehearsal, passed; Build & Push passed; Docker build validation (no push) and `Deploy to DO Droplet` were skipped.
- `PR_44_MERGED_SHA_CI_JOB`: `96695826601` passed; the rehearsal receipt was uploaded.
- `PR_44_MERGED_SHA_SECURITY_RUN`: `32456686304` passed; historical secret scan and production dependency audit passed.
- `PR_44_ROLLBACK_REHEARSAL_ARTIFACT`: `rollback-rehearsal-evidence` (`659` bytes, unexpired).
- `PR_44_ROLLBACK_REHEARSAL_RECEIPT_SHA256`: `160f59bd56257807aeaba18ad40e727c37e73720dbf978ce8d19b282b275dccb`.
- `PRODUCTION_DEPLOY_ENABLED`: `false`.
- `GROWTH_BOOTSTRAP_DIGEST`: `ABSENT`.
- `PR_44_ROLLBACK_REHEARSAL`: `PASS` — the merged-SHA receipt reports candidate verification rejection, previous digest-pinned backend/frontend restoration, matching environment hashes, byte-identical Compose/Caddyfile restoration, backend `/health/ready` and `/health` success, frontend health success, and missing-previous-image rejection; it does not prove the production topology or run `migrate:down`.
- `PRODUCTION_PREFLIGHT_RUN`: `32413675729` passed in read-only probe mode;
  production environment rendering, SSH, DB host resolution, TCP connectivity,
  expected database name, DB authentication, and `SELECT 1` all passed.
- `PRODUCTION_DROPLET`: DigitalOcean read-only API confirmed active droplet
  `easymod-prod` (`id=572180595`, `139.59.249.141`).
- `CORS_ORIGINS_PREREQUISITE`: `CLOSED` — repository variable
  `CORS_ORIGINS` now contains `https://app.easymod.tech` and
  `https://growth.easymod.tech`; it still excludes the marketing origin.
- `GROWTH_DNS_TLS_GATE`: `OPEN` — `growth.easymod.tech` resolves to
  `139.59.249.141`, but HTTPS still fails with `tlsv1 alert internal error`
  (TLS alert 80). Caddy on the droplet has no certificate for the Growth SNI
  because its deployed `Caddyfile` predates the Growth site block, and that
  file is synced inside the gated deploy. TLS is therefore a post-deploy
  validation and cannot be closed beforehand.
- `FIRST_GROWTH_ROLLOUT`: `NOT RUN` — the image is published but not pinned on
  the droplet; `PRODUCTION_DEPLOY_ENABLED` remains `false`.
- `OPERATOR_BOOTSTRAP`: `NOT RUN` — no Founder target credentials or live
  authenticated bootstrap session were available.
- `PHASE_3_BROWSER_WALKTHROUGH`: `NOT RUN` — the host is not live.
- `ROLLBACK_REHEARSAL`: `PASS` — merged SHA `0f327dd4728c649a3ed849f6915043f0410af278`; CI run `32456686329`, deployment-config job `96695826601`, artifact `rollback-rehearsal-evidence`, receipt SHA256 `160f59bd56257807aeaba18ad40e727c37e73720dbf978ce8d19b282b275dccb`.

## First-rollout digest pin

The first Growth rollout must be hand-pinned with the exact image built from
`origin/main` at `e455b0c` before any separately authorized deploy. The source
delta check `git log c65919238b608b5329aa0c152be4387dbafbfb67..origin/main --
EasyMod-growth` is empty, but an exact publication is still required because
the Docker build embeds its SHA in `dist/build-info.json`.

The exact publication completed through workflow dispatch:

- `GROWTH_IMAGE_PUBLICATION_RUN`: `32477273787`
- `GROWTH_IMAGE_BUILD_JOB`: `96756642973`
- `GROWTH_IMAGE_BUILD_SHA`: `e455b0c69ce8aca1a18d7dc4085f1cd6854d25d0`
- `GROWTH_IMAGE_TAG`: `e455b0c69ce8aca1a18d7dc4085f1cd6854d25d0`
- `GROWTH_IMAGE_DIGEST`: `sha256:7421a9b49792fb02d6f8c18acd9d5a547966684529c8dfaa1df8629bdff02b00`
- `GROWTH_IMAGE_BUILD_INFO`: run log confirms `VITE_BUILD_SHA=e455b0c...`
- `GROWTH_IMAGE_IMMUTABLE_CHECK`: `PASS` — bare digest is 64 hex characters

The previous `ff33c056` and `c659192` image digests remain historical evidence
only. The local Docker Desktop daemon was unavailable for the optional pull and
`docker image inspect` cross-check; the authoritative digest is the successful
GHCR push step's digest from the exact-SHA run. The following operator commands
remain prepared only; they were not executed:

```bash
cd /opt/easymod
docker pull ghcr.io/mr3826/easymoderator-growth-os:e455b0c69ce8aca1a18d7dc4085f1cd6854d25d0
test "$(docker image inspect -f '{{index .RepoDigests 0}}' ghcr.io/mr3826/easymoderator-growth-os:e455b0c69ce8aca1a18d7dc4085f1cd6854d25d0)" = "ghcr.io/mr3826/easymoderator-growth-os@sha256:7421a9b49792fb02d6f8c18acd9d5a547966684529c8dfaa1df8629bdff02b00"
```

After separate authorization, set `GROWTH_BOOTSTRAP_DIGEST` to this verified
bare digest, confirm the droplet pulled the same immutable reference, and clear
the variable after a successful rollout. It remains unset until the human gate
opens.

## Phase A and B pre-deploy receipts

These receipts were collected on `2026-08-21`. No deploy, DNS/TLS change,
Founder credential handling, or production data mutation occurred. The restore
drill used a temporary container, volume, and network and removed all three in
its trap-guarded teardown.

- `PHASE_A_PREFLIGHT_GATE`: `PASS` for pre-deploy lanes 1-4
- `DIGEST_AUTHORITY`: `PASS` — exact-SHA publication run `32477273787` produced
  `sha256:7421a9b49792fb02d6f8c18acd9d5a547966684529c8dfaa1df8629bdff02b00`
- `PRODUCTION_DIGEST_CAPTURE`: `PASS` — backend rollback ref
  `ghcr.io/mr3826/easymod-backend@sha256:016272e5ee91f821ef27f9a93cc07874036a567bc22fa1f1973193bde0921b18`
  and frontend rollback ref
  `ghcr.io/mr3826/easymod-frontend@sha256:496aac5a73e954ed8d08f94250bbaddc5321f6a63555e81c139acab0d3db6fc5`
  were captured with `docker inspect`; Growth was confirmed absent
- `BACKUP_READINESS`: `PASS` — fresh backup run `32441601649` produced
  `easymod-20260821-025646.dump`; isolated restore receipt recorded
  `RESTORE_PG_RESTORE=PASS`, users `2`, shops `2`, Growth tables absent as an
  explicit pre-rollout baseline, latest migration
  `20260726_001_meta_webhook_receipts`, and unchanged production PostgreSQL
  uptime; the published restore workflow is the repeatable mechanism for this
  receipt
- `DEPLOY_PATH_INTEGRITY`: `PASS` — validator returned
  `rollback-contract=PASS`; `production` now has required reviewer `mr3826` and
  protected-branch policy; `main` requires pull requests, admin enforcement,
  conversation resolution, strict `Test & Build Gate`, `Growth OS build gate`,
  and `Growth OS browser E2E gate` checks, with required approvals set to `0`,
  force-push and deletion disabled;
  required secret names passed, `PRODUCTION_DEPLOY_ENABLED=false`, and
  `GROWTH_BOOTSTRAP_DIGEST` is absent. Single-maintainer review is structurally
  unavailable; the `production` environment reviewer gate with
  `prevent_self_review=false` remains the human checkpoint.
- `DNS_HTTP_BASELINE`: `PASS` — expected hosts resolve to `139.59.249.141` and
  HTTP redirects to HTTPS
- `GROWTH_TLS_ISSUANCE`: `DEFERRED_TO_POST_DEPLOY` — the pre-deploy TLS failure
  is circular by design because the Growth Caddy block is delivered and reloaded
  only by the gated deploy; no pre-deploy TLS failure is counted against Phase A
- `PHASE_B_POST_DEPLOY_GATE`: `OPEN` — Growth TLS issuance, live
  Growth-origin browser walkthrough, and operator bootstrap remain pending
- `PRODUCTION_DEPLOY_ENABLED`: `false` confirmed by names-only repository
  variable inspection
- `GROWTH_BOOTSTRAP_DIGEST`: absent during preflight
- `HUMAN_AUTHORIZATION_GATE`: closed

The existing `origin/main` CI run `32466526882` and Security run `32466526773`
passed, with `Deploy to DO Droplet` skipped. These checks and the new pre-deploy
receipts do not authorize the live rollout.

## Phase 3 prospect foundation hardening

The merged Phase 3 implementation had confirmed defects in source scoping,
redaction, phone normalization, linkage authorization, assignment validation,
source-reference tombstones, timeline bounds, duplicate conflict handling, and
diagnostic error visibility. The hardening implementation is the focused remediation; it
does not rebuild the already-merged prospect foundation.

- `HARDENING_BRANCH`: `codex/growth-os-phase-3-prospect-hardening`
- `HARDENING_BASE`: `930005db170761a472576e597df900bc77dc67bd`
- `HARDENING_PR_STATE`: `MERGED — PR #42 squash-merged as
  c65919238b608b5329aa0c152be4387dbafbfb67`
- `REPOSITORY_VISIBILITY`: `PUBLIC — verified with gh repo view`
- `HARDENING_PRODUCTION_CHANGED`: `NO`
- `HARDENING_DNS_CHANGED`: `NO`
- `HARDENING_BROWSER_E2E`: `PASS remotely — merged SHA c65919238b608b5329aa0c152be4387dbafbfb67; Growth OS browser E2E run 32412540978 reported 12/12 Chromium scenarios; live Growth-origin browser/DNS/TLS remains open`
- Server enforcement now restricts marketer source rows, redacts notes/metadata
  and timeline private fields, gates linkage suggestions, permits read-assigned
  without mutation permission, requires active Growth roles for owners, and
  requires explicit CLI audit actors.
- Data integrity now preserves non-Bangladesh phone digits, excludes merged
  tombstones from source-reference deduplication, bounds timeline pages, and
  returns consistent duplicate conflicts through global error handling.
- Growth UI now sends explicit nulls for cleared edit fields, routes endpoint
  `401`/`403`/`503` responses through `GrowthAuthProvider`, follows the legal
  lifecycle map, gates the prospect sidebar, validates UUID inputs, and caps
  mutation reasons at 200 characters.
- Local hardening validation: focused prospect gate **6 suites, 41 tests
  passed**; full backend unit gate **174 suites, 2,027 tests passed**; backend
  security gate **29 suites, 203 tests passed**; test-discovery guard **181
  tracked files, 181 with exactly one execution home**; disposable PostgreSQL/
  Redis integration **4 suites, 35 tests passed**, including migration
  `20260820_003` and importer re-linking; Growth frontend gate **6 files, 34
  tests passed with TypeScript check**; Growth production build passed; merchant
  frontend gate **59 files, 483 tests passed**; backend syntax/build passed.
- Disposable Growth browser gate: `npm run test:growthos:e2e` passed **12 of 12
  Chromium scenarios** across prospect workflows, role/scoped permissions,
  mocked and real failure states, and 390px/768px/1440px responsive layouts.
  The runner completed migrations and fixture seeding against disposable
  PostgreSQL/Redis services and removed the owned containers, volumes, and
  network during teardown; no production service or data was touched.
- `HARDENING_REMOTE_CI`: `PASS — merged SHA c65919238b608b5329aa0c152be4387dbafbfb67 passed Growth OS build, browser E2E run 32412540978 (12/12), CI run 32412540977, historical secret scan, dependency audit, backend integration, Meta-shaped E2E, deployment dry run, and Test & Build; the Growth image was published and deployment was skipped`
- The merged hardening implementation remains separate from the Phase 2
  Cloudflare credential recovery and release verdict block above. No DNS, deploy,
  bootstrap, or production data action was authorized by this state update.

## Known limitations and pre-existing debt

- The repository has no tracked `docs/growth-os/GROWTH_OS_GOAL.md` or `CURRENT_STATE.md`; the available untracked master-goal document was preserved in the user's root worktree and historical tracked Growth documents were used as context. This Phase 2 state file is the durable evidence record.
- Node `v25.6.1` is newer than the repository's Node 20 engine. The local unit/security gates pass, but runs without Redis emit pre-existing post-test BullMQ/ioredis `ECONNREFUSED` logs; the disposable PostgreSQL/Redis gate passes with Redis available.
- The two existing quarantine suites remain unrelated debt: the chatbot suite currently assumes a legacy route, and the smart-payment suite requires an unsupported CommonJS/ESM Chai load. They remain within the tracked quarantine allowance and were not changed by Phase 3.
- Meta-shaped E2E remains an open pre-existing gate and does not provide live Growth-origin browser proof in this worktree. It is intentionally not represented as a Phase 3 pass.
- A full Gitleaks history scan cannot traverse the linked-worktree `.git` pointer. The bounded changed-code scans passed. A whole-worktree scan reports the pre-existing public Resend DKIM TXT record in `docs/launch/cloudflare-zone-records.txt` as a generic-key false positive; it was not changed.
- No production deployment, DNS/TLS change, live browser session, operator bootstrap, or production data mutation was performed; the Growth image was published and the later production preflight was read-only.
- Remote CI and draft PR checks passed on PR #35; Phase 3 remote CI/build gates passed on PR #37, #39, and #40; merged PR #42 passed its remote browser gate in run 32412540978 and CI run 32412540977; merged PR #44 passed CI run 32456686329, Security run 32456686304, and rollback rehearsal job 96695826601 with receipt hash 160f59bd56257807aeaba18ad40e727c37e73720dbf978ce8d19b282b275dccb. Live Growth-origin browser parity, DNS/TLS, operator bootstrap, and production delivery remain unverified; the disposable browser and rollback rehearsals are not live-host receipts.

## Phase 3 implementation

Implemented the canonical two-table prospect ledger and its internal operator
surface:

- PostgreSQL migration with named checks, scope/query indexes, and partial
  unique identity indexes;
- lazy-loaded Sequelize prospect/event entities and associations;
- pure phone/email/page/business normalization and deterministic lifecycle;
- repository-enforced all, assigned, and redacted source scopes;
- transactional create/edit/status/assignment/link/merge services writing both
  product events and platform audit rows;
- GET duplicate preflight and linkage suggestions with targeted rate limiting;
- dry-run-by-default historical importer for `crm_lead` and Partner rows;
- Growth list/detail/create/edit pages, permission UX guards, redacted rendering,
  timeline, assignment, linkage, merge, and Vitest/jsdom setup;
- backend unit/security/migration/integration/import tests and Growth UI/client
  tests.

Merchant signup/Partner producers, subscriptions, billing, and merchant
frontend were not changed by the prospect implementation. PR #44 later added
only the non-production rollback-rehearsal CI wiring.

## Deferred Growth OS debt

The following remain explicitly deferred and were not expanded by the hardening
implementation: unindexed `%LIKE%` linkage suggestions; no `pg_trgm` index for `q`
search; punctuation-normalized business-name search gaps; unbounded importer
source loads and intra-batch dry-run miscounts; IP-only rate limits covering
only a subset of routes; entity/migration index drift; missing role DDL checks
and partial indexes on the `db:sync` path; and the `merged_into_id ON DELETE SET
NULL` conflict with the merge check. Outreach, Next Best Action, demos, trials,
retention/churn scoring, referrals/testimonials, and autonomous AI remain Phase
4+ scope.

## Phase 3 development and release gates

The gates are intentionally separate:

- `PHASE_2_IMPLEMENTATION_GATE`: `PASS`
- `PHASE_2_MERGE_GATE`: `PASS — PR #35 squash-merged and verified on main`
- `PHASE_2_PRODUCTION_RELEASE_GATE`: `BLOCKED`
- `PHASE_3_DEVELOPMENT_BLOCKED_BY`: `NONE`
- `PHASE_3_MERGED_IMPLEMENTATION_GATE`: `CORRECTED — merged implementation had confirmed security/correctness defects; the merged hardening implementation addresses them`
- `PHASE_3_IMPLEMENTATION_GATE`: `PASS — local hardening validation and PR #42 remote checks complete on merged SHA c65919238b608b5329aa0c152be4387dbafbfb67`
- `PHASE_3_BROWSER_E2E_GATE`: `PASS remotely — merged SHA c65919238b608b5329aa0c152be4387dbafbfb67; run 32412540978 reported 12/12 Chromium scenarios; live Growth-origin browser/DNS/TLS remains OPEN`
- `PHASE_A_PREFLIGHT_GATE`: `PASS — exact digest, incumbent rollback refs, isolated restore, deploy protections, and required names-only configuration checks are evidenced; the restore-drill workflow awaits publication`
- `FIRST_GROWTH_ROLLOUT_DIGEST_GATE`: `PASS — exact e455b0c publication run 32477273787 produced digest sha256:7421a9b49792fb02d6f8c18acd9d5a547966684529c8dfaa1df8629bdff02b00`
- `PRODUCTION_DIGEST_CAPTURE_GATE`: `PASS — backend/frontend incumbent refs are digest-pinned and Growth is absent, so the bootstrap path is confirmed`
- `BACKUP_RESTORE_GATE`: `PASS — isolated manual drill restored the fresh dump and cleaned all temporary resources; Growth tables were absent in the pre-rollout backup and recorded explicitly`
- `DEPLOY_PATH_INTEGRITY_GATE`: `PASS — rollback contract, production reviewer policy, protected main branch with zero required approvals and strict required checks, and required secret names are verified`
- `DNS_HTTP_BASELINE_GATE`: `PASS — DNS and HTTP redirect baseline recorded`
- `GROWTH_TLS_ISSUANCE_GATE`: `OPEN — post-deploy Caddy certificate issuance and HTTPS validation are required because the Caddy Growth block is delivered by the gated deploy`
- `PHASE_B_POST_DEPLOY_GATE`: `OPEN — Growth TLS, live Growth-origin browser walkthrough, and operator bootstrap remain pending`
- `PHASE_C_PUBLICATION_GATE`: `OPEN — the corrected workflow and receipts must merge to main before the restore mechanism is considered published`
- `OPERATOR_BOOTSTRAP_GATE`: `OPEN — Founder/operator bootstrap remains unclaimed`
- `PRODUCTION_BROWSER_E2E_GATE`: `OPEN — no live Growth-origin browser receipt`
- `ROLLBACK_REHEARSAL_GATE`: `PASS — merged SHA 0f327dd4728c649a3ed849f6915043f0410af278; CI run 32456686329; deployment-config job 96695826601; artifact rollback-rehearsal-evidence; receipt SHA256 160f59bd56257807aeaba18ad40e727c37e73720dbf978ce8d19b282b275dccb`
- `OVERALL_GROWTH_OS_RELEASE_VERDICT`: `NO-GO`

Phase 3 implementation and the disposable local and remote browser gates are
complete for the development gate. The pre-deploy rollout gate is now
evidenced, but live Growth-origin TLS/browser delivery, operator bootstrap,
rollback rehearsal and production delivery remain open and must not be
represented as passed by this phase. The restore mechanism remains a release
precondition, not authorization to deploy.
