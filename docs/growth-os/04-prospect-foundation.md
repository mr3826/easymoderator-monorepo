# Phase 3: Prospect Foundation

## Purpose

Phase 3 adds the first trustworthy Growth OS work surface: one canonical row per
prospect business, with server-derived identity normalization, deterministic
lifecycle transitions, assignment, deliberate linkage, merge history, and an
operator timeline. It replaces neither merchant source tables nor the platform
security ledger.

## Persistence

`growth_os_prospects` stores business/contact identity, acquisition provenance,
status, ownership, pointers to authoritative `users`/`shops`, merge state, and
metadata. `growth_os_prospect_events` is append-only and renders the product
timeline. Every mutation writes an event and an `AuditLog` row in the same
transaction. Audit failure rolls the mutation back.

The database enforces the lifecycle/source checks, the channel requirement, the
converted-to-shop invariant, merge consistency, source-reference idempotency,
and partial unique identity indexes. Merged rows leave the phone/email/page and
source-reference unique indexes without being deleted.

## Normalization And Deduplication

- Plausible Bangladesh phone values become Bangladesh-default E.164-style
  digits (`+880...`); other country values preserve their international digits
  as `+<digits>` until a multi-country E.164 parser is introduced.
- Email values are trimmed and lowercased.
- Page URLs lose scheme, `www.`, mobile Facebook host aliases, query/fragment,
  and trailing slash before lowercasing.
- Business names are lowercased, punctuation-collapsed, and whitespace-normalized.

The service derives normalized fields and never accepts them from the client.
PostgreSQL partial unique indexes are the race-safe detector. The service maps a
unique violation to `409 GROWTH_OS_PROSPECT_DUPLICATE` with the conflicting id.
`GET /prospects/duplicate-check` is a read-only preflight and is rate limited.

## Lifecycle

```text
new -> contacted -> qualifying -> qualified -> converted
new/contacted/qualifying/qualified -> disqualified | unreachable
unreachable -> contacted
disqualified -> qualifying (reason required)
any live row -> merged only through merge
```

Merged rows are terminal. Conversion requires an existing linked shop.
Disqualification and reopening require a reason. `eligibleForNextPhase` is
derived when a row is shaped for the API: qualified, owned, not merged, and
reachable through at least one channel.

## Authorization

- `manage_all` and `read_all` read all rows with full contact fields.
- `read_assigned` alone restricts SQL queries to the current owner's rows;
  `update_assigned` is additionally required for edit/status operations.
- `read_source_scope` is restricted to `self_signup`, `partner_form`,
  `referral_mention`, `inbound_message`, and `event` rows. It sets contact
  fields, notes, metadata, timeline reasons, and timeline metadata to `null`,
  omits actor name/email attributes, and adds `redacted: true`.
- Roles without a prospect read permission receive `403 GROWTH_OS_FORBIDDEN`.

The repository applies the scope predicate before fetching a row, including
detail and mutation lookups. Linkage suggestions require `manage_all`; `/link`
verifies target existence and writes only prospect pointers. Timeline reads are
bounded and expose page metadata.

## API

All paths are under `/api/internal/growth-os`:

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/prospects` | `read_all` or `read_assigned` or `read_source_scope` |
| POST | `/prospects` | `manage_all` |
| GET | `/prospects/duplicate-check` | any prospect read permission |
| GET | `/prospects/:id` | any prospect read permission |
| PATCH | `/prospects/:id` | `manage_all` or `update_assigned` |
| POST | `/prospects/:id/status` | `manage_all` or `update_assigned` |
| POST | `/prospects/:id/assign` | `manage_all` |
| POST | `/prospects/:id/link` | `manage_all` |
| GET | `/prospects/:id/linkage-suggestions` | `manage_all` |
| POST | `/prospects/:id/merge` | `manage_all` |

Validation is Joi-based and mutations retain the existing CSRF middleware.
Error responses use the existing sanitized `AppError` envelope. Enumeration-
shaped duplicate and linkage lookups use the shared Redis-backed limiter when
available.

## Import

`EasyMod-backend/scripts/import-growth-prospects.js` reads legacy `crm_lead`
audit rows and all `partner_applications`, preserves source references, and
writes an `imported` timeline event. It performs no source-table writes, handles
rows independently, is dry-run by default, and requires `--apply` to persist.
Rerunning the importer is safe through `(source, source_reference)` uniqueness;
merged tombstones do not satisfy the source-reference lookup or unique index.

## Explicit Boundaries

Signup and Partner producers remain untouched. No subscriptions, billing,
customers, shop settings, or merchant automation records are copied or mutated.
Follow-up tasks, activities/notes as a subsystem, outreach, scoring, demos,
trials, activation, and later funnel phases remain out of scope.
