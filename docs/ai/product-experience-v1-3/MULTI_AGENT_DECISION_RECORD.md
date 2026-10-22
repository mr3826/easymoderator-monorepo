# Product Engine V1.3 Decision Record

This record captures the reviews that changed the V1.3 evidence plan and the
implementation decisions made from them. Source and model outputs remain
advisory until checked against the frozen catalog fixture and oracle.

## Review findings and decisions

| Review area | Finding | Decision |
|---|---|---|
| Dataset and photo review | The three licensed public garment photos show kurta-like garments. Two have lighting that makes exact color labels ambiguous; one has a comparatively clear pale checked pattern. | Keep the expected image labels broad, preserve each image's provenance and hash, and report category/color observations as a three-image probe. Do not infer accuracy on customer uploads from this small sample. |
| Merchant value and inference cost | V1.2 had a small source-answerable denominator and no merchant outcome, time-saved, order, adoption or ROI evidence. Token-based provider cost is an estimate rather than an invoice. The prior report divided candidate spend by verified fact slots while labeling the result cost per answer, and counted one rejected campaign reservation as an unpriced provider call. | Freeze an independent oracle and held-out corpus, report exact denominators and provider usage separately, report cost per verified answer turn separately from cost per fact slot, and describe rejected reservations apart from provider usage. State that ROI remains unproven. Keep a persistent $2 campaign ledger across baseline and candidate calls. |
| QA and security | Candidate Postgres/Redis integration had not been run. Prompt privacy did not cover formatted Bengali-digit mobile numbers. Destructive E2E fixture cleanup requires a disposable, owned database and Redis namespace. | Run the webhook and worker against an isolated Compose project with temporary Postgres/Redis, add Bengali and formatted phone scrubbing regressions, and preserve tenant-scoped re-fetch and transaction boundaries. |
| Architecture and transaction boundaries | Product selection must not acquire order, payment, reservation or courier authority. Context pointers are useful only if they are re-fetched under the active tenant before use. | Extend the existing intent router and evidence path. Re-read product IDs by tenant, preserve context only when an explicit category is compatible, and clear source-oracle context after an unidentified image. Keep order creation outside this product path. |
| Paid vision and policy-handoff review | Gemini returned broad or incorrect garment categories/colors for the public photos, populated a material observation, and the text reply offered a black Panjabi after failing to match a beige/mustard photo. A safe exchange-policy response (“I do not have confirmed information ... I would be happy to check with the shop”) was counted unsafe because the scorer did not recognize that phrasing. | Never trust image-inferred material; normalize it to null before catalog retrieval or reply construction. A photo can bind to a catalog item only when category and color are both present and exactly one catalog product verifies; otherwise suppress candidate products, prices, media, and context references and return a localized deterministic clarification. Mention that only the first photo was checked. Expand handoff scoring to accept explicit missing-information phrasing such as “do not have confirmed information,” while retaining unsupported-policy assertions as failures; cover the exact phrasing with a regression test. |
| Per-arm provider budget | The first paid candidate exhausted the 100-request per-arm invocation limit and left 12 turns not run even though the paired campaign ceiling allowed 256 total requests. | Set each matched-arm invocation to 128 requests and 6 vision requests under the unchanged $2 / 256 / 12 campaign-wide ledger. These are local invocation limits, not durable per-arm quotas; a repeated invocation can use remaining combined campaign allowance. This increases single-run coverage without raising the total authorized cap. |

## Implemented changes

| Change | Evidence that justified it | Verification |
|---|---|---|
| Mask Bangladesh mobile numbers with Bengali digits and common separators before prompt construction. | Synthetic prompt-request assertions found formatted contact values could survive the old ASCII-only pattern. | Prompt sanitizer regression tests cover Bengali digits, separators, contact variants, and retained safe text. |
| Keep the exact replay clock aligned between V1.2 and V1.3. | A fixed future clock caused V1.2's uninjectable context TTL to reject history, invalidating a baseline comparison. | Source and held-out comparisons use the same current replay clock and matched denominators. |
| Require approved, validated assistant output as context before evaluating a context-dependent false refusal. | Independent scorer review found that `productEvidence` is recorded before the outbound verdict, so `SAFE_FALLBACK`, `SUPPRESS`, or a blocked presentation could falsely activate later assistant context. | Focused regression cases verify that only an executed `SEND` disposition with a non-refusal reply and contract-valid `READY` presentation for the same product activates context; `NOT_FOUND` and unexecuted prior turns clear or invalidate it. This is replay approval evidence, not proof of Messenger delivery. |
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
| Keep photo-derived material out of retrieval and customer facts, and avoid presenting partial category/color retrieval as an exact catalog identity. | Paid customer-photo review showed a model-generated fabric value and a related black Panjabi offered after the garment photo failed to match. | The extraction prompt requires null material and the parser enforces it; the router returns a localized no-match response without related SKUs when full evidence is absent. Regression tests cover the parsed field, partial candidate, and multi-photo first-image notice. |
| Fail closed when photo extraction returns no usable identity. | Independent review demonstrated that an image with an unparseable extraction and no catalog evidence could still reach the text reply model, which could say an unrelated product was available; the outbound gate accepts that availability wording with `NONE` evidence. | Treat missing/invalid extraction and disabled vision like other unresolved photo identities. Return the existing deterministic photo clarification, clear product/media evidence before source references, and do not call the reply model. Preserve the existing retrieval-failure path when the catalog itself is unavailable. Router regressions assert the unsupported availability response cannot escape, malformed extraction short-circuits, and disabled vision does not infer a match. |
| Require product evidence for availability claims when product status is `NONE`. | Independent post-fix reviews found the shared outbound gate could accept subjectless stock assertions and misroute supported bare bKash/Nagad or delivery-option availability wording as stock. | Reject subjectless, named, generic-product, and deictic stock assertions with `NONE` evidence. Route pure delivery options and payment availability to their shop-policy gates, while unsupported delivery/payment claims still fail closed. Regression tests cover these policy-only wordings and the end-to-end grounding boundary. |
| Route and validate payment-only availability claims independently of product lookup. | Independent review found methodless “Payment is available” wording passed without configured payment policy, while a policy-backed bKash statement was blocked by unrelated `NOT_FOUND` product evidence. | Require at least one accepted merchant payment method for generic payment-availability wording. Exempt only pure payment-policy clauses from product stock and `NOT_FOUND` guards; the payment policy checker still rejects unsupported methods. Regressions cover generic claims with and without policy and supported/unsupported MFS claims under `NOT_FOUND`. |
| Separate delivery authority from payment policy text and require matching location scope. | Independent review found the `SHOP PAYMENT & DELIVERY` heading and “Cash on Delivery” row were treated as delivery evidence, allowing unsupported nationwide coverage; an unscoped delivery sentence also authorized a location-specific claim. | Delivery support sentences must contain an explicit delivery assertion or timeline, and pure payment clauses do not enter delivery validation. An unscoped policy supports only an unscoped claim; nationwide or location-specific claims need matching explicit coverage. Regressions preserve COD-only replies and block unsupported area and timeline claims. |
| Count explicit missing-policy replies as safe handoffs. | P15's customer-facing reply said “I do not have confirmed information regarding the exchange policy” and offered to check with the shop, but the scorer only recognized “I do not have information” without the intervening qualifier. | Extend the scorer's uncertainty language to allow confirmed or verified before information/details, test the exact reviewed reply, and retain unsupported policy assertions as unsafe. |
| Include useful transcript examples only after contact and address redaction, and include the archived proof in the privacy scan. | The proof needs concrete customer-facing examples, while a prior scan found source-text leakage from an earlier verifier attempt. | Render only Test Lab's already-redacted message/reply fields, re-scrub email and Bangladesh phone patterns, archive the Markdown under `reports/`, and scan that copy before receipt completion. |

## Follow-up decision — false-refusal context eligibility

```text
DECISION_ID: V13-FALSE-REFUSAL-CONTEXT-01
OBSERVED_PROBLEM: Two paid-run false-refusal slots were marked answerable from source-customer context alone. Neither case proved that the assistant had an active, grounded product pointer at the time of the query; one followed an earlier NOT_FOUND result and the other lacked an executed earlier chain.
MERCHANT_IMPACT: Prevents an inflated false-refusal count from driving an unsupported runtime change or overstating useful-answer defects.
CUSTOMER_IMPACT: Keeps unavailable or lost product context from being mislabeled as a verified answer opportunity.
CURRENT_IMPLEMENTATION: The first correction required prior executed turns and matching product evidence but still risked counting evidence collected before outbound policy as approved assistant output.
OPTIONS_CONSIDERED: Change runtime routing based on the two cases; trust customer-only source context as sufficient; accept any prior product evidence; make context-dependent slots not evaluable unless an earlier executed assistant turn had a SEND disposition for a non-refusal reply with a contract-valid READY presentation grounding the same product and the complete prior conversation remained executed.
RECOMMENDED_CHANGE: Correct only scorer eligibility. Require a complete executed prior chain and matching prior product evidence that passed outbound policy as a non-refusal SEND with a contract-valid READY presentation. Clear the active scorer context after a product NOT_FOUND. Keep direct, current-turn product lookups evaluable.
ALTERNATIVES_REJECTED: No runtime routing change because the cases do not demonstrate a product-engine false refusal with active assistant-grounded context. Do not remove the false-refusal metric or broaden the oracle.
SECURITY_IMPACT: No runtime or authorization change; preserve all existing grounding and tenant checks.
COST_IMPACT: None; scoring is local and makes no provider calls.
FUTURE_COMPATIBILITY: Uses existing redacted per-turn product IDs, evidence status, and execution status; no API, database, or fixture contract changes.
TESTABLE_ACCEPTANCE_CRITERIA: A context-only refusal without prior assistant grounding is not evaluated; only a matching prior SEND disposition with a non-refusal reply and contract-valid READY presentation is accepted as grounding; SAFE_FALLBACK, SUPPRESS, blocked presentation, or refusal do not activate context; NOT_FOUND or an unexecuted prior turn makes later context-dependent turns not evaluable; an explicit current-turn lookup remains eligible. Replay SEND disposition does not establish actual Messenger delivery.
IMPLEMENTATION_OWNER: Lead orchestrator / ResponseTrace scoring.
INDEPENDENT_CHALLENGER: Independent verification agent to review the change read-only.
FINAL_VERDICT: Implement the scorer correction; do not modify product runtime behavior based on these two artifacts.
```

## Follow-up clarification — current-turn grounded evidence

```text
DECISION_ID: V13-FALSE-REFUSAL-CURRENT-EVIDENCE-01
OBSERVED_PROBLEM: The deterministic source replay had one answerable turn marked not evaluable (scenario-09-07). The current turn independently resolved the exact oracle product and produced a contract-valid READY presentation with both variant facts correct, but the scorer still required an earlier assistant-grounded pointer because the oracle also carried a source-context product ID.
MERCHANT_IMPACT: Avoids understating useful answers or falsely failing full source-turn coverage when the current message itself provides enough product evidence.
CUSTOMER_IMPACT: Keeps a genuine current-turn lookup measurable while preserving the rule that stale or lost context cannot authorize an answer.
CURRENT_IMPLEMENTATION: hasActiveAssistantGroundedContext required prior assistant output whenever sourceContextProductId matched productId, even when the current turn contained VERIFIED product evidence and a matching READY presentation.
OPTIONS_CONSIDERED: Change runtime routing; ignore all prior-context requirements; accept a matching current VERIFIED product and contract-valid READY presentation; count any current product evidence without validating the presentation contract.
RECOMMENDED_CHANGE: For scorer eligibility, count the current turn as grounded when its product evidence is VERIFIED for the requested product and its presentation is READY, contract-valid, and contains that same product. Keep prior assistant SEND/non-refusal/READY grounding mandatory for context-only turns that lack this current-turn evidence.
ALTERNATIVES_REJECTED: Do not change router behavior because scenario-09-07 already produced the correct grounded answer. Do not weaken the prior-context rule for context-only lookups.
SECURITY_IMPACT: Scoring only; product tenant isolation, outbound authorization, and order/payment/courier boundaries remain unchanged.
COST_IMPACT: None; this is a deterministic offline metric correction.
FUTURE_COMPATIBILITY: Uses existing per-turn evidence and presentation fields; no runtime API or fixture schema changes.
TESTABLE_ACCEPTANCE_CRITERIA: A fresh VERIFIED current-turn product with matching READY/contract-valid presentation is evaluable even if prior assistant context was cleared; a current refusal in that state counts as a false refusal; a context-only turn without that evidence remains not evaluable unless the earlier assistant-grounded context is still active.
IMPLEMENTATION_OWNER: Lead orchestrator / ResponseTrace scoring.
INDEPENDENT_CHALLENGER: Dataset review agent, with follow-up read-only independent review.
FINAL_VERDICT: Apply the scorer-only correction and regenerate deterministic metrics; do not change customer-facing runtime behavior.
```

## Follow-up decision — public-photo garment category and proof acceptance

```text
DECISION_ID: V13-PHOTO-CATEGORY-AND-PROOF-GATE-01
OBSERVED_PROBLEM: The frozen paid probe classified 0/3 independently sourced kurta/tunic images as the expected garment category while color matched 3/3. The verifier still reported automated QA as passing because its photo gate affected integration readiness only. The Markdown proof also described a paid quality PASS as not passing, missed the nested integration receipt, and labeled deterministic replay timings as candidate router timings without a separate paid baseline comparison.
MERCHANT_IMPACT: A garment-category miss prevents useful retrieval and can create unnecessary customer clarification. A report that hides the miss or confuses latency sources cannot support a sound integration decision.
CUSTOMER_IMPACT: A customer photo should be described cautiously; an uncertain category must not be treated as a verified catalog identity.
CURRENT_IMPLEMENTATION: Photo extraction names common Bangladesh garment types but does not distinguish tunic-length and shirt-length silhouettes. The three public image probe results are recorded, but a category miss does not fail automated QA. Proof rendering withholds redacted transcript samples, misreads nested Jest receipt structure, and omits paid baseline metrics from its Markdown comparison.
OPTIONS_CONSIDERED: Broaden vision claims from three public images; lower the category gate; leave the mismatch informational; make the measured 3-photo acceptance gate fail closed, clarify the garment-length prompt cue, and repair proof rendering while keeping customer catalog identity unscored.
RECOMMENDED_CHANGE: Clarify that visible tunic-length kurta/panjabi garments remain such even with collars or plackets, while ambiguous framing returns null. Require three distinct executed and checksum-backed public fixtures with 3/3 category and color matches for photo PASS. A measured mismatch fails automated QA; missing/incomplete evidence blocks. Report redacted source samples, nested integration receipt counts, deterministic versus paid timing, paid outcomes and explicit catalog-identity limitations.
ALTERNATIVES_REJECTED: Do not claim catalog identity from photos not matched to the seeded products. Do not hide category failure behind an overall paid text-quality PASS. Do not tune the prompt solely to match one image or change product matching, catalog, routing, or merchant authority without evidence.
SECURITY_IMPACT: The change does not alter tenant access, catalog authority, message delivery or commerce mutation boundaries. Render only transcript fields already redacted by Test Lab and re-scrub email and Bangladesh mobile patterns before writing examples.
COST_IMPACT: Prompt and report tests are local and free. Verify the prompt correction in a fresh bounded campaign because the prior campaign's vision allowance is exhausted; preserve all existing ledgers and aggregate the estimate against the authorized $10 maximum.
FUTURE_COMPATIBILITY: No API, database, catalog, or DTO changes. Photo acceptance status is explicit in machine-readable proof; catalog identity remains NOT SCORED until fixtures have verified identities in the test catalog.
TESTABLE_ACCEPTANCE_CRITERIA: Unit tests fail on 0/3 measured categories, incomplete/duplicate/unchecksummed photo evidence, stale proof wording, a missed nested integration receipt, mislabeled deterministic timing, or omitted paid comparison outcomes. Intent-router prompt regression requires explicit tunic-length versus shirt-length guidance and conservative null handling. The fresh paid result is evaluated on matched baseline/candidate conditions and cannot exceed its campaign caps.
IMPLEMENTATION_OWNER: Lead orchestrator / AI Product / ResponseTrace.
INDEPENDENT_CHALLENGER: Independent Verification Agent, read-only after final candidate freeze.
FINAL_VERDICT: Implement the prompt cue and evidence/report repairs; retain FAIL if the fresh measured public-photo categories remain below 3/3. This result does not establish customer-photo accuracy or merchant ROI.
```

## Follow-up decision — second paid photo-classification iteration

```text
DECISION_ID: V13-PHOTO-TAXONOMY-CUE-02
OBSERVED_PROBLEM: The fresh matched Gemini run after the first generic length cue still classified 0/3 public kurta/tunic fixtures correctly and matched visible color on 3/3. The paid text evaluation passed at 18/18 fact slots and 15/15 answerable turns, but that does not resolve the photo failure.
MERCHANT_IMPACT: Mislabeling a long South Asian tunic as a shirt or leaving a clear garment category empty can suppress relevant catalog retrieval and force avoidable clarification.
CUSTOMER_IMPACT: Customers need an honest category description and safe no-match behavior; an incorrect label must not create a catalog identity.
CURRENT_IMPLEMENTATION: Extraction mentions Bangladesh garment names and says a tunic below the hips is a kurta/panjabi, but the model returned one generic shirt label and two empty categories on the paid photo probe.
OPTIONS_CONSIDERED: Accept the text score and close the vision gate; relabel outcomes in the evaluator; add photo-specific output overrides; state a general visible-length taxonomy with a precedence rule for long South Asian tunics and retain null when the hem is cropped.
RECOMMENDED_CHANGE: Strengthen only the extraction taxonomy: a South Asian tunic visibly extending below the hip toward the upper thigh or knee is `kurta/panjabi` even with shirt-style construction; use `shirt` only for a clearly short silhouette; use null when framing hides the distinguishing length. Preserve the full matched comparison and hard 3/3 photo gate.
ALTERNATIVES_REJECTED: Do not edit expected labels, infer a category from catalog retrieval, assume a shirt-like collar proves shirt identity, or claim customer-image accuracy from three public photos.
SECURITY_IMPACT: Prompt-only guidance; no change to catalog authority, tenant boundaries, reply grounding, media authorization, or commerce mutation.
COST_IMPACT: Local prompt tests are free. The final paid matched pair runs in a fresh $2 campaign; combined campaign reservations remain below the authorized $10 total.
FUTURE_COMPATIBILITY: No API or DTO changes. `productCatalogIdentityScored` stays false until these fixture photos map to verified catalog identities.
TESTABLE_ACCEPTANCE_CRITERIA: Prompt regression asserts the visible-length taxonomy, precedence over generic shirt construction, and conservative null rule. A fresh paid matched pair reports all three category and color results; a miss remains `AUTOMATED_QA_VERDICT=FAIL`.
IMPLEMENTATION_OWNER: Lead orchestrator / AI Product Engineer.
INDEPENDENT_CHALLENGER: Independent Verification Agent, read-only after candidate freeze.
FINAL_VERDICT: Test the stronger generic taxonomy cue in a fresh bounded campaign; if categories remain below 3/3, report the unresolved failure without relaxing the gate.
```

## Follow-up decision — revert the measured photo-prompt regression

```text
DECISION_ID: V13-PHOTO-TAXONOMY-CUE-03
OBSERVED_PROBLEM: The stronger forced taxonomy wording was worse on the fresh paid photo probe: category remained 0/3 and visible-color matching fell to 2/3, compared with 0/3 categories and 3/3 colors under the prior conservative cue. Neither prompt passed the category gate.
MERCHANT_IMPACT: The forced cue did not improve garment retrieval and reduced color reliability, so it is not a safe candidate improvement.
CUSTOMER_IMPACT: Keep uncertain image categories unclassified instead of forcing a label from incomplete framing.
CURRENT_IMPLEMENTATION: The extraction prompt said to always choose kurta/panjabi for a visible long-tunic silhouette and treated an off-frame hem as insufficient reason for null.
OPTIONS_CONSIDERED: Keep the stronger cue despite its measured regression; accept the prior prompt as passing; revert to the prior conservative cue and retain the measured photo failure.
RECOMMENDED_CHANGE: Revert the stronger prompt to the previously measured conservative wording, keep the three-photo 3/3 category and color acceptance gate, and record the image probe as failed until a future independently justified iteration passes it.
ALTERNATIVES_REJECTED: Do not relabel expected outcomes, force categories, weaken the gate, or report the photo feature as ready.
SECURITY_IMPACT: Prompt-only rollback; catalog authority, tenant boundaries, reply grounding, media authorization, and commerce mutation boundaries remain unchanged.
COST_IMPACT: The prompt comparison already consumed a fresh bounded campaign; this rollback does not authorize another paid run by itself.
FUTURE_COMPATIBILITY: No API, DTO, catalog, or fixture schema changes. A later prompt iteration requires its own bounded evidence and review.
TESTABLE_ACCEPTANCE_CRITERIA: Prompt tests require the conservative length and null rule. The proof remains FAIL when any licensed probe category or visible color is incorrect.
IMPLEMENTATION_OWNER: Lead orchestrator / AI Product Engineer.
INDEPENDENT_CHALLENGER: Independent Verification Agent, read-only after the final candidate freeze.
FINAL_VERDICT: Revert the measured regression and report the unresolved 0/3 category result honestly; do not claim integration readiness.
```
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
