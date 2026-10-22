# EasyModerator Product Engine V1.3 — Integration & Customer Truth Proof

Generated: 2026-10-22T15:18:07.003Z

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
- V1.3 tested code commit: `38b4be066b508ee25f7a43a11707139c5fc0f659` on `feature/product-engine-v1.3-customer-truth`.
- Evidence checkout: `D:\easymod\_wt-product-engine-v1-3`.
- Evidence package root: `D:\easymod\_product-engine-v1-3-evidence-final-20261022-09`.
- Backend source SHA-256: `8c2736021a3aeff9d69ab38782eab3a4803b8708d7d20b76cb246fb43d8ddeb7`.
- Worktree clean at verification start: **YES**.
- Worktree clean when the proof was generated: **NO**. Verification receipt: `D:\easymod\_product-engine-v1-3-evidence-final-20261022-09\regression\verify-694c0c21-a54c-43ab-8d86-ad52dfe731b6.json`.
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

Credential status: AUTHENTICATED; the process-scoped value is not recorded. Model: gemini-3.1-flash-lite. Provider-reported traffic across matched arms: 158 text and 6 vision calls. Request attempts across matched arms: 158 text and 6 vision. Candidate run ledger: 109 request attempts, 109 provider usage records, 0 rejected reservations. Estimated matched-pair spend from priced usage: $0.03366275; provider invoice: NOT_AVAILABLE. Candidate route coverage: 200/200 executed, 0 not run. Candidate quality gate: PASS; 18/18 fact slots and 15/15 answerable turns verified; context resolution failures 0 across 13/13 fully executed conversation chains (0 not evaluable); cross-domain safety 4 safe, 0 unsafe across 4/4 executed turns (0 not run). Runner provenance: PASS; paid/current runner hashes 6e1034df8e8c92b8e6d9a48415b57a2c8b91f34f4af63fa06a5f5dbfe34d205d/6e1034df8e8c92b8e6d9a48415b57a2c8b91f34f4af63fa06a5f5dbfe34d205d. Candidate unpriced provider calls: 0; all recorded candidate provider usage was priced.

Candidate false refusals: 0 slots across 15/15 evaluated/expected answerable turns (0 not evaluable).

Observed campaign activity remains in the cumulative ledger: 164/256 requests, 6/12 vision requests, 164 provider-reported calls and 0 unpriced or pending request(s). Estimated priced usage: $0.03366275; worst-case reserved: $0.29095925 of $2.00 ceiling. Invoice unavailable.

Provider estimates use reported token usage and a pinned local rate calculation. They are not billing records. The credential is process-scoped and is not copied into artifacts.

## F. Images

Photo acceptance verdict: **FAIL**. The completed paid matched run evaluated 3 unique licensed public photos. Category matches: 0/3; visible-color matches: 3/3; catalog identity: NOT SCORED. These are a small public-photo probe, not customer-upload accuracy evidence.

No source-corpus image pixels were available. The three independent photos are licensed public fixtures; results should not be generalized to customer photos. The detailed provenance and per-photo observations are in the machine-readable proof.

## G. Backend integration

Receipt status: **PASS**; PostgreSQL and Redis use a disposable project-scoped stack. Selected integration: 12 passed, 12 total; webhook pipeline: 46 passed, 46 total; full backend regression: 3971 passed, 3971 total. Receipts: `D:\easymod\_product-engine-v1-3-evidence-final-20261022-09\integration`.

Product search: **PASS**. Fake Meta transport: **PASS**. These checks do not establish production database behavior or live Meta delivery. Disposable service receipts: `D:\easymod\_product-engine-v1-3-evidence-final-20261022-09\integration`.

## H. Browser QA

Playwright exit code: 0; result: {"total":6,"passed":6,"failed":0,"skipped":0,"results":[{"status":"passed","project":"chromium","title":"tests\\product-engine-lab\\lab.spec.ts:44:1 › local Test Lab journeys, data boundaries, run history, and responsive controls","duration":"1.5m"},{"status":"passed","project":"chromium","title":"tests\\product-engine-lab\\lab.spec.ts:385:1 › loads the real Lab shell on every installed browser engine","duration":"519ms"},{"status":"passed","project":"firefox","title":"tests\\product-engine-lab\\lab.spec.ts:44:1 › local Test Lab journeys, data boundaries, run history, and responsive controls","duration":"1.8m"},{"status":"passed","project":"firefox","title":"tests\\product-engine-lab\\lab.spec.ts:385:1 › loads the real Lab shell on every installed browser engine","duration":"626ms"},{"status":"passed","project":"webkit","title":"tests\\product-engine-lab\\lab.spec.ts:44:1 › local Test Lab journeys, data boundaries, run history, and responsive controls","duration":"1.8m"},{"status":"passed","project":"webkit","title":"tests\\product-engine-lab\\lab.spec.ts:385:1 › loads the real Lab shell on every installed browser engine","duration":"650ms"}]}. Evidence: `D:\easymod\_product-engine-v1-3-evidence-final-20261022-09\playwright\execution.json`.

The Playwright runner starts a loopback Test Lab for the browser run and stops it afterward; no persistent Test Lab URL is claimed by this report.

## I. Security and privacy

- Security tests: **PASS**. Egress guard: PASS; blocked non-loopback attempts: 0.
- Tenant violations: 0; unscoped catalog reads: 0.
- Pre-proof artifact privacy scan: **PASS** at 2026-10-22T15:12:11.704378Z. The proof-inclusive post-generation scan and checksum manifest are `D:\easymod\_product-engine-v1-3-evidence-final-20261022-09\security\artifact-privacy-scan.json` and `D:\easymod\_product-engine-v1-3-evidence-final-20261022-09\security\artifact-checksum-manifest.txt`.
- No credential values are stored in the proof package.

## J. Cost and merchant economics

Estimated matched-pair provider cost from priced usage: $0.03366275. Candidate unpriced provider calls: 0. Rejected campaign ledger attempts: 0 (blocked before provider usage). All recorded provider usage was priced. Candidate cost per verified product-answer turn: $0.00146383; per verified fact slot: $0.00121986. Deterministic source replay router p50/p95: 1.014 ms / 3.53 ms. Paid candidate route p50/p95: 4292.737 ms / 5388.844 ms; baseline: 1.497 ms / 5111.596 ms. Paid candidate provider p50/p95: 1176 ms / 2192 ms (baseline 1195 ms / 2276 ms). These route timings exclude webhook, queue, database and customer-facing network latency.

No merchant time saved, adoption, order outcomes, conversion or ROI data exists in this test. Commercial evidence is therefore **NOT ESTABLISHED**.

## K. Baseline comparison

- Source comparison: Valid: **YES**. V1.2 verified answers: 7; V1.3 verified answers: 18. V1.2 context failures: 11; V1.3: 0 across 13/13 complete conversation chains. V1.3 context turns not evaluable: 0.
- Held-out comparison: Valid: **YES**. V1.2 verified answers: 28; V1.3 verified answers: 37.
- Paid Gemini source comparison: verified fact answers 7/18 baseline to 18/18 candidate; fully answered turns 5/15 baseline to 15/15 candidate. Quality verdict: PASS. Paid matched-pair estimated cost: $0.03366275; candidate $0.02195750 vs baseline $0.01170525 (REGRESSED). Paid route p95 outcome: REGRESSED; provider p95 outcome: IMPROVED. Paid public-photo probe: category 0/3, visible color 3/3; catalog identity NOT SCORED.
- Deterministic and paid model results are kept separate. Comparison outputs include dataset, oracle, catalog, engine-source and runner hashes.

## L. Independent verification

Verdict: **PASS**; reviewer: Independent Verification Agent (read-only); reviewed code commit: 38b4be066b508ee25f7a43a11707139c5fc0f659; reviewed runner hash: 6e1034df8e8c92b8e6d9a48415b57a2c8b91f34f4af63fa06a5f5dbfe34d205d.

The independent reviewer inspected frozen code SHA `38b4be066b508ee25f7a43a11707139c5fc0f659`, recomputed backend and runner hashes, audited the paid and deterministic comparisons plus integration, security, Playwright and privacy artifacts, and reran five focused non-paid suites (5/5 suites, 175/175 tests on Node v20.20.2). The reviewer did not repeat paid Gemini calls or the full integration and browser suites; those results remain supported by their recorded receipts. The final 147-entry manifest was independently recomputed with no invalid, duplicate, missing, mismatched, out-of-scope or unlisted entries. No source code changed after review.

## M. Remaining decisions

| Task | Classification | Evidence/status |
|---|---|---|
| Resolve any remaining text, context or vision failures | Required before integration | Deterministic source truth: PASS; paid Gemini quality: PASS; vision results are listed above. |
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

Machine-readable proof: `D:\easymod\_product-engine-v1-3-evidence-final-20261022-09\product-engine-v1.3-proof.json`.

| Status key | Value |
|---|---|
| `PROJECT` | EasyModerator |
| `MILESTONE` | Product Engine V1.3 |
| `GOAL` | Integration & Customer Truth Verification |
| `V1_2_BASE_SHA` | 957bb991a18db1949369a6f805822b8c8b69889b |
| `V1_3_BRANCH` | feature/product-engine-v1.3-customer-truth |
| `V1_3_FINAL_SHA` | 38b4be066b508ee25f7a43a11707139c5fc0f659 |
| `WORKTREE_CLEAN` | true |
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
| `REAL_PROVIDER_ESTIMATED_COST_USD` | 0.033662750000000005 |
| `REAL_OBSERVED_PRICED_USAGE_ESTIMATE_USD` | NOT_APPLICABLE |
| `REAL_GEMINI_STATUS` | PASS |
| `REAL_GEMINI_QUALITY_VERDICT` | PASS |
| `REAL_GEMINI_RUNNER_PROVENANCE` | PASS |
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
