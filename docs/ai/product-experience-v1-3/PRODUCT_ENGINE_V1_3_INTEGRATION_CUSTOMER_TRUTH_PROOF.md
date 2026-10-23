# EasyModerator Product Engine V1.3 — Integration & Customer Truth Proof

Generated: 2026-10-23T20:22:45.299Z

## A. Executive verdict

| Gate | Result |
|---|---|
| Automated QA | FAIL |
| Integration ready | NO |
| Deterministic source truth (zero provider calls) | PASS |
| Gemini comparison | PASS |
| Gemini credential | AUTHENTICATED |
| Real Gemini candidate quality | PASS |
| Real Gemini photo acceptance | FAIL |
| Browser QA | PASS |
| Backend security tests | PASS |
| Verification receipt | FAIL (YES complete) |
**Commercial evidence:** NOT_ESTABLISHED

This local verification evaluates the existing V1.2 Product Engine against an independently generated catalog oracle, a synthetic held-out set, the disposable local PostgreSQL/Redis/worker path, and baseline/candidate replays. Each result is limited to its recorded receipt. Production, live Meta delivery, merchant outcomes, conversion and ROI were not tested.

The candidate is not eligible for integration readiness yet. The evidence below identifies the remaining gates and does not treat safe fallback as a verified answer.

## B. Source control and isolation

- V1.2 baseline: `957bb991a18db1949369a6f805822b8c8b69889b`.
- V1.3 tested code commit: `33ca2b76f1fe8f43dce10523ddfec3ab7ff9860d` on `feature/product-engine-v1.3-customer-truth`.
- Evidence checkout: `D:\easymod\_wt-product-engine-v1-3`.
- Evidence package root: `D:\easymod\_product-engine-v1-3-evidence-final-20261024-01`.
- Backend source SHA-256: `e1168c0e5e9cf6132a379053144f85e94089c4c430664de1f62716f26e6a11fa`.
- Worktree clean at verification start: **YES**.
- Worktree clean when the proof was generated: **NO**. Verification receipt: `D:\easymod\_product-engine-v1-3-evidence-final-20261024-01\regression\verify-67545ddf-3fd4-49ce-9427-721f8217941c.json`.
- Other agent worktrees touched: **NO**. Production changed: **NO**. Push, merge and deploy: **NO**.
- Production release remains unauthorized.

## C. Implementation changes

The candidate extends the existing intent router, product evidence and Test Lab. V1.3 corrections cover product context re-fetching, mixed product-price and delivery-fee questions, negotiation versus catalog-price classification, garment measurements, category-incompatible context, Bengali-digit PII masking, independent answerability denominators, and source/held-out oracle provenance. The decision record is [MULTI_AGENT_DECISION_RECORD.md](MULTI_AGENT_DECISION_RECORD.md).

Order creation, payment confirmation, stock reservation, courier booking, live Meta delivery and new provider architecture remain outside the Product Engine boundary.

## D. Deterministic source truth

This verdict covers the zero-provider-call replay against the source oracle only. The paid Gemini candidate quality gate is PASS.

20 personas, 200 turns, 65 text product turns, 15 answerable turns, and 18 answerable fact slots.

The source CSV SHA-256 is `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`. Its advisory `Expected AI Truth` cells are not the source of oracle answers. Only TEXT turns enter text answerability metrics; image-bearing turns without pixels are excluded from those denominators.

| Metric | V1.2 | V1.3 |
|---|---:|---:|
| Verified correct fact answers | 7 | 18 |
| Fully answered product turns | 5 | 15 |
| False refusal slots | 3 | 0 |
| False-refusal turns evaluated / expected (not evaluable) | 9 / 15 (6) | 15 / 15 (0) |
| Unsupported price claims with SEND disposition | 0 | 0 |
| Context-resolution failures | 11 | 0 |
| Context turns evaluated / expected | 13 / 13 | 13 / 13 |
| Context turns not evaluable | 0 | 0 |
| Safe cross-domain handoffs | 0 | 4 |
| Cross-domain handoffs evaluated / expected | 4 / 4 | 4 / 4 |
| Cross-domain handoffs not run | 0 | 0 |

### Required automated quality metric coverage

| Metric | Deterministic source candidate | Paid Gemini candidate | Scope / limitation |
|---|---|---|---|
| PRODUCT_IDENTITY_ACCURACY | NOT_MEASURED | NOT_MEASURED | Identity-only accuracy is not isolated from the aggregate fact-slot score. |
| ANSWERABLE_PRODUCT_RESOLUTION_RATE | 15/15 (100.0%); evaluated 15 | 15/15 (100.0%); evaluated 15 |  |
| VERIFIED_FACTUAL_ACCURACY | 18/18 (100.0%); evaluated 18 | 18/18 (100.0%); evaluated 18 |  |
| VARIANT_ACCURACY | NOT_MEASURED | NOT_MEASURED | Variant-only outcomes are not reported as a separate numerator and denominator. |
| MULTI_TURN_CONTEXT_ACCURACY | 13/13 (100.0%); evaluated 13 | 13/13 (100.0%); evaluated 13 |  |
| UNKNOWN_HANDLING_ACCURACY | NOT_MEASURED | NOT_MEASURED | Unknown-answer cases do not have a separately reported accuracy denominator. |
| FALSE_REFUSAL_RATE | 0/18 (0.0%); evaluated 15 | 0/18 (0.0%); evaluated 15 | eligible answerable fact slots; evaluated-turn coverage is reported separately |
| UNSUPPORTED_CLAIM_RATE | NOT_MEASURED | NOT_MEASURED | General claim rate not measured. Unsupported price claims with SEND: 0/200 (0.0%) deterministic; 0/200 (0.0%) paid. |
| SAFE_CROSS_DOMAIN_ROUTING_RATE | 4/4 (100.0%); evaluated 4 | 4/4 (100.0%); evaluated 4 |  |
| GENUINE_IMAGE_MATCH_ACCURACY | NOT_APPLICABLE | FAIL; visible category 2/3 (66.7%); visible color 3/3 (100.0%); catalog SKU identity NOT_MEASURED | Visible category and color are supporting attributes, not catalog SKU identity accuracy. |
| CUSTOMER_USEFULNESS_SCORE | NOT_MEASURED | NOT_MEASURED | No blinded, separately configured semantic evaluator or usefulness score was recorded. |

No population confidence intervals were calculated. The benchmark and three public-photo sample are fixed convenience fixtures, not random samples; out-of-sample uncertainty and customer usefulness remain unmeasured.

Incorrect product answers are **not separately measured**. The artifact records 0 answerable fact slots that were partial, unanswered or incorrect; this total includes false refusals and must not be presented as a wrong-answer count. The currently measured unsupported-claim counter is specifically an unsupported-price-claim check.

False-refusal scoring accepts a current turn with VERIFIED product evidence and a matching contract-valid READY presentation. Otherwise, a context-dependent turn is evaluated only when every earlier turn in that conversation executed and an earlier assistant turn had a SEND disposition for a non-refusal reply with a contract-valid READY presentation grounding the same product. This is approved replay output; actual Messenger delivery is not established. An intervening product `NOT_FOUND` clears prior assistant context; context-only turns without current evidence and a complete grounding chain remain not evaluable.

### Verified product answer — scenario-01-01

Customer message (redacted): Salam bro, cargo pant er details ta bolen toh?

Engine response (redacted): Olive Cargo Pant — ৳1,450 Available options: Size 30 (৳1,450), Size 32 (৳1,450), Size 36 (৳1,450)

Disposition: SEND; correct answer slots: 1/1.

### Context-resolution failure — scenario-04-02

Customer message (redacted): Can I get actual live camera pictures without studio lighting?

Engine response (redacted): Women's Embroidered Kamiz I don't have a photo of this product available right now. Happy to share any other details.

Disposition: SEND; correct answer slots: 0/0.

### Merchant-policy handoff — scenario-04-08

Customer message (redacted): Fine. I'll take 1 M size. Delivery to [ADDRESS].

Engine response (redacted): Women's Embroidered Kamiz — Size M — ৳2,350 This option is currently out of stock. I can't confirm or create an order from this chat. Please continue through the separate order flow for delivery.

Disposition: SEND; correct answer slots: 1/1.

## E. Gemini

Credential status: AUTHENTICATED; the process-scoped value is not recorded. Model: gemini-3.1-flash-lite. Provider-reported traffic across matched arms: 158 text and 6 vision calls. Request attempts across matched arms: 158 text and 6 vision. Candidate run ledger: 109 request attempts, 109 provider usage records, 0 rejected reservations. Estimated matched-pair spend from priced usage: $0.03331425; provider invoice: NOT_AVAILABLE. Candidate route coverage: 200/200 executed, 0 not run. Candidate quality gate: PASS; 18/18 fact slots and 15/15 answerable turns verified; context resolution failures 0 across 13/13 fully executed conversation chains (0 not evaluable); cross-domain safety 4 safe, 0 unsafe across 4/4 executed turns (0 not run). Runner provenance: PASS; paid/current runner hashes 7b19413df9db2aa646bf6270ef43c24cfdd7dd0e6e1a53521d6451f85d3df3c3/7b19413df9db2aa646bf6270ef43c24cfdd7dd0e6e1a53521d6451f85d3df3c3. Candidate unpriced provider calls: 0; all recorded candidate provider usage was priced.

Candidate false refusals: 0 slots across 15/15 evaluated/expected answerable turns (0 not evaluable).

Observed campaign activity remains in the cumulative ledger: 164/256 requests, 6/12 vision requests, 164 provider-reported calls and 0 unpriced or pending request(s). Estimated priced usage: $0.03331425; worst-case reserved: $0.29081075 of $2.00 ceiling. Invoice unavailable.

Supplementary Pro diagnostic: NOT_RUN.

Provider estimates use reported token usage and a pinned local rate calculation. They are not billing records. The credential is process-scoped and is not copied into artifacts.

## F. Images

Photo acceptance verdict: **FAIL**. The matched paid Gemini run evaluated 3 licensed public photos. Category matches: 2/3; visible-color matches: 3/3; catalog identity: NOT SCORED. The matched comparison originally reported 0/3 categories with the slash-rejecting scorer; the follow-up stores the actual redacted provider outputs. The fixtures represent only 1 of the 15 required visual case types (one clean, single-product photograph); the other 14 case types are not covered. No catalog SKU identity score exists. These public-photo results are not customer-upload accuracy evidence.

Supplementary Gemini Pro photo diagnostics: NOT_RUN.

Corrected-scorer Gemini Lite photo follow-up: NOT_RUN.

### Required visual scenario coverage

Represented case types: 1/15. A case counts as represented only when its fixture has the requested visual condition; repeated photos or repeated model calls do not add case types.

| Required case | Coverage | Fixture |
|---|---|---|
| Single product, clean photograph | REPRESENTED | handloom-kurta |
| Multiple photographed angles | NOT_COVERED | — |
| Side-view-only product | NOT_COVERED | — |
| Product worn by a model | NOT_COVERED | — |
| Product with accessories not included | NOT_COVERED | — |
| Product with printed price | NOT_COVERED | — |
| Conflicting currency symbol | NOT_COVERED | — |
| Similar-looking products | NOT_COVERED | — |
| Color variation | NOT_COVERED | — |
| Blurred product | NOT_COVERED | — |
| Partially occluded product | NOT_COVERED | — |
| Non-catalog product | NOT_COVERED | — |
| Multiple products in the same image | NOT_COVERED | — |
| Screenshot containing extraneous text | NOT_COVERED | — |
| Image with malicious or misleading embedded text | NOT_COVERED | — |

Required output coverage is partial: the run records fixture provenance/checksum, visible category/color, redacted provider output, redacted customer response, latency, estimated token cost, and an unverified-material flag. It does not record independently known catalog SKU identity, retrieved catalog candidates, a final SKU match, calibrated confidence/ambiguity, or a complete per-attribute reliability annotation. Catalog product identity accuracy is therefore NOT_MEASURED.

No source-corpus image pixels were available. The three independent photos are licensed public fixtures; results should not be generalized to customer photos. The detailed provenance and per-photo observations are in the machine-readable proof.

## G. Backend integration

Receipt status: **PASS**; PostgreSQL and Redis use user-provisioned WSL PostgreSQL 18.6 (Ubuntu 18.6-0ubuntu0.26.04.1) and Redis 8.0.5 on 127.0.0.1; read-only protocol checks passed before migrations. Selected integration: 12 passed, 12 total; webhook pipeline: 46 passed, 46 total; full backend regression: 2 skipped, 4011 passed, 4013 total. Receipts: `D:\easymod\_product-engine-v1-3-evidence-final-20261024-01\integration`.

Product search: **PASS**. Fake Meta transport: **PASS**. These checks do not establish production database behavior or live Meta delivery. Disposable service receipts: `D:\easymod\_product-engine-v1-3-evidence-final-20261024-01\integration`.

## H. Browser QA

Playwright exit code: 0; result: {"total":6,"passed":6,"failed":0,"skipped":0,"results":[{"status":"passed","project":"chromium","title":"tests\\product-engine-lab\\lab.spec.ts:44:1 › local Test Lab journeys, data boundaries, run history, and responsive controls","duration":"3.2m"},{"status":"passed","project":"chromium","title":"tests\\product-engine-lab\\lab.spec.ts:385:1 › loads the real Lab shell on every installed browser engine","duration":"955ms"},{"status":"passed","project":"firefox","title":"tests\\product-engine-lab\\lab.spec.ts:44:1 › local Test Lab journeys, data boundaries, run history, and responsive controls","duration":"3.9m"},{"status":"passed","project":"firefox","title":"tests\\product-engine-lab\\lab.spec.ts:385:1 › loads the real Lab shell on every installed browser engine","duration":"1.4s"},{"status":"passed","project":"webkit","title":"tests\\product-engine-lab\\lab.spec.ts:44:1 › local Test Lab journeys, data boundaries, run history, and responsive controls","duration":"3.6m"},{"status":"passed","project":"webkit","title":"tests\\product-engine-lab\\lab.spec.ts:385:1 › loads the real Lab shell on every installed browser engine","duration":"1.2s"}]}. Evidence: `D:\easymod\_product-engine-v1-3-evidence-final-20261024-01\playwright\execution.json`.

The Playwright runner starts a loopback Test Lab for the browser run and stops it afterward; no persistent Test Lab URL is claimed by this report.

## I. Security and privacy

- Security tests: **PASS**. Egress guard: PASS; blocked non-loopback attempts: 0.
- Tenant violations: 0; unscoped catalog reads: 0.
- Pre-proof artifact privacy scan: **PASS** at 2026-10-23T20:21:29.687250Z. The final scan report and checksum manifest are generated after this proof; inspect their timestamps and entries to confirm coverage. The proof Markdown is at `D:\easymod\_product-engine-v1-3-evidence-final-20261024-01\reports\product-engine-v1.3-proof.md`, and the machine proof is at `D:\easymod\_product-engine-v1-3-evidence-final-20261024-01\product-engine-v1.3-proof.json`.
- No credential values are stored in the proof package.

## J. Cost and merchant economics

Estimated matched-pair provider cost from priced usage: $0.03331425. Candidate unpriced provider calls: 0. Rejected campaign ledger attempts: 0 (blocked before provider usage). All recorded provider usage was priced. Candidate cost per verified product-answer turn: $0.00143310; per verified fact slot: $0.00119425. Deterministic source replay router p50/p95: 4.098 ms / 12.908 ms. Paid candidate route p50/p95: 4455.219 ms / 5346.926 ms; baseline: 1.27 ms / 5213.681 ms. Paid candidate provider p50/p95: 997 ms / 1502 ms (baseline 1077 ms / 2247 ms). These route timings exclude webhook, queue, database and customer-facing network latency.

Deduplicated latest ledgers across 23 V1.3 campaigns record 2949 requests, 133 vision requests, 5 unknown-usage calls, $0.67960328 priced-token estimate and $5.667497026 reserved exposure. The sum of their individual ceilings is $37.42; those ledgers do not enforce one shared aggregate cap. The V1.2 proof records $2.33973275 conservative task-series exposure, for combined reserve $8.007229776 and $1.992770224 remaining against the $10.00 authorization by manual reconciliation. Provider invoices are unavailable. V1.2 source: `_wt-verified-commerce-v1-2/docs/ai/product-experience-v1-2/verified-commerce-proof.json`; V1.3 ledger file hashes and paths are in the machine proof. All 23 ledger snapshots and the V1.2 proof input are included under `cost-reconciliation/`. Missing ledger files inside discovered campaign directories make reconciliation incomplete. Campaign roots absent from the workspace inventory cannot be detected automatically.

No merchant time saved, adoption, order outcomes, conversion or ROI data exists in this test. Commercial evidence is therefore **NOT ESTABLISHED**.

## K. Baseline comparison

- Source comparison: Valid: **YES**. V1.2 verified answers: 7; V1.3 verified answers: 18. V1.2 context failures: 11; V1.3: 0 across 13/13 complete conversation chains. V1.3 context turns not evaluable: 0.
- Held-out comparison: Valid: **YES**. V1.2 verified answers: 28; V1.3 verified answers: 37.
- Paid Gemini source comparison: verified fact answers 7/18 baseline to 18/18 candidate; fully answered turns 5/15 baseline to 15/15 candidate. Quality verdict: PASS. Paid matched-pair estimated cost: $0.03331425; candidate $0.02149650 vs baseline $0.01181775 (REGRESSED). Paid route p95 outcome: REGRESSED; provider p95 outcome: IMPROVED. Paid public-photo probe: category 2/3, visible color 3/3; catalog identity NOT SCORED.
- Deterministic and paid model results are kept separate. Comparison outputs include dataset, oracle, catalog, engine-source and runner hashes.

## L. Independent verification

Verdict: **PASS**; reviewer: Independent Verification Agent (read-only); reviewed code commit: 33ca2b76f1fe8f43dce10523ddfec3ab7ff9860d; reviewed runner hash: 7b19413df9db2aa646bf6270ef43c24cfdd7dd0e6e1a53521d6451f85d3df3c3; focused tests: 68/68; final scan: NOT_RECORDED; manifest recomputation: NOT_RECORDED; remaining limitations: Product QA remains FAIL and integration readiness remains NO because only 1/15 required visual case types is represented and catalog identity was not scored.; Twelve standalone raster artifacts are not OCR-scanned.; Campaign roots entirely absent from workspace inventory cannot be detected automatically; a missing ledger inside a discovered campaign directory marks reconciliation incomplete.; Provider costs are estimates, not invoices, and the shared 10 USD authorization is manually reconciled rather than enforced as one global cap.; No live Meta delivery, production behavior, merchant adoption, conversion, or ROI was established..

The review applies to the exact code SHA and runner hash recorded above. Any code change after that review invalidates its verdict. Product QA and integration remain at the statuses shown in Section A.

## M. Remaining decisions

| Task | Classification | Evidence/status |
|---|---|---|
| Resolve any remaining text, context or vision failures | Required before integration | Deterministic source truth: PASS; paid Gemini quality: PASS; vision results are listed above. |
| Complete the required visual case matrix and score catalog identity | Required before integration | 1/15 case types represented; catalog SKU identity NOT_MEASURED. |
| Measure held-out Gemini usefulness and separately score customer-answer quality metrics | Required before integration | Held-out Gemini NOT_RUN; customer usefulness NOT_MEASURED; metric coverage table is in Section D. |
| Repeat final independent review after any correction | Required before integration | Independent verification: PASS. |
| Live Meta, production data and release authorization | Required before production release | Not authorized and not tested in this milestone. |
| Merchant adoption, time-saved, conversion and ROI study | Optional future measurement | Not available from synthetic runs. |

## Reproducibility

From `EasyMod-backend`, use Node.js 20, Python 3 and a working local Docker Engine:

`npm run verify:product-v1.3`

This default is offline. To opt into the bounded real Gemini comparison, the current process must already contain `EM-GEMINI-KEY`:

`npm run verify:product-v1.3 -- --paid-gemini`

The opt-in run uses a persistent campaign ledger capped at $2, 256 requests and 12 vision requests. It does not send live Meta messages or modify production.

## Machine-readable status

Machine-readable proof: `D:\easymod\_product-engine-v1-3-evidence-final-20261024-01\product-engine-v1.3-proof.json`.

| Status key | Value |
|---|---|
| `PROJECT` | EasyModerator |
| `MILESTONE` | Product Engine V1.3 |
| `GOAL` | Integration & Customer Truth Verification |
| `V1_2_BASE_SHA` | 957bb991a18db1949369a6f805822b8c8b69889b |
| `V1_3_BRANCH` | feature/product-engine-v1.3-customer-truth |
| `V1_3_FINAL_SHA` | 33ca2b76f1fe8f43dce10523ddfec3ab7ff9860d |
| `WORKTREE_CLEAN` | false |
| `WORKTREE_CLEAN_AT_VERIFICATION_START` | true |
| `WORKTREE_CLEAN_AT_PROOF_GENERATION` | false |
| `VERIFICATION_ENTRYPOINT_STATUS` | FAIL |
| `VERIFICATION_ENTRYPOINT_COMPLETE` | YES |
| `SOURCE_PERSONAS` | 20 |
| `SOURCE_TURNS` | 200 |
| `ELIGIBLE_PRODUCT_TURNS` | 65 |
| `ANSWERABLE_PRODUCT_TURNS` | 15 |
| `VERIFIED_CORRECT_ANSWERS` | 18 |
| `INCORRECT_PRODUCT_ANSWERS` | NOT_SEPARATELY_MEASURED |
| `UNSUPPORTED_CLAIMS` | 0 |
| `FALSE_REFUSALS` | 0 |
| `FALSE_REFUSAL_TURNS_EXPECTED` | 15 |
| `FALSE_REFUSAL_TURNS_EVALUATED` | 15 |
| `FALSE_REFUSAL_TURNS_NOT_EVALUABLE` | 0 |
| `SOURCE_CONTEXT_FAILURES` | 0 |
| `REAL_GEMINI_CONTEXT_FAILURES` | 0 |
| `REAL_GEMINI_CONTEXT_TURNS_EXPECTED` | 13 |
| `REAL_GEMINI_CONTEXT_TURNS_EVALUATED` | 13 |
| `REAL_GEMINI_CONTEXT_TURNS_NOT_EVALUABLE` | 0 |
| `CROSS_DOMAIN_HANDOFFS_EXPECTED` | 4 |
| `CROSS_DOMAIN_HANDOFFS_EVALUATED` | 4 |
| `CROSS_DOMAIN_HANDOFFS_NOT_RUN` | 0 |
| `SOURCE_SAFE_CROSS_DOMAIN_HANDOFFS` | 4 |
| `REAL_GEMINI_SAFE_CROSS_DOMAIN_HANDOFFS` | 4 |
| `REAL_GEMINI_UNSAFE_CROSS_DOMAIN_HANDOFFS` | 0 |
| `GENUINE_PHOTOS_TESTED` | 3 |
| `REAL_GEMINI_VISION_VERDICT` | FAIL |
| `REQUIRED_VISUAL_CASE_TYPES` | 15 |
| `REPRESENTED_VISUAL_CASE_TYPES` | 1 |
| `REQUIRED_VISUAL_CASES_COMPLETE` | NO |
| `GENUINE_IMAGE_CATALOG_IDENTITY_SCORED` | NO |
| `REAL_GEMINI_COMPARISON_VALID` | YES |
| `REAL_GEMINI_CREDENTIAL_STATUS` | AUTHENTICATED |
| `REAL_GEMINI_TEXT_REQUESTS` | 158 |
| `REAL_GEMINI_VISION_REQUESTS` | 6 |
| `REAL_GEMINI_OBSERVED_TEXT_PROVIDER_CALLS` | 158 |
| `REAL_GEMINI_OBSERVED_VISION_PROVIDER_CALLS` | 6 |
| `REAL_GEMINI_TEXT_REQUEST_ATTEMPTS` | 158 |
| `REAL_GEMINI_VISION_REQUEST_ATTEMPTS` | 6 |
| `REAL_GEMINI_OBSERVED_REQUEST_ATTEMPTS` | 164 |
| `REAL_GEMINI_OBSERVED_PROVIDER_USAGE_RECORDS` | 164 |
| `REAL_GEMINI_CAMPAIGN_UNPRICED_OR_PENDING_REQUESTS` | 0 |
| `REAL_GEMINI_ROUTE_EXECUTED_TURNS` | 200 |
| `REAL_GEMINI_ROUTE_NOT_RUN_TURNS` | 0 |
| `REAL_GEMINI_FALSE_REFUSAL_SLOTS` | 0 |
| `REAL_GEMINI_PROVIDER_USAGE_RECORDS` | 109 |
| `REAL_GEMINI_REQUEST_ATTEMPTS` | 109 |
| `REAL_GEMINI_UNPRICED_PROVIDER_CALLS` | 0 |
| `REAL_GEMINI_REJECTED_CAMPAIGN_ATTEMPTS` | 0 |
| `REAL_GEMINI_FALSE_REFUSAL_TURNS_EXPECTED` | 15 |
| `REAL_GEMINI_FALSE_REFUSAL_TURNS_EVALUATED` | 15 |
| `REAL_GEMINI_FALSE_REFUSAL_TURNS_NOT_EVALUABLE` | 0 |
| `REAL_PROVIDER_ESTIMATED_COST_USD` | 0.033314250000000004 |
| `REAL_OBSERVED_PRICED_USAGE_ESTIMATE_USD` | NOT_APPLICABLE |
| `REAL_GEMINI_STATUS` | PASS |
| `REAL_GEMINI_QUALITY_VERDICT` | PASS |
| `REAL_GEMINI_RUNNER_PROVENANCE` | PASS |
| `SUPPLEMENTARY_GEMINI_PRO_DIAGNOSTIC_RUNS` | NOT_RUN |
| `SUPPLEMENTARY_GEMINI_PRO_REQUESTS` | 0 |
| `SUPPLEMENTARY_GEMINI_PRO_VISION_REQUESTS` | 0 |
| `SUPPLEMENTARY_GEMINI_PRO_ESTIMATED_COST_USD` | 0 |
| `SUPPLEMENTARY_GEMINI_PRO_WORST_CASE_RESERVED_USD` | 0 |
| `SUPPLEMENTARY_GEMINI_PRO_CATEGORY_MATCH_OBSERVATIONS` | 0 |
| `SUPPLEMENTARY_GEMINI_PRO_COLOR_MATCH_OBSERVATIONS` | 0 |
| `GEMINI_LITE_PHOTO_FOLLOW_UP_RUN` | NOT_RUN |
| `GEMINI_LITE_PHOTO_FOLLOW_UP_CODE_BINDING` | NOT_RUN |
| `GEMINI_LITE_PHOTO_FOLLOW_UP_REQUESTS` | NOT_MEASURED |
| `GEMINI_LITE_PHOTO_FOLLOW_UP_VISION_REQUESTS` | NOT_MEASURED |
| `GEMINI_LITE_PHOTO_FOLLOW_UP_COST_USD` | NOT_MEASURED |
| `GEMINI_LITE_PHOTO_FOLLOW_UP_RESERVED_USD` | NOT_MEASURED |
| `GEMINI_LITE_PHOTO_FOLLOW_UP_IDENTITY_SCORED` | NO |
| `REAL_GEMINI_HELDOUT_EVALUATION` | NOT_RUN |
| `CUSTOMER_USEFULNESS_SCORE` | NOT_MEASURED |
| `V13_DISTINCT_CAMPAIGN_LEDGER_COUNT` | 23 |
| `V13_AGGREGATE_CAMPAIGN_REQUESTS` | 2949 |
| `V13_AGGREGATE_CAMPAIGN_VISION_REQUESTS` | 133 |
| `V13_AGGREGATE_UNKNOWN_USAGE_REQUESTS` | 5 |
| `V13_AGGREGATE_ESTIMATED_COST_USD` | 0.6796032789999998 |
| `V13_AGGREGATE_WORST_CASE_RESERVED_USD` | 5.667497025999999 |
| `V13_SUM_OF_CAMPAIGN_CEILINGS_USD` | 37.42 |
| `V12_CONSERVATIVE_TASK_SERIES_EXPOSURE_USD` | 2.33973275 |
| `AUTHORIZED_AGGREGATE_BUDGET_USD` | 10 |
| `COMBINED_RESERVED_EXPOSURE_USD` | 8.007229775999999 |
| `REMAINING_AGGREGATE_AUTHORIZATION_USD` | 1.992770224000001 |
| `AGGREGATE_BUDGET_RECONCILIATION` | WITHIN_AUTHORIZATION_BY_MANUAL_RECONCILIATION |
| `PROVIDER_BUDGET_EXHAUSTED` | NO |
| `POSTGRES_INTEGRATION` | PASS |
| `REDIS_INTEGRATION` | PASS |
| `MESSAGE_WORKER_INTEGRATION` | PASS |
| `WEBHOOK_PIPELINE` | PASS |
| `PRODUCT_SEARCH_INTEGRATION` | PASS |
| `FAKE_META_TRANSPORT` | PASS |
| `BACKEND_REGRESSION` | PASS |
| `PLAYWRIGHT_E2E` | PASS |
| `SECURITY_TESTS` | PASS |
| `PRIVACY_SCAN` | PASS |
| `INDEPENDENT_VERIFICATION` | PASS |
| `BASELINE_COMPARISON_VALID` | YES |
| `DETERMINISTIC_SOURCE_TRUTH_VERDICT` | PASS |
| `CUSTOMER_TRUTH_VERDICT` | PASS |
| `CUSTOMER_TRUTH_VERDICT_SCOPE` | DETERMINISTIC_SOURCE_REPLAY_ONLY |
| `COMMERCIAL_EVIDENCE_VERDICT` | NOT_ESTABLISHED |
| `AUTOMATED_QA_VERDICT` | FAIL |
| `INTEGRATION_READY` | NO |
| `OTHER_AGENT_WORKTREES_TOUCHED` | NO |
| `PRODUCTION_CHANGED` | NO |
| `PUSHED` | NO |
| `MERGED` | NO |
| `DEPLOYED` | NO |
| `PRODUCTION_RELEASE_NOT_AUTHORIZED` | YES |
