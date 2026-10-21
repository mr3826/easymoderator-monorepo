# Verified Commerce Foundation V1.2 — Local Proof

**Result:** Implemented and verified locally on `feature/verified-commerce-foundation-v1.2`, based on `78b6250af40039749f9c096cd3e0debe2e6cf6a7`. This evidence does not authorize production use or release.

## Product behavior delivered

- Product identity, price, stock, variants, and media are grounded in tenant-scoped catalog evidence. Missing or ambiguous facts remain unknown.
- Image interpretation supplies retrieval hints only. The verified catalog and outbound grounding gate remain authoritative for customer-facing claims.
- The deterministic Messenger presenter checks final text and image ownership before a send. The real Gemini replay itself performed zero database mutations and zero Messenger sends.
- The local Test Lab separates real provider measurements from mocked route comparisons and synthetic catalog/vision fixtures.

## Real Gemini evaluation

Receipt `artifacts/runs/471add4a-f2c5-44c8-8a9f-2e156a731a10.json` records a completed run against all 200 CSV turns from 20 personas. All 200 route turns executed and all 200 presentation contracts passed. The router made 64 text requests and 4 separate synthetic-raster vision requests, for 68 total requests. All four vision cases passed response-schema, category, and color checks. No customer photos were used.

The labeled denominator is small: 4 of 200 turns were answerable product turns, and all 4 were correct; 5 eligible product fact slots were scored and all 5 were correct. There were zero unnecessary refusals for these eligible slots. This does not establish broad answer quality or merchant ROI. The semantic target evaluator and a scored context-retention metric were not run. The `unsupportedClaimsSent` metric detects numeric currency-marked price claims (`৳` or `$`) only; broad semantic unsupported-claim rate remains unmeasured. The baseline/candidate route comparison is mocked and does not prove a real-provider improvement.

The run used `gemini-3.1-flash-lite`, with provider-reported and committed spend of **$0.01465225** against a **$0.65 per-run** ceiling. It completed without provider errors or retries. Historical run `e1385091-72ea-4e3c-9acd-8798525ff136` had one transport failure and routed 199 of 200 turns; it is included in cumulative accounting, not treated as the final result.

The latest shell had no `EM-GEMINI-KEY` in Windows User scope. The host had already injected the variable into Process scope, and the successful paid run used that inherited process value. The credential was not printed, copied into User scope, or saved in an artifact. A fresh User-scope-only replay was therefore unavailable in this shell.

Across 15 completed real-Gemini receipts, recorded committed spend is **$0.23143875** (1,018 requests; $0.22598950 provider-reported). Including the previously recorded $2.108288 interrupted-run upper bound and $0.000006 authorization check gives a conservative task-series exposure of **$2.33973275**. This is manual cumulative accounting: the code enforces the per-run ceiling, not a persistent $10 ceiling across repeated runs.

## Integration and browser evidence

- Focused implementation suites: 237 tests passed. Offline provider/product suites: 129 passed. Security suite: 799 passed across 58 suites. The no-egress suite passed 6 tests, and the privacy scanner unit suite passed 7 tests.
- Integration receipt `artifacts/integration/e4008ad7-468b-4a4f-9e09-fdd55a7494a1.json` passed 12 selected integration tests plus 46 webhook pipeline tests. It used ephemeral PostgreSQL/Redis, disabled external providers, and recorded zero blocked non-loopback attempts.
- Playwright receipt `artifacts/playwright/execution.json` passed 6 of 6 tests across Chromium, Firefox, and WebKit. All six browser observations recorded zero page errors, console errors, and failed requests. Axe reported zero critical/serious violations across nine sections in each browser.
- The browser receipt shares the current engine, runner, and dataset hashes, but its `candidateRunId` (`83871a37-aefa-4366-9c22-ea4bac645e77`) is a separate candidate-mode run with no provider calls. It is not a replay of real-Gemini run `471add4a-f2c5-44c8-8a9f-2e156a731a10`.
- Saved screenshots for all three browsers were visually inspected. They show the input, model candidate, and validated reply under redaction labels; the candidate contains an unsupported price claim and the validated reply refuses to repeat it. Raw Playwright trace ZIPs were excluded from the evidence package after the privacy scan found simulator text in their internals. Raster artifacts were not OCR-scanned.
- The WebKit CSP exception is limited to the exact Playwright screenshotter no-op style hash; `unsafe-inline` remains disabled.

## Privacy and provenance

The simulator CSV remained read-only with SHA-256 `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`. The final scanner report is `artifacts/final-qa/privacy-scan.json`; its gate passed with zero parse errors, denied keys, unsafe exact-source matches, source-contact sequences, or unclassified heuristic matches. Approved exact matches remain only in redacted input fields and redacted transcript customer lines. Raw Playwright trace ZIPs were removed from the evidence package after inspection confirmed they retained simulator text; sanitized browser observations and screenshots remain. The report lists raster artifacts that were not OCR-scanned.

Five older redacted transcript files and three older run receipts were sanitized after evaluation because a source contact sequence had survived in those historical outputs. The affected output text now carries redaction markers. Provider usage, routing outcomes, scores, and run-level costs were not changed; the receipts record that post-run sanitization. The current successful receipt had no such contact-pattern match.

- Engine SHA-256: `d88b51e3f151648443a2993c90d1e8282799d7e2fd559640fa86db3a4d727ae9`
- Runner SHA-256: `3e128d58b3ea2e241fd757410f62b6aaaa109035e00e335727976645b70c5fca`

## Evidence index

- Real-provider run, budget ledger, and redacted transcript: `artifacts/runs/471add4a-f2c5-44c8-8a9f-2e156a731a10.json` and sibling files.
- Browser observations, accessibility reports, and screenshots: `artifacts/playwright/`. Raw trace ZIPs are excluded for privacy.
- Ephemeral integration receipt and log: `artifacts/integration/e4008ad7-468b-4a4f-9e09-fdd55a7494a1.json` and `.log`.
- Privacy report and SHA-256 manifest: `artifacts/final-qa/privacy-scan.json` and `artifacts/final-qa/SHA256SUMS.txt`.
- Synthetic vision fixture provenance: `artifacts/triage/SYNTHETIC_MEDIA_PROVENANCE.json`.

The V1.1 production-router replay artifact was left unchanged. No production database or worker writes, Meta sends, payment or courier integrations, staging changes, deployment, push, merge, or PR action was performed. Founder/human product review remains required before any release claim or merchant-facing use.
