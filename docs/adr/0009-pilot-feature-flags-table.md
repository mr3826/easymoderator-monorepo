# ADR-0009: Pilot Feature Flags Live in a Platform-Controlled Table

Status: Accepted
Date: 2026-09-27
Owners: Engineering

## Context

The pilot must be enabled per shop, by the platform, with an instant rollback.
The repository has no flag system; the existing patterns are:

- **Env booleans** in `config.js`, rendered into production from an allowlist
  (`render-production-env.js`). They are global, and a change needs a
  redeploy.
- **`shops.settings` JSON.** Any active shop member, including staff, can patch
  it through `PATCH /api/shop/:id`, and `mergeAndSanitizeSettings` keeps every
  key already present. A flag stored there could be self-enabled or, worse,
  self-disabled to bypass enforcement.

## Decision

Use a new table, `shop_pilot_features`:

- `customer_intelligence` BOOLEAN;
- `order_confidence_mode` in `off`, `shadow`, `enforce`;
- `order_confidence_config` JSONB, holding sanitised thresholds.

Writes go only through SUPER_ADMIN admin endpoints and are audited in the same
transaction:

- `PATCH /api/admin/shops/:shopId/pilot-features`;
- `POST /api/admin/pilot-features/disable-all`, the global kill switch.

A missing row, or a failed flag lookup, reads as **all off**, which is exactly
the pre-pilot behaviour. The flag read is never the reason an order cannot
book.

## Alternatives rejected

- **`shops.settings.pilot_features`.** It is merchant-writable (see above).
- **Env flags.** They are global only, need a redeploy through the renderer,
  and cannot target pilot merchants.
- **A generic feature-flag service or table.** More than the pilot needs. This
  table is narrow and typed.

## Consequences

- Operators get a per-shop toggle, trial mode, and a global kill switch without
  a deploy.
- Merchant-tunable thresholds are platform-set during the pilot, and can move
  to a merchant setting with its own authorization after the pilot.
