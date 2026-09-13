# Mobile Program — Execution State

This is the living ledger and phase-receipt log for the mobile program. Every phase appends a
receipt in the format below (master brief §25) and updates the flag/file ledger.

## Feature flag ledger (ADR M-010)

| Flag | Default | Current production state | Gates |
|---|---|---|---|
| `MOBILE_API_ENABLED` | `false` | `false` (not provisioned) | all `/api/auth/native/*`, `/api/mobile/*` |
| `MOBILE_PUSH_ENABLED` | `false` | `false` (not provisioned) | native FCM registration/send for mobile subscriptions |
| `MOBILE_ORDER_MUTATIONS_ENABLED` | `false` | `false` (not provisioned) | mobile-invoked order create/confirm/cancel |
| `MOBILE_COURIER_ACTIONS_ENABLED` | `false` | `false` (not provisioned) | mobile-invoked courier book/retry |
| `MOBILE_AI_DRAFTS_ENABLED` | `false` | `false` (not provisioned) | conversation → order-draft flow |

None of these flags exist in the production environment allowlist yet — adding them there, for
any reason, is a human decision (`CURRENT_STATE.md` §11), never performed by an agent.

## Additive backend delta ledger

See `MOBILE_ARCHITECTURE.md` §2 for the full table. As of Phase 0: **zero backend code changes
have been made** — Phase 0 is documentation-only. The ledger table exists now so Phase 1 has a
single place to check off each row as it lands.

## Track D — pre-existing production defect fixes (tracked separately from phase receipts)

| # | Branch | Status | Merge to `main` |
|---|---|---|---|
| 1 | `fix/backend-product-tenant-mass-assignment` | Not started | Human gate — requires explicit user approval before merge |
| 2 | `fix/delivery-prepaid-cod-amount` | Not started | Human gate — requires explicit user approval before merge |
| 3 | `fix/delivery-cross-provider-double-booking` | Not started | Human gate — requires explicit user approval before merge |
| 4 | `fix/notification-push-membership-targeting` | Not started | Human gate — requires explicit user approval before merge |

Each PR, once opened, is left unmerged. Opening a PR is program work; merging it into `main` is
never self-authorized (see `MOBILE_ARCHITECTURE.md` §2 and the Phase 0 review finding below).

## Phase 0 review finding log

An independent adversarial review (The Fool + BD-merchant value challenge + architecture challenge
protocol, master brief §4/§30) ran against the full Phase 0 document set on 2026-09-13. Verdict:
**PASS-WITH-NOTES** on the overall set and on ADRs M-004, M-008, M-012 individually — no BLOCKED
findings. All four notes were resolved directly in the documents rather than left open:

1. Track D merge-to-`main` framing clarified as an explicit human gate (`MOBILE_ARCHITECTURE.md` §2).
2. `CURRENT_STATE.md` §15's "additive" definition clarified to explicitly cover inert new branches
   inside existing shared files (what M-004 actually does), distinct from behavior changes.
3. `CURRENT_STATE.md` §16's removal procedure now lists the `sid`-revocation and CSRF Bearer-skip
   branches explicitly.
4. ADR M-008 now has a concrete, arithmetic ranking table (`MOBILE_PRODUCT_SPEC.md` §2.1) instead
   of a placeholder cross-reference; ADR M-012 now defines the `STATUS_UNCLEAR` fallback for
   contradictory internal order state instead of leaving it undefined; ADR M-004 now names the
   required hybrid Bearer+cookie CSRF test explicitly; two Bangladesh UX principles (remembered
   customer context, image compression) that the spec had omitted are now recorded as deferred with
   an owning phase (`MOBILE_PRODUCT_SPEC.md` §4.1) instead of silently dropped.

The review's citation spot-check independently re-verified 9 of `CURRENT_STATE.md`'s file:line
claims against live source and found all 9 accurate, including exact line text.

## Phase receipts

### Phase 0 — Discovery, Isolation, Architecture

```text
PHASE=0 (Discovery, Isolation, Architecture)
STATUS=PASS

BRANCH=mobile/p0-discovery (merging into feature/mobile-app)
HEAD_SHA=<set at commit time, see PR>

FEATURES_COMPLETED=
- docs/mobile/{CURRENT_STATE,MOBILE_PRODUCT_SPEC,MOBILE_ARCHITECTURE,MOBILE_API_CAPABILITY_MATRIX,DEV_SETUP,MOBILE_EXECUTION_STATE}.md written
- docs/mobile/adr/M-001 through M-012 written (repo ADR format + Assumptions section)
- Independent adversarial review (The Fool / BD-merchant value / architecture challenge) run; all findings resolved in-document
- feature/mobile-app pushed to origin; isolation verified empirically (zero CI runs, zero commit statuses on baseline SHA)

ARCHITECTURE_DECISIONS=M-001..M-012 (see docs/mobile/adr/)

FILES_CHANGED=
- docs/mobile/CURRENT_STATE.md (new)
- docs/mobile/MOBILE_PRODUCT_SPEC.md (new)
- docs/mobile/MOBILE_ARCHITECTURE.md (new)
- docs/mobile/MOBILE_API_CAPABILITY_MATRIX.md (new)
- docs/mobile/DEV_SETUP.md (new)
- docs/mobile/MOBILE_EXECUTION_STATE.md (new)
- docs/mobile/adr/M-001..M-012-*.md (new, 12 files)
No application code, backend code, or CI workflow changed in this phase.

API_CHANGES=none (documentation only; new endpoints are specified, not implemented, in Phase 0)
DB_CHANGES=none

SECURITY_REVIEW=Independent adversarial review completed 2026-09-13 (see Phase 0 review finding log above); no BLOCKED findings; all PASS-WITH-NOTES items resolved in-document before this receipt was written.

UNIT_TESTS=n/a (no code in this phase)
INTEGRATION_TESTS=n/a (no code in this phase)
E2E_TESTS=n/a (no code in this phase)
ANDROID_BUILD=n/a (Phase 1 scope)
EXPO_DOCTOR=n/a (Phase 1 scope)

WEB_REGRESSION_STATUS=UNCHANGED (no backend/frontend file touched)
BACKEND_REGRESSION_STATUS=UNCHANGED (no backend file touched)

PILOT_PRODUCTION_IMPACT=NONE

KNOWN_RISKS=
- Backend behavior described in CURRENT_STATE.md (auth, CSRF, courier, push, orders) is a snapshot at baseline SHA 77790a833da372a03899686a365d7a40b2a95a67; any change landing on main before this program reads these files again could make specific line citations stale. Re-verify against current source before Phase 1 implementation, not just before Phase 0 documentation.
- Track D fixes are documented and scoped but not yet implemented; mobile design decisions that depend on them (M-007's push targeting, M-012's COD-adjacent framing) are correct in intent but not yet true in the running system.

DEFERRED_ITEMS=
- M-008 ranking table weighting may need real-usage tuning once Phase 2 ships; the table itself is the reviewable decision, not a placeholder.
- Two Bangladesh UX principles (remembered customer context — owner Phase 4; image compression — owner Phase 3/6) tracked in MOBILE_PRODUCT_SPEC.md §4.1.
- M-012's write-path order-status-machine correction ADR is required before Phase 4, not written yet (by design — Phase 0 explicitly defers it).

NEXT_PHASE=Phase 1 (Foundation: Expo scaffold, native auth backend M-004/M-005/M-010, mobile-ci.yml) — begins after this receipt and the Phase 0 PR are reviewed. Track D's four fix PRs are opened next, in parallel with Phase 1 start, each requiring explicit user confirmation before merge.
```
