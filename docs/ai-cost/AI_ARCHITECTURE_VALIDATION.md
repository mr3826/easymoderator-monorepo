# AI Architecture Validation

**Branch** `audit/ai-cost-model` · **date** 2026-07-28 · **verdict `ACCEPTED_WITH_CONFIGURATION_FIXES`**

Validates the Gemini-first AI, RAG, embedding, caching and fallback architecture against
the locked product decisions. Companion documents:

| Document | Question it answers |
|---|---|
| [RETRIEVAL_QUALITY_EVALUATION.md](RETRIEVAL_QUALITY_EVALUATION.md) | Is the current retrieval good enough? |
| [GEMINI_FREE_TIER_CAPACITY.md](GEMINI_FREE_TIER_CAPACITY.md) | How far does the free key go? |
| [GEMINI_FIRST_ROUTING.md](GEMINI_FIRST_ROUTING.md) | Is Gemini primary everywhere? |
| [PROMPT_CACHING_DECISION.md](PROMPT_CACHING_DECISION.md) | Should we cache prompts? |
| [PRODUCT_IMAGE_FLOW_VALIDATION.md](PRODUCT_IMAGE_FLOW_VALIDATION.md) | Do product images work? |
| [AI_COST_AUDIT.md](AI_COST_AUDIT.md) | What does it all cost? |

Evidence classes used throughout: **[M]** measured against a live provider or a real
Postgres, **[C]** derived from code by reading it, **[A]** assumption.

---

## 1. Headline

The architecture is sound and does **not** need a semantic-embedding upgrade. What it
needed was four configuration-level corrections, all of which are applied on this branch.
Three of them were causing the chatbot to ground its replies on the wrong products —
the exact failure the grounding design exists to prevent.

| # | Defect | Class | Effect | Status |
|---|---|---|---|---|
| F-1 | Product-search `WHERE` clause was a tautology | [M] | every free-text query matched the whole catalogue | **fixed** |
| F-2 | `hasProductIntent` keyword gate blocked real product queries | [M] | 10 of 49 clear product questions reached the LLM ungrounded | **fixed** |
| F-3 | Non-semantic vector hits injected as authoritative product facts | [M] | 60–80% false-positive rate on products the shop does not sell | **fixed** |
| F-4 | `ai_search_text` and friends were never populated | [C] | the ranking columns were NULL for every product in production | **fixed** |
| F-5 | Vision ran on product upload and customer photos | [C] | violates locked decisions 1, 2 and 9 | **fixed** |
| F-6 | `gemini-pro` in the automatic fallback chain | [M] | `limit=0` on the free key — a doomed call before every OpenAI fallback | **fixed** |
| F-7 | Gemini context cache created for a retired model | [M] | caching could never hit; one failing round-trip per message | **fixed** |
| F-8 | `model_preset: 'advanced'` had no plan gate | [C] | one DB field away from a loss-making route | **fixed** |

Two things could not be closed from the repository and remain **founder-owned**; both are
in §6.

---

## 2. Customer messaging path (validated)

Traced end to end in `intent-router.service.js`. Ordered cheapest-first; each stage can
answer and return, so most messages never reach a model.

```
Meta webhook
  → message-worker.js: Redis SET NX dedup claim      [C] a redelivery costs $0
  → burst coalescing / debounce
  → conversation-state: language detect, entities
  → intent-router.route()
      Stage 1    exact-match response cache (Redis)            → answer, $0
      Stage 1.5  order-number regex → DB order lookup          → answer, $0
      Stage 1.7  greeting regex fast-path                      → answer, $0
      Stage 1.8  BanglaBERT local classify (conf ≥ 0.85)       → answer, $0
      Stage 2    keyword FAQ match (SQL, score ≥ 0.3)          → 1 Gemini call
      Stage 3    _callLlm — full grounded reply
                   a. shouldSearchProducts()  ← F-2 fix
                   b. Postgres FTS product search  ← F-1 fix   [M] p95 13 ms
                   c. Qdrant knowledge chunks (score > 0.5)
                      product hits only if embedder is semantic ← F-3 fix
                   d. buildSystemPrompt + grounding block
                   e. llm.service.chat()
  → confidence gate / hallucination detector / guardrail
  → reply
```

**Query representation.** There are two retrieval tiers and they are not the same thing.
The **primary** product tier is Postgres full-text search over
`name, name_bn, ai_search_text, ai_category, ai_color_primary, ai_material, category`,
ranked by `ts_rank` plus attribute bonuses. The **secondary** tier is Qdrant vector
search, which supplies shop-knowledge chunks and — only on a semantic embedder — extra
product ids that are then re-fetched live from Postgres for price and stock.

This matters because the previous audit reported "retrieval runs on a non-semantic n-gram
hash", which is true of the vector tier and **not** true of the product tier. Product
retrieval was never semantic and never needed to be; it is lexical, and once F-1 and F-2
were fixed it scores 98.0% top-3 on clear product queries [M].

**Provider generation.** Gemini `gemini-3.1-flash-lite` for every normal reply.
**Policy checks** run after generation: `confidence-gate.service`,
`hallucination-detector.service`, `guardrail.service`. **OpenAI fallback** only when
Gemini fails — see [GEMINI_FIRST_ROUTING.md](GEMINI_FIRST_ROUTING.md).

---

## 3. Product ingestion path (validated, one correction)

```
product.service.createProduct / updateProduct
  → row written to products
  → queueProductProcessing()  (setImmediate, non-blocking)
      → product-ai.service.processProduct()
          attrs = deriveAttributesFromText(product)      ← F-5 fix, no provider call
          writes ai_search_text, ai_category,
                 ai_color_primary, ai_material,
                 ai_tags, ai_description, ai_processed_at
      → product-embedding.embedProduct()
          buildEmbeddingText() → rag.ingestData() → Qdrant upsert
```

Before F-5, `processProduct` returned early at `if (!imageUrls.length) return false` and
otherwise sent the product image to **OpenAI vision as a forced primary provider**. Since
no image-upload endpoint exists (§5), the early return always won — so the six `ai_*`
columns the search ranks on were `NULL` for every product in production, and the FTS was
effectively matching on `name`, `name_bn` and `category` alone.

`deriveAttributesFromText` now populates them from the merchant's own text. Colour comes
from the `Color` variant option or a word match, material from a word match, and both are
left `null` rather than guessed — a wrong `ai_color_primary` scores 3 points in the
ranking and actively demotes the right product.

Measured effect of populating them, on clear product queries [M]:
top-1 **93.9% → 98.0%**, wrong-product **6.1% → 2.0%**.

**Chunking.** There is none for products: one product is one document
(`buildEmbeddingText`). Shop knowledge is chunked by source record in
`knowledge/auto-index.job.js`. Price, stock and quantity are deliberately excluded from
embedding text and always re-read live — that is correct and unchanged.

> **Pre-existing defect, not fixed here.** `buildEmbeddingText` does
> `variants.join(', ')` on an array of objects, producing
> `sizes: [object Object], [object Object]` in the embedded text. Harmless to the lexical
> tier (which never reads it) and it pollutes only the vector document. Listed in the
> backlog rather than fixed, because changing embedding text invalidates every indexed
> product and should be done with a deliberate reindex.

---

## 4. No AI vision anywhere (locked decisions 1, 2, 9)

Four paths could reach a vision model. All four now consult one switch,
`vision-policy.service.js`, which is **off unless `AI_VISION_ENABLED=true`**:

| Path | File | Behaviour with vision off |
|---|---|---|
| Product upload attribute extraction | `product-ai.service.js` | text derivation instead |
| Customer photo attribute extraction | `intent-router.service.js` | skipped; caption text drives the DB search |
| Image→product matching, vision tier | `image-product-matcher.service.js` | returns `method: 'vision_disabled'` |
| CLIP image embeddings | `product-ai.service.js`, `image-product-matcher.service.js` | not indexed, not queried |

Skipping extraction is not sufficient on its own: the customer's image blocks were still
attached to the **final** chat payload, so the provider would receive and bill for the
image regardless. `stripImageBlocks()` removes them and keeps the text, and the router
appends an explicit instruction so the model does not pretend to have seen a photo it
never received. Covered by `gemini-first-routing.test.js` §D, including an assertion that
no `inlineData` reaches the provider.

**Consequence the founder must decide on.** `image_understanding: true` is advertised as a
plan feature in `subscription.plans.js` and rendered on the public pricing page
(`Pricing.tsx`). With vision off, the bot cannot identify a product from a photo — it asks
the customer to type the name. The flag was **not** changed here, because editing it edits
the pricing page. See §6.

> **RESOLVED 2026-08-03 — Option 2 was taken.** The switch is now split in two:
> `AI_PHOTO_MATCH_ENABLED` (default **on**) analyses the customer's photo,
> `AI_VISION_ENABLED` (default **off**) still covers merchant product-image
> analysis and re-attaching image bytes to the reply call. The photo reaches a
> model exactly once — extraction — and the reply is grounded on that
> description plus live catalog rows, so the doubled image cost the paragraph
> above warns about does not apply. `image_understanding` is now delivered.
> Note the free-tier consequence: a photo message costs **2** of the 15
> requests/minute.

---

## 5. Product images

Full detail in [PRODUCT_IMAGE_FLOW_VALIDATION.md](PRODUCT_IMAGE_FLOW_VALIDATION.md). In
one line: **there is no upload implementation at all** — no multer, no S3/Spaces, no
Cloudinary, no presigned URLs anywhere in `EasyMod-backend/src` [C]. `products.images` and
`products.image_url` accept URL strings only, and the Add Product form marks images
required, previews them with `URL.createObjectURL`, and never sends them.

So today: no image bytes are sent to any provider, and also no image bytes are stored.

---

## 6. Unresolved, founder-owned

1. **Is `EMBEDDING_PROVIDER` set to something semantic?** The secret exists (set
   2026-06-04) but its value cannot be read from here, and `/health/detailed` needs an
   admin token. `resolveProvider()` accepts only `openai`, `gcp`, `http`, `tei` — the
   values every other repo artefact implies (`gemini`, `google`) silently degrade to the
   n-gram hash. With F-3 applied, a non-semantic embedder is now *safe* (the product tier
   is skipped) but the shop-knowledge tier still runs on it. Check
   `GET /health/detailed` → `embedding.semantic`.
2. ~~**The `image_understanding` pricing claim** (§4).~~ **Closed 2026-08-03** — vision
   for customer photos only was accepted and shipped on by default. The measured
   ~1,065 input tokens per image, billed flat regardless of resolution, is now a
   real line item. What remains open is not the claim but the **key tier**: a free
   Gemini key allows 15 requests/minute project-wide and a photo message costs two
   of them. Confirm the production key is paid before this carries real traffic.

---

## 7. What changed on this branch

Source:
`product-search.service.js`, `intent-router.service.js`, `product-ai.service.js`,
`image-product-matcher.service.js`, `llm.service.js`, `gemini-cache.service.js`,
`circuit-breaker.service.js`, `ai-chatbot.controller.js`, `subscription.plans.js`,
new `vision-policy.service.js`.

Tests: `gemini-first-routing.test.js` (17), `retrieval-behaviour.test.js` (9),
`intent-router.test.js` (+2). **115 suites / 1377 tests passing.**

Harness: `scripts/retrieval-eval/{dataset.js,run-eval.js}` — 86 labelled queries,
36 products, 7 engines, real Postgres, real Gemini embeddings.
