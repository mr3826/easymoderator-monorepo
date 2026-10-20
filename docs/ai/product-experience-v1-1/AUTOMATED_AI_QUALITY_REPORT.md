# Automated AI Quality Report

## Deterministic factual evaluation

- Supplied simulator: **2/2 answerable product fact slots correct** across 200 sequential turns; all other 198 turns were not answerable from available synthetic/offline evidence.
- Fixed synthetic evaluation: **8/8 answerable fact slots correct across 7 cases** (6 answerable cases); tenant isolation and presentation contracts passed.
- Baseline synthetic fact accuracy: **5/8**; baseline full replay: **0/2** eligible product slots correct.
- Candidate unsupported claims sent: **0**; unnecessary refusals on the two eligible slots: **0**.
- Tenant-scope violations and unscoped catalog reads: **0**.

Facts were checked against structured product fixtures and response evidence, not an AI judge. The oracle ignores source expected-answer text as truth. The deterministic router regression verifies that a product identity question containing attribute words in the exact title can receive a catalog card, while an attribute question outside that title remains on the fact-verification path.

The intentionally unsafe `unsafe-price-claim` P1 triage fixture is preserved under `artifacts/triage/`. The adversarial mock candidate was blocked as `BLOCKED_BY_GROUNDING` / `SAFE_FALLBACK`, reason `UNSUPPORTED_DOMAIN_CLAIM`; the artifact records structured disposition and evidence fields without persisting the raw candidate or a response digest.

## Automated regression and integration

- Full backend Jest suite: **282/282 suites and 3,614/3,614 tests passed** in 102.541 seconds with Node `v24.19.0`, task-owned disposable Redis, and the Node no-egress preload. An initial attempt without the expected Redis service timed out; the successful run used the disposable Redis endpoint.
- Focused product-evidence hardening suite: **81/81 tests passed**, including English and Bengali material/title boundaries, supported claims, and title-only controls.
- Selected real-stack integration: **3 suites / 12 tests passed**; webhook-to-worker pipeline: **1 suite / 45 tests passed**. See [Local Integration Results](LOCAL_INTEGRATION_RESULTS.md).
- Playwright: **2 Chromium tests passed**, zero retries, in 70 seconds. See [Playwright E2E Report](PLAYWRIGHT_E2E_REPORT.md).

## Failure and refusal interpretation

The candidate recorded 61 safe fallbacks and 139 sends across all domains. A safe fallback is neither automatically correct nor an unnecessary refusal. None of the two eligible fact slots was unnecessarily refused; 118 product-identity turns remained unresolved by the synthetic catalog, and 20 image-dependent turns were excluded because real vision did not run. No empty response was counted as a correct product answer.

## Quality boundary

This is a scoped automated local pass, not evidence of broad natural-language quality, merchant-level answerability, policy correctness, order/payment/courier state, or visual correctness. Bangla/Banglish quality judging, robustness repeats with real models, and real vision are `NOT_RUN`. See [coverage](DATASET_ORACLE_AND_COVERAGE.md) and [real provider limits](REAL_MODEL_AND_VISION_RESULTS.md).
