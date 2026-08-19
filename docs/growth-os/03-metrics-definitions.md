# Growth OS metric definitions

Status: Phase 1 working contract, 2026-08-05. These definitions separate code-observed behavior from targets and hypotheses. No percentage target in this document is a production fact.

## Observed in the current code path

| Metric/event | Current definition | Evidence status |
| --- | --- | --- |
| Activation | First successful AI reply records `shop.settings.activation.activated_at` and the first conversation ID. | Observed in code; now written with a recoverable Redis claim. |
| Activated shop | A shop with a non-empty `activation.activated_at`. | Observed in code; must be reconciled with product analytics before external reporting. |
| Weekly retention | An activated shop with at least one captured order in the current seven-day window. | Observed in code; current report uses two grouped order queries. |
| Funnel events | Current first-party events written to `audit_logs` as `resource_type=funnel_event`. | Observed in code; ingestion is schema-validated, Redis-backed when deployed, payload/tenant-bound and server-idempotent, and browser retries are marked only after acceptance. |

## Events excluded from the current contract

`assistant_test_passed` and `trial_day_7_active` are intentionally not accepted
until their first-party producers and fixture coverage exist. An allowlist entry
without a producer would create an event that looks measurable while remaining
unverifiable.

## Targets

No approved Growth OS target values were found in the current codebase or evidence bundle. Any activation, retention, conversion, response-time, or SLA target must be supplied and approved separately before it is used as a dashboard benchmark.

## Hypotheses

The following remain hypotheses until source records and a date range support them:

- which acquisition source produces the highest qualified-prospect rate;
- which follow-up cadence improves demo-to-trial conversion;
- which activation signal predicts weekly retention;
- whether first AI reply is sufficient as the operational activation definition.

## Reporting rules

1. Label every dashboard value as observed, target, or hypothesis.
2. A missing producer or failed query is not zero activity.
3. Retention denominators must state the cohort used.
4. Metric definitions and query changes require fixture coverage before they are exposed to Growth users.
