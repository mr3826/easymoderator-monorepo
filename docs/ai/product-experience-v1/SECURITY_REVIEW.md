# Security review

## Implemented controls

- Product evidence requires an explicit `shop_id`/`shopId` equal to the current tenant. Contextual products and ID re-reads are also shop-scoped.
- Product media requires HTTPS, an exact configured public asset/API origin, a path under `/uploads/product-images/{shopId}/`, and a safe filename. A matching path on an untrusted host or URL with credentials is rejected. The same evidence URL and product identity are required before an image attachment is built.
- The outbound gate binds explicit product names to the verified catalog rows for price and stock claims. Bare price claims require one unambiguous product; unequal or unknown active variant prices require a named variant. Policy fees are accepted only when the amount is locally tied to a fee/charge label, so a delivery mention elsewhere in the sentence cannot authorize a product price.
- The outbound gate rejects unsupported prices and foreign currency codes, stock/variant availability, unknown attributes, URLs, and delivery/order/payment commitments. Delivery location, polarity, and timelines must match policy evidence. Payment methods must match the live accepted-method line, and a claimed payment destination must match its configured number; unrelated contact numbers do not authorize it. Claim evaluation is scoped to relevant clauses and evidence categories. Safe fallbacks omit parent prices whenever active variant records make that price ambiguous.
- Active FAQ rows are re-read for the same shop before cached or vector-derived FAQ text is trusted. FAQ evidence carries a snapshot for send-time comparison. Generic non-FAQ RAG has no verifiable snapshot and is held from automatic send.
- Product facts, active FAQ evidence, and the current payment/delivery operating-context hash are revalidated after the automatic-send boundary is claimed. Changed or missing rows hold the reply for human review. Read failures throw retryable errors.
- Current customer text, recent conversation messages, and quoted reply text/file names are scrubbed for recognizable Bangladesh phone and email patterns before the provider boundary. The 200-turn local replay detected zero such patterns in fake-provider prompts and persisted no source cells.
- Prompt-injection cases are covered by the grounding-boundary and router suites. The inbound synthetic image labeled for prompt injection was not passed to a model.

## Evidence

Focused tests cover cross-tenant and ownerless rows, media origin and path ownership, product-identity-bound price/stock claims, variant price/availability, fee attribution, unlisted currency codes, payment-method and exact-recipient authorization, Bengali recipient digits, location-specific delivery scope and timelines, material unknowns, quoted-context PII scrubbing, FAQ cache invalidation, prompt-injection blocking, retrieval failures, and stale evidence at automatic send. The local route replay recorded zero tenant-scope violations and zero unscoped fixture reads.

## Residual security limits

- The route replay mocks catalog, FAQ, cache, action audit, and provider calls. It does not prove production database query scoping, transaction races, Redis isolation, worker concurrency, or provider delivery behavior.
- No real image bytes or vision model were evaluated. The fixture SVGs exercise only local file metadata; media injection behavior in a real vision request remains unverified.
- Non-FAQ RAG answers are intentionally held at the automatic-send boundary until they have a verifiable same-shop source snapshot.
- Legacy or external media that does not use the tenant-owned upload path is deliberately unavailable to this renderer until a trusted path is provided.
- The PII check covers recognizable phone/email patterns, not arbitrary sensitive text or every Unicode obfuscation.

No production or staging systems, credentials, databases, provider accounts, queues, or Meta APIs were used.
