# Mobile Architecture Overview

Status: Accepted (Phase 0)<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator

This document is the map; the ADRs in `docs/mobile/adr/` are the decisions. Read
`docs/mobile/CURRENT_STATE.md` first — every decision below responds to a specific, cited gap or
defect recorded there.

## 1. Shape of the system

```
mr3826/easymoderator-monorepo
├── EasyMod-backend/        existing, JS, Express — additive-only mobile delta lives inside here,
│                            flag-gated (ADR M-010), new files only where noted below
├── EasyMod-frontend/        existing, untouched
├── EasyMod-growth/          existing, untouched
├── EasyMod-mobile/          NEW — standalone package, own lockfile, own Node version (ADR M-001)
├── docs/mobile/             NEW — this document set
└── .github/workflows/
    └── mobile-ci.yml        NEW — only workflow that runs on mobile branches (ADR M-009)
```

`EasyMod-mobile/` is never a workspace member. Nothing in `EasyMod-backend/`, `EasyMod-frontend/`,
or `EasyMod-growth/` is edited in a way that changes existing behavior — every backend touch point
below is either a brand-new file, a brand-new route, or an addition to a file that is inert unless
a new flag (default `false`) is on.

## 2. Backend delta, file by file (the complete ledger — kept in sync with `MOBILE_EXECUTION_STATE.md`)

| Area | Change | Type | Flag | ADR |
|---|---|---|---|---|
| `modules/auth/native/*` (new dir: routes, controller, reusing `auth.service`) | new files | additive | `MOBILE_API_ENABLED` | M-004 |
| `modules/auth/session.service.js` | wire `createSession` into the new native signin/refresh path only | additive call site | `MOBILE_API_ENABLED` | M-004 |
| `modules/auth/session.routes.js` mount | fix double `/sessions/sessions` prefix for the **new** native session-list route only; existing (dead) mount untouched | additive | `MOBILE_API_ENABLED` | M-004 |
| `middleware/auth.middleware.js` (`authenticate`) | add: if JWT has `sid` claim, reject if revoked | new conditional branch, no-op for tokens without `sid` | n/a (branch is inert for all existing tokens) | M-004 |
| `middleware/csrf-middleware.js` | add: skip CSRF when Bearer-only, no cookies, and flag on | new conditional branch | `MOBILE_API_ENABLED` | M-004 |
| `modules/mobile/*` (new dir: `attention`, `today` routes) | new files | additive | `MOBILE_API_ENABLED` | M-008 |
| `config/config.js` | add 5 boolean flags | additive keys | n/a (flags themselves) | M-010 |
| `modules/notification/push-notification.service.js` | fix membership-targeting query (Track D #4, lands on `main` independently) | bugfix, not mobile-only | n/a | M-007 |
| `modules/shop/shop.service.js` (`removeUserFromShop`) | deactivate the removed user's push subscriptions (Track D #4) | bugfix, not mobile-only | n/a | M-007 |
| `modules/order/order.service.js` (`buildCourierOrderData`) | respect `payment_status` for COD amount (Track D #2) | bugfix, not mobile-only | n/a | — |
| `modules/delivery/courier-dispatch-claim.service.js` | claim key drops per-provider scoping (Track D #3) | bugfix, not mobile-only | n/a | — |
| `modules/product/product.validator.js`, `product.service.js` | strip server-owned fields incl. `shop_id` (Track D #1) | bugfix, not mobile-only | n/a | — |
| `audit/idempotency.middleware.js` | reused as-is on new mobile mutation routes | no change to the file | n/a | M-006 |
| Any order/courier/stock mutation route mobile calls | wrap in `Idempotency-Key` handling + `X-EM-Client`-sourced audit metadata | additive middleware application | `MOBILE_ORDER_MUTATIONS_ENABLED` / `MOBILE_COURIER_ACTIONS_ENABLED` | M-005, M-006 |

The four Track D rows are bug fixes to real, pre-existing production defects (see
`docs/mobile/CURRENT_STATE.md` and the plan's Track D section) — they ship as **separate PRs into
`main`**, each with a test that fails on `origin/main` and passes with the fix. Opening each PR is
something this program does; **merging any of them into `main` is the human gate the master brief
names explicitly ("merge to `main`") and is never self-authorized by an agent, regardless of how
narrowly scoped or well-tested the fix is** — the user reviews and merges each one individually.
`feature/mobile-app` merges `main` only after the user has merged the Track D fixes they choose to
take. They are listed here because mobile's design (M-007, and the general trustworthiness of
courier/COD data mobile will display) depends on them being fixed, not because mobile's branch
fixes them directly.

## 3. Client architecture (`EasyMod-mobile/`)

- Expo SDK 57, Expo Router (file-based, tab navigator: Home · Inbox · + · Orders · More), New
  Architecture, development builds (never Expo Go, per ADR M-002).
- State/data: TanStack Query for all server state; no separate global store — server state and
  the thin local UI state (active tab, in-progress form drafts) are kept deliberately separate.
- Networking: a single typed client module per ADR M-003 — zod-validated responses, one error
  normalizer, one place that attaches `Authorization: Bearer`, `X-EM-Client`, and
  `Idempotency-Key` headers.
- Auth: SecureStore for the refresh token, in-memory access token, single-flight refresh guard,
  full sign-out on refresh-reuse-detected (ADR M-004).
- Push: native FCM via `getDevicePushTokenAsync`, registered against the existing subscriptions
  endpoint (ADR M-007).
- Offline: persisted read-only TanStack Query cache for an explicit allowlist, no mutation queue
  (ADR M-011).
- i18n: i18next, `bn` default, extending the web app's existing key namespace
  (`CURRENT_STATE.md` §12) rather than a parallel translation set.
- Design tokens copied from the web app's brand tokens (`CURRENT_STATE.md` §12): `#00A651` /
  `#008040` primary, `#030213` text, `#d4183d` destructive, `#F9FAF8` background, `10px` radius,
  Hind Siliguri, `lucide` icons (via a React Native-compatible icon set using the same glyphs).

## 4. Operating model (who does the work, and where)

- The orchestrator (this session) owns the integration branch `feature/mobile-app` and the
  worktree at `D:/easymod/mob`, merges every phase's PR into it, tracks every phase gate and
  receipt in `MOBILE_EXECUTION_STATE.md`, and never touches `main` except through the four Track D
  PRs. Every push uses an explicit refspec; local gitleaks runs before every push.
- Each phase's implementation work happens on its own `mobile/pN-<ticket>` branch, in its own
  worktree when it runs concurrently with other lanes (disjoint files only — e.g., Track D's four
  fixes run in parallel with Phase 0 documentation because they touch entirely different files).
- Every phase gets an independent review pass on its diff before merging into `feature/mobile-app`
  — a fresh reviewing agent with no stake in having written the code, plus a dedicated security
  review on any phase that adds an authenticated write path.
- Toolchain (Node 22, Node 20, Maestro, Android SDK env vars) is set up session-locally per
  `docs/mobile/DEV_SETUP.md` — no global machine state changes.

## 5. What "done" means for Phase 0

The isolation and architecture gate (`DISCOVERY PILOT_ISOLATION API_CAPABILITY_MATRIX
ARCHITECTURE`, see `MOBILE_EXECUTION_STATE.md`) passes when: this document set and all 12 ADRs
exist and are reviewed; `feature/mobile-app` is pushed and shows zero CI runs from any existing
workflow; the four Track D PRs are open (not merged) with a failing-then-passing test each; and an
independent adversarial review (The Fool + BD-merchant value challenge, recorded in
`MOBILE_EXECUTION_STATE.md`) has run against this document set and its findings are either
resolved or explicitly deferred with a reason.
