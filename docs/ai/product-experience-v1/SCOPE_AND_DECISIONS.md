# Scope and decision records

## Scope

Extend the existing backend router, grounding service, product-search boundary, controller, and message worker. Add a validated product presentation contract, deterministic fixtures, and offline replay evidence. Preserve product/order/payment/courier ownership and the current release boundary.

Out of scope: new model providers, vector stores, product UI redesign, mobile work, schema migrations, real provider calls, real image-recognition evaluation, live databases, Messenger sends, staging, deployment, merge, and push.

## Decisions

### D-01 — Extend current routing and grounding

- **Problem:** product facts and customer-facing presentation were fragmented across existing paths.
- **Existing implementation:** `intent-router.service.js`, `grounding/`, and `product-search.service.js` already owned routing, evidence, and retrieval.
- **Options:** replace the router; add a new orchestration service; extend existing boundaries.
- **Value / cost / risk:** extending these paths gives merchants consistent facts with no new runtime service or inference tier. It carries less operational and compatibility risk than a second engine.
- **Chosen:** extend existing modules and add a small `product-experience/product-presentation.js` DTO and Messenger text adapter.
- **Rejected:** new database, model, broker, or behavioral recommendation subsystem.
- **Evidence:** baseline code map and the 20-suite final product and order-boundary regression run.
- **Independent verdict:** pending Agent H final review.

### D-02 — Require explicit tenant ownership and configured-origin tenant media

- **Problem:** an unscoped or foreign product/media row must not become merchant evidence.
- **Existing implementation:** the search query accepts `shopId`; evidence resolution and media filtering were less strict than the tenant boundary requires.
- **Options:** trust caller filtering; recheck explicit `shop_id`; infer owner from product names or media URLs.
- **Chosen:** require explicit matching `shop_id`/`shopId`, and accept only HTTPS product-image URLs from the configured public asset/API origins, under `/uploads/product-images/{shopId}/`, with a safe single filename. URL credentials and untrusted origins are rejected.
- **Merchant/customer value:** only the current shop's catalog and authentic merchant media can be presented.
- **Cost / operations:** no new infrastructure; external/legacy media without the tenant upload path remains unavailable until migrated to trusted storage.
- **Security / compatibility:** fails closed and does not change the product row schema.
- **Evidence:** cross-tenant, missing-owner, media provenance, and hostile-origin tests.
- **Independent verdict:** pending Agent H final review.

### D-03 — Treat mutable catalog and policy evidence as live, typed authority

- **Problem:** parent price could mask variant prices, FAQ/cache answers could lose their source authority, stale prices or stock could reach an automatic send, and stale payment/delivery settings or generic RAG could be mistaken for sendable evidence.
- **Existing implementation:** cache, FAQ, catalog, and provider-send logic already exist.
- **Options:** cache mutable replies; revalidate evidence at the send boundary; move policy facts into the product engine.
- **Chosen:** preserve policy/knowledge provenance through cache, bind explicit product names and variant prices to the matching verified row, require local fee/charge labels for delivery fees, re-read active FAQ rows within the same shop, avoid caching generic RAG answers, and re-read relevant product rows plus the current operating-context hash after send-boundary claim and before provider send. A changed or unavailable row is held for human review or retried on read failure. Generic non-FAQ RAG has no verifiable FAQ snapshot and is held from automatic send.
- **Value / cost:** avoids repeated policy hallucinations and stale product or operating facts. Product-grounded sends incur an indexed product reread; FAQ and policy-grounded sends also incur same-shop FAQ or settings reads at the send boundary. The replay mocks these reads, so their production latency and database cost are not measured.
- **Security / compatibility:** product engine does not own order, payment, courier, or merchant policy writes.
- **Evidence:** router cache/FAQ tests and worker stale-evidence tests.
- **Independent verdict:** pending Agent H final review.

### D-04 — Suppress ambiguous facts in the presentation contract

- **Problem:** variants may have different prices or unknown stock; a single parent price can mislead.
- **Options:** show parent price; choose a variant by size/color conventions; report unknown until one variant is identified.
- **Chosen:** a unique variant explicitly named in the current message is selected; a prior selection may carry forward only from the latest grounded same-shop assistant turn, while an explicit, invalid, or ambiguous current option replaces or clears that prior selection. The router re-reads the product under the current shop and matches the stored variant ID to live catalog data. Differing, missing, or unknown variant prices suppress the parent price, including in safe fallbacks. Null variant quantity means `UNKNOWN`, not zero stock.
- **Customer value:** customers see verified options without fabricated size, availability, or price.
- **Cost / compatibility:** deterministic; DTO version `1`; BDT default; no migration.
- **Evidence:** variant and presentation contract tests plus outbound product-identity and ambiguous-price checks.
- **Independent verdict:** pending Agent H final review.

### D-05 — Use two offline replays and label their limits

- **Problem:** a safe synthetic resolver trace alone does not exercise route orchestration or show how unsupported model claims are handled.
- **Chosen:** keep the deterministic evidence replay and add a sequential 200-turn replay through the production `intent-router.route()` and outbound grounding gate with a local fake model that returns unsupported claims. Database, FAQ, cache, audit, search, and provider collaborators are mocked.
- **Value / cost:** proves deterministic routing and send-gate behavior without paid calls or business writes.
- **Limit:** it is not a real database, worker, provider, image-recognition, or Messenger integration test.
- **Evidence:** [200-turn-replay.json](artifacts/200-turn-replay.json) and [production-router-replay.json](artifacts/production-router-replay.json).
- **Independent verdict:** pending Agent H final review.
