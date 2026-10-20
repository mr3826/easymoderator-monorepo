# V1 Evidence Verification

## Revisions and inputs

- V1.1 worktree: `D:\easymod\_wt-product-engine-v1-1`, branch `feature/ai-product-experience-v1.1`.
- V1.1 baseline used by the Lab: `c8981c4df9ea84d47c35f2541884fd55afd64bae`.
- Earlier V1 implementation commit: `c8981c4df9ea84d47c35f2541884fd55afd64bae`; its parent is the reported V1 starting baseline `07168f49066e4dc4a8e2a756621ac577a13c12bd`.
- Dataset: 200 source turns across 20 personas, SHA-256 `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`.
- The V1 reports were checked against the repository history and original artifacts during baseline review. No claim in this report uses a CSV suggested answer as factual evidence.

## Evidence produced

- Full candidate replay: `a1c3fbd4-76a7-4e97-878b-e328fd5a11c0.json`.
- Full baseline replay: `0d313a7a-3c41-42a1-a7bc-8dfb888c15d2.json`.
- Final independently reproduced integration receipt: `7464d6e3-713b-41e2-8516-ce5a93cdc9ab.json`; the preceding reviewer receipt `f9bd5277-be6f-437d-8fd1-e23f3ab7fdf9.json` is preserved as a suite-level failure despite all 12 assertions passing.
- Browser execution receipt: `artifacts/playwright/execution.json`.
- Playwright HTML report: `artifacts/playwright/html-report/index.html`.
- Captured startup, Scenario Explorer, and Conversation Replay screenshots: `artifacts/playwright/screenshots/`.
- Playwright trace archives: `artifacts/playwright/test-results/`.

Each full replay records all 200 turns, 20 personas, the unchanged dataset-wide SHA-256, sequential per-persona execution, and `rawSourceMessagesPersisted:false`. Free-text responses are scored in memory; persisted turns keep structured outcomes and `responseTextStored:false`, with no response preview or unsalted response digest. The public index and saved artifacts omit raw customer messages, suggested answers, per-row unsalted hashes, and free-text responses. API and export tests assert those boundaries; the independent review and recursive artifact scan verified the regenerated receipts before the local commit.

## Verification limits

The replay's `sourceRevision` points to the baseline commit because the candidate was run from the uncommitted V1.1 worktree. The two engine source hashes distinguish the baseline router (`edb4f8f1cbcf7c652231de778e4d0d0a8fc96d3286751b34b18d509badf47173`) from the candidate router (`780bd86ecca3abd3d845c5d7dcba4be8802bc8d64f74092d696c3ee80530fa77`). The runner hash is the same for the paired runs: `e83540d19fd5ec8a46304df732a009a58961c6d98a12978a26fb028951f569ee`.

The `.nvmrc` specifies Node 20. The available local runtime used for these runs was Node `v24.19.0`; a Node 20 binary was unavailable. The reports therefore do not claim runtime-version parity with Node 20.
