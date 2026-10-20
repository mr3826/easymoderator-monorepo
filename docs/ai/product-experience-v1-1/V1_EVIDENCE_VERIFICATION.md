# V1 Evidence Verification

## Revisions and inputs

- V1.1 worktree: `D:\easymod\_wt-product-engine-v1-1`, branch `feature/ai-product-experience-v1.1`.
- V1.1 baseline router commit: `c8981c4df9ea84d47c35f2541884fd55afd64bae`; its parent is the reported V1 starting baseline `07168f49066e4dc4a8e2a756621ac577a13c12bd`.
- Dataset: 200 source turns across 20 personas; SHA-256 `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`.
- The V1 reports were checked against repository history and original artifacts during baseline review. No claim uses a CSV suggested answer as factual evidence.

## Final evidence

- Latest independently verified full candidate replay: `artifacts/runs/9fe42774-0577-4568-9a4e-ab9cf14129da.json`.
- Latest independently verified full baseline replay: `artifacts/runs/a785b54c-8f0c-4856-8f78-812ef69a137d.json`.
- Candidate backend `src/` SHA-256: `422d20f15cba2128e3fed628caafce6ac24ced803a76147f6830eb1622e66914`.
- Baseline effective backend `src/` SHA-256: `6bc6dfd460faa28841b0419a2daa822a263f13704fde4b3d269c492593354cb8`, computed with V1 router bytes pinned from the baseline commit and all other shared source files from the V1.1 worktree. The comparison scope is detailed in [Baseline and Candidate Comparison](BASELINE_CANDIDATE_COMPARISON.md).
- Both latest runs use the same runner SHA-256 `f587f0301cd474b1f4ff85a2dc022b77c953ead811f6aa44bab0a0a1d0a2a452` and dataset SHA. The candidate records source revision `1be73a59971d6d66b59ef631ee82cef0636fcf72`; baseline uses the pinned V1 router revision.
- Full backend Jest receipt: `artifacts/unit-regression/4cea78a0-0274-4da5-aa6a-8745fd9703bd.receipt.json`, 282 suites / 3,614 tests, Node v24.19.0 and disposable Redis, at source revision `bb5f2dcc63a7fc4e00559b8abba6a351802a2d27`.
- Final independently rerun disposable-stack integration receipt: `artifacts/integration/191422c9-ee09-41d4-96da-a78f3433335a.json`; it records 3 suites / 12 selected integration tests and 1 suite / 46 webhook-pipeline tests, with cleanup exit code 0 and source revision `bb5f2dcc63a7fc4e00559b8abba6a351802a2d27`.
- Browser execution receipt: `artifacts/playwright/execution.json`, run `73e7f36e-86c4-4c80-b6bb-12be77caea3a`, source revision `1be73a59971d6d66b59ef631ee82cef0636fcf72`, 4 passed / 2 skipped / 0 failed across installed Chromium, Firefox, and WebKit. Axe scanned all 9 Lab sections with 0 violations. HTML report, screenshots, traces, and the run-scoped axe report are under `artifacts/playwright/`.
- Final privacy scan: `artifacts/final-qa/privacy-scan.json`.

Each full replay records 200 turns, 20 personas, the unchanged dataset-wide SHA-256, sequential per-persona execution, and `rawSourceMessagesPersisted:false`. Free-text responses are scored in memory; persisted turns keep structured outcomes and `responseTextStored:false`, with no response preview or unsalted response digest. The Lab dataset API and saved artifacts omit raw customer messages, suggested answers, and per-row unsalted hashes. API/export tests and the recursive scan cover these boundaries.

## Verification limits

Replay receipts record their own source revisions. The final candidate replay is on `1be73a59971d6d66b59ef631ee82cef0636fcf72`; its `engineSourceSha256` hashes every regular file in backend `src/`, sorted by relative path and delimited before hashing. The baseline hash substitutes the pinned V1 router bytes; this captures the effective engine code while making the comparison scope explicit. The later local commit contains only QA report provenance handling and does not modify backend `src/`.

The `.nvmrc` specifies Node 20. Node 20 was unavailable on this host, so final backend Jest, integration, and Playwright runs used Node `v24.19.0`. The reports do not claim Node 20 runtime parity.
