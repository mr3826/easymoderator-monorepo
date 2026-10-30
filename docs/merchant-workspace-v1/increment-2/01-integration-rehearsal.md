# 01 — Controlled Multi-Workstream Integration Rehearsal

**Date:** 2026-10-25 · **Rehearsal worktree:** `D:\easymod\_rehearsal-mw-v1-integration`
**Rehearsal branch/SHA:** `rehearsal/mw-v1-integration` @ `f32de36b` (disposable — never pushed)
**Gate:** INTEGRATION_REHEARSAL = **PARTIAL** (honest; see verdict)

## Strategy comparison (mission §5.2)

| Option | Assessment | Decision |
|---|---|---|
| 1. Merge selected frozen workstreams into T | v6 = freshest reviewed UX line but diverged pre-Pilot+ (111 behind); file-level merge silently breaks behavior (evidence below) | **rehearsed, rejected for now** |
| 2. Port only required contracts | pilot-customer-rto create-time guard: 1 colliding file, CLEAN `git apply --check`, adopted as `57c5ada3` | **DONE (adopted)** |
| 3. Defer unstable streams, continue independently | orders-v2 (sibling of v6, superseded), mobile (dirty/active, contract-compat only) | **recorded as dependencies** |

Increment 2 therefore continues from **pure T (`3d1bc0eb`)** + the ported guard —
`14bd5d92` (docs) → `57c5ada3` (guard). No rehearsal commit enters the product branch.

## Workstream inventory (all source-verified, read-only; explore session `ses_e8bae3b26…`)

| Workstream | HEAD | vs T | Dirty? | Collisions | Verdict |
|---|---|---|---|---|---|
| orders-execution-workspace-v2 | `3b68c699` (Oct 15, clean) | divergent 3↑/111↓, mb `71603e9f` | no | 11 code files (order core, inbox UI, api types) | shares the two seed commits with v6; its unique commit is superseded by v6's line — DEFER |
| merchant-journey-v6-action-first | `50b52e86` (Oct 16, clean) | divergent 15↑/111↓, same mb | no | 15 code files, mostly FE rewrites | rehearsed below — DEFER for owner-rebase |
| mobile-app | `939de5dc` (Oct 9 + **23-file WIP**) | divergent 43↑/144↓, mb `b4995115` | **YES — active, untouched** | only 5 backend files | PORT_CONTRACTS_ONLY: mobile must re-sync onto T's hardened `/api/mobile/inbox` reply contract (message-tag 422 + HUMAN_AGENT 7-day clock); T must later absorb mobile's `/api/mobile/products/images` + session-bound FCM when they land upstream. Not merged into anything here. |
| mobile-execution | `f4d640bc` (clean) | divergent 12↑/145↓ | no | — | DEFER — obsolete; its lineage was rebased into mobile-app |
| pilot-customer-rto | `41e5d49f` (Oct 5, clean) | divergent 1↑/189↓, mb `59bcb4dc` | no | 1 file (order.service.js context) | **CONTENT-PORTED** (guard + integrity test only) |

## v6 merge rehearsal — what actually happened

`git merge --no-ff --no-commit 50b52e86` → auto-merged the API/service layer
`cleanly` (FE-08 customerId + v6 fields coexist in `api/domains/order.ts`;
`conversation.ts` kept FE-03 removal + FE-08 signal + gained v6
`__skipGlobalErrorToast`/Idempotency-Key plumbing; backend auto-merge fine),
7 true conflicts resolved toward T (4 UI components, 1 test, 2 locales), then
merge commit `f32de36b`.

| Gate | Result | Note |
|---|---|---|
| `tsc --noEmit` | **0** | type-level compatible |
| `vite build` | **green** | bundles |
| backend jest order+conversation (37 suites) | **496/496** | service-layer merge genuinely sound |
| FE vitest full | **30 failed** | see attribution below |

Failure families (evidence):
1. **i18n coverage guard ×2** — 91 t() keys missing in en/bn: v6's clean-merged
   components use keys from v6's locales (rejected via --ours). Mechanical union
   required.
2. **Dashboard ×1** — v6's Dashboard.tsx/test merged clean (T never touched them)
   but expects v6's data hooks/shell wiring: cross-cutting, not file-level.
3. **UnifiedInbox ×27** — T's inbox test file (clean, T-version) fails against the
   merged tree: v6's *non-conflicting* helper files (`DashboardLayout.tsx`,
   `shared/lib/http/client.ts`, global-error-toast behavior) change request
   ordering/payloads — e.g. `expected 1st vi.fn() call with { page: 99, limit: 50 }`
   no longer holds. Pilot+ inbox guarantees are behaviorally broken by files that
   merged with ZERO conflicts.

## Rehearsal verdict

**PARTIAL — do not integrate v6 (or orders-v2) into the product line at file level.**
- Backend + API-layer semantics merge cleanly and stay green (496/496; FE-01/03/08
  invariants verified preserved).
- The v6 frontend line is a *capability-shaped rewrite* whose blast radius includes
  non-colliding files; it must be rebased **onto** Pilot+/increment-1 by its owner and
  re-validated (incl. the 10 Pilot+/increment-1 Playwright journeys and live gates),
  which Docker-blocked rehearsal here cannot substitute.
- Mobile: contract-compatibility tracked as dependency (no code merge — worktree is
  dirty/active, never touched).
- The only content adopted: pilot-customer-rto's `customer_id` shop-integrity guard
  (`57c5ada3`, 295/295 order-module green) — it strengthens the exact authority this
  increment builds customer context on.

### Outstanding integration blockers (recorded, per §5.4)
1. v6 frontend rebase + revalidation (owner decision on adopting its action-first shell).
2. Host Docker Desktop Linux engine down → real-stack rehearsal (live `customer_id`
   request, migrations, browser journeys against a live backend) impossible since
   ~13:00Z; retry is scheduled.
3. orders-v2 unique backend bits (Idempotency-Key on POST /api/order, `delivered`
   list-filter enum) — evaluate when order-execution work resumes; not needed for
   this increment's jobs.

### Safe follow-up sequence
1. Increment 2 lands on T + guard (this branch).
2. v6 owner rebases `feature/merchant-journey-v6-action-first` onto landed increment 2
   and re-runs their evidence suite + this repo's regression gates.
3. Mobile re-syncs backend contracts upstream.
4. Final combined release candidate = main + Pilot+ + increment1 + increment2 + v6(rebased)
   — rehearse again end-to-end with live infra before any pilot enablement.
