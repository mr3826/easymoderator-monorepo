# Baseline and Candidate Comparison

The comparison used controlled mock adapters, not Gemini. Both runs used the same simulator CSV SHA-256 `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6` and 200-turn input.

| Metric | Baseline `d31c486f-47b5-4cbc-abe3-d8969cac905e` | Candidate `e9f1b90e-1036-40ed-bae0-54361382cfe7` | Conclusion |
|---|---:|---:|---|
| Turns | 200 | 200 | Same source dataset. |
| Answerable turns | 4 | 3 | Different denominators. |
| Correct eligible turns | 3/4 | 3/3 | Do not compare as a delta. |
| Correct fact slots | 3/4 | 3/3 | Do not claim improvement. |
| Provider calls | 0 | 0 | Both are mock runs. |
| Provider cost | `$0` | `$0` | Real Gemini evidence is separate. |

Latency in the mock route comparison was p50 0.705 ms baseline versus 0.631 ms candidate and p95 1.385 ms versus 1.330 ms. These small in-process mock timings do not establish real-provider or end-to-end latency improvement. No provider-matched baseline run was performed.
