# Independent Verification - Product Engine V1.3

**Verdict: PASS for candidate/source binding, the paid matched comparison, and cost archive reconciliation. Product QA remains FAIL and integration readiness remains NO.**

## Reviewed candidate and paid run

- Code commit: `33ca2b76f1fe8f43dce10523ddfec3ab7ff9860d`
- Backend SHA-256: `e1168c0e5e9cf6132a379053144f85e94089c4c430664de1f62716f26e6a11fa`
- Runner SHA-256: `7b19413df9db2aa646bf6270ef43c24cfdd7dd0e6e1a53521d6451f85d3df3c3`
- Paid source comparison `dd4306c3-194b-48a0-baae-811e21916c38` passed with the same 200-turn denominator and exact candidate/runner binding. Baseline and candidate estimated costs were $0.01181775 and $0.02149650; pair total $0.03331425. All 164 usage records were priced and no attempts were rejected.
- Candidate quality: 18/18 fact slots, 15/15 answerable turns, 13/13 context turns, and 4/4 safe cross-domain handoffs passed. Unsupported claims and false refusals were zero.

## Cost reconciliation

All 23 distinct latest V1.3 campaign ledgers are included in the package and each archived SHA-256 matches its source reference. Totals are 2,949 requests, 133 vision requests, and five unknown-usage requests; estimated V1.3 usage is $0.679603279 and reserved exposure is $5.667497026. The archived V1.2 proof hash matches and its conservative exposure is $2.339732750. Combined reserve is $8.007229776 against the manually reconciled $10 authorization, leaving $1.992770224. Provider invoices are unavailable. The sum of individual campaign ceilings is $37.42, so aggregate authorization is not globally enforced. Call-level and ledger estimates differ by about $0.000000029 from floating-point aggregation.

The tooling fix in commit `998e2381b5c699a3b2b1a55a9d41548beb67fada` marks reconciliation incomplete when a ledger is missing inside a discovered campaign directory and archives checksum-verified inputs. Entire campaign roots missing from workspace inventory remain undetectable.

## Product and verification limits

Three genuine photos were evaluated: category matched 2/3 and visible color matched 3/3; catalog identity was not scored and only 1/15 required visual case types is represented. Product QA is **FAIL** and integration readiness is **NO**. Twelve standalone rasters are not OCR-scanned. No live Meta delivery, production behavior, adoption, conversion, or ROI was established.

The original verifier receipt remains `complete=true`, `status=FAIL`; its earlier privacy result is preserved. A subsequent clean-root scan passed but predates the current proof. The final proof-inclusive package scan and checksum manifest are recorded separately after proof regeneration. The reviewer did not rerun tests or providers; the recorded offline primary test run passed 3 suites / 68 tests on the tooling commit.

## Final package-only follow-up

A second read-only follow-up reviewed the latest proof after the post-proof scan and checksum manifest were regenerated. It confirmed these exact hashes:

- Proof JSON: `02a3969c92592bba7bf0ca4efa485fb530e3c04df8938ed8c75346602dce572c`
- Archived and worktree proof Markdown: identical; `2bc71da2df1223715594a7319c0fbc60ecbb585a6388774b3f7808a6906f6efb`
- Privacy scan: `2f7d7ec4c6d74518479c2973433adc6681dda9b74e1e8c804e6d5a37e90a8955`; checked `2026-10-23T20:25:57.443157Z`; PASS.
- Checksum manifest: `2a02fbab54bf8d313d2c7ce79d43d5bedd0e80fb8d91a3de465f193833c4781d`; all 308 entries recomputed successfully: 307 package files plus `customer-simulator.csv`. Duplicates, missing, mismatched, out-of-scope, and unlisted entries: zero.

The final scan had zero parse errors, source-contact matches, and sensitive-pattern matches. Twelve standalone rasters were not OCR-scanned. Candidate commit, backend SHA, and runner SHA remain bound to `33ca2b76f1fe8f43dce10523ddfec3ab7ff9860d`, `e1168c0e5e9cf6132a379053144f85e94089c4c430664de1f62716f26e6a11fa`, and `7b19413df9db2aa646bf6270ef43c24cfdd7dd0e6e1a53521d6451f85d3df3c3` respectively. Product QA remains **FAIL** and integration readiness **NO**.

The proof's embedded audit section records the immediately preceding package snapshot; the scan and manifest listed here were generated afterward and independently verified against the latest proof. The original verifier receipt remains unchanged at `complete=true`, `status=FAIL`. The final reviewer made no edits, tests, or provider calls.
