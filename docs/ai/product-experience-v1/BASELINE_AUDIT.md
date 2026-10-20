# Baseline audit

**Baseline:** `07168f49066e4dc4a8e2a756621ac577a13c12bd`
**Isolated checkout:** `D:\easymod\easymoderator-product-engine-v1` on `feature/ai-product-experience-v1`
**Audit scope:** backend product intent, catalog evidence, media authorization, presentation, and outbound send boundary. No frontend, mobile, shared release, or deployment files were changed.

## Existing capability map

| Capability | Baseline state | Evidence and gap observed |
| --- | --- | --- |
| Messenger intake and async worker | EXISTS | `message-worker.js` owns the reply and provider-send lifecycle. |
| Intent routing | EXISTS | `intent-router.service.js` has greeting, FAQ, product, RAG, cache, and LLM paths. |
| Shop-scoped product search | PARTIAL | `product-search.service.js` searches catalog rows; returned candidates needed stricter owner checks and retrieval failures could be mistaken for no match. |
| Product evidence and factual gate | PARTIAL | `grounding/` resolves facts and validates candidates; variant pricing, option claims, policy authority, and some unsupported domain claims needed stronger checks. |
| Conversation product context | PARTIAL | Prior product references exist; current catalog rows must be re-read under the active shop before use. |
| Product media authorization | PARTIAL | Product images exist; tenant-owned upload provenance needed a fail-closed boundary. |
| Customer-photo interpretation | EXISTS, not evaluated here | Existing vision switch and extractor remain. Original dataset images and authorized real-model evaluation were unavailable. |
| Product presentation DTO / channel renderer | MISSING | No validated channel-neutral product presentation schema existed. |
| Stale evidence check at automatic send | PARTIAL | Candidate validation existed; mutable product facts needed a final shop-scoped re-read before provider send. |
| Order, payment, courier, and policy authorities | EXISTS outside product module | Product routing must hand off or remain uncertain; it does not perform these domain mutations. |

## Baseline regression evidence

- Four critical suites passed: **126 tests** at the baseline SHA. Details are in [initial-baseline-tests.json](artifacts/initial-baseline-tests.json).
- Direct baseline resolver replay: **193 `NOT_FOUND`, 6 `NONE`, 1 `VERIFIED`**, with related evidence on 48 turns and no identifying terms on the 6 `NONE` turns. The aggregate report is [initial-baseline-replay.json](artifacts/initial-baseline-replay.json).
- Dataset SHA-256: `892fb83191cc5fbfab48a30551f1095faedd5fd8ee2a238ccfa44a46b38254e6`.

These results establish a small offline baseline, not a live database, worker, Messenger, or model baseline. The dataset is adversarial and is not merchant truth.
