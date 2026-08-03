# EasyModerator — AI Call Graph

**Audit date:** 2026-07-28 · **Branch:** `audit/ai-cost-model` · **Code baseline:** `e8b0a2a` (working tree), production `a8cf44c`

Every node is traced to a file and line. Nodes marked **$** cost money; **DEAD** nodes are wired in
code but unreachable in the deployed stack.

---

## 1. Production model chain

`src/modules/ai/llm.service.js:166-170` — tried in order, first success wins:

| # | Provider label | Model resolved in production | Why that model |
|---|---|---|---|
| 1 | `gemini-lite` | **`gemini-3.1-flash-lite`** | `llm.service.js:27` default. `LLM_GEMINI_LITE_MODEL` is **not** in the key set written by `scripts/render-production-env.js:90-160`, and no such GitHub secret exists — so the deployed `.env.prod` has no override. |
| 2 | `gemini-pro` | **`gemini-3.1-pro-preview`** | `llm.service.js:28` default, same reasoning. |
| 3 | `openai` | **`gpt-4.1-mini`** | `llm.service.js:29` default, same reasoning. |

`ai-chatbot.controller.js:290-291` maps the shop's `model_preset` onto `preferredProvider`:
`standard → gemini-lite`, `advanced → gemini-pro`. A shop set to *advanced* pays tier-2 prices on
**every** message.

Embeddings — `src/modules/rag/embedding.service.js:218-253`: `resolveProvider()` accepts only
`openai`, `gcp`, `http`, `tei`. Everything else, **including `gemini` and `google`**, silently falls
through to the non-semantic local n-gram hash.

---

## 2. Customer message → reply

```
Meta webhook  (POST /api/webhooks/meta)
  │
  ├─ meta-webhook-events.handler.js:408-417
  │    isNewConversation → subscriptionService.trackUsage(shopId,'conversations',1,'conv:<id>')
  │    ◀── THIS IS THE ONLY BILLING EVENT. One per conversation, idempotent, not per message.
  │
  └─ burst-coalescer.scheduleBurstFlush()          burst-coalescer.js:72
       debounce 8 s (AI_BURST_WINDOW_MS), hard cap 20 s
       N rapid customer messages → ONE burst-flush job
       │
       ▼
    BullMQ 'message-processing'  (attempts:3, exponential 2s→4s→8s, concurrency 10, 1/shop)
       │
       ▼
    message-worker.processMessageJob()             message-worker.js:238
       │
       ├─ burst.loadPendingCustomerTurn()          :273   combines text, collects ALL image URLs
       ├─ claimDedupKey(msg:dedup:…)  SET NX EX 86400     :292
       │     ◀── runs BEFORE any model call, so a duplicate webhook AND a BullMQ retry
       │         both short-circuit at $0. Retries never re-charge.
       ├─ Guard: HITL / ai:pause / automation_mode / channel flag / subscription status
       │
       ├─ $ analyzeSentiment()                     sentiment.service.js:174
       │     keyword hit (angry/frustrated/positive) → return, NO LLM
       │     message ≤ 30 chars                    → return, NO LLM
       │     otherwise → llmService.chat(maxTokens 150)      ← 1 CALL
       │     frustrated/angry ⇒ escalate to human, RETURN (no reply LLM at all)
       │
       ├─ loadConversationHistory()                :100   last 10 messages, VERBATIM, no summary
       │
       ├─ handleOrderFlow()                        order-flow.service.js
       │     deterministic step machine. When it handles the turn the conversational
       │     LLM is SKIPPED entirely. Only calls a model via matchImageMessage (§4).
       │
       └─ AIChatbotController.processNewIntent()   ai-chatbot.controller.js:251
            │
            ├─ knowledgeService.getKnowledgeForAI(shopId)          DB
            ├─ getRelevantFaqs(shopId, message, 5)                 SQL ILIKE, NOT a vector search
            │     ◀── hasImages ⇒ null ⇒ buildSystemPrompt falls back to the FULL FAQ dump
            │         (up to MAX_FAQ_IN_PROMPT = 50). Image turns carry a bigger prompt.
            ├─ getOperatingContext(shopId)                         DB
            ├─ buildSystemPrompt(...)              intent-router.js:608   → 1 251 tok (text, 5 FAQ)
            │                                                             → 1 508 tok (image, 12 FAQ)
            │                                                             → 2 554 tok (image, 50 FAQ)
            └─ intentRouter.route()                intent-router.js:107
                 │
                 │  Stage 1   in-memory exact-match cache (30 min)      → HIT: $0
                 │  Stage 1.5 order-number regex → DB lookup            → HIT: $0
                 │  Stage 1.7 greeting regex fast-path                  → HIT: $0
                 │  Stage 1.8 BanglaBERT classify        DEAD — no service in prod compose
                 │  Stage 2   FAQ keyword search (SQL)
                 │     └─ hit ⇒ $ llmService.chat(systemPrompt + FAQ text, maxTokens 512)  ← 1 CALL
                 │              no history, no grounding → ~1 292 tok in
                 │  Stage 3   _callLlm()             intent-router.js:281
                 │
                 ▼
              _callLlm
                 ├─ IF images:
                 │     ├─ $ _extractProductAttributes(imageUrls[0])   ← 1 CALL, ~1 215 tok in
                 │     │     Gemini vision, maxTokens 150
                 │     └─ productSearch.searchByAttributes()          DB
                 ├─ ELSE IF hasProductIntent(message):
                 │     └─ productSearch.searchByAttributes()          DB
                 │
                 ├─ IF no images: $ rag.queryData()   rag.service.js:205
                 │     └─ getEmbedding(query)  ← 1 EMBEDDING per text message
                 │        · EMBEDDING_PROVIDER resolves to `local` ⇒ $0 and non-semantic
                 │     └─ Qdrant /points/search  (limit 4, score > 0.5)
                 │        product hits ⇒ re-fetch LIVE from Postgres (price never embedded)
                 │
                 ├─ geminiCache.getOrCreate(shopId, systemPrompt)   gemini-cache.js:103
                 │     ALWAYS RETURNS null IN PRODUCTION — see §5
                 │
                 └─ $ llmService.chat(maxTokens 768)                 ← 1 CALL
                       systemInstruction = persona + operating ctx + FAQs + products + RAG
                       contents          = last 10 turns verbatim + this turn
                                           + EVERY image in the burst, re-sent in full
                       │
                       ├─ 1. gemini-3.1-flash-lite   $0.25 in / $1.50 out per 1M
                       ├─ 2. gemini-3.1-pro-preview  $2.00 in / $12.00 out  ← 8× tier 1
                       └─ 3. gpt-4.1-mini            $0.40 in / $1.60 out   ← 1.6× tier 1
                       (circuit breaker: 3 consecutive failures ⇒ tier skipped for 300 s)
                 │
                 ▼
          confidence gate → store → send via Meta Send API
                 │
                 └─ usage logging:  ✗ NONE (before this audit).
                    llm.service discarded `usageMetadata` / `usage` entirely.
```

### Model calls per customer message

| Message shape | Model calls | Notes |
|---|---|---|
| Greeting (`hi`, `আসসালামু আলাইকুম`) | **0** | regex fast-path |
| Repeat of a message seen < 30 min ago | **0** | exact-match cache |
| `where is order 12345` | **0** | DB lookup |
| Cart/checkout step | **0** | deterministic order-flow |
| Short text (≤ 30 chars) | **1** | main reply only; sentiment skipped |
| FAQ keyword hit | **1** | cheap branch, no history |
| Typical text | **2** | sentiment + main reply |
| Text + 1 image | **2–3** | vision extract + main reply (+ sentiment) |
| Duplicate webhook | **0** | dedup key claimed before AI |
| BullMQ retry (attempt 2/3) | **0** | same dedup key |
| Any turn that escalates a tier | **+1 billed call at the higher tier** | |

---

## 3. Product ingestion

```
Add Product form  (EasyMod-frontend/src/app/components/AddProduct.tsx)
  │
  ├─ up to 5 File objects held in `productImages` state          :37
  └─ ✗ NEVER ATTACHED to productData (:245-296) and there is no upload endpoint
        ⇒ POST /api/products carries NO images array
  │
  ▼
product.service.createProduct()                    product.service.js
  ├─ Postgres INSERT + usage tracking
  └─ queueProductProcessing(id, shopId)            :254   setImmediate, fire-and-forget
       │
       ▼
     product-ai.processProduct()                   product-ai.service.js:39
       ├─ imageUrls = product.images ?? [product.image_url]
       ├─ if (!imageUrls.length) return false      :46  ◀── TAKEN TODAY. Whole vision
       │                                                    pipeline is skipped.
       ├─ $ llmService.chat({ preferredProvider:'openai', maxTokens:300 })   ← 1 CALL
       │     gpt-4.1-mini vision on imageUrls[0] ONLY.
       │     Images 2-5 are never sent to any model, at any point.
       │     Measured: 1080×1440 ⇒ 2 493 image tokens; 512×512 ⇒ 429.
       ├─ product.update({ ai_* columns })
       ├─ $ embedProduct()                         product-embedding.service.js:78
       │     buildEmbeddingText() → ONE document, no chunking, no overlap, 106 tok measured
       │     price / stock deliberately excluded (they change too often)
       │     └─ rag.ingestData → getEmbedding → Qdrant upsert (384-dim, Cosine)
       └─ indexProductImage() → CLIP service       DEAD — no service in prod compose
```

### Re-embedding triggers

| Event | Vision call | Embedding | Source |
|---|---|---|---|
| Create | 1 (if images existed) | 1 | `product.service.js:254` |
| Update **touching `images` or `image_url`** | 1 | 1 | `product.service.js:305-308` |
| Update touching anything else — **including `quantity`** | 0 | **1** | `product.service.js:311` |
| Bulk update (price/status/is_active) | 0 | **1 per product** | `product.service.js:720-726` |
| Delete | 0 | 0 (one Qdrant DELETE) | `product.service.js:343` |
| `npm run reindex:qdrant` | 0 | 1 per product + FAQ + biz info | `auto-index.job.js` — **manual only, not scheduled** |

There is no diff check: an update that changes nothing embeddable still re-embeds.

---

## 4. Other paid paths

| Path | Trigger | Model | File |
|---|---|---|---|
| Image→product match | order-flow with purchase intent + image | Tier 3 `gemini-lite` vision, `maxTokens:200` | `image-product-matcher.service.js:51` |
| Self-MFS payment screenshot | customer sends a payment receipt | `llmService.chat` | `self-mfs-handler.service.js:136` |
| Banglish→Bangla transliteration | `transliterateWithLlm` | `llmService.chat`, `maxTokens:256` | `llm.service.js:213` |
| Voice-note transcription | **route-only**, not wired to the webhook pipeline | hardcoded `gemini-1.5-flash` | `voice-processing.service.js:28` |

`image-product-matcher` Tier 1 is CLIP (dead) and Tier 2 is RAG, so in practice an image that reaches
it costs **one Gemini vision call plus up to two query embeddings**.

---

## 5. Why prompt caching never fires

`intent-router.js:461` calls `geminiCache.getOrCreate(shopId, systemPrompt)` **without a model
argument**, so `gemini-cache.service.js:108` falls back to `LLM_DEFAULT_MODEL_GEMINI || 'gemini-2.0-flash'`
— a model retired on 2026-06-01, and in any case a *different* model from the one generating the reply.

That mismatch never gets tested, because the request fails earlier. A live probe on 2026-07-28:

```
POST /v1beta/cachedContents  model=models/gemini-2.0-flash
→ 400  "Cached content is too small. total_token_count=1998, min_total_token_count=4096"
```

`gemini-cache.service.js:80` treats any 400 containing `"minimum"` as a silent skip and returns `null`.
The system prompt is 1 087–2 554 tokens — it can never reach 4 096.

Implicit caching does not save it either. Two **identical** back-to-back `generateContent` calls both
returned `promptTokenCount: 2155` with **no `cachedContentTokenCount` field at all**.

**Cached input tokens in production are zero on every call.**
