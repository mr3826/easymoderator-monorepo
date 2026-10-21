# V1 Evidence Verification

## Scope and revisions

- Repository: `D:\easymod\easy-moderator`; isolated checkout: `D:\easymod\_wt-verified-commerce-v1-2`.
- Branch: `feature/verified-commerce-foundation-v1.2`.
- V1.1 baseline: `78b6250af40039749f9c096cd3e0debe2e6cf6a7`.
- V1.2 implementation commit: `dd04c079f2b752725d372e879cb1549a8459b8d1`.
- Source dataset: `D:\easymod\customer-simulator.csv`, unchanged SHA-256 `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`.

## Claim-to-evidence map

| Claim | Evidence | Verification result |
|---|---|---|
| 200-row real-provider evaluation completed | `artifacts/runs/471add4a-f2c5-44c8-8a9f-2e156a731a10.json` and its redacted transcript | 200 turns executed; 68 Gemini calls; 0 actual Messenger sends or business mutations. |
| Small labeled product denominator passed | Same receipt | 4/4 answerable turns and 5/5 eligible fact slots correct; not broad quality proof. |
| Unsupported product-image association did not become the validated reply | Redacted conversation trace screenshot and triage artifacts | Candidate associated a catalog-item price with an unidentified image; grounding blocked the association, and the validated reply withheld the price. Evidence does not show the catalog price itself was false. |
| Current Test Lab journeys pass in installed engines | `artifacts/playwright/execution.json` run `0a2e2320-569e-479d-9878-2a40030a0519` | 6/6; no page/console/request errors; axe serious/critical count 0 across 9 sections per engine. |
| Historical real-stack integration passed | `artifacts/integration/e4008ad7-468b-4a4f-9e09-fdd55a7494a1.json` | 12 integration + 46 webhook tests; receipt source field is baseline SHA. Current-candidate refresh is not verified. |
| Sanitized evidence package passed privacy scan and checksum audit | `artifacts/final-qa/privacy-scan.json`, `playwright-trace-sanitization.json`, and `SHA256SUMS.txt` | Gate PASS; independent reviewer matched 440/440 package files; dataset is metadata-only. |

## Verification limits

The baseline/candidate comparison used mocked adapters with different eligible denominators. Real Meta, payment/courier, real merchant/customer image behavior, broad semantic target evaluation, context-retention scoring, merchant ROI, and current-candidate PostgreSQL/Redis integration remain unverified. See the specialized reports and `VERIFIED_COMMERCE_FOUNDATION_PROOF.md` for the detailed status matrix.

No production or staging data/configuration was changed. No release, push, merge, PR, Meta send, payment, courier booking, or order mutation was performed.
