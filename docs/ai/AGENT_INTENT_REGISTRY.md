# Agent Intent Registry

Version: 1.0.0<br>
Last updated: 2026-08-22<br>
Owner: Engineering + Product<br>
Supersedes: Intent taxonomy portions of `EASYMODERATOR_DOMAIN_AGENT_RUNTIME_VISION.md` and audit-level names in `AI_ASSISTANT_INTENT_CAPABILITY_BOUNDARY_AUDIT.md`<br>
Status: Normative; launch taxonomy

MUST / MUST NOT / REQUIRED are binding: violating one blocks merge. SHOULD / RECOMMENDED may be deviated from with a recorded ADR. MAY is optional. Any rule affecting authorization, tenant isolation, idempotency, or material mutation MUST be written as MUST.

This registry is the single namespace for runtime intents, evaluation labels, persisted intent records, and telemetry. The live audit names are evidence for migration; they are not a second registry. Contract versioning and deprecation rules are owned jointly with [Agent Contracts](./AGENT_CONTRACTS.md).

## 1. Registry Rules

- An `intentId` is uppercase ASCII with underscores and is stable after release.
- Each intent has one domain, one route owner, one action policy, and one evaluation definition.
- The classifier MAY return `UNKNOWN`, but it MUST NOT invent an identifier outside this registry.
- Intent selection is separate from capability authorization. An intent never grants an action.
- An intent that requires a live provider or order lookup is not classified as a static knowledge intent.
- Deprecated values remain readable and queryable forever; they are never deleted or reused.
- A taxonomy change requires a migration note, corpus update, labeler sign-off, and a backward-compatibility test.

## 2. Taxonomy Decision

The launch registry contains 22 intents. Product attributes that differ only by slot are one intent. Post-purchase requests that all route to a human are one intent with a reason slot. This keeps the Bangla/Banglish rules layer small enough to maintain.

## 3. Launch Intents

| Intent ID | Domain | Required slots | Handling and boundary |
|---|---|---|---|
| `STOP_OPT_OUT` | `SUPPORT` | none | Deterministically records opt-out and suppresses AI dispatch. |
| `GREETING` | `KNOWLEDGE` | language | Deterministic greeting template; normal outbound policy still applies. |
| `GENERAL_CHAT_OR_UNKNOWN` | `KNOWLEDGE` | none | Clarification or grounded conversation; no arbitrary data access. |
| `PRODUCT_INQUIRY` | `PRODUCT` | product reference | Reads live catalog facts and may answer only verified product claims. |
| `PRODUCT_ATTRIBUTE` | `PRODUCT` | product reference, `attribute` | `attribute` is a slot such as `size`, `color`, `material`, `brand`, or `specification`; it is not a separate intent. |
| `PRODUCT_AVAILABILITY` | `PRODUCT` | product reference, optional variant | Reads live stock and availability; never infers stock from a prior reply. |
| `PRODUCT_PHOTO_LOOKUP` | `PRODUCT` | attachment, optional caption | Matches against the current shop catalog; a customer photo is not proof of inventory. |
| `FAQ_KNOWLEDGE_QUESTION` | `KNOWLEDGE` | question topic | Answers from active FAQ and merchant knowledge only. |
| `DELIVERY_POLICY` | `KNOWLEDGE` or `COMMERCE_OPS` | zone or location | Static merchant configuration routes to `KNOWLEDGE`; live provider/zone lookup routes to `COMMERCE_OPS`. |
| `DELIVERY_CHARGE` | `KNOWLEDGE` or `COMMERCE_OPS` | destination | Static charge table routes to `KNOWLEDGE`; live zone/provider calculation routes to `COMMERCE_OPS`. |
| `PAYMENT_POLICY` | `KNOWLEDGE` or `COMMERCE_OPS` | payment topic | Static policy routes to `KNOWLEDGE`; current payment-status or verification lookup routes to `COMMERCE_OPS`. |
| `PAYMENT_METHODS` | `KNOWLEDGE` | none | Reads configured methods. It MUST NOT accept or verify money. |
| `ORDER_STATUS_LOOKUP` | `ORDER` | order reference | Read-only and customer-bound. A shop plus guessed number is insufficient. |
| `PURCHASE_INTENT_START` | `ORDER` | product reference | Starts an order session only after a product is identified and the phrase is not negated. |
| `ORDER_SESSION_CHECKOUT` | `ORDER` | current checkout slot | Advances a durable session; order creation requires a fresh confirmation hash and Action Gate authorization. |
| `CART_EDIT_OR_ADD_MORE` | `PRODUCT` to `ORDER` | product or quantity change | Mutates only the pre-order cart and remains inside the hop limit. |
| `ORDER_SESSION_CANCEL` | `ORDER` | active session | Cancels an uncommitted order session; it cannot cancel an existing order. |
| `SELF_MFS_PAYMENT_VERIFICATION` | `COMMERCE_OPS` | screenshot, expected amount | Fail-closed OCR and payment verification. Until the canonical session supplies complete evidence, route to human. |
| `SENTIMENT_HANDOFF` | `SUPPORT` | sentiment | Pauses automation, notifies the merchant, and requires human resolution. |
| `ORDER_POST_PURCHASE_REQUEST` | `SUPPORT` | `reason` | `reason` is one of `MODIFICATION`, `RETURN`, `COMPLAINT`, `DELAY`; all four route to human support. |
| `HUMAN_HANDOFF_REQUEST` | `SUPPORT` | none | Customer explicitly asks for a person; support is terminal for the turn. |
| `LOW_CONFIDENCE_OR_GROUNDING_FAILURE` | `SUPPORT` | reason code | System outcome for uncertainty, retrieval failure, unsupported claims, or policy denial. |

`PRODUCT_ATTRIBUTE` replaces separate `PRODUCT_SIZE`, `PRODUCT_COLOR`, and `PRODUCT_MATERIAL` labels. `ORDER_POST_PURCHASE_REQUEST` replaces the four separate `ORDER_*_REQUEST` labels. The reason slot is required in persisted records even when the customer language is mixed.

## 4. Static Versus Live Tie-Break

The classifier MUST apply this rule before choosing a domain:

> If the answer is available from static merchant configuration, route to `KNOWLEDGE`. If the answer requires a current provider, zone, order, inventory, or payment lookup, route to `COMMERCE_OPS` or `ORDER` according to the target record.

Boundary cases MUST be in the evaluation corpus:

| Customer text | Label | Domain | Reason |
|---|---|---|---|
| `ঢাকার বাইরে কত?` | `DELIVERY_CHARGE` | `KNOWLEDGE` when a static outside-Dhaka charge exists; otherwise `COMMERCE_OPS` | The same words require different domains based on the source needed. |
| `ঢাকার বাইরে কুরিয়ার দিয়ে এখন কত লাগবে?` | `DELIVERY_CHARGE` | `COMMERCE_OPS` | Requires live courier/zone calculation. |
| `কি কি পেমেন্ট নেন?` | `PAYMENT_METHODS` | `KNOWLEDGE` | Static configured methods. |
| `আমার পেমেন্টটা গেছে?` | `PAYMENT_POLICY` | `COMMERCE_OPS` | Requires current payment state. |
| `এই জামার সাইজ কি?` | `PRODUCT_ATTRIBUTE` with `attribute=size` | `PRODUCT` | Attribute is a slot, not a new intent. |
| `অর্ডারটা বদলাতে চাই` | `ORDER_POST_PURCHASE_REQUEST` with `reason=MODIFICATION` | `SUPPORT` | Existing-order changes are human-only. |

## 5. Intent Record

Every stored intent decision has:

```json
{
  "contractVersion": "1.0",
  "intentId": "PRODUCT_ATTRIBUTE",
  "intentVersion": 1,
  "domain": "PRODUCT",
  "slots": { "attribute": "material", "productReference": "p-1" },
  "confidence": 0.94,
  "source": "RULE | CLASSIFIER | LLM | HUMAN",
  "evidenceIds": ["ev-123"],
  "traceId": "trace-123",
  "createdAt": "2026-08-22T00:00:00.000Z"
}
```

The registry version and intent version are separate. A revised rule for the same meaning increments `intentVersion`; a changed meaning creates a new intent ID and deprecates the old one.

## 6. Stage-2 Rule Ownership

Stage 2 is the deterministic Bangla/Banglish/English rule layer that runs after ingress and before model routing. Rules live in a versioned registry module and are released with the corpus, not in prompt text or merchant records.

| Responsibility | Owner | Required action |
|---|---|---|
| Phrase and negation rule changes | Intent Engineering | Open a registry change with before/after examples and a reason code. |
| Bangla native-language review | Bangladesh Language QA | Review every new Bengali phrase and every negation boundary. |
| Product/business meaning | Product | Approve slot semantics and domain ownership. |
| Regression execution | QA | Run the full corpus, confusion matrix, near-miss suite, and tenant fixtures. |
| Release decision | Engineering lead | Merge only when quality floors and safety invariants pass. |

Change workflow:

1. Add the phrase to a labelled corpus fixture with locale, intent, domain, slots, and expected safety result.
2. Add a positive example, a negation example, an adjacent-intent example, and a Banglish spelling variant.
3. Run the corpus and compare per-class precision, recall, domain accuracy, and false mutation metrics.
4. Obtain native-language and product-owner review.
5. Increment the rule-set version and record the migration note.

## 7. Reserved Intents

These labels are not launch capabilities. They remain named so a future request cannot silently create a new live branch:

| Reserved intent | Current behavior |
|---|---|
| `PRODUCT_COMPARE` | Route to human or clarification; no comparison workflow is active. |
| `PRODUCT_RECOMMEND` | No autonomous upsell or recommendation action. |
| `PRODUCT_ALTERNATIVE` | Only real, evidence-backed alternatives may be offered from `PRODUCT_INQUIRY`; no separate action. |
| `PRODUCT_BUNDLE` | Human or static knowledge response; no bundle mutation. |
| `BROADCAST_OR_COLD_OUTREACH` | Not a customer-assistant capability. |
| `ARBITRARY_TOOL_REQUEST` | Deny and hand off; no model-selected tool registry. |

## 8. Deprecation And Migration

When an intent is retired:

- mark it `DEPRECATED` with an effective date and replacement mapping;
- keep the old value in persisted rows, analytics, and exports;
- dual-read old and new values during the 90-day compatibility window;
- add a migration note with owner, corpus impact, and dashboard impact;
- never assign the retired identifier to a new meaning.

## 9. Registry Acceptance Tests

- The launch list contains 20-25 active intent IDs and the reserved list is excluded from active routing.
- Product size, color, and material queries resolve to `PRODUCT_ATTRIBUTE` with a slot.
- All four post-purchase request reasons resolve to `ORDER_POST_PURCHASE_REQUEST` and `SUPPORT`.
- Static versus live delivery and payment examples resolve to the correct domain.
- Negated purchase language never starts `PURCHASE_INTENT_START`.
- A classifier output outside the registry becomes `GENERAL_CHAT_OR_UNKNOWN` or `HUMAN_HANDOFF_REQUEST`, never a new action.
- Deprecated values remain readable after a registry release.
