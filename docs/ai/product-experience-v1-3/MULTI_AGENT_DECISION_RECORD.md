# Product Engine V1.3 Decision Record

This record captures the reviews that changed the V1.3 evidence plan and the
implementation decisions made from them. Source and model outputs remain
advisory until checked against the frozen catalog fixture and oracle.

## Review findings and decisions

| Review area | Finding | Decision |
|---|---|---|
| Dataset and photo review | The three licensed public garment photos show kurta-like garments. Two have lighting that makes exact color labels ambiguous; one has a comparatively clear pale checked pattern. | Keep the expected image labels broad, preserve each image's provenance and hash, and report category/color observations as a three-image probe. Do not infer accuracy on customer uploads from this small sample. |
| Merchant value and inference cost | V1.2 had a small source-answerable denominator and no merchant outcome, time-saved, order, adoption or ROI evidence. Token-based provider cost is an estimate rather than an invoice. | Freeze an independent oracle and held-out corpus, report exact denominators and provider usage separately, and state that ROI remains unproven. Keep a persistent $2 campaign ledger across baseline and candidate calls. |
| QA and security | Candidate Postgres/Redis integration had not been run. Prompt privacy did not cover formatted Bengali-digit mobile numbers. Destructive E2E fixture cleanup requires a disposable, owned database and Redis namespace. | Run the webhook and worker against an isolated Compose project with temporary Postgres/Redis, add Bengali and formatted phone scrubbing regressions, and preserve tenant-scoped re-fetch and transaction boundaries. |
| Architecture and transaction boundaries | Product selection must not acquire order, payment, reservation or courier authority. Context pointers are useful only if they are re-fetched under the active tenant before use. | Extend the existing intent router and evidence path. Re-read product IDs by tenant, preserve context only when an explicit category is compatible, and clear source-oracle context after an unidentified image. Keep order creation outside this product path. |

## Implemented changes

| Change | Evidence that justified it | Verification |
|---|---|---|
| Mask Bangladesh mobile numbers with Bengali digits and common separators before prompt construction. | Synthetic prompt-request assertions found formatted contact values could survive the old ASCII-only pattern. | Prompt sanitizer regression tests cover Bengali digits, separators, contact variants, and retained safe text. |
| Keep the exact replay clock aligned between V1.2 and V1.3. | A fixed future clock caused V1.2's uninjectable context TTL to reject history, invalidating a baseline comparison. | Source and held-out comparisons use the same current replay clock and matched denominators. |
| Re-fetch product pointers after policy, media, and numeric-size turns. | The source corpus exposed missing availability answers after Banglish `ache?`, numeric size follow-ups, and policy/media turns. | Intent-router tests and the 200-turn source/held-out comparisons exercise these sequences. |
| Keep same-category product context across unsupported fabric, fit, measurement, pocket, color-care, and transaction-policy turns; re-fetch again before answering. | Source and held-out replay showed size follow-ups losing their product after unanswerable attributes and payment/order turns. Explicit incompatible categories still start a fresh catalog lookup. | Intent-router regressions cover same-category reuse, cross-category rejection, policy/measurement persistence, and full source/held-out context-resolution counts. |
| Treat a request for the prior product's photo as a contextual lookup, while saying when the catalog has no stored image. | Held-out replay asked for a Panjabi photo after the item had already been identified; a generic catalog search returned a contradictory no-match plus alternative. | Router test checks the scoped re-fetch, product identity and honest photo-unavailable response; the deterministic held-out comparison verifies the text identity slot. |
| State that no order or delivery has been confirmed when a customer selects a size and supplies delivery details. | Replay showed the router could give a valid size/stock answer without clarifying that a separate order flow had not started. | Router and scorer regressions verify the catalog fact remains answerable while the transaction boundary is explicit. |
| Answer mixed product-price and delivery-fee questions with the verified product price and an explicit fee uncertainty. | The prior path suppressed the verified price when the customer combined catalog and delivery-policy questions. | Intent-router regression and deterministic oracle replay. |
| Preserve route-produced catalog references across attachment-metadata turns without inventing or replaying image pixels. | The source CSV carries attachment metadata but not image bytes; dropping every reference labeled as an image turn broke later context. | Replay-context test confirms only route-produced tenant-scoped references persist and the next answer re-fetches current products. |
| Exclude a 64-hex SHA-256 metadata value from the contact-pattern privacy scan while continuing to scan content and other fields. | A hash-shaped value falsely matched a phone-number heuristic and blocked otherwise private evidence artifacts. | Scanner regression confirms a checksum is accepted while phone-like values still fail. |
| Correct Meta E2E fixture queries and expectations to match the seeded catalog's exact identities and uncertainty contract. | Generic product phrases did not match exact fixture rows; a candidate material value marked AI-suggested was not verified merchant evidence. | Final webhook suite asserts the provider fallback reaches the grounding gate and the unsupported material is safely withheld. |
| Treat Bangla `একদাম` offers as merchant price policy, not a request to repeat the catalog price. | Replay showed a negotiated amount was entering catalog-price scoring and the router could answer with the listed price without addressing approval. | Oracle and router regressions assert policy authority, a localized verification response, no listed-price echo, and no provider call. |
| Score Bengali and Banglish policy handoffs from their meaning instead of an English-only phrase list. | Localized “team will let you know” and “shop-er sathe verify” replies were safe but were not counted as handoffs by the first scorer. | Scorer tests cover Bengali, Banglish and English policy escalation forms. |
| Exclude garment-length and body-measurement requests from product-variant answer scoring, and prevent explicit category switches from inheriting the prior product. | Replay exposed a length question being scored as a size answer and a women’s garment context carrying into a trousers/leggings request. | Oracle regressions assert no variant answer for the length question, no cross-category product inheritance, and source-only context advancement. |
| Redact contact spans while retaining safe commerce content in the evaluation transcript. | Replacing an entire turn containing a phone number hid the semantic text needed to investigate context failures. | Trace tests mask the phone, mask a delivery-location clause, and preserve the remaining product question; the artifact privacy scan checks generated receipts. |
| Generate and pin a held-out oracle during the one-command verification flow, and run the explicit backend security suite. | A generated held-out CSV without a matching oracle could reuse stale answerability labels; the earlier entrypoint did not invoke the dedicated security command. | The verification receipt records held-out oracle preparation and the isolated `test:security` result. |
| Keep intentional egress-denial probes out of the integration leak counter, pin the browser baseline to the frozen V1.2 SHA, and route V1.3 browser outputs to its own artifact root. | The first clean verifier run exposed expected DNS/TCP denial probes being counted as leaks, an obsolete browser baseline constant, and Playwright overwriting V1.2 artifacts. | Egress tests assert their isolated blocked-API records, the browser test checks `957bb991a18db1949369a6f805822b8c8b69889b`, and all V1.3 screenshots, traces, reports, and route receipts follow `LAB_ARTIFACT_ROOT`. |

## Boundaries retained

- No order creation, payment confirmation, stock reservation, courier booking,
  or delivery mutation is introduced by this milestone.
- PostgreSQL and Redis are disposable local services; the Meta HTTP transport is
  captured by tests. No live Meta customer delivery is claimed.
- The held-out corpus is synthetic and has no copied customer messages or
  hidden-answer fields.
- Any uncertainty in merchant catalog evidence remains an uncertainty in the
  customer response; blocked hallucinations count as safe holds, not successful
  answers.
- Merchant ROI, adoption, and operational time savings remain unmeasured.
