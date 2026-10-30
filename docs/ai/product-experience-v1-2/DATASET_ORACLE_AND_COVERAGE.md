# Dataset Oracle and Coverage

## Source preservation

The source `D:\easymod\customer-simulator.csv` remains byte-for-byte unchanged: SHA-256 `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`, 200 rows, 20 personas. The evaluation scanner checked 397 distinct simulator message/truth values and 616 distinct long cell values. The CSV itself is not copied into the evidence package.

## Real-provider coverage

Receipt `artifacts/runs/471add4a-f2c5-44c8-8a9f-2e156a731a10.json` executed all 200 route turns and validated all 200 presentation contracts. The source labels support only 4 answerable product turns; 4/4 were correct. Five eligible fact slots were scored; 5/5 were correct with zero unnecessary refusals for those slots. Other turns include non-product, unknown, or handoff scenarios and must not be folded into product answer accuracy.

The run recorded 154 local `SEND` dispositions and 46 `SAFE_FALLBACK` dispositions. These are evaluation decisions only: zero Messenger messages were actually sent and zero business mutations occurred. The bounded numeric unsupported-price-sent metric was zero; semantic unsupported claims were not independently scored. A saved Gemini candidate associated a catalog-item price with an unidentified image. The grounding gate blocked that unsupported product-image association; the catalog price itself was not shown false. The 46 fallback dispositions are not 46 observed Gemini hallucinations.

## Synthetic catalog and vision coverage

Four synthetic raster inputs were processed by Gemini. All four outputs passed schema, category, and color checks. No simulator customer photograph was used. These fixtures do not support claims about live merchant image recognition or customer-uploaded photo quality. Synthetic catalog fixture counts and provenance are recorded separately in `artifacts/triage/SYNTHETIC_MEDIA_PROVENANCE.json`.

## Comparison and missing metrics

The mock baseline and candidate had different eligible denominators (4 versus 3); see `BASELINE_CANDIDATE_COMPARISON.md`. No improvement delta is claimed. Broad target-language quality, semantic hallucination rate, scored multi-turn context retention, product identification over a representative catalog, cost per resolved inquiry, and merchant ROI were not measured.
