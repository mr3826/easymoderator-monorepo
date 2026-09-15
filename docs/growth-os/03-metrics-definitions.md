# Growth OS metric definitions

Status: Phase 2 analytics contract, 2026-09-15. These definitions separate code-observed behavior from targets and hypotheses. No percentage target in this document is a production fact.

## Observed in the current code path

| Metric/event | Current definition | Evidence status |
| --- | --- | --- |
| Growth activation | A non-merged prospect reaches `converted` while linked to an active merchant/shop. This is the canonical prospect-to-active-merchant/shop outcome. | Observed from the prospect ledger and linked shop state. |
| First successful AI reply | Operational milestone only, recorded separately as `shop.settings.first_ai_reply`; it is never Growth activation. | Observed in code; written with a recoverable Redis claim. |
| Activated shop | A linked prospect satisfying the canonical Growth activation definition. | Derived by Growth workspace analytics; inactive shops and merged tombstones are excluded. |
| Weekly retention | An activated shop with at least one captured order in the current seven-day window. | Observed in code; current report uses two grouped order queries. |
| Funnel events | Public marketing events are limited to `landing_view` and `signup_started`; internal lifecycle milestones require a trusted server producer and are written to `audit_logs` as `resource_type=funnel_event`. | Observed in code; contracts are allowlisted, rate-limited, payload-bound, idempotent, and actor/correlation tagged where available. |

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
- whether first AI reply predicts the canonical prospect-to-active-shop activation outcome.

## Reporting rules

1. Label every dashboard value as observed, target, or hypothesis.
2. A missing producer or failed query is not zero activity.
3. Retention denominators must state the cohort used.
4. Metric definitions and query changes require fixture coverage before they are exposed to Growth users.
5. Imported cohorts use preserved `source_recorded_at`; `created_at` is import arrival time and prospect event `created_at` is event time.
6. Qualification timing, follow-up timing, lost reasons, source-to-activation, and lead-to-activation are reported only from available ledger/event fields; unavailable metrics are returned explicitly, never as zero.
