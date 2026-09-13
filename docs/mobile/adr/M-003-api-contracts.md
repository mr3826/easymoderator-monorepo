# ADR-M-003: API Contracts Owned by Mobile, Verified by Backend Tests

Status: Accepted<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator

## Context

`openapi.yaml` is stale relative to the live route set and is exercised by no test
(`CURRENT_STATE.md` §11). Six distinct error envelope shapes exist across the API, and most
unhandled 4xx responses default to `code: INTERNAL_ERROR`. ADR M-001 keeps `EasyMod-mobile/`
outside the root workspace, so it cannot import a shared TypeScript types package from
`EasyMod-backend` or `EasyMod-frontend` even if one existed (none does).

## Decision

Mobile owns its own typed API client: hand-written TypeScript request/response types per endpoint
it actually calls, validated at the network boundary with `zod` schemas (reject and surface a
clear error on shape mismatch rather than trusting an unchecked cast). A single error normalizer
maps all six observed envelope shapes plus the `INTERNAL_ERROR`-default 4xx case to one internal
`{ kind, message, retryable, fieldErrors? }` shape the UI layer consumes.

The source of truth for whether mobile's assumption about an endpoint is correct is a backend
contract test — a supertest request/response assertion run against the real Express app and a
real disposable Postgres/Redis, added in the same PR as any new or changed endpoint mobile
depends on. `openapi.yaml` is updated only for genuinely new endpoints mobile introduces (the
native auth routes, `/api/mobile/attention`, `/api/mobile/today`); it is not relied upon as a
contract for existing routes.

## Assumptions

- The backend module owners accept contract tests as a review gate for any endpoint change that
  would break the mobile client, in lieu of a generated-client workflow.
- No endpoint mobile depends on changes shape without a corresponding PR that includes both the
  backend contract test and the mobile-side type/zod schema update in the same review.

## Alternatives Rejected

- **Generate a TypeScript client from `openapi.yaml`.** Rejected: the spec is stale and untested;
  generating from it would produce confidently wrong types, worse than hand-written types checked
  against real contract tests.
- **Shared `@easymod/api-types` workspace package.** Rejected by ADR M-001 (would pull mobile back
  into the root workspace / Node-version coupling) and would still need contract tests to catch
  runtime-shape drift that TypeScript types alone cannot see (e.g., a field silently becoming
  `null` instead of absent).

## Consequences

- Positive: mobile never trusts an assumption about a response shape that isn't independently
  verified by a backend test in the same repo, same PR.
- Positive: the error normalizer is written once, tested against all six known envelope shapes
  plus the `INTERNAL_ERROR` default, and every screen's error handling composes on top of it
  instead of re-deriving envelope parsing.
- Negative: every new mobile-consumed endpoint carries a small fixed cost (contract test + zod
  schema + type) that a shared-client approach might have auto-generated — accepted as cheaper
  than the cost of drift bugs.
