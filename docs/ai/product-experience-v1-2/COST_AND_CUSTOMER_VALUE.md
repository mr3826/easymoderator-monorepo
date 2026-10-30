# Cost and Customer Value

## Measured cost

- Final bounded Gemini run: `$0.01465225` provider-reported and committed for 68 requests, under its `$0.65` per-run ceiling.
- Across 15 completed receipts: 1,018 requests; `$0.22598950` provider-reported and `$0.23143875` committed.
- Conservative task-series exposure including a prior interrupted-run upper bound and authorization check: `$2.33973275`, under the authorized `$10` limit.
- The cumulative figure is manually reconciled. The runtime controller enforces per-run reservations and a per-run cap, not a persistent cumulative `$10` ledger.
- No additional paid call was made during the final QA/documentation pass.

## Latency scope

Final run mixed-route latency was p50 `1.93 ms`, p95 `5,370.795 ms`, mean `1,585.979 ms`; provider latency p50 was `1,192 ms`, p95 `3,455 ms`. These are in-process replay measurements, not full webhook-to-send or customer-perceived latency. Mock baseline/candidate timings are not provider timings.

## Customer value

Four of 200 source turns were eligible and answerable product questions; all four were correct. Cost per resolved inquiry cannot be stated defensibly because the 68 calls and aggregate spend include the full mixed-route run and only four labeled answerable product turns. No merchant workflow study, conversion measurement, time saved, or ROI calculation was performed. No claim of commercial defensibility is made.
