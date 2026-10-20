# Dataset validation

## Source handling

- Source file: `D:\easymod\customer-simulator.csv` (read-only input).
- SHA-256: `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`; size: 44,958 bytes.
- The source contains **9 recognized columns**, **20 persona groups**, **10 ordered turns per group**, **200 scenarios**.
- The supplied `BeforPersona_ID` spelling is accepted as the persona-id header. The parser preserves normalized field values in memory; it does not rewrite the CSV or the expected-answer text.
- No raw CSV row, customer message, profile, or PII is included in committed replay artifacts or fixtures. Artifacts retain only the source hash, aggregate tags, synthetic scenario ordinals, and fixture IDs.

## Aggregate scenario mix

| Input type | Turns |
| --- | ---: |
| TEXT | 179 |
| IMAGE_TEXT | 17 |
| IMAGE | 3 |
| IMAGE_IMAGE | 1 |

| Declared language | Turns |
| --- | ---: |
| Bangla | 46 |
| Banglish | 123 |
| English | 28 |
| Other | 3 |

There are 21 image-bearing turns and four explicit attachment identities (`image-1` to `image-4`). The original images were not provided. Four synthetic SVG substitutes and their checksums are documented in [media-fixtures/manifest.json](media-fixtures/manifest.json). The SVGs test the local media fixture path only; they do not establish vision accuracy. The route replay uses fake `fixtures.invalid` URLs and disables photo interpretation.

## Evidence-aware expected truth

The replay maps expected-answer text to aggregate evaluation categories only: outside product-module scope; merchant policy fixture required; media inspection required; live authoritative state required; should remain unknown without merchant evidence; or manual review. These tags never become product, policy, price, or stock evidence.

The synthetic shop catalog contains two tenants and nine records, including similar products with different prices, incomplete attributes, variants, contradictory stock data, missing media, and shop-specific policy fixtures. This is a contract and isolation smoke set; its coverage is too small to estimate real catalog recall or customer usefulness.
