# Baseline and Candidate Comparison

Both runs executed the same 200 source turns and 20 personas sequentially, with the same dataset SHA-256. Baseline router source: `c8981c4df9ea84d47c35f2541884fd55afd64bae`, engine SHA-256 `edb4f8f1cbcf7c652231de778e4d0d0a8fc96d3286751b34b18d509badf47173`. Candidate router was the V1.1 working-tree file, engine SHA-256 `780bd86ecca3abd3d845c5d7dcba4be8802bc8d64f74092d696c3ee80530fa77`. Both use runner SHA-256 `e83540d19fd5ec8a46304df732a009a58961c6d98a12978a26fb028951f569ee`.

| Measure | Baseline | Candidate |
|---|---:|---:|
| Full turns executed | 200 | 200 |
| Eligible answerable product fact slots | 2 | 2 |
| Correct verified answers | 0/2 | 2/2 |
| Unsupported claims sent | 0 | 0 |
| Unnecessary refusals on eligible slots | 0 | 0 |
| Safe fallbacks | 59 | 61 |
| Targeted synthetic fact accuracy | 5/8 (62.5%) | 8/8 (100%) |
| Tenant isolation and presentation contract | Pass | Pass |

The targeted evaluation improved by **3/8 fact slots (+37.5 percentage points)**. In the full source replay, the narrow eligible denominator improved from 0/2 to 2/2. The 198 other turns were not answerable from the offline synthetic authority; safe fallbacks are reported separately and are not scored as correct product answers.

Full receipts: baseline `0d313a7a-3c41-42a1-a7bc-8dfb888c15d2.json`; candidate `a1c3fbd4-76a7-4e97-878b-e328fd5a11c0.json`. The comparison pins distinct baseline and candidate engine hashes while holding the dataset and runner hashes constant. No real provider, vision, or Meta calls were made; response text was scored in memory and omitted from the saved receipts.
