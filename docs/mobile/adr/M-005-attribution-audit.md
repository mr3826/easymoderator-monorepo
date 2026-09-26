# ADR-M-005: Mobile Client Attribution via Header + Audit Metadata

Status: Accepted<br>
Date: 2026-09-13<br>
Owners: Mobile Program Orchestrator

## Context

`audit_logs` has no dedicated "source" column; `AuditService.logOperation` accepts a free-form
`metadata` JSON field, and `x-request-id` is already threaded end-to-end into it
(`CURRENT_STATE.md` §11). Every mutation the mobile app performs against shared production data
(orders, courier bookings, product stock) should be distinguishable from a web-originated mutation
after the fact, without a schema migration.

## Decision

The mobile client sends `X-EM-Client: android/<app-version>` on every request. A small piece of
request-context middleware reads this header (if present) and makes it available to any handler
that writes an audit row. Every mobile-invoked critical mutation (order create/confirm/cancel,
courier book/retry, stock/price update) writes its existing `AuditService.logOperation` call with
`metadata.source: 'MOBILE'` plus the existing `x-request-id`, actor (`userId`), shop, and entity
fields — no new columns, no new table.

## Assumptions

- "Critical mutation" for this ADR's purposes means anything already covered by an existing
  `AuditService.logOperation` call site today; mobile does not introduce new audited actions
  beyond what the web app already audits for the same operation.
- A `metadata.source` string field is sufficient for the program's traceability needs; a queryable
  dedicated column is a future migration if audit-log analytics ever need to filter at scale, out
  of scope here.

## Alternatives Rejected

- **New `source` column on `audit_logs`.** Rejected for Phase 0–8: a schema migration on a shared,
  high-write table for a field with no query-performance requirement yet is unnecessary risk;
  `metadata` already exists and is already the extensibility point this table uses for
  request-scoped detail.
- **Client-side-only tagging (e.g., a mobile analytics event), no backend audit change.**
  Rejected: audit rows are the record a security or support investigation actually reads; a
  parallel analytics stream would not be consulted during an incident and would drift from the
  audit log's field names and retention policy over time.

## Consequences

- Positive: any mobile-originated mutation is traceable in the exact same audit trail security
  already reviews, with zero new infrastructure.
- Positive: fully additive — an audit row written without a mobile client attaches no
  `metadata.source`, identical to today's behavior.
- Negative: `metadata.source` is not indexed; a future need to efficiently query "all mobile
  mutations in the last 24 hours" at scale would require either a JSON index or the deferred
  dedicated column.
