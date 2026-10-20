# Product Engine V1.1 Local Test Lab

This folder contains the V1.1 implementation plan, verification reports, and redacted local QA artifacts. The lab runs only on loopback and uses synthetic tenant catalogs plus a controlled mock provider. Its output is not proof of live merchant catalog accuracy, provider quality, vision quality, or Messenger delivery.

## Start the local lab

From `EasyMod-backend`, run:

```powershell
node scripts/product-experience/lab-server.js
```

The server chooses an available loopback port and prints the URL. Set `LAB_PORT` only when a fixed port is needed. The supplied simulator CSV is read from the workspace root; scenario APIs return sanitized metadata rather than raw source messages or per-row message hashes. Replay responses are scored in memory and omitted from persisted receipts and exports; the dataset-wide SHA-256 remains as the integrity check. Do not expose the local server outside the machine.

## Reproduce the local QA runs

From `EasyMod-backend`, with the repository's dependencies installed:

```powershell
node node_modules/jest/bin/jest.js scripts/product-experience/lab-contracts.test.js scripts/product-experience/lab-security.test.js scripts/product-experience/lab-server.test.js scripts/product-experience/no-egress.test.js scripts/product-experience/lab-process.test.js src/modules/ai/__tests__/intent-router.test.js src/modules/ai/grounding/__tests__/product-evidence-hardening.test.js src/modules/ai/grounding/__tests__/product-presentation.contract.test.js --runInBand --coverage=false
node node_modules/jest/bin/jest.js scripts/product-experience/lab-replay.test.js --runInBand --coverage=false
node scripts/product-experience/run-lab-playwright.js
node scripts/product-experience/run-integration.js
```

The Playwright runner starts and stops its own Lab server. It uses Chromium when installed and reports browser engines that are unavailable. The integration runner creates a uniquely named disposable Postgres/Redis Compose project, runs actual migrations and the selected real-stack Jest suites, then removes only its own project.

The repository specifies Node 20 in `.nvmrc`. The completed runs used the available Node `v24.19.0` runtime because a Node 20 binary was unavailable; repeat them under Node 20 before treating version parity as verified.

## Reports and evidence

- [Automated QA final verdict](AUTOMATED_QA_FINAL_VERDICT.md)
- [Dataset oracle and coverage](DATASET_ORACLE_AND_COVERAGE.md)
- [Baseline and candidate comparison](BASELINE_CANDIDATE_COMPARISON.md)
- [Playwright E2E report](PLAYWRIGHT_E2E_REPORT.md)
- [Local integration results](LOCAL_INTEGRATION_RESULTS.md)
- [Real model and vision results](REAL_MODEL_AND_VISION_RESULTS.md)
- [Security and shared-worker review](SECURITY_AND_SHARED_WORKER_REVIEW.md)
- Machine-readable gates and hashes: `artifacts/final-qa/`
- Browser report, screenshots, traces, exports, replay receipts, and integration receipts: `artifacts/`

The input CSV SHA-256 is `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`. No report treats the CSV's suggested answers as catalog truth. Real provider, real vision, and real Meta tests are explicitly `NOT_RUN`; production release is not authorized.
