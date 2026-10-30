# Independent Final Review — V1.2 Evidence Snapshot

**Initial review snapshot:** privacy scan `2026-10-21T13:05:53.088972Z`; checksum manifest written at `2026-10-21T13:05:54Z`. This report was added after that manifest snapshot; the post-report scan and independent checksum verification are documented below.

## Scope and method

I reviewed the V1.2 proof, focused reports, machine-readable status, current real-model and Playwright receipts, historical integration receipt, synthetic-media provenance, privacy-scan output, and checksum inventory in `D:\easymod\_wt-verified-commerce-v1-2`. I compared receipt IDs, denominators, status fields, source/dataset hash references, cost and latency scope, and the integration caveat. I independently parsed every manifest line, recomputed each packaged-file SHA-256, compared package files against listed paths, and checked the dataset metadata hash against the privacy report.

I did not open or hash the customer CSV, read customer rows, call Gemini or another provider, start Docker or integration services, contact Meta, make production changes, or run tests in this final package review. No source or documentation file other than this review report was changed by me.

## Evidence checks

| Area | Independent check | Result and limit |
|---|---|---|
| Real-model run `471add4a-f2c5-44c8-8a9f-2e156a731a10` | Receipt and proof aggregates | 200/200 turns; 64 text + 4 synthetic-vision requests = 68 total; 0 failures/retries; 4/4 labeled answerable turns and 5/5 eligible fact slots correct. The four vision inputs were synthetic. This is a small labeled denominator, not broad quality proof. |
| Grounding, tenant, and action boundary | Receipt and focused reports | 0 tenant violations, unscoped catalog reads, business mutations, or Messenger sends. One unsupported product-image association was blocked: the candidate linked a catalog price to an unidentified image. The evidence does not show that the catalog price itself was false. The zero unsupported-price-sent metric counts numeric currency-prefixed claims only; semantic unsupported-claim evaluation was `NOT_RUN`. |
| Source provenance | Proof, real-run receipt, and browser provenance | The receipt, proof, and browser provenance agree on backend source SHA-256 `d88b51e3f151648443a2993c90d1e8282799d7e2fd559640fa86db3a4d727ae9`, runner SHA-256 `3e128d58b3ea2e241fd757410f62b6aaaa109035e00e335727976645b70c5fca`, and dataset SHA-256 `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`. The real-run receipt's `sourceRevision` is the baseline SHA `78b6250a`; its source hashes match the candidate source values recorded in the proof and browser provenance. |
| Local browser run `0a2e2320-569e-479d-9878-2a40030a0519` | Execution receipt and proof | PASS, 6/6 across Chromium, Firefox, and WebKit; zero page errors, console errors, or failed requests; zero serious/critical axe findings across nine Lab sections per browser. `realGeminiTraceUi=false`: this run tested candidate-mode local Lab behavior, not loading the real-Gemini trace in the browser. |
| Integration | Historical receipt `e4008ad7-468b-4a4f-9e09-fdd55a7494a1`, machine status, and focused report | Historical isolated PostgreSQL/Redis pass: 12 selected integration tests plus 46 webhook tests. Its `sourceRevision` is baseline `78b6250a`. The current-candidate refresh failed before Compose startup because Docker Desktop's local API/service was unavailable. Therefore current-candidate integration is `NOT_RUN`, and `INTEGRATION_READY=NO`; the historical pass is not presented as candidate-bound evidence. |
| Initial privacy scan `2026-10-21T13:05:53.088972Z` | Initial `privacy-scan.json` snapshot | PASS: 359 JSON artifacts, 49 text artifacts, 12 ZIP files / 6 unique archives; zero parse errors, denied keys, unsafe exact-source matches, contact matches, or heuristic matches. It permitted 16,116 exact matches only in redacted input fields and 405 only in redacted transcript customer lines. Seventeen standalone raster artifacts were not OCR-scanned. |
| Initial SHA-256 manifest | `SHA256SUMS.txt` as written at 13:05:54Z | 440 lines: 439 packaged files plus one metadata-only dataset entry. All 439 packaged-file hashes matched; zero malformed entries, duplicates, missing files, mismatches, out-of-scope paths, or unmanifested package files. I did not read the dataset bytes. |
| Baseline comparison and value claims | Comparison and cost reports | The baseline/candidate runs use mock adapters and have different eligible denominators (4 vs. 3), so they do not establish an improvement delta. The bounded Gemini run cost was `$0.01465225` against a `$0.65` per-run ceiling. Cumulative task-series accounting is manual, and the latency measurements are in-process replay/provider timings, not end-to-end customer latency. No ROI or cost-per-resolved-inquiry result is established. |

## Findings at the reviewed snapshot

- **P0: 0. P1: 0.** I found no discrepancy that invalidates the bounded receipt results or the privacy scanner's PASS at this snapshot.
- **P2 at the 13:05:53Z snapshot: proof-count drift.** The human proof then listed 39 text artifacts while the scan listed 49, and `verified-commerce-proof.json` then listed 12,999 redacted-input matches while the scan listed 16,116. The package owner corrected those proof counters and timestamp after that snapshot. The independent-review status was provisional then and was confirmed by the final read-only check below.
- The worktree was not clean at review time: the evidence, privacy tooling, and browser artifacts had modified/untracked files while `HEAD` remained `dd04c079f2b752725d372e879cb1549a8459b8d1`. The proof's statement that evidence/privacy changes are committed separately becomes accurate only after the planned local commit. This review does not create that commit.

## Post-report final verification

After this report was added, the package owner refreshed the scan. The current `privacy-scan.json` records its exact timestamp and passes with 359 JSON artifacts, 50 text artifacts, and 12 ZIP files (6 unique); zero parse errors, denied fields, unsafe exact-source matches, contact/heuristic findings, or archive matches; 16,116 exact matches only in redacted JSON input fields and 405 only in redacted transcript customer lines. Seventeen standalone rasters remain not OCR-scanned; zero archive raster members remain.

I independently recomputed the refreshed manifest: 441 entries total, consisting of 440 package files and one metadata-only dataset entry. All 440 package hashes matched; there were zero malformed, duplicate, missing, mismatched, out-of-scope, or unmanifested entries. The dataset metadata hash matched the refreshed scan. I did not read or hash the CSV bytes. This confirms `INDEPENDENT_REVIEW_PASS=YES`.

## Verdict and remaining limits

**Scoped verdict: PASS WITH LIMITATIONS for the bounded local evidence reviewed at the timestamps above.** The evidence supports the specific real-Gemini replay, synthetic-image checks, local three-engine browser run, and historical isolated integration receipt with their stated provenance. It does not support a broad semantic-quality or merchant-value claim.

`AUTOMATED_QA_STATUS=BLOCKED`, `LOCAL_INTEGRATION_PASS=NOT_RUN`, `PRODUCT_EVALUATION_PASS=NO`, `REAL_VISION_VERIFIED=NO` for representative customer/merchant imagery, and `REAL_META_VERIFIED=NOT_RUN` are appropriate. Broad semantic hallucination rate, context-retention scoring, representative merchant-photo performance, current-commit database/queue integration, live Meta/payment/courier behavior, end-to-end latency, and merchant ROI remain unverified. No production release is authorized.
