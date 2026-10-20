# Cost and Customer Value

## Measured local performance

The paired full-run performance sample covers 200 in-process intent-router calls with controlled mock adapters. It excludes network, provider, database, and Messenger latency.

| Metric | Baseline | Candidate |
|---|---:|---:|
| p50 | 0.781 ms | 0.939 ms |
| p95 | 1.497 ms | 1.872 ms |
| Mean | 1.081 ms | 1.264 ms |
| Mock model calls | 63 | 62 |
| Real provider usage records | 0 | 0 |
| Measured provider cost | Not measured | Not measured |

The candidate's measured p50/p95 rose by 0.158/0.375 ms in this small local in-process sample (mean +0.183 ms). This is not a production latency benchmark. The run recorded `costUsd:null` with status `NOT_MEASURED_NO_REAL_PROVIDER_CALLS`; dollar cost was not estimated from mock calls. No provider charges were incurred by the replay.

## Customer-value evidence

On the fixed synthetic evaluation, the candidate correctly grounded 8/8 eligible fact slots versus 5/8 for baseline. In the supplied CSV, it correctly answered 2/2 independently answerable product fact slots versus 0/2 for baseline. Both runs sent zero unsupported claims; the candidate made zero unnecessary refusals on eligible slots. These narrow denominators do not estimate conversion, customer satisfaction, sales lift, or value across the 118 unresolved identity turns and 20 image-dependent turns.

The Lab cost view explicitly distinguishes mock usage from paid provider usage and displays unavailable values when they were not measured. Real token usage, provider price, end-to-end latency, and merchant ROI remain unmeasured.
