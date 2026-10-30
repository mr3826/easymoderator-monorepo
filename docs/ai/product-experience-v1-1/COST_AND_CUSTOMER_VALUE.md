# Cost and Customer Value

## Measured local performance

The latest paired sample covers 200 in-process intent-router calls with controlled mock collaborators. It excludes network, real provider, database, and Messenger latency.

| Metric | Baseline | Candidate | Change |
|---|---:|---:|---:|
| p50 | 0.751 ms | 0.911 ms | +0.160 ms |
| p95 | 1.546 ms | 1.988 ms | +0.442 ms |
| Mean | 1.059 ms | 1.390 ms | +0.331 ms |
| Mock model calls | 63 | 62 | -1 |
| Real provider usage records | 0 | 0 | 0 |
| Measured provider cost | Not measured | Not measured | — |

These are small local in-process measurements, not production latency benchmarks. This paired run is slower on the candidate path; the sample is controlled-mock router timing and does not include external I/O. Each receipt records `costUsd:null` with `NOT_MEASURED_NO_REAL_PROVIDER_CALLS`; cost was not inferred from mock calls, and no provider charges were incurred by these replays.

## Customer-value evidence

On the fixed synthetic evaluation, the candidate grounded 8/8 eligible fact slots versus 5/8 for baseline. In the supplied CSV, it correctly answered 2/2 independently answerable product fact slots versus 0/2 for baseline. Both runs sent zero unsupported claims, and the candidate made zero unnecessary refusals on eligible slots. These narrow denominators do not estimate conversion, customer satisfaction, sales lift, or value across the 118 unresolved identity turns and 20 image-dependent turns.

The Lab cost view distinguishes mock usage from paid provider usage and shows unavailable values where they were not measured. Real token usage, provider pricing, end-to-end latency, and merchant ROI remain unmeasured.
