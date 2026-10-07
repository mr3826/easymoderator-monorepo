# Growth OS Completion Plan

Date: 2026-10-07

This is the execution plan for the Growth OS completion branch. It is based on
the current `origin/main` tree at `981f8f74595e0c17f3e779b91708e9d5ba79facc`,
not on the unrelated mobile release branch that was checked out initially.

## Recovery Summary

The historical plan was recovered from `docs/growth-os/GROWTH_OS_GOAL.md`,
`docs/growth-os/04-prospect-foundation.md`,
`docs/growth-os/05-internal-control-plane.md`, the phased plan in
`docs/growth-os/2026-08-05-current-status-audit-and-execution-plan.md`, and the
Growth commit lineage from `041d3d50` through the current main ref.

The intended productized boundary is the internal Growth Workspace: shared
authentication and role policy, prospect ledger, source attribution, lifecycle
events, follow-ups, notes, operational home, funnel analytics, search, Merchant
360/insight, admin control-plane actions, and bounded browser capture. The
ledger remains a Growth read model and does not replace merchant, order,
subscription, customer, or channel source-of-truth domains.

The historical marketing list is classified as follows:

| Historical item | Classification | Evidence-based disposition |
| --- | --- | --- |
| Prospect capture, source attribution, funnel measurement, owner queues, lifecycle follow-up | PRODUCTIZED_GROWTH_OS_CAPABILITY | Implemented in the current Growth Workspace; harden correctness and release gates below. |
| Positioning, offers, landing pages, CTA tests, testimonials, case studies, webinars, content, community, ambassador operations | MANUAL_MARKETING_OPERATION | No current product contract or source tables; do not invent a CRM/marketing automation surface. |
| Meta, Google, Instagram campaign delivery and ad-network measurement | EXTERNAL_PLATFORM_DEPENDENCY | Existing provider/producer boundaries are authoritative; no live credentials or approved provider contract is present. |
| CAC, reply rate, cohort retention, outreach automation, demos, trials, referral scoring, autonomous AI | DEFERRED_ROADMAP_ITEM | Current analytics explicitly returns these as unavailable; preserve that contract. |
| The original multi-agent/marketing orchestration concept and removed campaign/Instagram modules | OBSOLETE_REQUIREMENT | Rejected by current architecture and later removal/history; not restored. |

## Initial Capability Matrix

| Capability | Initial status | Evidence and remaining concern |
| --- | --- | --- |
| Internal auth, MFA, role policy, role administration | COMPLETE | Shared auth, Redis fail-closed authorization, canonical two-role policy, audited admin mutations, and focused tests exist. Live bootstrap remains an external release gate. |
| Prospect ledger and lifecycle | COMPLETE with integrity gap | CRUD, normalization, scope, merge, importer, audit, and browser flows exist. The self-referential merge FK still uses `SET NULL`, conflicting with the merged-row check. |
| Source attribution and event timeline | PARTIAL | Source taxonomy and transactional events exist. Event identity is database-generated and importer idempotency is source-reference based; no unapproved ad-network attribution is added. |
| Follow-ups and notes | PARTIAL | CRUD, scope, terminal transitions, and timeline events exist. Analytics follow-up counts are not cohort/scope filtered. |
| Home and funnel analytics | PARTIAL | Measured/derived/unavailable contracts exist. Follow-up discipline currently leaks global counts to source/assigned scopes. |
| Internal search | PARTIAL | Backend scope and response redaction exist. Source-scoped results expose `ownerUserId`; Unicode normalized-name search is incomplete. |
| Merchant/admin control plane | COMPLETE for shipped contract | Admin and masked insight views, audited mutations, idempotency, and role checks exist. No billing-plan bypass or unsupported provider automation is introduced. |
| Frontend workspace | COMPLETE for shipped contract | Pages and state tests exist; full local Vitest run is resource-flaky under this environment and needs deterministic worker configuration. |
| Browser extension capture | COMPLETE for bounded contract | Source validation and tests exist; no scraping, credentials, outreach, or live-origin proof is claimed. |
| CI/CD and deployment | PARTIAL | Reusable Growth verification, immutable image publication, Caddy/Compose checks, and backend/frontend rollback exist. The rollback rehearsal does not capture or restore the Growth image. |
| PII/audit retention | PARTIAL | Audit sanitization covers credentials and contact email/phone in some paths, but prospect snapshots can retain contact names, notes, and metadata. Retention ownership/duration is not an executable policy. |

## Execution Waves

### Wave 0 - Contracts and scope

| ID | Priority | Task | Dependencies | Acceptance |
| --- | --- | --- | --- | --- |
| GOS-001 | P0 | Reconcile current code, historical requirements, and deferred release gates in this plan and the execution-state receipt. | None | Every candidate is classified; no historical manual/provider item becomes speculative code. |

### Wave 1 - Correctness and isolation

| ID | Priority | Task | Dependencies | Files/modules | Acceptance |
| --- | --- | --- | --- | --- | --- |
| GOS-101 | P0 | Scope Growth analytics follow-up counts to the same non-merged, source-recorded cohort and prospect scope used by the report. | GOS-001 | `growth-os.workspace.service.js`, analytics tests | Assigned/source readers cannot observe global follow-up counts; cohort-window semantics are explicit and tested. |
| GOS-102 | P0 | Remove owner identifiers from source-scoped global search results. | GOS-001 | `growth-os.workspace.service.js`, search/security tests | Redacted search responses contain no owner UUID/name/email while preserving permitted business/status/source fields. |
| GOS-103 | P0 | Make merged-prospect referential integrity consistent with the merged-row check. | GOS-001 | prospect entity, new migration, sync bootstrap, migration tests | Deleting a merge target is rejected rather than silently nulling `merged_into_id`; existing data is preserved. |
| GOS-104 | P1 | Redact Growth PII and working content from prospect audit snapshots and document retention ownership/limits without changing the ledger source of truth. | GOS-001 | prospect audit sanitizer/service, audit tests, authoritative docs | New audit rows contain no raw contact name/email/phone/page URL/notes/metadata; redaction is covered for create/update/merge/import paths. |

### Wave 2 - Read-path hardening

| ID | Priority | Task | Dependencies | Files/modules | Acceptance |
| --- | --- | --- | --- | --- | --- |
| GOS-201 | P1 | Apply a fail-closed, Redis-backed, authenticated user-plus-IPv6-safe limiter to Growth read/enumeration routes, not only duplicate/search probes. | GOS-001 | `growth-os.routes.js`, security tests | Prospect, owner, home, analytics, admin list/detail/audit, follow-up/note reads have bounded quotas; production Redis failure returns sanitized `503`. |
| GOS-202 | P1 | Preserve Unicode letters/numbers when normalizing search terms for normalized business-name search. | GOS-001 | prospect repository/workspace search, integration/unit tests | Punctuation and non-ASCII business names are discoverable without wildcard widening. |
| GOS-203 | P2 | Align Growth entity index definitions and `db:sync` bootstrap with real source-recorded/cohort access paths. | GOS-103 | prospect entity, migration, sync, migration tests | Fresh sync and migrate paths create the same named Growth indexes and constraints required by current queries. |

### Wave 3 - Test and release reproducibility

| ID | Priority | Task | Dependencies | Files/modules | Acceptance |
| --- | --- | --- | --- | --- | --- |
| GOS-301 | P2 | Make Growth Vitest execution deterministic in constrained local/CI workers. | GOS-101/102/104/202 | `vitest.config.ts`, package scripts | Full Growth suite completes without worker-startup timeouts and retains assertion failures. |
| GOS-302 | P2 | Add a repository-standard Growth lint gate for the JavaScript/TypeScript frontend and changed backend/workflow helpers. | GOS-001 | root/frontend package scripts and config | Lint runs in CI/local validation and passes without disabling meaningful safety rules. |
| GOS-303 | P2 | Extend rollback rehearsal to capture, restore, and health-check the immutable Growth image. | GOS-001 | `ci-cd.yml`, `rollback-rehearsal.sh`, rehearsal tests | Candidate rejection and rollback restore backend, frontend, Growth image refs, env, Compose, and Caddyfile; missing Growth image fails closed. |
| GOS-304 | P2 | Add built-image smoke coverage for the actual Nginx artifact and deterministic `/api` fallback behavior. | GOS-301 | Growth Nginx config, image smoke runner/test, workflow | Built artifact serves health/SPA routes with security/cache headers and does not masquerade unsupported API paths as the SPA. |

### Wave 4 - Final validation and release preparation

| ID | Priority | Task | Dependencies | Acceptance |
| --- | --- | --- | --- | --- |
| GOS-401 | P0 | Run focused and repository-standard validation, including migration, integration, security, UI, build, and unfinished-marker review. | Waves 1-3 | Exact commands and results are recorded; introduced defects are fixed. |
| GOS-402 | P0 | Perform an independent adversarial review of architecture, data scope, PII, failure paths, race/idempotency behavior, UX, CI, and rollback. | GOS-401 | All legitimate findings are fixed and affected tests rerun. |
| GOS-403 | P1 | Update `EXECUTION_STATE.md` with current branch/base/head, implementation receipts, limitations, and release verdict. | GOS-401/402 | The document describes the completed system, not a superseded plan. |
| GOS-404 | P1 | Inspect remote main/CI and create one PR only if all code gates pass. | GOS-403 | PR is coherent; CI is inspected after publication; deployment is considered only under the documented human/provider gates. |

## External Gates

No source change can manufacture the missing production credential/MFA, live
Growth DNS/TLS/browser proof, provider credentials, production approval, or
deployment authorization. Those remain release evidence gates. The branch must
still complete all locally actionable correctness, security, testing, and
rollback work before a conditional release verdict is reported.

## Commit Slices

Implementation commits will remain coherent and scoped to the waves above:

1. `fix(growth): close scoped analytics and search leaks`
2. `fix(growth): enforce prospect audit and merge integrity`
3. `fix(growth): harden read limits and normalized search`
4. `test(growth): make validation and image rollback reproducible`
5. `docs(growth): record completion audit and release gates`

No commit will include unrelated mobile or developer work.
