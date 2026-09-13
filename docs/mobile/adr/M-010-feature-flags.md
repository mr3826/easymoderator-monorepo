# ADR-M-010: Mobile Backend Surface Gated by Five Boolean Flags

Status: Accepted<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator

## Context

`src/config/config.js:33` already has exactly this pattern for one prior feature:
`growthOsEnabled: process.env.GROWTH_OS_ENABLED === 'true'` — a boolean flag, read once at config
load, defaulting to `false` when the env var is absent or anything other than the string `'true'`.
The production environment variable renderer is a strict allowlist (`CURRENT_STATE.md` §11), so a
new flag defaulting to `false` and never added to the production allowlist is inert in production
by construction, not just by convention, until a human deliberately adds it.

## Decision

Add five flags to `config.js` following the exact same pattern:

- `MOBILE_API_ENABLED` — gates all `/api/auth/native/*`, `/api/mobile/*` routes (404 when off).
- `MOBILE_PUSH_ENABLED` — gates whether the native FCM registration/send path is exercised for
  mobile-sourced subscriptions.
- `MOBILE_ORDER_MUTATIONS_ENABLED` — gates mobile-invoked order create/confirm/cancel.
- `MOBILE_COURIER_ACTIONS_ENABLED` — gates mobile-invoked courier book/retry.
- `MOBILE_AI_DRAFTS_ENABLED` — gates mobile's conversation → order-draft flow (Phase 4).

All five default to `false`. Each phase that introduces a mobile-only backend route or behavior
change wraps it in the relevant flag and includes an integration test asserting the flag-off
behavior is unchanged from baseline (typically: route returns 404, or the code path is never
reached).

## Assumptions

- Five independent flags (rather than one umbrella flag) are the right granularity because the
  phases roll out at different times with different human gates (push needs Firebase; courier
  actions need Track D fix #2/#3 landed first) — a single flag would force an all-or-nothing
  cutover.
- No flag is ever read anywhere except `config.js`'s single load point, so there is exactly one
  place to audit for "is this flag actually gating what it claims to."

## Alternatives Rejected

- **A remote feature-flag service (e.g., LaunchDarkly-style).** Rejected: massive overkill for
  five booleans in a program explicitly forbidden from adding new paid third-party accounts
  without a human gate, and it would add a new external dependency and failure mode
  (flag-service-down behavior) to every gated request.
- **One umbrella `MOBILE_ENABLED` flag.** Rejected per Assumptions above — the phases' human gates
  and readiness timelines are genuinely independent.

## Consequences

- Positive: turning any mobile backend capability off is a single environment variable change,
  reversible without a deploy of new code (the code path already exists and is simply not reached).
- Positive: exactly matches an existing, already-reviewed pattern — no new config-loading
  machinery for a reviewer to learn.
- Negative: five flags to keep track of by Phase 8 — mitigated by listing all five and their
  current intended production state explicitly in `MOBILE_EXECUTION_STATE.md`'s ledger, updated at
  every phase gate.
