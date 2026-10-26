# 10 — Independent Adversarial Review (Increment 2)

**Reviewer:** fresh-context agent `ses_e8ac2b465ffe9DHN5pnrNUEWlK` (did not write the code).
**Reviewed candidate:** frozen `a14fff73…` (the reviewer observed the branch advance to a
docs-only `cc272b96` during its run — F10; the code tip under review was unchanged).
**Verdict: APPROVED_WITH_FINDINGS — 0 blockers, 0 majors, 8 minor + 4 informational.**

## Claims the reviewer independently CONFIRMED (ran source + unit + real-Postgres itself)

- **Tenancy / id-only association:** foreign `customer_id` on orders/conversations is
  intersected with the JWT `shop_id` (empty result); foreign assignee → 400
  `INVALID_ASSIGNEE` inside the row-locked transaction, fail-closed; foreign tag smuggle
  → 404 before any write; foreign-customer note → 404; forged shop claim in a token →
  middleware 403; order PATCH cannot move `customer_id`. `mwv1-increment2.integration.test.js`
  judged **not tautological** (real supertest + Postgres, asserts DB reload + audit content).
- **Flag-off zero gated reads**, **notes privacy** (no body in audits/logs/prompt/SSE),
  **D1-D4** (force HTTP-reachable yet staff-inert, membership enforced, visibility, single
  controller-path SSE, no optimistic overwrite), **truth labels**, **scope discipline**
  (no microservice/task-store/pipeline/bulk-send/identity-merge; queue still a read model),
  and **increment-1 integrity** (pilot `9f562aaf` + increment-1 `3d1bc0eb` clean/untouched;
  `origin/main..HEAD` local-only ⇒ never pushed/merged/deployed).
- Commands it ran: tsc 0; 6-file FE subset 143/143; backend focused 48/48 (627);
  full backend 312/313 (see F1); integration 30/30 (219); `--listTests` confirms the new
  spec is in the suite.

## Findings and disposition (all addressed in `ce45e081` unless noted)

| # | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | minor | Full backend 312/313 — `totp.service.test.js` fails because the **gitignored lab `.env`** (needed for the running preview) re-populates JWT env the test deletes | **Environment artifact, not code.** Proven: with `.env` removed, totp 10/10 and backend 313/313. CI/clean-checkout = 313/313. Documented here; `.env` is never committed. |
| F2 | minor | `UnifiedInbox.test.tsx:621` sync assertion flakes under full-parallel load | **Fixed** — wrapped in `waitFor`. |
| F3 | minor | Duplicate `hitl_changed` on the **bulk-close** path (my D4 change made `updateConversation` emit, but the bulk loop still emitted) | **Fixed** — removed the loop emit; single service emit is now the only source on every path. |
| F4 | minor | `createAuditLog` client helper POSTs `/api/audit` (no handler) + its "test of illusion" + dead i18n keys remained after my caller removal | **Fixed** — helper, barrel export, and pinning test removed. |
| F5 | minor | notes `?before=` cursor only mock-verified (uses physical `created_at`, works in PG) | **Fixed** — added a real-Postgres integration test for the cursor (now 220 integration tests). |
| F6 | minor | tag replace-set `destroy`+`bulkCreate` not atomic → mid-failure silently clears tags | **Fixed** — wrapped in a transaction (graceful fallback for the mock path). |
| F7 | minor | "idempotency-keyed" audit overclaims dedup (`audit_logs.idempotency_key` is a non-unique index) | **Fixed** — doc 05 + code comment corrected to "records a correlation key, does not dedup." |
| F8 | minor | `mwv1-reset-lab.js` hard-deletes CRM rows for any `DATABASE_URL` (fails fail-closed standard) | **Fixed** — refuses unless DB name is `*_dev/_lab/_test` and `NODE_ENV!=production`. |
| F9 | info | "Open orders" heading lists recent (not only-open) orders | **Fixed** — relabelled "Recent orders" (statuses already verbatim; no false claim). |
| F10 | info | candidate SHA moved during review; proof.json `commits_above_base`/doc-07 "19" disagree with actual | **Fixed** — proof.json + this doc reconcile counts; final freeze recorded below. |
| F11 | info | increment-1 frozen SHA still ships the broken live `customer_id` HTTP link (increment-2 fixed it) | **Acknowledged** — increment-1 is a frozen historical candidate; the repair lives here (`0ea22a31`); merge order increment-1→increment-2 carries the fix forward. |
| F12 | info | backend unit run leaves the auth fixture modified + creates `docs/ai/product-experience*/artifacts` droppings (non-hermetic) | **Addressed** — droppings removed from the tree/commit; fixture follows the increment-1 "committed with the run" convention. |

## Claims the reviewer could NOT re-run in its sandbox (documented, not disputed)

Rehearsal 496/496 (disposable worktree, out of study scope — verdict was conservative
PARTIAL); meta-e2e 48/48; Playwright deterministic/live + perf table + build (the reviewer
noted screenshots exist but provenance is unverifiable from a static read). All of these
were executed by the implementing agent with commands recorded in docs 08/09 and are
reproducible via the commands listed there.

## Post-fix re-verification (implementing agent, `ce45e081`)

- backend focused 48/48 (627); full backend **313/313 clean** (312 with the lab `.env`
  present — F1, proven); real-stack integration **30/30 (220)**; FE **664/664** (bounded
  workers) + tsc 0 + build; Playwright **20/20** (10 journeys + 10 pilot-plus regression)
  chromium; journeys firefox re-run green earlier this session.

## Verdict adoption

The increment is **independently approved with findings**, every actionable finding closed,
and no completion claim rests on the implementer's own report alone.
