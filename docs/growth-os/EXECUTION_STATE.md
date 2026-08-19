# Growth OS Execution State

Updated: 2026-08-20

## Current execution

- `CURRENT_MAIN`: `d1e7eacc062401882ac9a1a8a48e916f24833f1b`
- `BRANCH`: `codex/growth-os-phase-1-telemetry-foundation`
- `PHASE`: Phase 1 — Repair current growth data foundations
- `STATUS`: COMPLETE for the bounded source and fixture acceptance gate
- `RELEASE_STATUS`: NO-GO for production or Growth enablement until the Phase 2 access/runtime gate passes
- `PRODUCTION_CHANGED`: NO

The canonical `GROWTH_OS_GOAL.md` and `CURRENT_STATE.md` were not found in
the repository. The untracked master-goal document and the tracked Growth OS
audit, architecture, application-foundation, and metrics documents were read
as the available source of truth. The pre-existing untracked files were
preserved.

## Phase 0 evidence reused

- Repository and remote were verified from the dedicated worktree before implementation.
- Existing Growth permission middleware, activation claim/release behavior, activated-cohort retention, bounded grouped order queries, and authz fixtures were reused rather than reimplemented.
- Historical Phase 0/Phase 1 ledger claims were treated as context, not as current acceptance proof.

## Phase 1 implementation

- Removed `assistant_test_passed` and `trial_day_7_active` from the accepted event contract until first-party producers and fixtures exist.
- Kept browser once-only funnel markers unset until the server accepts the event, and forwarded a validated `Idempotency-Key` for retries.
- Made retry identity versioned, hashed, payload-bound, and bound to user/shop context so a reused header cannot suppress a different tenant or payload.
- Changed analytics query failures from false zero-valued success payloads to sanitized `503` responses.
- Added sanitized operational signals for activation and funnel write failures without allowing telemetry bookkeeping to block customer replies.
- Added a conditional PostgreSQL JSONB-path activation update so a stale telemetry snapshot cannot replace concurrent merchant settings.
- Configured analytics write limiters to use the shared Redis rate-limit store when deployed; the documented single-process fallback remains for local development/staging without Redis.
- Added backend and frontend regression fixtures for unsupported events, failure semantics, idempotency, retry behavior, and the PostgreSQL activation write path.

No database migration or schema change was made.

## Validation evidence

- Focused Growth/analytics backend suite: **5 suites, 34 tests passed**.
- Backend security suite: **27 suites, 183 tests passed**.
- Merchant frontend unit suite: **59 files, 483 tests passed**. The suite emits expected `ECONNREFUSED` noise for tests that probe an absent local backend; the process still exits successfully.
- Frontend funnel/client focused tests: **2 files, 3 tests passed**.
- Frontend TypeScript check: passed.
- Growth OS TypeScript check: passed.
- Backend syntax/build check: passed.
- Frontend production build: passed; existing large-chunk warnings remain.
- `git diff --check`: passed; only expected CRLF conversion warnings were emitted.
- Backend test-discovery check: **pre-existing failure** — two orphan tests and empty integration/meta-E2E suites; no Growth test routing was changed in this phase.

## Unverified runtime evidence

- `UNVERIFIED_ITEM`: real PostgreSQL/Redis/browser delivery across the Growth and merchant origins.
- `WHY_NOT_VERIFIED`: no authorized disposable staging stack or browser session was available in this worktree; database, Redis, and authorization behavior in the fixtures is mocked or local-only.
- `RISK`: production CORS/CSRF origin behavior, Redis topology, database concurrency, and cross-origin browser delivery remain runtime questions.
- `REQUIRED_FOLLOWUP`: Phase 2 staging gate with real PostgreSQL/Redis, Growth auth/2FA/refresh/expiry/CSRF flows, revocation invalidation, and browser coverage.

## Next phase

Phase 2 — Make the access foundation releasable. It is not started by this
change. It must close the Growth-origin auth mismatch, real access-flow tests,
role grant/revoke with immediate cache invalidation, and staging/browser proof
before Growth is enabled.
