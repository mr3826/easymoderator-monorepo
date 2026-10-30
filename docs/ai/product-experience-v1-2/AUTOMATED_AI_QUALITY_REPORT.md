# Automated AI Quality Report

## Scored outcomes

The real Gemini receipt executed 200/200 CSV turns. Only 4/200 were labeled source-answerable product turns; all 4 were correct. Five eligible fact slots were scored and all five were correct. No unnecessary refusal occurred among those eligible facts. Four synthetic vision fixtures passed schema, category, and color checks.

These small denominators do not support a broad product-accuracy pass. The semantic target evaluator was not run; a scored context-retention metric is unavailable. Naturalness, product identification across representative catalogs, context reset/continuity accuracy, and semantic unsupported claims remain unmeasured. Numeric unsupported-price claims sent were 0. One candidate associated a catalog-item price with an unidentified image; this unsupported product-image association was blocked before the validated reply. The evidence does not establish that the catalog price itself was false. The 46 `SAFE_FALLBACK` dispositions are not 46 observed Gemini hallucinations.

## Failure and correction record

The redacted trace and triage evidence show that grounding blocked an unsupported association between a catalog-item price and an unidentified image. The validated reply did not repeat that price, and no send occurred. No fixture truth or expected answer was changed to improve the result. The Browser export waiter and trace-archive metadata privacy gaps were also corrected and reverified; those are QA/evidence-tool corrections, not model-quality improvements.

## Verdict

`PRODUCT_EVALUATION_PASS=NO` for the full requested quality target. The bounded scored outcomes passed their local assertions, but broad semantic, context, and merchant-usefulness acceptance criteria were not measured. Do not infer sales impact, merchant ROI, or zero hallucination risk.
