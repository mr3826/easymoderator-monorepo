# Real Model and Vision Results

## Real Gemini replay

Receipt: `artifacts/runs/471add4a-f2c5-44c8-8a9f-2e156a731a10.json`.

| Metric | Result |
|---|---:|
| Model | `gemini-3.1-flash-lite` |
| Source turns executed | 200/200 |
| Presentation contracts valid | 200/200 |
| Text calls | 64 |
| Synthetic-raster vision calls | 4 |
| Total requests / failed / retries | 68 / 0 / 0 |
| Answerable product turns correct | 4/4 of 4/200 total turns |
| Eligible fact slots correct | 5/5 |
| Unnecessary refusals on those slots | 0 |
| Tenant violations / unscoped catalog reads | 0 / 0 |
| Actual Messenger sends / business mutations | 0 / 0 |
| Provider-reported / committed run cost | `$0.01465225` / `$0.01465225` |

In one reviewed case, a candidate associated a catalog-item price with an unidentified image. Grounding rejected this unsupported product-image association; the validated reply withheld the price. The evidence does not establish that the catalog price itself was false. `unsupportedPriceClaimsSent=0` is a narrow numeric currency-prefixed metric, not a semantic hallucination rate. Broad semantic evaluation and scored context retention were not run. The 46 `SAFE_FALLBACK` local dispositions are evaluation decisions, not observed Gemini hallucinations.

## Credential scope

`GEMINI_KEY_AVAILABLE=YES`; `GEMINI_AUTH_VERIFIED=YES` for the successful bounded run.

The successful run used the host-injected Process-scope `EM-GEMINI-KEY`. A later check found no Windows User-scope value. No User-only replay was made, no persistent variable was created, and no credential content or fingerprint was recorded. The credential was not sent to the browser or included in artifacts.

## Vision

Gemini processed four synthetic raster fixtures. All passed schema/category/color checks. No customer or merchant photos were supplied. Thus `REAL_PROVIDER_VERIFIED=YES` for this bounded model run, while `REAL_VISION_VERIFIED=NO` for representative merchant/customer image behavior.
