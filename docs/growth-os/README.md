# Growth OS

Growth OS is EasyModerator's internal acquisition, activation, and retention
workspace. It is a modular surface inside the monorepo, not a CRM replacement or
standalone SaaS product.

## Source Of Truth

- `EXECUTION_STATE.md` records the current phase, gates, evidence, and open
  release constraints.
- `04-prospect-foundation.md` describes the Phase 3 prospect ledger contract.
- The dated audit and architecture documents preserve historical repository
  evidence. Current code and tests take precedence when they differ.

The repository does not recreate the missing `GROWTH_OS_GOAL.md` or
`CURRENT_STATE.md` files. The tracked execution state and this index are the
durable navigation points.

## Access Boundary

Growth routes are mounted at `/api/internal/growth-os` behind the existing
authentication and server-side Growth role middleware. Founder and Growth
Manager sessions require the existing MFA assurance claim. Prospect scope is
resolved from `req.growthOs.permissions`; client state never authorizes a row.

## Phase 3 Surface

Phase 3 provides a canonical prospect ledger, deterministic lifecycle changes,
assignment, deliberate linkage to existing users/shops, merge handling, a typed
timeline, duplicate preflight, and a dry-run-by-default historical importer.
Prospects point to EasyModerator records and never copy or mutate subscriptions,
shops, users, customers, or merchant producer paths.

Frontend routes live inside `EasyMod-growth`:

- `/prospects`
- `/prospects/new`
- `/prospects/:prospectId`
- `/prospects/:prospectId/edit`

## Verification

Backend unit and security tests run through the backend Jest homes. Real
PostgreSQL/Redis integration uses `npm run test:backend:integration:docker`.
Growth frontend tests use Vitest with jsdom and Testing Library. Browser E2E,
live Growth-origin delivery, operator bootstrap, and production deployment
remain separate release gates.
