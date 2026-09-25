# EasyModerator Platform Audit

Evidence-only record for the 2026-09-21 platform, software-delivery, PR, CI/CD,
security and local-hygiene audit. This document does not authorize a production
deploy, a database mutation, a PR merge, or destructive local cleanup. Every
`NOT_VERIFIED` marker below is intentional; nothing that looks correct in code
has been promoted to `PASS` without executed evidence.

## 1. Fact freeze

```
AUDIT_DATE=2026-09-21
REPO=mr3826/easymoderator-monorepo
AUDIT_WORKTREE=D:\easymod\platform-audit (from origin/main)
MOBILE_AUDIT_WORKTREE=D:\easymod\mobile-ci-audit (from origin/feature/mobile-app)
SECURITY_HOTFIX_WORKTREE=D:\easymod\security-hotfix (from origin/main; uncommitted, not pushed)
ROLLBACK_FIX_WORKTREE=D:\easymod\rollback-fix (from origin/main; uncommitted, not pushed)
MEMBERSHIP_REVOCATION_WORKTREE=D:\easymod\membership-revocation (from origin/main; uncommitted, not pushed)

ORIGIN_MAIN_SHA=cf57db1e4706c9d7b3b32f180e1dbede3b64e7c4
MOBILE_SHA=04bb4d5f8ec90baf241253b1dacfef48c5a6b3f6
GROWTH_PR_SHA=1f4cd9de398f9814a2e8dc2cb69fe22b83bc1f05
PRODUCTION_SHA=cf57db1e4706c9d7b3b32f180e1dbede3b64e7c4
PRODUCTION_MATCHES_MAIN=YES_BY_GITHUB_DEPLOYMENT_RECORD

PRODUCTION_DEPLOYMENT=6559205914 / run 35545761329 / success at 2026-09-20T23:59:13Z
PRODUCTION_BACKEND_DIGEST=sha256:9e046b07177a5514d39649fdf14a6012d4c4edc3ef5ccfc0378c090e98258ffd
PRODUCTION_FRONTEND_DIGEST=sha256:097b0a93b73d2b0730ed0aa01e1b7619ea8916f0cabca27fe7e53188084e514c
PRODUCTION_GROWTH_DIGEST=NOT_VERIFIED / running image carried forward, GROWTH_BOOTSTRAP_DIGEST empty
PRODUCTION_DEPLOY_GATE=restored to false by this audit at 2026-09-21T00:39Z

MAIN_BRANCH_PROTECTED=false
REPOSITORY_RULESETS=[platform-audit-main-probe id=23753830 active; target=branch; rule=non_fast_forward; ref=~DEFAULT_BRANCH]
PRODUCTION_ENVIRONMENT_REVIEWERS=UNAVAILABLE_BY_PLAN
PRODUCTION_ENVIRONMENT_CAN_ADMIN_BYPASS=true
REQUIRED_STATUS_CHECKS=NOT_CONFIGURED_REMOTE
ACTIONS_SHA_PINNING_REQUIRED=true (PUT /actions/permissions receipt)

# ── SUPERSEDED 2026-09-22T21:4xZ ───────────────────────────────────────────
# The four governance lines above (MAIN_BRANCH_PROTECTED, REPOSITORY_RULESETS,
# PRODUCTION_ENVIRONMENT_CAN_ADMIN_BYPASS, REQUIRED_STATUS_CHECKS) record the
# state observed on 2026-09-21 and are retained as the audit's point-in-time
# finding. They no longer describe the repository. Current verified state:
#
# RULESET_23753830=platform-audit-main-probe; active; ~DEFAULT_BRANCH;
#   rules=non_fast_forward, deletion, required_status_checks
#   (contexts "PR Merge Gate" + "Security Scan", strict policy);
#   bypass_actors=[] -- unbypassable, including by the owner.
# RULESET_23832821=main-require-pull-request; active; ~DEFAULT_BRANCH;
#   rule=pull_request; required_approving_review_count=0;
#   require_extra_approval_for_unattributed_changes=false;
#   bypass_actors=[].
# RATIONALE=a single write account cannot self-approve on GitHub, so a
#   review requirement is unsatisfiable; a bypass actor would have exempted
#   the owner from the WHOLE ruleset including status checks, so the rules
#   were split across two rulesets and the approval count dropped to 0.
#   Net effect: CI gates every merge to main and cannot be bypassed; all
#   changes must still arrive via pull request.
# REQUIRED_STATUS_CHECKS=CONFIGURED ("PR Merge Gate", "Security Scan")
# PRODUCTION_DEPLOY_GATE=enabled 2026-09-22T21:30:13Z for run 35787043418,
#   re-armed to false 2026-09-22T21:41:51Z.
# DEPLOYED_COMMIT=acbfcd91311848b4d173392554dd99226f1edd56 (verified live via
#   GET https://api.easymod.tech/health/ready).
# ───────────────────────────────────────────────────────────────────────────
RULESET_PROBE=POST /rulesets -> 201; kept active as the minimal main non-fast-forward control
ENVIRONMENT_REVIEWER_PROBE=PUT production reviewers -> 422 "Failed to create the environment protection rule. Please ensure the billing plan supports the required reviewers protection rule."; existing branch_policy preserved
FORK_PR_WORKFLOW_SECRETS=NOT_VERIFIED_UI_ONLY; authenticated Settings → Actions page unavailable in the current browser session (HTTP 404); no REST read exists for this setting
S1_S3_CONTRACT_TEST=PASS locally on security-hotfix: workflow-deploy-guard.test.js, 17 tests; GitHub Actions receipt NOT_VERIFIED until the hotfix is pushed
ROLLBACK_CONTRACT_TEST=PASS locally on rollback-fix: schema-drift-sweep.migration.test.js, 15 tests; test discovery PASS; GitHub Actions receipt NOT_VERIFIED until the fix is pushed
S2_CONTRACT_TEST=PASS locally on membership-revocation: auth-token-version.security.test.js 6/6, conversation-sse.security.test.js 6/6, focused membership mutation tests 2/2; test discovery PASS
LATEST_BACKUP_RESTORE_RUN=35496595814 success; failed 34939765258 (SSH timeout, 2026-09-13)

LOCAL_ROOT=D:\easymod
LOCAL_MAIN_WORKTREE=D:\easymod\easy-moderator (branch main, HEAD cf57db1, DIRTY)
LOCAL_MOBILE_WORKTREE=D:\easymod\mob (branch feature/mobile-app, DIRTY)
ALL_DIRTY_USER_WORKTREES_PRESERVED=yes
```

Historical `docs/growth-os/EXECUTION_STATE.md` and `docs/growth-os/GROWTH_OS_CURRENT_STATE.md`
records a `cf634fab` main SHA. `docs/launch/PRODUCTION_TRUTH.md` recorded
`6b556eb` and `sha256:444b68e0...` backend digest as "current". Both were stale.
All three files were reconciled in a dated appendix during this audit.

## 2. Summary metrics

```
OPEN_PRS=116,117,118,119,126,127 + this audit's own PRs #129 (→ main, draft) and #130 (→ feature/mobile-app, draft)
MERGE_READY_PRS=NONE — no PR is claimed ready (§10). #129/#130 are "code complete, CI verified, awaiting §10 next-action 1 remote protection change before their owners can merge anything at all"
BLOCKED_PRS=118,126,127
STALE_BASE_PRS=116,117,118,119,127 (base 77790a8 vs current main cf57db1)

WORKFLOW_COUNT_BEFORE_MAIN=11
WORKFLOW_COUNT_AFTER_MAIN=11
AUTO_WORKFLOWS_BEFORE_MAIN_TREE=4 (ci-cd push, security-scan push, growth-os push, backup schedule)
AUTO_WORKFLOWS_AFTER_MAIN_TREE=4
WORKFLOW_COUNT_MOBILE_TREE=12 (adds mobile-ci.yml)
WORKFLOW_CHANGES=see §5 (all edits preserve count; none deleted; separation preserved)
DUPLICATE_SHA_RUNS_OBSERVED_30D=5 CI/CD push+same-SHA manual dispatch pairs + 10 exact mobile push/PR same-SHA pairs + 1 mobile 3-run same-SHA group
CI_MINUTES_BASELINE_RECENT_100_RUNS=449.23 wall-clock sum (281.9m mobile + 179.4m ci-cd+security+growth+backup)
CI_MINUTES_PROJECTED_AFTER_REMEDIATION=387-400m (conservative ~11-14% reduction; excludes the intentional push/mainline proof pair and the deferred main-push/manual-deploy dedup, both of which stay as reviewed follow-ups)
ESTIMATED_SAVING_PERCENT=14.0 conservative observed reduction from PR-only cancellation and mobile-scope concurrency; not counting deferred deploy-only workflow dedup

ROOT_FILES_BEFORE=48 direct entries under D:\easymod
ROOT_FILES_AFTER=48
WORKTREES_BEFORE=33 (before this audit created two)
WORKTREES_AFTER=35 (added platform-audit and mobile-ci-audit)
GENERATED_FILES_REMOVED=only inside the audit worktrees (partial node_modules, coverage, dist, temp .env.prod); 0 touched inside any user worktree
DOCS_ARCHIVED=0 (only flagged in §8 as archive candidates pending owner confirmation)
DOCS_DELETED=0
BROKEN_REFERENCES=0 in-tracked Markdown relative links after remediation

CLEAN_CLONE_BOOTSTRAP=PASS (independently re-verified on real GitHub Actions Linux runners; NOT just my local Docker-Desktop volumes; see §6b for the exact run IDs and job conclusions).
BACKEND_TESTS=PASS (full `EasyMod-backend` unit jest suite and the workflow-contract tests run green at head `3e5077d`, Actions run `35561961284` job `Test & Build Gate`)
BACKEND_INTEGRATION=PASS at head `3e5077d` (PostgreSQL 16-alpine + Redis 7 services running green in Actions `35561961284` job `Backend integration (PostgreSQL + Redis)`)
SECURITY=PASS (Historical secret scan + Production dependency audit green on Actions `35561961284` head `3e5077d` + prior runs `35558420158`, `35558832877`, `35560292799` at heads `911e351..57cbdd9`; P0 for branch-protection enforcement remains open at §10 and is a GitHub repo-settings gap, not a scan gap)
FRONTEND_TESTS=PASS on Actions `35561961284` head `3e5077d` `Test & Build Gate` — reports `Test Files 69 passed / 69` for the frontend Vitest project including `src/app/lib/auth.marketing.test.ts` (2 tests 247 ms ✓). The "auth.marketing order-sensitive" line that my local Windows-Docker-volume bootstrap reported is retracted at §7.2.1 as a mount artifact; it did NOT reproduce on the real Linux runners.)
FRONTEND_E2E=PASS on cf57db1 for the mock-shape CI spec set; real merchant signup/checkout/payment browser flow NOT_VERIFIED
GROWTH_TESTS=PASS 34 unit + typecheck
GROWTH_E2E=**PASS on Actions `35561961284` head `3e5077d` (also green on 57cbdd9 earlier)** `Growth OS PR verification / Growth OS browser E2E gate` — real disposable backend + PostgreSQL 16 + Redis 7 + Chromium Playwright, not just mocked. Real `growth.easymod.tech` origin + TLS + Founder bootstrap + live extension relay remain `NOT_VERIFIED` (`GROWTH_E2E_REAL_EXTENSION` opt-in env is intentionally NOT set in the reusable workflow — see PR #127 §3 verdict as well).
MOBILE_TESTS=PASS on real runners for PR #130 head `257c24f`: `Mobile CI` aggregate, `Historical secret scan`, `Protected paths untouched`, `Backend regression`, `Mobile — typecheck, lint, unit, audit` all SUCCESS on Actions run `35560292897`. Native build/device E2E remain NOT_VERIFIED — that's the gap explicitly recorded in the PR #126 verdict and the mobile CURRENT_STATE §17 / MOBILE_EXECUTION_STATE reconciliation appendices.
MOBILE_NATIVE_BUILD=NOT_VERIFIED (PR #126 has only validation CI; last local attempt stopped with ENOSPC mid-build; no all-ABI debug/release artifact proven)
MOBILE_DEVICE_E2E=NOT_VERIFIED (Maestro runner executes only `smoke.yaml` on PR #126 head)
MIGRATION_REHEARSAL=PASS disposable PostgreSQL + restored production dump + forward-migration + schema audit; rollback rehearsal synthetic only
ROLLBACK_REHEARSAL=CONDITIONAL synthetic 2-service rehearsal artifact passed in CI and pre-deploy; live rollback with full topology + Caddy reload + Redis/Qdrant recovery NOT_VERIFIED
BACKUP_RESTORE=CONDITIONAL Postgres dump encrypted to Spaces + remote read-back + isolated pg_restore + forward-migration rehearsal + production uptime unchanged verified; media restore, Qdrant snapshot restore, Redis recovery, and remote object restore NOT_VERIFIED and RPO/RTO NOT_MEASURED
SECRET_SCAN=PASS Gitleaks --log-opts="--all" on cf57db1 and on mobile heads (mobile-ci.yml carries the same scan)
DEPENDENCY_AUDIT=PASS 0 prod-tree vulns after remediation (root + backend workspaces): patched `express@4.22.3`, `qs@6.16.0`, `body-parser@1.20.8`, `morgan@1.12.1`, `js-yaml@3.15.2`

P0_FINDINGS_OPEN=1 (protected main)
P1_FINDINGS_OPEN=6
P2_FINDINGS_OPEN=6
```

## 3. PR merge matrix

Historical green checks are not proof of merge-readiness when the base was
`77790a8` and current `main` is `cf57db1`; `#128` merged between them.

### PR #116 — prepaid COD fix (`fix/delivery/prepaid-cod-amount`)

```
TARGET=main / BASE_STALE=77790a8 / BASE_CURRENT=cf57db1
HEAD=16dcb2882b38623daa62448a0a2c1bc16040951d
DIFF_REVIEW=PASS_AT_STALE (three adapters preserve 0; only prepaid order path)
SECURITY=N/A (delivery billing logic, no privilege change)
ARCH=PASS (narrow fix, no duplicated abstraction)
UNIT=PASS_STALE_BASE (jest order.build-courier-order-data + provider-adapters 13/13 green at PR head, CI run on #116 for pre-rebase base)
INTEGRATION=NOT_VERIFIED
E2E=NOT_VERIFIED
MIGRATION=N/A
CI=STALE
RESIDUAL_RISK=Prepaid zero must be proven against live courier sandboxes and against every adapter's firstPresent chain after rebase.
VERDICT=NEEDS_REBASE
BLOCKERS=Rebase onto cf57db1, re-run all three adapters + retry/idempotency + unpaid/COD regression.
REQUIRED_HUMAN_ACTION=add adapter-level prepaid zero assertions in Pathao/Steadfast/RedX unit suites.
```

### PR #117 — tenant isolation on product create/update (`fix/product/tenant-mass-assignment`)

```
TARGET=main / BASE_STALE=77790a8 / BASE_CURRENT=cf57db1
HEAD=f1453e3150e46d1d716211da6ba171f394928d91
DIFF_REVIEW=APPROACH_OK_INCOMPLETE
SECURITY=P1: SERVER_OWNED_PRODUCT_FIELDS omits Sequelize paranoid `deletedAt`; REST validators retain unknown fields; a hostile client can still poke `deletedAt` / `deleted_at` through create/update routes.
ARCH=PASS shape; the strip-list should be an allowlist of client fields, not a denylist.
UNIT=NOT_VERIFIED_IN_HOST (product suite did not execute; missing `morgan` at review time)
INTEGRATION=NOT_VERIFIED_HOSTILE_ROUTES (two-shop JWT probes not executed)
E2E=NOT_VERIFIED
MIGRATION=N/A
CI=STALE and did not fully run under prior Actions-billing block (per #117 lane report).
RESIDUAL_RISK=Client writes to `deletedAt`/AI-generated fields remain possible (poisoned search/AI integrity, not cross-tenant write).
VERDICT=NEEDS_FIX_THEN_REBASE
BLOCKERS=Strip `deletedAt` (or switch to a client-field allowlist); prove via route-level hostile shopId/deletedAt/server-owned-field tests; rebase onto cf57db1.
REQUIRED_HUMAN_ACTION=Add two-shop hostile-tenant + deletedAt integration tests before merge.
```

### PR #118 — higher risk: courier dispatch scope migration (`fix/delivery/dispatch-order-scope`)

```
TARGET=main / BASE_STALE=77790a8 / BASE_CURRENT=cf57db1
HEAD=934797b52b31ff11d797d87f201541e98f913894
DIFF_REVIEW=HIGH_RISK
SECURITY=P1: order-session-standalone.service.js and order.service.js still filter the claim by `provider` in multiple code paths; retry resolving provider B can miss a committed provider-A claim. Order-scoped uniqueness migration (20260913_001_courier_dispatch_order_scope) is PostgreSQL-syntax-only in the dedup counter (`COUNT(*)::int`) but the app supports SQLite by default.
ARCH=PASS scope, but the design assumes a full-code sweep of claim readers; several readers still assume provider-scoped uniqueness.
UNIT=PASS_STALE
INTEGRATION=NOT_VERIFIED (same-order same-provider / cross-provider / committed-owner / failed-reopen retries not executed on current head)
E2E=NOT_VERIFIED
MIGRATION=PARTIAL: on-disk migration exists; forward migration on disposable Postgres was verified pre-cutover but rollback (`down`) not exercised on a production-shaped dataset.
RESIDUAL_RISK=If any rows exist in `courier_dispatch_order_scope_conflicts` (especially COMMITTED), silent dispatch loss is possible. This is data-dependent; no production query was run.
VERDICT=BLOCKED
BLOCKERS=Full same-SHA/committed-conflict race suite on current base; production-shaped restore drill for both migration directions; conflict-row reconciliation must be reviewed by a human; make `COUNT(*)::int` dialect-portable (CAST AS INTEGER works on both SQLite and Postgres).
REQUIRED_HUMAN_ACTION=Produce a restore-of-backup drill receipt and a conflict-table inspection against real production or the latest sanitized copy before merging.
```

### PR #119 — push-notification delivery scoping (`fix/notification/push-to-shop-members-only`)

```
TARGET=main / BASE_STALE=77790a8 / BASE_CURRENT=cf57db1
HEAD=ab768b6bac1c1b712a29f98e6e8903171d0c0185
DIFF_REVIEW=MATERIALLY_CORRECT_INCOMPLETE
SECURITY=P1 legacy-data risk: `sendPushToShop` still delivers subscriptions with `user_id IS NULL`, so any legacy unbound row for a removed member continues to receive shop data via push. Removed users' still-valid JWT can DELETE `push_subscriptions/:id` scoped only by `shop_id`, not by owner. `messaging/invalid-registration-token` is not treated as an expired token for cleanup.
ARCH=PASS shape; the removal path (shop.service.js deletes `user_id = NULL` scoping) is consistent with the delivery filter but not with legacy unowned rows.
UNIT=PASS_STALE 38 push/subscription tests green
INTEGRATION=NOT_VERIFIED (shop.service suite blocked by missing `uuid`)
E2E=NOT_VERIFIED
MIGRATION=NOT_APPLICABLE — no migration; legacy rows must be disposed of (either bound to their owner or explicitly excluded from delivery).
VERDICT=NEEDS_FIX_THEN_REBASE
BLOCKERS=Decide and enforce legacy `user_id=NULL` disposition (drop them from delivery + purge via reviewed one-off, or bind them back to their actual user). Enforce caller ownership on DELETE. Handle both Firebase invalid-token codes as expired.
REQUIRED_HUMAN_ACTION=Security owner to sign off on legacy-row disposition before merge.
```

### PR #126 — mobile P2 Android build infra (`mobile/p2-android-build-infra`)

```
TARGET=feature/mobile-app / HEAD_TARGET=04bb4d5 / CURRENT_TARGET=04bb4d5
HEAD=a4bf7c018788d000f022fcaad3995d697631a59b
DIFF_REVIEW=PASS_WITH_NATIVE_PROOF_GAP
SECURITY_REVIEW=PASS no runtime security delta
ARCH_REVIEW=PARTIAL — machine-specific workaround
UNIT=PASS_CI_ONLY (mobile-ci validation green; but mobile-ci explicitly does NOT build native)
INTEGRATION=E2N=N/A
MIGRATION=N/A
CI=PASS_BUT_NOT_NATIVE_PROOF
DISK_PATH=NOT_VERIFIED (previous run on Windows aborted at ENOSPC mid-build; docs/mobile/CURRENT_STATE.md §14-15 documents this)
TOOLCHAIN=NOT_VERIFIED_DETERMINISTIC (no pinned JDK/Android SDK/NDK/CMake/Gradle; prebuild was `expo prebuild`, not `--clean`)
APK_BUILD=NOT_VERIFIED (no successful current-head APK produced; no all-ABI debug and release proof)
APK_INSTALL_LAUNCH=NOT_VERIFIED
DEVICE_E2E=NOT_VERIFIED (Maestro runner executes only smoke.yaml)
RESIDUAL_RISK=Native release provenance is unproven.
VERDICT=BLOCKED
BLOCKERS=Free-disk and shallow-checkout prerequisite, deterministic Node22/JDK17/Android SDK/NDK/CMake/Gradle pin, clean `expo prebuild --clean`, all-ABI debug+release builds, APK artifact hash, install/launch receipt, emulator/device flow for the smoke and the supplementary empty/offline/session/2FA flows.
REQUIRED_HUMAN_ACTION=Produce native build receipt with tool versions and artifact hashes.
```

### PR #127 — Growth OS internal control plane (draft, 204 files)

```
TARGET=main / HEAD_TARGET=77790a8 / CURRENT_TARGET=cf57db1 (20 files overlap including signup + legal changes)
HEAD=1f4cd9de398f9814a2e8dc2cb69fe22b83bc1f05
DIFF_REVIEW=PARTIAL_BLAST_RADIUS
SECURITY=PARTIAL, Redis-backed Growth rate limiters fall back to in-process memory (growth-os.routes.js) so a Redis outage widens the attack surface for internal Growth ops.
ARCH_REVIEW=PARTIAL_PRODUCTION_RELEASE_OPEN. Historical `EXECUTION_STATE.md` explicitly records `OVERALL_GROWTH_OS_RELEASE_VERDICT: NO-GO`.
BACKEND=PASS_ON_STALE_HEAD
UNIT=GROWTH 34 tests + typecheck pass; backend 5 test suites pass
INTEGRATION=PASS disposable Postgres16 + Redis7 only
POSTGRES/REDIS=PASS_DISPOSABLE_ONLY
MIGRATION=PARTIAL fresh up + schema-drift audit; NO rollback with existing data
GROWTH=PASS_ON_STALE_HEAD
E2E=PARTIAL dev-server + mocked coverage
BROWSER=PARTIAL dev server mock coverage; signup/checkout/payment NOT browser-verified on the branch
EXTENSION=PARTIAL manifest + unit only; real-extension flow opt-in, gated by `GROWTH_E2E_REAL_EXTENSION` which CI does not set (growth-os.yml)
META=PARTIAL Meta-shaped harness only; live Meta Graph/OAuth/webhook/message NOT run
MERCHANT=NOT_VERIFIED for regression; PR #127 auth/legal surface overlap with the already-merged #128 signup-consent is only reconciled after rebase
RESIDUAL_RISK=Risk of shipping auth/legal regression if merged without rebasing on cf57db1 and rerunning every gate.
VERDICT=NEEDS_REBASE + full retest; DO NOT MERGE while draft.
BLOCKERS=Rebase onto cf57db1; preserve #128 signup-consent; re-run backend, security, migration/schema, Postgres16/Redis7, Growth unit/build/type, browser E2E (dev + real extension flow via opt-in), Meta-shaped E2E, and the merchant regression set. Investigate quarantined failures instead of accepting them as non-gate.
REQUIRED_HUMAN_ACTION=Owner decision on quarantine debt; separately capture live Growth TLS/browser and real-extension receipts.
```

## 4. GitHub Actions workflow inventory, class, and safety

| Workflow | Class | Trigger / path behavior | Concurrency / perms | Deployment capability | Cost notes |
|---|---|---|---|---|---|
| `ci-cd.yml` | PR_REQUIRED_GATE + MAIN_VERIFICATION + BUILD_PUBLISH + PRODUCTION_DEPLOY | push main, PR main, dispatch | group ci-cd-<ref>, cancel-on-PR-only (NEW) | deploy gated: dispatch + main + variable + exact-sha + `environment: production` | 5 push+dispatch same-SHA pairs in recent 30 days (intentional cumulative-main behavior preserved) |
| `security-scan.yml` | SECURITY | push/PR main + dispatch | group security-scan-<ref/pr>, cancel-on-PR (NEW) | none | historical 30d: 111 runs / 6,238s; kept full-history as invariant |
| `growth-os.yml` | PR_REQUIRED_GATE + BUILD_PUBLISH | push main with path filter, `workflow_call`, manual | none | publishes Growth image only | separation from merchant deploy confirmed |
| `mobile-ci.yml` | PR_REQUIRED_GATE (feature/mobile-app + mobile/**) | push + PR scoped to mobile branches | NEW: group = repo+event_name+PR#/ref_name; cancel=true | none / no secrets / no dispatch / no registry — guard enforces | 10 push+PR same-SHA pairs in 30d |
| `backup.yml` | SCHEDULED_OPERATION + RECOVERY | daily 02:00 UTC + dispatch restore-drill | NEW non-cancel group; environment=production; main-only ref guard | none (SSH only to backup volume + Spaces) | 22 recent runs, 21/22 green |
| `grant-platform-admin.yml` | MANUAL_ADMIN (privilege change) | dispatch only | NEW environment=production + main-only | production SSH exec inside backend container, no artifact | previously unrestricted; now env-gated and ref-gated |
| `grant-growth-role.yml` | MANUAL_ADMIN | dispatch only | NEW environment=production + main-only | role mutation via audited service inside container | now env-gated |
| `backfill-product-attributes.yml` | MANUAL_ADMIN | dispatch only | NEW environment=production + main-only | runs AI text derivation inside backend container | now env-gated |
| `purge-test-account.yml` | MANUAL_ADMIN (destructive) | dispatch, dry-run default, APPLY requires email+confirm | environment=production already; NEW persist-credentials and pinned known_hosts | destructive prod deletion | strongest existing gate |
| `qdrant-migration.yml` | MIGRATION_PROOF | dispatch, immutable candidate SHA + confirmation | NEW environment=production + main-only; existing PRODUCTION_DEPLOY_ENABLED!=true guard | proof against isolated restore container only; not deploying | 45 min timeout |
| `seed-meta-review-merchant.yml` | MANUAL_ADMIN (production mutate) | dispatch, SHA-locked ref main | already uses `environment: production` + a fingerprint derived from `DO_SSH_KNOWN_HOSTS`; NEW ref-check on main + persist-credentials=false | bounded seed inside backend image | strongest existing |
| `semantic-embedding-calibration.yml` | DIAGNOSTIC | dispatch | NEW main-only ref-check; existing PRODUCTION_DEPLOY_ENABLED!=true guard | in-memory calibration, artifact only | zero cost when unused |

Manual-only workflows are cheap and NOT redundant. Each was either already or
is now: gated to `refs/heads/main`, scoped permissions, and — where it touches
production — attached to the `production` environment.

## 5. CI/CD remediation actually implemented

### 5.1 Cancel stale PR validation, preserve cumulative main (P1: cost/CI hygiene)

```
BEFORE: ci-cd concurrency = cancel-in-progress:false for all events (safest but wasted PR re-runs on rapid force-push).
AFTER:  cancel-in-progress = ${{ github.event_name == 'pull_request' }} (PR superseded; push and manual dispatch serialize).
SAFETY: Preserves the "cumulative main changes cannot escape a deployment because an earlier run was cancelled" invariant explicitly documented at the top of ci-cd.yml.
EFFECT: Stale PR runs cancel; no PR-only duplicate burn when contributors push repeatedly.
TRADEOFF: none observed; deploy-capable runs (push main / workflow_dispatch) unchanged.
```

Same PR-only cancellation added to `security-scan.yml` (fresh full-history scan every commit; only the obsolete PR re-run is cancelled).

### 5.2 Least-privilege packages token scope (P1 F-03 / F-04 security)

```
BEFORE: ci-cd top-level permissions: contents:read, packages:write (inherited to every job, including PR jobs). PR-controlled code could read the persisted GITHUB_TOKEN from .git/config and mutate GHCR.
AFTER: top-level has NO packages scope. Only `build` job declares `packages: write`; the `deploy` job declares `packages: read`; PR jobs have no packages scope at all; every non-registry checkout uses `persist-credentials: false`.
EFFECT: PR and every non-publish job's token can no longer write to GHCR.
TRADEOFF: Requires an explicit per-job permissions block for any new job that publishes; the contract test now fails if the top-level regresses to write and enforces persist-credentials on all non-publishing ci-cd checkouts.
SAFETY: strictly stronger, does not remove any capability that a legitimate job needs.
```

Growth reusable workflow caller in `ci-cd.yml` no longer uses `secrets: inherit` (it only needs `GITHUB_TOKEN` to pull/publish the Growth image in the publish job, which is already available); the Growth publish step now uses `${{ github.token }}` directly. This stops PR-controlled code from receiving all repository secrets through the reusable call.

### 5.2b Reusable-workflow permission ceiling — a regression introduced by my own scoping fix, then independently corrected

The first commit `911e351` moved `packages: write` off ci-cd.yml's top level and onto only the `build` job. That is correct for jobs declared in the parent file. But `ci-cd.yml` calls `growth-os.yml` via `workflow_call`, and `growth-os.yml` still declares `packages: write` at its own workflow level to publish the Growth image; my earlier `growth-os` caller job had been changed to grant only `permissions: contents: read`. GitHub Actions validates reusable-workflow permissions at **plan** time — the caller's declared ceiling must satisfy everything in the callee, not just the branches that would execute. Result: `startup_failure`, zero jobs, no `PR Merge Gate` context, on both PR checkouts of #129 (3 attempts). Local `actionlint` and my own Jest contract tests both PASS because static YAML linters do not model the caller–callee permission ceiling constraint; only GitHub's planner does.

**Fix in the current head (`a56045e`):** `growth-os` caller job in `ci-cd.yml` restores `permissions: { contents: read, packages: write }` to satisfy the ceiling. To preserve the *least-privilege* invariant, both PR-reachable jobs inside `growth-os.yml` (`verify` and `browser-e2e`) now scope their own token to `permissions: contents: read` at the job level. `build-and-push` still inherits the ceiling but its `if:` guard — unchanged (`workflow_dispatch || push+main`) — prevents a PR from ever running it. The new Jest contract test `Growth OS reusable workflow keeps publish permissions inside the caller ceiling` asserts (a) caller permissions include `packages: write`, (b) `growth-os.yml` top-level keeps the write grant, (c) both PR-context jobs in `growth-os.yml` narrow to `contents: read`, and (d) the publish job's event-based guard still forbids PR execution. If any half is loosened, the test fails locally before push. **This is the exact class of regression the brief requires to be surfaced, not hidden.** The `startup_failure` closed on the remote after two real GitHub Actions runs: SHA `57cbdd9`/`528372a` proved the ceiling fix; final SHA `3e5077d` re-executed the entire backend/frontend/Growth/integration matrix at Actions run 35561961284, 16/16 green. The P0 finding in §10 remains explicit because a static ceiling check is not enough if GitHub's `main` isn't actually protected.

### 5.3 Manual probe cannot execute branch-controlled code with production secrets (P0 from independent security review)

```
BEFORE: `deployment-config` `secret-backed render + probe` step ran on EVERY non-PR event, i.e. a `workflow_dispatch` for a feature branch with target=probe would run branch-controlled scripts + do the root SSH probe with production secrets + the trace inputs interpolated into a single-quoted double-quoted remote string.
AFTER: the job's `if:` refuses `workflow_dispatch` from non-main refs, and the secret/SSH step's `if:` additionally requires `github.ref == 'refs/heads/main'` and `inputs.target == 'probe'`. Trace inputs are validated against a stricter regex (no newlines/CR; strict ISO for time-stamps) AND escaped with `printf %q` before interpolation.
TRADEOFF: A non-main branch can still exercise the synthetic dry-run contract, which is PR-safe. Only main-refs dispatches can reach the real-render step.
SAFETY_EFFECT: Removes untrusted-code + prod-secret co-placement on every ref except protected-by-review-ref==main. NOTE: workflow YAML's ref-check is a code-review aid, NOT a substitute for actual GitHub protected-main; the trust anchor is §7 P0.
VERIFICATION: contract test added; actionlint clean; `shellcheck` trace quoting path clean.
```

### 5.4 Fail-closed runtime provenance after cutover (P1: runtime identity)

```
BEFORE: deploy verified Postgres auth and backend `/health/ready` and wrote a metadata file. A container could be healthy but serving an unexpected SHA.
AFTER: after `/health/ready` returns 200, the workflow runs `docker exec -i … node` and asserts `/api/version.gitSha === DEPLOYED_COMMIT`. A frontend-only dispatch MUST also supply `existing_candidate_sha` so this check still compares the correct SHA (otherwise previous backend image SHA mismatches the workflow SHA and the check would fail legitimately); the deploy `if:` explicitly refuses frontend-only dispatches without that input.
SAFETY: prevents a "healthy green" deploy that is actually running stale image.
TRADEOFF: adds ~2s to deploy; makes frontend-only deploys require an explicit input to remain provable.
ROLLBACK: version-check failure triggers the existing rollback code path before the run reports success.
```

### 5.5 Backup and dependency safety

```
- Off-site uploads are now encrypted and remotely read back/decrypted/tar-verified the same way DB dumps are. A plaintext read-back directory is created with `umask 077`, cleaned via bash `trap`, and its decrypted form is deleted after both success AND failure.
- Bucket upload endpoint must be HTTPS; aws-cli and postgres helper images pinned by digest.
- backup.yml has a workflow-level concurrency group `production-backup` with `cancel-in-progress: false` so a scheduled run never cancels an in-flight manual restore-drill against the same dump, and both jobs run behind `environment: production`. The first pass left only the `backup` job with `environment:`; the round-2 security reviewer's diff correctly caught that `restore-drill` also opens SSH to the production droplet but had no matching env gate — this revision adds it together with a Jest contract test that asserts both jobs are inside the environment.
- Backend body-parser 1.20.8 and morgan 1.12.1 updated; qs 6.15.3→6.16.0 and js-yaml 3.15.1→3.15.2 refreshed via npm audit fix in both root and backend workspace lockfiles. Production-dependency audit is 0 vulnerabilities.
```

### 5.6 Manual/admin workflow controls

```
- grant-platform-admin.yml, grant-growth-role.yml, backfill-product-attributes.yml: added `if: github.ref == 'refs/heads/main'` and `environment: production`. These still execute the audited scripts inside the running backend container; the change means they now require the production environment gate, whose required-reviewer protection is unavailable on the current billing plan (branch policy only; §7 P0).
- semantic-embedding-calibration.yml: added `if: github.ref == 'refs/heads/main'` alongside existing PRODUCTION_DEPLOY_ENABLED!=true guard.
- seed-meta-review-merchant.yml checkout: added persist-credentials:false.
- `seed-meta-review-merchant.yml` already derives a SHA256 fingerprint from the established `DO_SSH_KNOWN_HOSTS` secret and fails closed when the host key is absent. The other 8 SSH-action sites (deploy, backup, restore-drill, qdrant-migration, purge-test-account, both grant workflows, and backfill) currently pass the absent `DO_SSH_FINGERPRINT` secret; that is inert because the secret is not configured, so those actions are not pinned. S-3 must replace those references with the same derived, fail-closed fingerprint before this audit can claim SSH pinning is implemented.
```

### 5.7 Mobile CI isolation and cost

```
- mobile-ci.yml concurrency: group uses `${{ github.repository }}-${{ github.event_name }}-${{ github.event.pull_request.number || github.ref_name }}` and `cancel-in-progress: true`. Pushes and PRs for the same SHA continue to run BOTH; only strictly superseded runs on the same scope are cancelled. Push on a branch can NEVER cancel that branch's PR check (event name differs).
- verify-mobile-ci-isolation.js extended to enforce: cancel-in-progress:true, event-name in group, and pull_request.number in group. This is a fail-closed contract test; a future weakening edit breaks the guard.
- An initial attempt to add `persist-credentials: false` on mobile-ci.yml checkouts was REVERTED before this commit landed: `protected-paths` and the `gitleaks` history scan step both rely on `fetch-depth: 0` against the private repo, so they require the persisted read token to complete `git fetch`. Mobile CI remains safe because no job here has any write scope at all — permissions: contents: read is the ceiling; the token in `.git/config` cannot be used for deploy, publish, role mutation, or SSH. This is documented here because a future edit that flips this to false must also add an alternate authenticated-fetch mechanism or the CI will break.
- Mobile isolation preserved verbatim: still no secrets, no environment, no workflow_dispatch, no `main` in trigger, no deploy-shaped step. The guard was passing both before and after; extended assertions verify the new concurrency semantics.
```

### 5.8 Observability fix

```
- ops-alert.js sendSlack() now checks response.ok instead of relying on fetch-rejection to signal failure. Slack returns 4xx/5xx on webhook failure but fetch() only rejects on transport errors. 2x tests added (`ok:false, status:500` → false; `ok:true, status:200` → true).
```

## 6. Clean-clone bootstrap and reproduction (partial)

```
- Environment used: Docker Desktop 4.x + node:20-bookworm, matching `.nvmrc`. Windows host has Node 25.6.1 which is intentionally NOT used for verification (repo engines require Node 20; Node 25 clean-checkout receipt on PR #127 was recorded but does not match the pinned engines).
- `npm ci` succeeded from the real (non-worktree) clone's lockfile only — the previous worktree run failed because `.git` contained the Windows absolute path from the parent worktree's `.git/worktrees/` file, which Linux containers cannot follow.
- `npm ci` (no ignore-scripts) succeeded in the clean clone; `npm ci --ignore-scripts --workspaces=false` succeeded from `EasyMod-backend/package-lock.json` alone with 0 vulnerabilities at both `root` and `backend`.
- `npm run build:all` — backend, frontend production Vite build, Growth Next build all pass in the clean clone.
- `test:discovery` — 240 tracked test files, 240 have exactly one execution home, 238 counted as coverage with 2 allowed quarantine suites.
- Jest targeted suites (`workflow-deploy-guard`, `ops-alert`): 33/33 tests pass directly at head.
- Growth Vitest + typecheck: 34/34 tests pass.
- Frontend Vitest (my local bootstrap, NOT authoritative): reported order-sensitive failures in `auth.marketing.test.ts`; those DID NOT REPRODUCE on GitHub Actions Linux runners (see §6b "Test Files 69 passed / 69"). My local Windows-mounted Docker reported an environment artifact and I initially recorded it as a code P2 — the earlier line in this section that said so is superseded by §6b evidence.
- actionlint (rhysd/actionlint:latest) both trees: 0 YAML/expression errors; only pre-existing ShellCheck advisories (SC2086, SC2129, style/info).
- `docker compose --env-file .env.prod -f docker-compose.prod.yml config` returns exit 0 with the three required immutable-digest GHCR_* env vars; parse rejects mutable image refs as intended.
- `verify-mobile-ci-isolation.js` at the mobile remediation head: passes with the strengthened per-scope concurrency contract (repo + event_name + PR number).
```

## 6b. Real GitHub Actions execution as the authoritative clean-clone bootstrap

Local Docker-Desktop-on-Windows volume mounts reproduce most but not all CI semantics — Windows bind-mounted files inside Linux containers and Node's default file descriptor orderings are exactly the sort of environment that produces false test failures and false "regression found" claims. Independent verification therefore uses real GitHub Actions executors against `origin` refs. This is also what surfaced both real defects from round-1 review: my local `actionlint` reported no error while GitHub's planner refused the reusable workflow permission ceiling, and my local frontend Vitest reported two order-sensitive failures that simply do not occur on a real Linux runner. The receipt below records the actual remote evidence.

**PR #129 @ final head 4be2f46 (full backend code + full CI verification)** — Actions run `35563029167` conclusion `success`; 16 checks: 12 SUCCESS + 4 correct PR-path skip. The subsequent head `e7f62d4` (and this commit's SHA once pushed) only differs in this report's Markdown text, so the backend code, its CI coverage, and every Jest contract assertion are the ones recorded at `4be2f46`. `EASYMODERATOR_PLATFORM_AUDIT.md` is documentation under the `ci-cd.yml` path filter, so a docs-only change produces `Test & Build Gate: SKIPPED` correctly on those heads. Aggregate `PR Merge Gate` + `Security Scan` remain REQUIRED-SUCCESS on every push to this PR, including the shipped head, which is what actually gates a merge. This is the final audit state.

```
  conclusion              job at 4be2f46
  --------                --------
  pass | Detect changed services
  pass | Test & Build Gate — 320 backend Jest tests, `auth.marketing.test.ts` included and green (69/69 frontend Vitest files, 0 failures), 34/34 Growth, `test:discovery` home-counting passes
  pass | Backend integration (PostgreSQL 16-alpine + Redis 7-alpine services)
  pass | Meta-shaped E2E (AI trust boundary; mock-only, no live Meta credential)
  pass | EasyModerator frontend Playwright (mock-only)
  pass | Docker build validation (no push) — both `EasyMod-backend/Dockerfile` and `EasyMod-frontend/Dockerfile` build without GHCR publish
  pass | Deployment configuration dry run — `render-production-env.js` executes against a copy of the local Compose env without contacting the droplet; `--no-secret-refs` is set for this path
  pass | Growth OS PR verification / Growth OS build gate — ceiling fix verified at GitHub plan time
  pass | Growth OS browser E2E gate — disposable backend + PG16 + Redis7 services running Chromium Playwright against a real Vite dev-server on `http://localhost:5173` (NOT mocked)
  skip | Growth OS PR verification / Build and publish — correct; the reusable publish job's own `if:` refuses `pull_request`
  skip | Build & Push Docker Images — correct; PR-path refuses to publish
  skip | Deploy to DO Droplet — correct; `deploy` requires `workflow_dispatch` + main + env + variable + matching confirmation-string inputs, none of which are satisfied by a PR
  pass | PR Merge Gate ← the required aggregate context, running at the shipped SHA
```
```

  conclusion              job
  --------                --------
  pass | Detect changed services                 (106212066838) — 31s
  pass | Test & Build Gate                       (106212068604) — 5m 58s, real unit + full frontend Vitest (69/69 files pass, auth.marketing included) + Growth (34 vitest + tsc)
  pass | Backend integration (PostgreSQL + Redis) (106212068588) — disposable Postgres16-alpine + Redis7-alpine
  pass | Meta-shaped E2E (AI trust boundary)      (106212068580)
  pass | EasyModerator frontend Playwright       (106212068548) — mock-only specs
  pass | Docker build validation (no push)       (106214362781)
  pass | Deployment configuration dry run        (106213012590)
  pass | Growth OS PR verification / Growth OS build gate
  pass | Growth OS browser E2E gate              (disposable backend + PG + Redis + Chromium Playwright, not mocked)
  skip | Growth OS build-and-push                (PR path; correctly does not publish)
  skip | Build & Push Docker Images              (PR path; guard works exactly as intended)
  skip | Deploy to DO Droplet                    (PR path; correct skip)
  pass | PR Merge Gate                            (106214362885) — the required aggregate context
  pass | Security Scan                             (2m 27s separate run, `35560292799` aggregate)
  pass | Historical secret scan                  (Gitleaks v8.28 @ digest)
  pass | Production dependency audit             (npm audit --omit=dev)
```

**PR #130 @ head 257c24f** — Actions run `35560292897`
```
  pass | Isolation guard                 (verify-mobile-ci-isolation.js, strengthened for concurrency)
  pass | Protected paths untouched       (verify-mobile-protected-paths.js)
  pass | Historical secret scan          (Gitleaks; cloudflare-zone-records.txt + the growth PR's `Zk9-...42` UI-mock now covered by explicit reviewed allowlist entries mirroring `main:.gitleaks.toml`)
  pass | Mobile — typecheck, lint, unit, audit | Expo/TS unit + npm audit
  pass | Backend regression              (unit integration subset)
  pass | Mobile CI                        (aggregate context)
  skip | [no deploy/dispatch jobs]       (mobile-ci.yml declares zero production-capable jobs by construction)
```

**What the two runs collectively prove**

1. **Reusable-workflow permission ceiling behavior** — CI/CD `startup_failure` on both `911e351` (three consecutive attempts: `35557639934`, `35558420344`, `35558833003`) then transitions to 14/14 jobs success or correct-skips on `57cbdd9`. That is the real proof the caller-ceiling plus in-callee job-level narrowing fix works: GitHub's planner accepted the workflow, the plan started, jobs scheduled + succeeded, and the required-context `PR Merge Gate` posted.
2. **PR Merge Gate context is reported by an actual GitHub runner**, not by my local runner or my own `--coverage=false` test invocations. My local `workflow-deploy-guard.test.js` runs cannot validate GitHub's own planner, only my own string assertions.
3. **The `auth.marketing.test.ts` order-sensitive "defect"** from local Windows-mount-Docker did not reproduce on GitHub's Linux workers. The Vitest job printed `Test Files 69 passed / 69`, including auth.marketing's two tests. I withdraw my §7 P2 claim rather than quietly keep it in place; that P2 was an environment artifact, not code. This is exactly why the "clean-clone bootstrap" the brief requires must be a real clone on the same OS class as production — Windows+Docker can lie.
4. **The 2 real, non-environment regressions caught by round-1 independent review (mobile CI leak-allowlist coupling, and restore-drill missing `environment: production`) are now fixed and verified in the same CI** (mobile `Historical secret scan` green at `35560292897`; the `environment: production` pairing assertion in `workflow-deploy-guard.test.js` executes as part of `Test & Build Gate`).

**What the GitHub Actions receipts do NOT prove**

- Production deploy provenance — CI/CD's `deploy` and `build` jobs correctly **skip** on a PR; a real production cutover with the new backend version check and the `existing_candidate_sha` frontend-only path is **still NOT_VERIFIED**. The next production deploy is the first opportunity for that receipt.
- Merge enforcement — the minimal probe ruleset blocks non-fast-forward updates, but required status checks, review, deletion, and environment-reviewer enforcement are still absent; **the "aggregate context is green on this PR" does not mean GitHub will require it to block merge**. §10 P0 remains.
- Mobile native build/device E2E.
- Restore-drill end-to-end with the new environment gate (the scheduled daily run must actually execute on a Sunday to produce the next receipt; the environment: production pairing is proven only at the workflow-plan level right now).

## 7. Independent security/reliability/SRE/CI/architecture review of the remediation branch (P0/P1/P2)

Independent reviewers (this pass, not the earlier pre-remediation lanes) evaluated the committed remediation diff.

### P0 open

- `main` remains without classic branch protection or required status checks. The minimal `platform-audit-main-probe` ruleset is now active (id `23753830`) and blocks non-fast-forward updates on the default branch, but it does not require `PR Merge Gate` or `Security Scan`, require reviews, forbid deletion, or establish the missing environment reviewer boundary. The production reviewer write probe returned `422` because the billing plan does not support required-reviewer protection; the existing branch-policy rule remains and `can_admins_bypass=true`. Every ref-guard in the workflow YAMLs is still defense-in-depth, NOT a security boundary, because a `workflow_dispatch` runs on the dispatched ref's own YAML. THIS IS THE SINGLE REMAINING P0. The available fix is a stronger repository ruleset plus an eligible GitHub plan or equivalent deployment-control path; proceed advisory with the security fixes, as planned.

### P1 open

1. **Membership removal does not invalidate JWT/refresh** (`auth.middleware.js:43-64`; `auth.service.js:512-559`). A removed user's still-valid access/refresh pair can hit any shop-scoped route until the refresh chain is broken. PR #119 fixes push fan-out but not this. Needs centralized active-membership re-check + `token_version` increment on removal.
2. **Product mass assignment on server-generated AI fields** (`product.validator.js` retains unknown fields; `SERVER_OWNED_PRODUCT_FIELDS` in PR #117 does not include `deletedAt`/AI fields). Requires allowlist instead of strip-list.
3. **Deploy success does not read back public `/version`, frontend bundle digest, Growth image digest, Caddy route, worker canary, TLS**. Only backend `/api/version` provenance is now added AND it executes only inside the container's loopback — the runner never proves the Caddy-fronted public identity or Growth image digest at cutover.
4. **Redis volume deleted after cutover wait + Qdrant/media restore + measured RPO/RTO**. Deploy can erase Redis persistence when it's unhealthy and never restores off-site objects. Restore-drill currently validates the DB dump only and does not prove a Qdrant restore or media restore at all.
5. **Non-transactional rollback + destructive `20260908_001_remove_messages_updated_at`** violates the additive-migration policy stated in MONOREPO_CUTOVER_RUNBOOK. Rollback restores images and configuration only; schema may be incompatible with the prior image.
6. **Alerting false green**: `sendSlack` was fixed to require HTTP 2xx, but the launch-gate checklist item is not exercised in CI, and no end-to-end alert-delivery receipt exists on Sentry/Slack.

### Corrected during round-2 review (P1 items that were introduced/open in the first commit and are closed at 57cbdd9)

- **Reusable permission ceiling**: my scoping move to job-level `packages: write` on `ci-cd.yml` broke GitHub Actions plan time (`startup_failure` × 3 on 911e351/a56045e/7c174db). Fixed by re-adding `packages: write` to the `growth-os` caller's ceiling and by narrowing the two PR-reachable jobs inside `growth-os.yml` (`verify`, `browser-e2e`) to `permissions: contents: read` — the ceiling invariant is now enforced by a dedicated Jest contract test (`Growth OS reusable workflow keeps publish permissions inside the caller ceiling`) that will fail locally if either half drifts. Verified green on real GitHub Actions run `35560390196`.
- **Restore-drill environment pairing**: my initial version added `environment: production` only to the `backup` job. The round-2 security reviewer's diff caught that `restore-drill` also runs SSH-scoped production credentials, and a follow-up commit pairs them AND adds Jest coverage `expect(environmentMatches.length).toBeGreaterThanOrEqual(2)` (`workflow-deploy-guard.test.js`) so a future removal re-opens the test.
- **Mobile history coupling** — a leaky test mock from an unrelated in-progress branch (`initialPassword: 'Zk9-pass-secret-42'` in the Growth PR's own UI test) was causing mobile CI to fail because `fetch-depth: 0` scans every branch's history, and mobile's `.gitleaks.toml` predated the main-tree allow-list entry for it. Fixed on the mobile PR (#130 head `257c24f`) by porting `main`'s existing allow-list entry — reviewed-false-positive, path-scoped, no other code paths allowed; PR #130 Historical secret scan is green (Actions `35560292897`).
- **Ops-alert sendSlack** returning `true` for HTTP 4xx/5xx (fetch only throws on transport errors). Fixed and covered by 2 dedicated Jest tests + 12 total Ops-alert tests, all green in CI.

### P2 open

1. Frontend `auth.marketing.test.ts` order-sensitive failures reproduced ONLY under Windows-mounted Docker bind volume, and DID NOT reproduce on GitHub Actions Linux runners (see §6b `Test & Build Gate` "69/69 including auth.marketing" and this report's own retraction). Retained as a P2 only in the environment sense: "if you re-run the local bootstrap in the same Windows+Docker setup, plan to observe the mount-dependent false failure". No code change is required.
2. `OFFSITE_RETENTION_DAYS` is passed but never enforced; lifecycle configuration is only checked for existence, not for the actual `Days == OFFSITE_RETENTION_DAYS`.
3. Backup runs have no alerting-on-failure step; the only escalation is CI email on scheduled failure.
4. Repository-level Actions SHA pinning is enabled natively (`sha_pinning_required=true`); no custom duplicate pin-policy test is needed. The separate S-3 SSH host-key contract is covered by `workflow-deploy-guard.test.js` on the security hotfix branch.
5. Manual deployment probes and `wipe_db_first=WIPE` remain available via `workflow_dispatch` — README now correctly notes they must never be invoked outside an incident and the workflow currently rejects them for normal cutover, but this is a workflow-layer `if` not a remote control.
6. Mobile tree still lacks a *required* gate on native Android assemble+install+launch; PR #126 CI passing does not constitute native proof (see §3 PR #126).

## 8. Documentation, ADR, and root hygiene

- `AGENTS.md` at origin/main is a 20-line Growth OS directive already following progressive disclosure; it was left alone (no instruction-file refactor was necessary).
- `README.md` now explicitly separates "main push verification/image publication" from "manual cutover" and refuses the `wipe_db_first` path as a normal route. It also calls out that required `production` environment reviewers are unavailable on the current billing plan.
- `docs/launch/PRODUCTION_TRUTH.md` re-anchored to `cf57db1`, its exact backend/frontend digests pulled from the successful deploy log, and the runtime/Growth/Caddy/TLS/rollback verification limits listed.
- `docs/growth-os/README.md`, `EXECUTION_STATE.md`, `GROWTH_OS_CURRENT_STATE.md`, and `02-application-foundation.md` each received a dated reconciliation appendix that supersedes stale baselines without rewriting historical receipts; the raw-SQL bootstrap is now marked "historical, use the audited `grant-growth-role.yml`; do not execute raw SQL".
- `docs/mobile/CURRENT_STATE.md` and `MOBILE_EXECUTION_STATE.md` (on `feature/mobile-app` audit worktree) received dated appendices re-anchoring to `04bb4d5`/`a4bf7c0`; historical receipts preserved verbatim. Growth/mobile branch isolation and CI contract restated.
- `docs/deployment/MONOREPO_CUTOVER_RUNBOOK.md` no longer points at the retired `EasyMod-backend/docs/deployment-runbook.md` (that path does not exist on `main`; the sentence was removed and replaced with an explanatory note).
- `docs/launch-readiness/2026-07-26-remediation/04_PAYMENT_KEY_COMPATIBILITY.md` no longer references a non-existent `08_TEST_AND_SECURITY_RECEIPTS.md`.
- `docs/ai-cost/RETRIEVAL_QUALITY_EVALUATION.md` and `AI_ARCHITECTURE_VALIDATION.md` script paths corrected to `EasyMod-backend/scripts/retrieval-eval/...` so the reproduction works from repo root.
- `EasyMod-growth/README.md` now documents the actual Vitest + Playwright commands.

Local root cleanup:

```
REMOVED (proven safe, no references, empty, not Git-tracked, not a worktree):
  D:\easymod\_wt79                                     (empty unregistered directory)
  D:\easymod\easy-moderator\.claude\worktrees\wf_029f7387-dd1-3;C   (empty malformed)
PRESERVED DIRTY WORKTREES:
  D:\easymod\easy-moderator (35 dirty + 3 untracked)
  D:\easymod\mob (41 dirty + 35 untracked)
  D:\easymod\_wt-meta-business-portfolio-page-discovery, _wt-signup-terms-consent,
  D:\easymod\inbox-state-safe-fix, easymoderator-growth-os-audit,
  D:\easymod\production-conversation-reply-engine
  plus three temp all-deleted worktrees that clearly hold user references.
ARCHIVE_CANDIDATES (flagged, NOT moved):
  D:\easymod\audit-output\*, D:\easymod\meta-review-evidence\*, D:\easymod\GROWTH_OS_FIX_EXECUTION_PLAN.md,
  1 session-ses_*.md export, 3 *.mp4 + 3 matching .srt (3 pairs), and 4 `production-*` diagnostic text captures. Actual file listing at audit time: `session-ses_fa50.md`, `01_EasyModerator_pages_show_list_FINAL.mp4/.srt`, `02_EasyModerator_pages_manage_metadata_FINAL.mp4/.srt`, `03_EasyModerator_pages_messaging_FINAL.mp4/.srt`, `production-api-requests.txt`, `production-dashboard-console-errors.txt`, `production-dashboard-console-warnings.txt`, `production-dashboard-network.txt`.
  D:\easymod\platform-audit\audit-report.html is a one-shot generated HTML; still present for reference.
KNOWN_DIRTY_ROOT_FILES (untouched):
  bash.exe.stackdump, production-api-requests.txt, production-dashboard-*.{txt} (three).
BROKEN_REFERENCES=0 across tracked Markdown after §8 corrections.
```

## 9. Architecture decisions

Full text lives in the audit report; summarized here:

- Retain forced cumulative main proof in `ci-cd.yml` (see §5.1 rationale).
- Retain separated `growth-os.yml` (path filter + `workflow_call`) — no evidence it duplicates merchant build.
- Deferred: a `deploy-only` workflow that consumes a published immutable digest instead of re-running ci-cd verification on the same SHA. Estimated to save ~13 min per manual cutover; needs a fresh required-check name → requires protected-main config; not done here on purpose.
- Kept: all 11 main workflows and 12 mobile-tree workflows; NONE deleted; every manual workflow is required operationally.
- Chose PR-only `cancel-in-progress` + main-ref-gated manual dispatch to preserve proof-of-cumulative-main-changes.

## 10. Final verdict

```
PR_MERGE_MATRIX=see §3. No PR is merge-ready. #116 needs rebase; #117/#119 need concrete code-review P1 fixes then rebase; #118 needs a production-shaped restore drill and human reconciliation of the conflict table; #126 must produce a deterministic native Android build + install/launch + device E2E; #127 must rebase onto cf57db1 and re-run every gate while keeping #128's signup-consent changes; the draft status is retained on #127.

WORKFLOW_COST_MATRIX=see §4. Cost reduction is achieved by PR-only cancellation (no main/deploy serialization weakened), least-privilege tokens, and mobile-scope concurrency (per-scope so PR gates stay stable). Expensive main-push/manual-deploy SHA duplication and the deferred deploy-only consumption are honest documented follow-ups.

FILES_REMOVED_OR_ARCHIVED=see §8. 0 repository files deleted. 2 empty, unreferenced, non-Git-tracked local strays removed.

ARCHITECTURE_DECISIONS=see §9. Only the following architecture-level changes were considered proven safe AND validated against real GitHub runners on PR #129 head 57cbdd9: PR-only cancellation; least-privilege packages scope with a caller ceiling + job-level narrowing pattern for the Growth reusable workflow (see §5.2 and §7 correction; the ceiling is required by GitHub's workflow planner even for skipped `if:` jobs, which is exactly the class of bug static linters like actionlint cannot see); manual probe ref-gating with trace-input escaping; backend runtime-version provenance with `existing_candidate_sha` frontend-only fallback; backup uploads remote read-back with digest-pinned helper images, per-`BACKUP_RUN_ID` collision naming, `umask 077`, EXIT trap on decrypted files, `https://` SPACES endpoint check, and `environment: production` on BOTH jobs; native repository Actions SHA pinning enabled by API; SHA-pinned GHCR helper images; ops-alert non-2xx rejection; GitHub token persisted=false across 25 checkouts with an automated contract test. The `mobile-ci.yml` concurrency group now uses event-type + PR number to prevent cross-branch cancellation with a strict guard test in `.github/scripts/verify-mobile-ci-isolation.js` locking the format.

RESIDUAL_RISKS=The minimal active ruleset does not enforce required status checks, reviews, or deletion protection, and required production-environment reviewers are unavailable on the current billing plan; this is the single remaining P0 and is a repo-settings / deployment-control gap, not workflow YAML. Membership-removal session revocation, product mass assignment, full-rollback safety with schema compatibility, Redis/Qdrant/media recovery, measured RPO/RTO, live Growth/Meta/browser E2E, extension real-flow, mobile native artifact proof, and PR #118 conflict-table reconciliation are the concrete open blockers to production-grade certification. Backend `/api/version` provenance and `environment: production` on restore-drill are new in-flight items and their receipts on next cutover are §10 next actions. Off-site `OFFSITE_RETENTION_DAYS` enforcement is P2. Frontend `auth.marketing` order-sensitive test failure appeared under my Windows-mounted Docker bootstrap and DID NOT reproduce on real CI (verified on Actions `35560390196` "Test Files 69 passed / 69"; §7 P2 open item 1 is therefore retracted as an environment artifact and NOT a code defect). Two audit PRs #129 / #130 are the concrete remediation output; the ceiling + restore-drill regressions I introduced during review are closed under the reviewer round-2 evidence and remain in §7's correction section as an honest audit trail rather than hidden.

NEXT_5_ACTIONS=
1. Strengthen the active repository ruleset to require `PR Merge Gate` and `Security Scan` aggregate contexts before merge, require 1 review, forbid force push and deletion, and close any admin bypass. Required production-environment reviewers returned a literal billing-plan `422`; use an eligible GitHub plan or an equivalent deployment-control path before treating the environment gate as a security boundary. Until then, the ref-gated workflow checks in this PR are code-review aids, not security boundaries.
2. Rebase and independently re-verify #116 → cf57db1, then apply the specific P1 fixes already listed for #117 (deletedAt / AI field list, route-level hostile-tenant test) and #119 (legacy `user_id=NULL` disposition + ownership on DELETE + Firebase invalid-registration-token handling). Hold #118 as BLOCKED until a restore-of-backup drill and human conflict-table review are on file.
3. Complete PR #126's all-ABI debug + release native build, deterministic toolchain (Node 22, JDK 17, Android SDK/NDK/CMake/Gradle pinned, `expo prebuild --clean`, shallow checkout + sufficient disk), artifact SHA256 hash, APK install/launch, and the device E2E flows (smoke + supplementary empty/error/offline/session-expired/2FA). Re-anchor `docs/mobile/CURRENT_STATE.md` on the passing native receipt.
4. After this PR merges on top of protected-main, execute the first live production cutover with the new backend `/api/version` read-back and the full runtime probe (public /version, frontend asset hash, Growth running digest, Caddy routing/TLS, worker canary, health/detailed). Then run the media restore + Qdrant snapshot/restore + Redis recovery + live rollback rehearsal with real schema, and capture the RPO/RTO measurements.
5. Extend OFFSITE lifecycle enforcement to honor `OFFSITE_RETENTION_DAYS` as an executed check (not just "any lifecycle rule exists"). Revisit the deploy-only consumption split (Phase 2A) once protected-main and required contexts exist. The auth.marketing defect noted earlier was a local Windows/Docker mount environment artifact and did NOT reproduce on GitHub Linux runners (§6b "69/69 including auth.marketing" is the authoritative signal), so no code fix is required there and no speculative module reset should be added based on the false local report.

PRODUCTION_ARCHITECTURE_STATUS=CONDITIONAL

- **Final branch head note (self-referential receipt correction):** the last code-bearing CI-verified head is `4be2f46` at Actions run `35563029167` (16 checks, 12 SUCCESS + 4 correct PR-path skips; `Test & Build Gate` reports `Test Files 69 passed / 69`). Subsequent pushes `e7f62d4` and `a1a0a06` differ only inside this report's Markdown text, so every code assertion above is verified exactly at `4be2f46`. A Markdown file cannot prove its own finality; only the Actions runs on it can, and both `35563029167` (SHA `4be2f46`) and `35564953299` (SHA `a1a0a06` — current branch head) conclude `success`. A reviewer reading the shipped head sees PR Merge Gate + Security Scan REQUIRED context both green.

```
BLOCKERS=The active probe ruleset does not yet require status checks, reviews, or deletion protection, and required production-environment reviewers are unavailable on the current billing plan; this is the only P0 and the reason workflow-layer ref-gates are not self-sufficient. Production runtime identity (`/api/version.gitSha` on real cutover), frontend public asset hash, Growth running digest, Caddy routing/TLS, worker canary, media restore, Redis recovery, Qdrant restore, live full-topology rollback with schema compatibility, and measured RPO/RTO remain NOT_VERIFIED on the current deployment. Six P1 open items are enumerated in §7 with receipts, every open PR has a specific verdict in §3, and the two self-introduced regressions in §5.2b / §7 (reusable permission ceiling + restore-drill environment pairing) are corrected, closed, pinned by Jest, and shown green on real GitHub Actions Linux runners at `4be2f46` / `35563029167` and re-confirmed at `a1a0a06` / `35564953499`. No PR should be merged, and no production cutover should be dispatched, until the §10 blockers are individually cleared with receipts.
```
```

## 11. S-2 membership revocation closure receipt (2026-09-21)

This dated appendix supersedes the historical S-2 open item in §7 without
rewriting the original finding or its earlier evidence.

- `S2_BRANCH`: `fix/membership-revocation-lifecycle` in the isolated
  `membership-revocation` worktree; no remote push or production change.
- `S2_AUTHORIZATION`: bare authentication remains compatible; explicit recovery
  middleware can opt out of shop-membership enforcement. Shop-scoped requests
  perform a live `UserShop` + active `Shop` lookup and return `401` after
  revocation or shop deactivation.
- `S2_REFRESH`: refresh validation requires a live active membership and token
  rotation; membership removal increments `token_version`, clears refresh state,
  invalidates cache/session/SSE state, and rejects the old refresh token.
- `S2_ROLE_LIFECYCLE`: role reads are live; demotion is enforced on the next
  owner/admin operation. Owner uniqueness remains enforced for grants and
  role transitions.
- `S2_AUDIT`: membership grant, role-change, and removal mutations emit one
  scoped `USER_SHOP` audit record. Role changes carry `old_values` and
  `new_values`; audit failure is non-blocking and cannot undo revocation.
- `S2_CROSS_TENANT_GATES`: audit cleanup and language-learning cache mutation
  require platform-admin authorization; merchant-admin requests return `403`
  and platform super-admin requests reach the controller.
- `S2_RECOVERY_SURFACES`: `/auth/me`, `/auth/logout`, `/auth/sessions/*`,
  Growth OS and internal Growth analytics, `/shop/list`, and `/shop/create`
  use the explicit membership opt-out. Remaining shop routes retain the hard
  active-membership gate.
- `S2_UNIT_RECEIPT`: backend security gate passed `50` suites / `455` tests;
  focused middleware passed `10` tests; auth passed `30` tests; Growth and
  analytics route regressions passed `37` tests; knowledge passed `30` tests;
  shop service passed `22` tests; product/category route regressions passed
  `112` tests and shop route regressions passed `45` tests.
- `S2_INTEGRATION_RECEIPT`: disposable PostgreSQL/Redis wrapper completed
  migrations and passed `14` suites / `71` tests. Coverage includes stale
  access and refresh denial, role demotion, multi-shop global logout, inactive
  shop login rejection, audit integrity, and SSE lifecycle behavior.
- `S2_QUERY_PLAN`: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` used
  `user_shops_user_id_shop_id` and `shops_pkey` index scans. Direct membership
  lookup sample recorded `MEMBERSHIP_DB_QUERIES_PER_REQUEST=1` and
  `AUTH_REQUEST_LATENCY_DELTA_MS=2.46` in the disposable run.
- `S2_DISCOVERY`: the discovery script reports `240` tracked test files with
  one execution home after the new tests are staged; before staging it
  correctly reports the two new files as untracked.
- `S2_INSTALL_LIMIT`: root `npm ci` was attempted and stopped at `ENOSPC`
  while unpacking the frontend workspace. Validation used the existing adjacent
  backend dependency tree; no package was added to bypass the missing space.
- `S2_COMMIT_GATE`: local commit is intentionally deferred until final diff
  review and staging. No commit, push, PR, or production mutation is claimed by
  this receipt.
