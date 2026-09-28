# Pilot Intelligence

This covers Customer 360 Lite with Sales Opportunities, and RTO Shield v2 /
Order Confidence.

It is a per-shop pilot, controlled by the platform. Every shop is off by
default.

| Document | Purpose |
| --- | --- |
| [00-current-state.md](00-current-state.md) | Discovery record before implementation, with evidence |
| [01-plan.md](01-plan.md) | Implementation plan, architecture challenge, pre-mortem and acceptance criteria |
| [02-product.md](02-product.md) | What merchants see and do; states, reasons, limitations |
| [03-architecture.md](03-architecture.md) | Components, entity relationships, flows, lifecycles, booking boundary, failure behaviour, scale |
| [04-api.md](04-api.md) | API contracts (OpenAPI: `EasyMod-backend/openapi.yaml`) |
| [05-data-model-and-migrations.md](05-data-model-and-migrations.md) | Schema, indexes, migration, compatibility, rollback |
| [06-security-and-privacy.md](06-security-and-privacy.md) | Threat model, tenancy, RBAC, PII, audit, Meta policy |
| [07-operations-runbook.md](07-operations-runbook.md) | Enable, disable, signals, alerts, troubleshooting |
| [08-test-evidence.md](08-test-evidence.md) | What was run, the results, and known limitations |

## Decisions

| ADR | Decision |
| --- | --- |
| [ADR-0005](../adr/0005-customer-identity-and-computed-state.md) | Customer identity and computed state |
| [ADR-0006](../adr/0006-opportunity-detection-sweep.md) | Opportunity detection sweep |
| [ADR-0007](../adr/0007-order-confidence-gate-at-booking-boundary.md) | Order confidence gate at the booking boundary |
| [ADR-0008](../adr/0008-manual-follow-up-only.md) | Manual follow-up only |
| [ADR-0009](../adr/0009-pilot-feature-flags-table.md) | Pilot feature flags table |
| [ADR-0010](../adr/0010-order-confidence-concurrency.md) | Order confidence concurrency |
