# V1 Evidence Verification

## Revisions and inputs

- V1.1 worktree: `D:\easymod\_wt-product-engine-v1-1`, branch `feature/ai-product-experience-v1.1`.
- V1.1 baseline router commit: `c8981c4df9ea84d47c35f2541884fd55afd64bae`; its parent is the reported V1 starting baseline `07168f49066e4dc4a8e2a756621ac577a13c12bd`.
- Dataset: 200 source turns across 20 personas; SHA-256 `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`.
- The V1 reports were checked against repository history and original artifacts during baseline review. No claim uses a CSV suggested answer as factual evidence.

## Final evidence

- Full candidate replay: `artifacts/runs/ba2632ad-07f2-4899-bfbd-23c9c0f1629c.json`.
- Full baseline replay: `artifacts/runs/8bd67fb2-e29c-48b6-a6f0-6e4028ef7a9c.json`.
- Candidate backend `src/` SHA-256: `422d20f15cba2128e3fed628caafce6ac24ced803a76147f6830eb1622e66914`.
- Baseline effective backend `src/` SHA-256: `6bc6dfd460faa28841b0419a2daa822a263f13704fde4b3d269c492593354cb8`, computed with V1 router bytes pinned from the baseline commit and all other shared source files from the V1.1 worktree. The comparison scope is detailed in [Baseline and Candidate Comparison](BASELINE_CANDIDATE_COMPARISON.md).
- Both runs use runner SHA-256 `f587f0301cd474b1f4ff85a2dc022b77c953ead811f6aa44bab0a0a1d0a2a452` and the same dataset SHA.
- Final independently rerun disposable-stack integration receipt: `artifacts/integration/2f3cf498-9164-46b9-8323-0c6208711213.json`; it records 3 suites / 12 selected integration tests and 1 suite / 45 webhook-pipeline tests, with cleanup exit code 0.
- Browser execution receipt: `artifacts/playwright/execution.json`; HTML report, screenshots, and traces are under `artifacts/playwright/`.
- Final privacy scan: `artifacts/final-qa/privacy-scan.json`.

Each full replay records 200 turns, 20 personas, the unchanged dataset-wide SHA-256, sequential per-persona execution, and `rawSourceMessagesPersisted:false`. Free-text responses are scored in memory; persisted turns keep structured outcomes and `responseTextStored:false`, with no response preview or unsalted response digest. The Lab dataset API and saved artifacts omit raw customer messages, suggested answers, and per-row unsalted hashes. API/export tests and the recursive scan cover these boundaries.

## Verification limits

Replay receipts report source revisions from before the final local commit; their `engineSourceSha256` values hash every regular file in backend `src/`, sorted by relative path and delimited before hashing. The baseline hash substitutes the pinned V1 router bytes; this captures the effective engine code while making the comparison scope explicit.

The `.nvmrc` specifies Node 20. Node 20 was unavailable on this host, so final backend Jest, integration, and Playwright runs used Node `v24.19.0`. The reports do not claim Node 20 runtime parity.
