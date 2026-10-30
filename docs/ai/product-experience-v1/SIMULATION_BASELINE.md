# Simulation baseline

## Before implementation

At baseline SHA `07168f49066e4dc4a8e2a756621ac577a13c12bd`, the direct resolver pass over the 200 simulator messages and tenant-separated synthetic catalog produced:

| Evidence status | Turns |
| --- | ---: |
| `NOT_FOUND` | 193 |
| `NONE` | 6 |
| `VERIFIED` | 1 |

Related candidates appeared on 48 turns. All 6 `NONE` outcomes had no identifying terms. Four critical baseline suites passed 126 tests. The replay did not call a model or mutate a database; it did not evaluate expected answers as truth.

## After implementation

| Replay | Coverage | Main result |
| --- | --- | --- |
| Deterministic contract replay | 200 turns per pass; two identical passes | 193 `NOT_FOUND`, 6 `NONE`, 1 `VERIFIED`; 200 valid presentation contracts; 200 written candidates accepted by the gate. |
| Production route-code replay with local collaborators | 200 sequential turns per pass; two identical traces | 139 `grounding_not_found`, 60 `llm`, 1 `grounding_product_presentation`; 140 `SEND`, 60 `SAFE_FALLBACK`. All 60 deliberately unsupported fake model candidates were blocked; none were accepted by the gate. |

The route replay confirms that the current synthetic catalog still verifies only one of the dataset turns. That is a limitation of the intentionally small fixture set and the expected-message/catalog mismatch; it is not evidence of broad retrieval accuracy. See `artifacts/production-router-replay.json` (local evidence artifact; not committed) for the sanitized trace.

Both replays are deterministic under the fixed fixtures. Neither uses the message worker, a real database, a real provider, actual source images, or Messenger delivery. Do not interpret local latency or zero harness spend as production latency or operating cost.
