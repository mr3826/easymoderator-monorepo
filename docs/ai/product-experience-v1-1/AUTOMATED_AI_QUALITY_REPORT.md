# Automated AI Quality Report

## Deterministic factual evaluation

- Supplied simulator: **2/2 answerable product fact slots correct**, across 200 sequentially replayed turns; all other 198 turns were classified not answerable from available synthetic/offline evidence.
- Fixed synthetic evaluation: **8/8 answerable fact slots correct across 7 cases** (6 answerable cases); tenant isolation and presentation contracts passed.
- Candidate unsupported claims sent: **0**.
- Candidate unnecessary refusals on the defined answerable slots: **0**.
- Tenant-scope violations and unscoped catalog reads: **0**.
- Baseline synthetic fact accuracy: **5/8**; baseline full replay: **0/2** eligible product slots correct.

Facts were checked against structured product fixtures and response evidence, not an AI judge. The oracle ignores source expected-answer text as truth. A deterministic router regression added during final correction verifies both that product identity questions containing attribute words in the exact title can receive a catalog card, and that an attribute question outside that title remains on the fact-verification path.

The intentionally unsafe `unsafe-price-claim` P1 triage fixture is preserved under `artifacts/triage/`. The adversarial mock candidate was blocked: `BLOCKED_BY_GROUNDING`, `SAFE_FALLBACK`, reason `UNSUPPORTED_DOMAIN_CLAIM`; the artifact records the disposition and structured evidence fields without persisting the raw candidate or a response digest.

## Failure and refusal interpretation

Candidate recorded 61 safe fallbacks and 139 sends across all domains. A safe fallback is neither automatically correct nor an unnecessary refusal. None of the 2 eligible fact slots was unnecessarily refused; 118 product-identity turns remained unresolved by the synthetic catalog, and 20 image-dependent turns were excluded because real vision did not run. No empty response was counted as a correct product answer.

## Quality boundary

This is a scoped automated local pass, not evidence of broad natural-language quality, merchant-level answerability, policy correctness, order/payment/courier state, or visual correctness. Bangla/Banglish quality judging, robustness repeats with real models, and real vision are `NOT_RUN`. See [coverage](DATASET_ORACLE_AND_COVERAGE.md) and [real provider limits](REAL_MODEL_AND_VISION_RESULTS.md).
