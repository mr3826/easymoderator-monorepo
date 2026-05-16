# EasyModerator AI Architecture

## LLM Stack

### Models

| Role | Model ID | Provider | When Used |
|------|---------|---------|----------|
| Primary | `gemini-2.0-flash` | Google | ~95% of traffic — fast, cheap |
| Fallback | `gemini-2.0-flash-thinking` / `gemini-pro` | Google | High-stakes, complex orders |
| Final Failsafe | `gpt-4.1-mini` | OpenAI | When all Gemini providers fail |

### Tier-to-Model Mapping (`llm-tier-selection.service.js`)

| Subscription Tier | Model | Token Caps |
|------------------|-------|-----------|
| starter (PACKAGE_1) | `gemini-2.0-flash` | Low |
| growth (PACKAGE_2) | `gemini-2.0-flash-thinking` | Medium |
| enterprise / PARTNER | `gemini-pro` | High |

### INTENT_TOKEN_LIMITS

```js
{
  greeting: 60,
  order_status: 120,
  price_query: 200,
  delivery_query: 150,
  payment_intent: 250,
  product_search: 300,
  general: 512,
  complex: 1024
}
```

Cost optimization: intent detection before LLM call → apply intent-specific token cap.

---

## Circuit Breaker Architecture

**File:** `src/modules/ai/circuit-breaker.service.js`

```
States: CLOSED (normal) → OPEN (degraded) → HALF-OPEN (recovering)

Failure threshold:  3 consecutive failures per provider
Recovery wait:      5 minutes
Recovery test:      1 successful call → CLOSED; 1 failed call → OPEN again

Redis keys:
  llm_circuit:{provider}           = 'OPEN' | 'HALF-OPEN' | 'CLOSED'
  llm_circuit_failures:{provider}  = {count}  (TTL: 5 minutes)

On OPEN:
  → logger.warn('Circuit breaker OPEN', { provider })
  → SSE event 'llm_outage' pushed to all connected seller dashboards
  → ops-alert.service.js → Slack webhook alert
  → Failover to next provider in chain
  → If all providers OPEN → return safe fallback response
```

---

## Intent Router Architecture

**File:** `src/modules/ai/intent-router.service.js`

### 3-Tier Pipeline

```
Incoming message (text + shopId + conversation history)
        │
        ▼ ──────────────────────────────────────────────
        │ TIER 1: Intent Cache
        │ Key: intent:{shopId}:{normalizedMessage}
        │ TTL: 1800 seconds (30 minutes)
        │ Normalize: lowercase, strip punctuation, trim
        │─────────────────────────────────────────────────
        │ CACHE HIT → return cached response (instant, free)
        │ CACHE MISS ↓
        ▼ ──────────────────────────────────────────────
        │ TIER 2: Semantic FAQ (RAG)
        │ embedding.service.generateEmbedding(messageText)
        │ rag.service.retrieve(shopId, embedding, topK=5)
        │ Best match cosine similarity:
        │   ≥ 0.82 → use FAQ answer (embedding cost only, no LLM)
        │   < 0.82 → fall through to tier 3
        │─────────────────────────────────────────────────
        │ FAQ MATCH ≥ 0.82 → return FAQ answer + cache it
        │ BELOW THRESHOLD ↓
        ▼ ──────────────────────────────────────────────
        │ TIER 3: LLM Call
        │ Build context:
        │   - Last 10 messages from conversation history
        │   - Top 3 RAG snippets (even if below threshold)
        │   - Shop settings (product focus, tone, language)
        │   - Product matches (if product intent detected)
        │ Apply token cap from INTENT_TOKEN_LIMITS[intent]
        │ Call llm.service.complete(prompt, context, tokenCap)
        │ Cache result: intent:{shopId}:{normalizedMsg} → TTL 1800s
        └────────────────────────────────────────────────
```

### Product Intent Gate
Before LLM call for product queries:
```
Detect BD product keywords (bd-product-keywords.json):
  Banglish: 'daam koto', 'price koto', 'ki ache', 'stock ache'
  English: 'price', 'cost', 'available', 'stock', 'how much'
  Bengali: 'দাম', 'মূল্য', 'পাওয়া যায়'

If product intent detected:
  → product.service.searchProducts(shopId, keywords)
  → include matched products in LLM context
  → prevents hallucinated product data
```

### Greeting Fast Path
Common greetings never reach LLM (instant responses):
```js
// 20+ BD greeting patterns return instant cached responses
// Source: language-switcher.service.js GREETING_RESPONSES map
'hi', 'hello', 'assalamualaikum', 'ki obostha', 'hye', 'hey'
```

---

## RAG Pipeline

### Components

| Component | File | Role |
|-----------|------|------|
| Knowledge CRUD | `knowledge.service.js` | Manage shop FAQs and documents |
| Auto-indexing | `auto-index.job.js` | BullMQ job: embed on knowledge save |
| Embedding | `embedding.service.js` | Generate vectors (OpenAI/Gemini) |
| Vector search | `rag.service.js` | Similarity search in Pinecone/Qdrant |
| Delivery RAG | `delivery-rag.service.js` | Delivery area/timeline knowledge |
| REST API | `rag.controller.js` | `/api/rag/*` manual operations |

### Tenant Isolation
Every shop's vectors are namespace-isolated:
```js
// Pinecone: use shopId as namespace
pineconeIndex.namespace(shopId).upsert([{ id, values, metadata }])
pineconeIndex.namespace(shopId).query({ vector, topK: 5 })

// Qdrant: filter by shopId in payload
qdrantClient.search('knowledge', {
  filter: { must: [{ key: 'shopId', match: { value: shopId } }] },
  vector: queryEmbedding,
  limit: 5
})
```

### Auto-Indexing Flow
```
knowledge.service.create(data)
  → BullMQ: { name: 'index-knowledge', data: { shopId, knowledgeId } }
  → auto-index.job.js worker:
    1. knowledge.service.getById(knowledgeId)
    2. embedding.service.generateEmbedding(knowledge.content)
    3. rag.service.upsertVector(shopId, { id: knowledgeId, embedding, content })
    4. logger.info('Knowledge indexed', { shopId, knowledgeId, vectorDim: 1536 })
```

---

## Guardrail Chain

**File:** `src/modules/ai/guardrail.service.js`

```
AI generates response
        │
        ▼
Guard 1: RTO Fraud Detection
  → rto-shield patterns: known BD fraud phone patterns in response content
  → HIGH severity if fraud pattern detected

Guard 2: Prompt Injection Detection
  → prompt-sanitizer.service.js: scan for injection strings
  → Patterns: "ignore previous", "forget instructions", role override attempts
  → HIGH severity if injection detected

Guard 3: Hallucination Detection
  → hallucination-detector.service.js
  → Cross-references claims against shop product catalog
  → Detects: made-up prices, non-existent products, invented order statuses
  → HIGH severity if hallucination detected

Guard 4: Content Policy Check
  → Validates against Meta messaging content policies
  → Checks: no spam patterns, no prohibited categories
  → MEDIUM severity on borderline content

Guard 5: Response Quality Score
  → Minimum quality threshold: response is relevant, coherent, non-empty
  → LOW if garbled; triggers fallback to FAQ answer

Result:
{
  pass: boolean,
  violations: [{ guard: string, severity: 'LOW'|'MEDIUM'|'HIGH', detail: string }],
  maxSeverity: 'LOW'|'MEDIUM'|'HIGH'|null,
  requiresEscalation: boolean,    // true if maxSeverity === 'HIGH'
  checksRun: number,
  executionTimeMs: number
}

On requiresEscalation = true:
  → conversation.hitl_active = true
  → SSE push to seller dashboard
  → Do NOT send response to customer
  → Log security event in audit module
```

---

## Language Architecture

**File:** `src/modules/language/language-switcher.service.js`

### Detection Order

```
1. Bengali (Unicode script check):
   Any character in range U+0980–U+09FF → detected as 'bn'
   
2. Banglish (pattern matching):
   Match against 26+ Banglish patterns list (common BD conversational words)
   Key patterns: daam, lagbe, ache, nai, korbo, pathao, pawa, koto, kemon,
                 bol, janai, chai, bolen, thakbo, ki, ektu, hobe, nibo,
                 dibo, paben, bolun, janaben, asha, jabe, chhoto, boro
   → detected as 'banglish'
   
3. English (default):
   No Bengali script, no Banglish patterns → 'en'
```

### Usage in Intent Router
```js
const { language } = languageSwitcher.detect(messageText)
// language: 'bn' | 'banglish' | 'en'

const systemPrompt = language === 'en'
  ? 'Respond in clear English.'
  : 'Respond in Bengali/Banglish as the customer wrote.'
```

---

## Multimodal Capabilities

| Input Type | Service | Output |
|-----------|---------|--------|
| Customer image | `image-product-matcher.service.js` + `clip-client.service.js` | Matched product from catalog |
| Voice note (WhatsApp) | `voice-processing.service.js` | Transcribed text → intent routing |
| BERT embedding | `bert-client.service.js` | Alternative vector source |
| Gemini context caching | `gemini-cache.service.js` | Reuse expensive prompt context across calls |

---

## Cost Architecture

### LLM Cost Savings Stack

| Layer | Savings | Mechanism |
|-------|---------|-----------|
| Greeting cache | ~20% of all traffic | Instant response, no API call |
| Intent cache (30-min TTL) | ~40–60% of remaining | Identical queries return cached result |
| Semantic FAQ (≥0.82) | ~20–30% more | Embedding cost only (< $0.001 per query) |
| LLM call (with token caps) | ~10–20% of total traffic | Only reaches LLM when needed |

### Total LLM Cost Impact
**~80–90% of conversations handled WITHOUT a full LLM call.**
Only complex, novel queries hit the LLM with token-capped budgets.

### Model Cost Hierarchy
- Gemini Flash: cheapest per token (~10x cheaper than GPT-4)
- Gemini Pro: moderate cost
- GPT-4.1-mini: most expensive (used only as final failsafe)

---

## Fallback Decision Tree

```
Message requires LLM response
          │
          ▼
Check circuit: gemini-flash CLOSED?
   YES → Call Gemini Flash
          │
     SUCCESS → Return reply + cache
     FAILURE (3rd consecutive) →
          │
          ▼
Check circuit: gemini-pro CLOSED?
   YES → Call Gemini Pro
          │
     SUCCESS → Return reply + cache
     FAILURE →
          │
          ▼
Check circuit: gpt-4.1-mini CLOSED?
   YES → Call GPT-4.1-mini
          │
     SUCCESS → Return reply + cache
     FAILURE (all 3 providers OPEN) →
          │
          ▼
All circuits OPEN:
  → Return best matching FAQ answer (from tier 2, even if below threshold)
  → OR: return safe fallback: "আমাদের টিম শীঘ্রই আপনাকে সাহায্য করবে।"
  → Set conversation.hitl_active = true
  → Trigger ops-alert.service.js → Slack alert
  → SSE 'llm_outage' event to all connected dashboards
```
