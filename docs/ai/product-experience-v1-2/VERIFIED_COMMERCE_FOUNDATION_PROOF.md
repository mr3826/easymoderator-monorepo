# EasyModerator Verified Commerce Foundation V1.2 — Proof Package

**Verdict:** Local implementation work is complete with material evaluation and integration limits. The evidence supports a bounded real-Gemini replay, a passing three-engine browser run, and a passing historical isolated integration receipt. It does not establish broad answer quality, real merchant-image performance, current-commit PostgreSQL/Redis integration, Meta readiness, or production readiness.

**Candidate:** `feature/verified-commerce-foundation-v1.2`, implementation commit `dd04c079f2b752725d372e879cb1549a8459b8d1`; baseline `78b6250af40039749f9c096cd3e0debe2e6cf6a7`. The final evidence and privacy tooling are additional local changes on that candidate and are committed separately. No push, merge, PR, deploy, production/staging change, Meta send, payment/courier action, order mutation, or customer-facing message was performed.

## Final automated verdict

| Required status | Result | Evidence boundary |
|---|---|---|
| `AUTOMATED_QA_STATUS` | `BLOCKED` | Current-commit integration refresh could not start because local Docker service/API was unavailable. An earlier isolated integration receipt passed. |
| `LOCAL_IMPLEMENTATION_COMPLETE` | `YES` | Scoped V1.2 implementation, evidence, privacy review, and handoff are complete locally. |
| `LOCAL_INTEGRATION_PASS` | `NOT_RUN` | Not freshly verified against the committed candidate. Historical receipt `e4008ad7-468b-4a4f-9e09-fdd55a7494a1` passed 12 selected integration and 46 webhook tests at recorded source revision `78b6250a`. |
| `PRODUCT_EVALUATION_PASS` | `NO` | The bounded run passed its small labeled fact denominator, but required broad semantic and context evaluation was not run. |
| `PLAYWRIGHT_E2E_PASS` | `YES` | Receipt `0a2e2320-569e-479d-9878-2a40030a0519`: 6/6 across Chromium, Firefox, and WebKit. |
| `REAL_PROVIDER_VERIFIED` | `YES` | A bounded 200-turn run used authenticated Gemini responses; this is not a production reliability claim. |
| `REAL_VISION_VERIFIED` | `NO` | Four real Gemini vision requests used synthetic raster fixtures only; no customer or merchant image performance is established. |
| `REAL_META_VERIFIED` | `NOT_RUN` | Meta used no live endpoint or send. |
| `INDEPENDENT_REVIEW_PASS` | `YES` | Independent review verified the final privacy scan, package inventory, and checksums; see `INDEPENDENT_FINAL_REVIEW.md`. |
| `INTEGRATION_READY` | `NO` | Current-commit integration provenance and live Meta remain unverified. |
| `PRODUCTION_RELEASE_NOT_AUTHORIZED` | `YES` | No release authority was granted or exercised. |

These statuses are repeated in `verified-commerce-proof.json` and `AUTOMATED_QA_FINAL_VERDICT.md`.

## What the implementation establishes

The V1.2 implementation continues the existing Product Engine and Test Lab. Tenant-scoped catalog evidence remains the authority for product identity, price, stock, variants, and eligible media. Missing facts remain unknown. Image interpretation is a bounded retrieval hint, not a catalog fact. A final presentation/grounding gate checks customer-facing text and media before a send decision. The real-provider evaluation itself did not perform a database mutation or Messenger send.

| Capability | Evidence | Result and limit |
|---|---|---|
| Product facts and null-price handling | Focused grounding/router suites; eligible fact-slot scoring in run `471add4a-f2c5-44c8-8a9f-2e156a731a10` | 5/5 eligible fact slots correct; missing/ambiguous facts stay unknown in covered cases. This is a small denominator. |
| Final response safety | 200/200 presentation contracts; failure triage; visually reviewed redacted trace | A Gemini candidate associated a catalog-item price with an unidentified image. Grounding rejected this unsupported product-image association; the validated reply withheld the price. The catalog price itself was not shown false. |
| Image interpretation | Four synthetic raster cases sent to the real Gemini vision-capable model | 4/4 schema, category, and color checks passed. The fixtures are synthetic and do not establish real customer-photo performance. |
| Tenant and action boundaries | Real-run counters and security/regression suites | 0 tenant violations, 0 unscoped catalog reads, 0 mutations, and 0 Messenger sends in the 200-turn model run. No live Meta verification. |
| Lab workflow | Playwright receipt `0a2e2320-569e-479d-9878-2a40030a0519` | Main Lab journeys and shell smoke passed in all three installed engines. This proves local browser behavior, not answer quality. |
| Local service integration | Historical isolated receipt `e4008ad7-468b-4a4f-9e09-fdd55a7494a1` | Passed against disposable PostgreSQL/Redis with the Node egress guard. Receipt source revision is `78b6250a`; exact committed-candidate refresh is not established. |

## Dataset and real-model evaluation

`D:/easymod/customer-simulator.csv` was kept read-only. It has 200 turns across 20 personas and SHA-256 `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`.

Real-provider receipt `artifacts/runs/471add4a-f2c5-44c8-8a9f-2e156a731a10.json` records:

- Model: `gemini-3.1-flash-lite`; 200/200 turns executed, 200/200 presentation contracts valid, and no route-not-run turns.
- Routing dispositions: 154 `SEND` decisions and 46 `SAFE_FALLBACK` decisions. These are local evaluation decisions, not actual sends. Actual Messenger sends and business mutations: 0.
- Provider calls: 64 text plus 4 synthetic-vision requests, 68 total; 0 failed calls and 0 retries.
- Source-answerable product turns: 4/200; correct: 4/4. Eligible fact slots: 5; correct: 5/5. Unnecessary refusals among those slots: 0.
- Vision fixture checks: 4 executed, 4 schema-valid, 4 category matches, and 4 color matches. No source-customer photo was used.
- Tenant violations: 0; unscoped catalog reads: 0; unsupported numeric currency-prefixed price claims sent: 0. The price metric does not measure broad semantic unsupported claims. Semantic target evaluation was `NOT_RUN`; a scored context-retention metric was `NOT_AVAILABLE`.
- Cost: provider-reported and committed `$0.01465225` for this run, below its `$0.65` per-run cap.

The saved redacted trace documents a Gemini candidate that associated a catalog-item price with an unidentified image. Grounding rejected the unsupported product-image association, and the validated customer-facing reply withheld the price. The evidence does not establish that the catalog price itself was false, and it does not prove hallucinations never occur. The run also recorded 46 `SAFE_FALLBACK` local evaluation dispositions; these are not 46 observed Gemini hallucinations.

Across 15 completed real-Gemini receipts, ledgered committed cost is `$0.23143875` across 1,018 requests; provider-reported cost is `$0.22598950`. Adding the recorded interrupted-run upper bound `$2.108288` and authorization check `$0.000006` yields a conservative task-series exposure of `$2.33973275`, under the authorized `$10` budget. Cumulative accounting was manual; the code enforces a per-run ceiling, not a persistent aggregate cap. No new paid replay was made for this handoff.

Recorded mixed-route latency for the real run was p50 `1.93 ms`, p95 `5,370.795 ms`, and mean `1,585.979 ms`; provider latency was p50 `1,192 ms` and p95 `3,455 ms`. These are in-process replay measurements, not end-to-end Messenger, database, queue, worker, or customer-perceived latency. A defensible cost-per-resolved-inquiry or ROI result is not available from this denominator.

Credential status: `GEMINI_KEY_AVAILABLE=YES`; `GEMINI_AUTH_VERIFIED=YES` for the successful bounded run. The host-injected Process environment supplied `EM-GEMINI-KEY`. A later scope check found no value in Windows User scope, so no User-scope-only retry was made. The key was not printed, persisted, sent to a browser, or included in artifacts.

## Baseline comparison

The local comparison uses mock adapters; it is not provider-matched and is not an improvement claim.

| Metric | Baseline `d31c486f-47b5-4cbc-abe3-d8969cac905e` | Candidate `e9f1b90e-1036-40ed-bae0-54361382cfe7` | Interpretation |
|---|---:|---:|---|
| Turns | 200 | 200 | Same CSV hash; controlled mock adapters. |
| Source-answerable product turns | 4 | 3 | Denominators differ. |
| Correct eligible turns | 3/4 | 3/3 | Not a valid accuracy delta because eligibility differs. |
| Eligible fact slots correct | 3/4 | 3/3 | Denominators differ; no improvement claim. |
| Provider calls / spend | 0 / `$0` | 0 / `$0` | Neither comparison is a Gemini result. |

The real Gemini run is reported separately above. The old V1.1 production-router replay artifact was not rewritten.

## Integration and browser verification

Historical integration receipt `artifacts/integration/e4008ad7-468b-4a4f-9e09-fdd55a7494a1.json` reports 12 selected integration tests and 46 webhook-pipeline tests passed; PostgreSQL 16 and Redis 7 used project-scoped temporary storage, loopback-only ports, disabled bridge IP masquerading, disabled external providers, and zero blocked non-loopback attempts. Compose teardown succeeded. Its `sourceRevision` field is the baseline SHA `78b6250a`, so this report does not bind those results to the committed candidate SHA.

A fresh integration attempt on the current checkout stopped before Compose startup: the first Docker network inspection failed, and Docker Desktop's service remained stopped while the local Docker API returned HTTP 500 for `/v1.56/info` and `/v1.56/networks`. No tests started and no containers were created by that attempt. Therefore current-candidate local integration is `NOT_RUN`, despite the historical passing receipt.

Current Playwright receipt `artifacts/playwright/execution.json` is `PASS`, run `0a2e2320-569e-479d-9878-2a40030a0519`, source revision `dd04c079f2b752725d372e879cb1549a8459b8d1`, URL `http://127.0.0.1:3411` during execution:

- 6/6 tests passed: full workflow and shell smoke in Chromium, Firefox, and WebKit.
- 0 page errors, 0 console errors, and 0 failed requests in all six observations.
- Axe reported zero serious/critical findings across the nine Lab sections in each browser. This automated scan is not accessibility certification.
- This browser run used a candidate-mode local run, not the real-Gemini receipt (`realGeminiTraceUi:false`). The three saved live-trace crops come from the separate recorded real-model evaluation.
- Twelve browser PNG screenshots were visually inspected. They show the local-workspace boundary, source-metadata-only scenario view, redaction labels, and the candidate-versus-validated-reply distinction. Screenshot review was visual; the aggregate scan reports 17 raster artifacts not OCR-scanned.

## Privacy, trace retention, and provenance

Raw Playwright archives are not retained. The package includes sanitized Playwright archive files: 12 archive files representing 6 unique contents. The sanitizer recursively redacted text and archive member names, removed 3,164 raster members and all unsupported opaque payloads, removed ZIP comments and extra fields, and resolved 6 name collisions. Fifty text members were redacted. The report's text-redaction totals are cumulative across the payload-redaction and final metadata-scrub passes; the last pass itself was metadata-only. Raster screenshots remain separately available and were not OCR-scanned.

The current scanner report `artifacts/final-qa/privacy-scan.json` is `PASS`: 359 JSON artifacts, 50 text artifacts, and 12 archive files (6 unique contents) scanned; zero parse errors, denied keys, unsafe exact-source matches, source-contact matches, heuristic matches, or unclassified archive matches. Exact source matches remain only in explicitly redacted JSON input fields (16,116) and redacted transcript customer lines (405). No exact source matches were found in sanitized Playwright archives. There were no archive raster members left unscanned; 17 standalone raster artifacts are reported as not OCR-scanned. The report records the scan timestamp.

The SHA-256 manifest has 441 entries: 440 packaged files independently matched, and one dataset entry is metadata-only because the original CSV remains outside the evidence package. Independent review found zero invalid, duplicate, missing, mismatched, or unmanifested package entries. The CSV hash is consistent across the proof, evaluation, scanner, and browser provenance.

Five older redacted transcript files and three historical run receipts were sanitized after a source contact sequence was found. Their scores, routing outcomes, usage, and cost fields were not changed; the receipts record post-run sanitization.

## Verification and self-correction record

- Focused implementation suites: 237 passed; offline provider/product suites: 129 passed; security suites: 799 passed across 58 suites; no-egress: 6 passed. The final privacy-scanner unit suite passed 10 tests and the trace-sanitizer unit suite passed 3.
- Browser test correction: moved the Playwright download-event waiter to immediately before the export click. The previous early waiter expired during slow WebKit navigation and accessibility scans; the new full three-engine run passed.
- Privacy correction: independent review identified ZIP comments, extra fields, and archive member names as additional privacy surfaces. Sanitization now removes/scrubs those fields, handles nested ZIPs, and scanner coverage checks them. Final scan and independent manifest verification passed.
- Real-model correction: the unsupported product-image association candidate was blocked by the existing grounding/presentation boundary; the evidence does not establish that the catalog price itself was false. No source truth or expected answer was changed to improve the score.
- Credential check: `EM-GEMINI-KEY` is absent from Windows User scope; the successful bounded run used the host-injected Process value. No persistent environment setting was changed and no retry was charged.
- Docker limitation: current-candidate integration refresh could not start for the API/service reason above; the earlier receipt is retained with its source-revision caveat.

## Reproduction and evidence index

Run from the V1.2 checkout. These commands do not make provider calls unless the bounded real-Gemini replay is explicitly requested and an authorized key is available.

```powershell
python EasyMod-backend/scripts/product-experience/test_scan_artifact_privacy.py
python EasyMod-backend/scripts/product-experience/test_sanitize_playwright_traces.py
node EasyMod-backend/scripts/product-experience/run-integration.js
node EasyMod-backend/scripts/product-experience/run-lab-playwright.js
python EasyMod-backend/scripts/product-experience/sanitize-playwright-traces.py
python EasyMod-backend/scripts/product-experience/sanitize-playwright-traces.py --metadata-only
python EasyMod-backend/scripts/product-experience/scan-artifact-privacy.py
```

Primary evidence is under `artifacts/`: the real run and sibling redacted transcript, browser execution/report/observations/screenshots/sanitized traces, historical integration receipt, route-comparison receipts, trace-sanitization report, privacy report, and `SHA256SUMS.txt`. `verified-commerce-proof.json` is the machine-readable status record. `README.md` documents the Lab and repeatable local checks.

Focused reports: `V1_EVIDENCE_VERIFICATION.md`, `DATASET_ORACLE_AND_COVERAGE.md`, `LOCAL_INTEGRATION_RESULTS.md`, `REAL_MODEL_AND_VISION_RESULTS.md`, `BASELINE_CANDIDATE_COMPARISON.md`, `PLAYWRIGHT_E2E_REPORT.md`, `AUTOMATED_AI_QUALITY_REPORT.md`, `COST_AND_CUSTOMER_VALUE.md`, `SECURITY_AND_SHARED_WORKER_REVIEW.md`, `INDEPENDENT_FINAL_REVIEW.md`, and `AUTOMATED_QA_FINAL_VERDICT.md`.

The Lab was served at `http://127.0.0.1:3411` during Playwright execution. For a local UI session, run `node EasyMod-backend/scripts/product-experience/lab-server.js`; it binds to loopback and prints the actual ephemeral URL. The automated run does not leave the server running.

## Release boundary

This is an engineering evidence package for local founder review. It does not authorize a live merchant claim, production release, or deployment. Real Meta, payment, and courier paths were not exercised. Broad semantic hallucination rate, naturalness, multi-turn context retention, robust merchant image recognition, end-to-end latency, and merchant ROI remain unmeasured. Human product/founder review is still required before merchant-facing use.
