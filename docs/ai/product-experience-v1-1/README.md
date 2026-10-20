# Product Engine V1.1 Local Test Lab

This folder contains the V1.1 implementation plan, verification reports, and redacted local QA artifacts. The Lab runs only on loopback and uses synthetic tenant catalogs plus controlled mock collaborators. Its output does not establish live merchant catalog accuracy, provider quality, vision quality, or Messenger delivery.

## Start the local Lab

From `EasyMod-backend`, run:

```powershell
node scripts/product-experience/lab-server.js
```

The server chooses an available loopback port and prints the URL. Set `LAB_PORT` only when a fixed port is needed. The supplied simulator CSV is read from the workspace root; scenario APIs return sanitized metadata instead of raw source messages or per-row message hashes. Replay responses are scored in memory and omitted from persisted receipts and exports; the dataset-wide SHA-256 remains as an integrity check. Do not expose the local server outside this machine.

The V1.1 Lab is left available at `http://127.0.0.1:7822` after final local verification. It reports ready with 20 personas and 200 scenarios. The port is local to this session and may change after a restart.

## Reproduce local QA

From `EasyMod-backend`, with repository dependencies installed:

```powershell
node node_modules/jest/bin/jest.js scripts/product-experience/lab-contracts.test.js scripts/product-experience/lab-security.test.js scripts/product-experience/lab-server.test.js scripts/product-experience/no-egress.test.js scripts/product-experience/lab-process.test.js src/modules/ai/__tests__/intent-router.test.js src/modules/ai/grounding/__tests__/product-evidence-hardening.test.js src/modules/ai/grounding/__tests__/product-presentation.contract.test.js --runInBand --coverage=false
node node_modules/jest/bin/jest.js scripts/product-experience/lab-replay.test.js --runInBand --coverage=false
node --require ./scripts/product-experience/no-egress.js node_modules/jest/bin/jest.js --coverage=false --forceExit --detectOpenHandles --runInBand --silent
node scripts/product-experience/run-lab-playwright.js
node scripts/product-experience/run-integration.js
python scripts/product-experience/scan-artifact-privacy.py
```

The full Jest suite expects the configured Redis endpoint to be reachable. Final verification used disposable Redis 7 at `127.0.0.1:6379` and Node `v24.19.0`; the task-owned container and its anonymous data volume were removed after verification. The full suite passed 282 suites / 3,614 tests. An initial attempt without the expected Redis service timed out; the subsequent isolated run passed.

The Playwright runner starts and stops its own Lab server. It uses Chromium when installed and reports unavailable browser engines. The integration runner creates a uniquely named disposable Postgres/Redis Compose project, runs migrations and selected real-stack Jest suites, then removes only its own project.

The repository specifies Node 20 in `.nvmrc`. Node 20 was unavailable on this host; final backend Jest, integration, and Playwright runs used Node `v24.19.0`. The reports do not claim Node 20 version parity.

## Reports and evidence

- [Automated QA final verdict](AUTOMATED_QA_FINAL_VERDICT.md)
- [Dataset oracle and coverage](DATASET_ORACLE_AND_COVERAGE.md)
- [Baseline and candidate comparison](BASELINE_CANDIDATE_COMPARISON.md)
- [Cost and customer value](COST_AND_CUSTOMER_VALUE.md)
- [Playwright E2E report](PLAYWRIGHT_E2E_REPORT.md)
- [Local integration results](LOCAL_INTEGRATION_RESULTS.md)
- [Independent final review](INDEPENDENT_FINAL_REVIEW.md)
- [Real model and vision results](REAL_MODEL_AND_VISION_RESULTS.md)
- [Security and shared-worker review](SECURITY_AND_SHARED_WORKER_REVIEW.md)
- Machine-readable gates and hashes: `artifacts/final-qa/`
- Browser report, screenshots, traces, exports, replay receipts, and integration receipts: `artifacts/`

The input CSV SHA-256 is `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`. No report treats its suggested answers as catalog truth. Real provider, real vision, and real Meta tests are explicitly `NOT_RUN`; production release is not authorized.
