# Baseline and Candidate Comparison

Both latest independently verified full runs executed the same 200 source turns across 20 personas, sequentially within personas, using dataset SHA-256 `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`. Candidate receipt: `artifacts/runs/9fe42774-0577-4568-9a4e-ab9cf14129da.json`; baseline receipt: `artifacts/runs/a785b54c-8f0c-4856-8f78-812ef69a137d.json`. The shared runner SHA-256 is `f587f0301cd474b1f4ff85a2dc022b77c953ead811f6aa44bab0a0a1d0a2a452`.

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

The fixed synthetic evaluation improved by 3/8 fact slots (+37.5 percentage points). In the full source replay, the narrow answerable denominator improved from 0/2 to 2/2. The remaining 198 turns were not answerable from the offline synthetic authority and are not counted as correct product answers.

## Source provenance and comparison scope

The candidate run reports Git revision `ef91596301530797860738af939bd07825ef3a10` and backend source-tree SHA-256 `422d20f15cba2128e3fed628caafce6ac24ced803a76147f6830eb1622e66914`. The baseline pins V1 router bytes from commit `c8981c4df9ea84d47c35f2541884fd55afd64bae` and uses the shared backend `src/` files from the V1.1 worktree, hashing the tree with those pinned router bytes substituted; its effective SHA-256 is `6bc6dfd460faa28841b0419a2daa822a263f13704fde4b3d269c492593354cb8`. This is a controlled router comparison with common current source, not a checkout-wide execution of the historical baseline commit. The receipts record the pinned revision plus the composite source hash.

No real provider, vision, or Meta calls were made. Replay response text was scored in memory and omitted from saved receipts. The two-slot CSV denominator and eight-slot synthetic denominator do not estimate broad product quality.
