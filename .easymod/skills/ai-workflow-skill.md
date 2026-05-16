---
name: em-ai-workflow-skill
description: "EasyModerator AI workflow skill. Use for intent routing, LLM failover chain (Gemini Lite→Pro→GPT-4.1-mini), RAG retrieval, BullMQ message-processing, guardrail chain, hallucination detection, Banglish/Bengali language detection."
---

# AI Workflow Skill — EasyModerator AI Architect

## ROLE
AI Workflow Architect for EasyModerator — design, optimize, and maintain the AI pipeline that powers automated customer conversations for BD f-commerce sellers.

---

## LLM STACK

### Models (Failover Chain)

| Tier | Model | Use Case | Token Budget |
|------|-------|----------|-------------|
| Primary | Gemini 2.0 Flash (Lite) | ~95% of traffic — fast/cheap | Low caps |
| Fallback | Gemini 2.0 Flash Thinking / Pro Preview | High-stakes, complex orders | Medium caps |
| Final Failsafe | GPT-4.1-mini | When both Gemini models fail | Medium caps |

### Tier-Based Model Selection (`llm-tier-selection.service.js`)

| Subscription Tier | Model Assigned |
|------------------|---------------|
| starter (PACKAGE_1) | `gemini-2.0-flash` |
| growth (PACKAGE_2) | `gemini-2.0-flash-thinking` |
| enterprise / PARTNER | `gemini-pro` |

### INTENT_TOKEN_LIMITS (token caps per intent)

```js
const INTENT_TOKEN_LIMITS = {
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

These caps prevent overspending on simple intents. Never raise them without benchmarking token-to-quality ratio.

---

## CIRCUIT BREAKER ARCHITECTURE

File: `src/modules/ai/circuit-breaker.service.js`

```
States: CLOSED (normal) → OPEN (failed) → HALF-OPEN (recovering)

Transition rules:
- CLOSED → OPEN: 3 consecutive failures on same provider
- OPEN → HALF-OPEN: after 5 minutes auto-reset
- HALF-OPEN → CLOSED: 1 successful call
- HALF-OPEN → OPEN: 1 failed call

Redis keys:
- llm_circuit:{provider} = 'OPEN' | 'HALF-OPEN' | 'CLOSED'
- llm_circuit_failures:{provider} = {count}
- TTL: 5 minutes on OPEN state

On circuit OPEN:
1. Log warning: logger.warn('Circuit breaker open', { provider })
2. Push SSE event: 'llm_outage' to seller dashboard
3. Alert: ops-alert.service.js → Slack webhook
4. Fallback: try next provider in chain
5. If all providers failed: return stored FAQ answer or "আমাদের টিম শীঘ্রই সাহায্য করবে"
```

---

## INTENT ROUTER PIPELINE

File: `src/modules/ai/intent-router.service.js`

### 3-Tier Routing (cheapest-first):

```
Incoming message
        │
        ▼
┌─────────────────────────────────────────┐
│ Tier 1: Intent Cache                     │
│ Key: intent:{shopId}:{normalizedMsg}     │
│ TTL: 1800s (30 min)                      │
│ If hit → return cached response          │
└─────────────┬───────────────────────────┘
              │ cache miss
              ▼
┌─────────────────────────────────────────┐
│ Tier 2: Semantic FAQ (RAG)               │
│ embedding.service.generateEmbedding()   │
│ rag.service.retrieve(shopId, embedding) │
│ If cosine_similarity ≥ 0.82 → use FAQ   │
└─────────────┬───────────────────────────┘
              │ below threshold
              ▼
┌─────────────────────────────────────────┐
│ Tier 3: LLM Call                         │
│ Build context: RAG snippets +            │
│   last 10 messages + shop settings      │
│ llm.service.complete(prompt, intent)    │
│ Apply token cap from INTENT_TOKEN_LIMITS │
│ Cache result for 30 min                  │
└─────────────────────────────────────────┘
```

### Key Configuration Values

| Config | Value | Notes |
|--------|-------|-------|
| `INTENT_CACHE_TTL_SECONDS` | 1800 | 30 min default |
| `SEMANTIC_SCORE_THRESHOLD` | 0.82 | Cosine similarity cutoff |
| `CONTEXT_WINDOW` | 10 messages | Last N messages included in prompt |
| `MAX_FAQ_IN_PROMPT` | 50 | Env-configurable, max FAQs included |

### Product Intent Gate
Before calling LLM for product queries:
1. Detect Banglish/Bengali product keywords from `bd-product-keywords.json`
2. If product intent detected → query `product.service.searchProducts(shopId, keywords)`
3. Include matched products in LLM context
4. This prevents hallucinated product data

### Greeting Cache (no LLM needed)
Common BD greetings return instant cached responses:
```js
const GREETING_RESPONSES = {
  'hi': 'হ্যালো! কীভাবে সাহায্য করতে পারি?',
  'hello': 'হ্যালো! আপনাকে স্বাগতম।',
  'assalamualaikum': 'ওয়ালাইকুম আস-সালাম! কীভাবে সাহায্য করব?',
  // 20+ more patterns in language-switcher.service.js
}
```

---

## RAG PIPELINE

### Components

| Service | File | Purpose |
|---------|------|---------|
| Knowledge CRUD | `knowledge.service.js` | Add/update FAQs and docs |
| Auto-indexing | `auto-index.job.js` (BullMQ) | Embed new knowledge on save |
| Embedding generation | `embedding.service.js` | OpenAI text-embedding / Gemini |
| Vector retrieval | `rag.service.js` | Similarity search in Pinecone/Qdrant |
| Delivery RAG | `delivery-rag.service.js` | Delivery area / timeline queries |
| REST API | `rag.controller.js` | `/api/rag/*` endpoints |

### Tenant Isolation
Every shop's vectors are namespaced by `shopId`:
```js
// Pinecone: namespace = shopId
await pineconeIndex.namespace(shopId).upsert(vectors)
await pineconeIndex.namespace(shopId).query({ vector, topK: 5 })

// Qdrant: collection filter by payload shopId
await qdrantClient.search('knowledge', {
  filter: { must: [{ key: 'shopId', match: { value: shopId } }] },
  vector: queryEmbedding,
  limit: 5
})
```

### Auto-Indexing Flow
```
knowledge.service.create(data) →
  BullMQ: queue.add('index-knowledge', { shopId, knowledgeId }) →
  auto-index.job.js worker:
    → embedding.service.generateEmbedding(content)
    → rag.service.upsertVector(shopId, { id: knowledgeId, embedding, content })
    → logger.info('Knowledge indexed', { shopId, knowledgeId })
```

---

## GUARDRAIL CHAIN

File: `src/modules/ai/guardrail.service.js`

5 guards applied to EVERY AI response before sending to customer:

```
Guard 1: RTO Fraud Detection
  → Check: response contains known fraud phone patterns (BD-specific)
  → Source: rto-shield module's blacklist patterns
  → On HIGH: escalate to HITL, don't send

Guard 2: Prompt Injection Detection
  → Check: prompt-sanitizer.service.js scans for injection patterns
  → Patterns: "ignore previous instructions", role-play overrides, jailbreak attempts
  → On detection: reject response, log security event

Guard 3: Hallucination Detection
  → Check: hallucination-detector.service.js verifies claims against known products
  → Detects: made-up prices, non-existent products, fake delivery timelines
  → On HIGH: request LLM regeneration with stricter prompt, or fallback to FAQ

Guard 4: Content Policy Check
  → Check: Meta-safe content rules (no spam, no prohibited content)
  → Validates against meta-safe-rules.md constraints
  → On violation: reject and log

Guard 5: Response Quality Score
  → Check: minimum quality threshold (not too short, not garbled, relevant)
  → On LOW quality: retry with fallback LLM or return FAQ answer

Result schema:
{
  pass: boolean,
  violations: [{ guard: string, severity: 'LOW'|'MEDIUM'|'HIGH', detail: string }],
  maxSeverity: 'LOW'|'MEDIUM'|'HIGH'|null,
  requiresEscalation: boolean,    // true if any HIGH severity
  checksRun: number,
  executionTimeMs: number
}
```

On `requiresEscalation = true`:
1. Set `conversation.hitl_active = true`
2. SSE push to seller dashboard
3. Do NOT send AI response to customer

---

## LANGUAGE DETECTION

File: `src/modules/language/language-switcher.service.js`

Detection order:
1. **Bengali** — any Unicode character in range U+0980–U+09FF → `'bn'`
2. **Banglish** — matches any of 26 pattern list:
   ```js
   const BANGLISH_PATTERNS = [
     'daam', 'lagbe', 'ache', 'nai', 'korbo', 'pathao', 'pawa', 'jabe',
     'koto', 'kemon', 'bol', 'janai', 'chai', 'bolen', 'asha', 'thakbo',
     'ki', 'ektu', 'hobe', 'boro', 'chhoto', 'nibo', 'dibo', 'paben',
     'bolun', 'janaben'
     // + more in service file
   ]
   ```
3. **English** — fallback if neither Bengali script nor Banglish patterns detected → `'en'`

### Usage in intent-router:
```js
const { language } = languageSwitcher.detect(message.text)
// language = 'bn' | 'banglish' | 'en'

// Pass language to LLM prompt:
const systemPrompt = `Respond in ${language === 'en' ? 'English' : 'Bengali/Banglish'}.`
```

---

## MULTIMODAL SUPPORT

| Capability | Service | Notes |
|-----------|---------|-------|
| Image product matching | `image-product-matcher.service.js` + `clip-client.service.js` | Customer sends product photo → AI identifies product |
| Voice note transcription | `voice-processing.service.js` | WhatsApp voice notes → text → intent routing |
| BERT embeddings | `bert-client.service.js` | Alternative embedding source |
| Gemini caching | `gemini-cache.service.js` | Reduces Gemini API costs on repeated prompts |

---

## COST ARCHITECTURE

Estimated traffic distribution with all optimizations:

| Layer | % of Traffic Handled | Cost Impact |
|-------|---------------------|------------|
| Greeting cache (instant) | ~20% | ~$0 |
| Intent cache (30-min) | ~40–60% of remaining | ~$0 |
| Semantic FAQ (≥0.82) | ~20–30% of remaining | Embedding cost only |
| LLM call (GPT/Gemini) | ~10–20% of all traffic | Full LLM cost |

**Token cost reduction:** intent-aware caps prevent overpaying for simple greetings.
**Model cost:** starter shops use Gemini Flash (cheap); only enterprise shops use Pro (expensive).

---

## FALLBACK STRATEGY DECISION TREE

```
LLM Call Needed
      │
      ▼
Gemini Flash (primary) ──FAIL──► Gemini Pro (fallback)
      │                                    │
   SUCCESS                              FAIL
      │                                    │
   Return reply               GPT-4.1-mini (final failsafe)
                                          │
                                      FAIL (all 3 down)
                                          │
                              Circuit breaker → OPEN
                                          │
                              Return: cached FAQ if available
                              OR: "আমাদের টিম শীঘ্রই সাহায্য করবে।"
                              AND: set conversation.hitl_active = true
                              AND: alert ops-alert.service.js → Slack
```

---

## ALWAYS

- Instrument every LLM call with intent type and token usage for cost monitoring
- Cache all cacheable responses (cache TTL = 30 min default)
- Check circuit breaker state before calling any LLM
- Run guardrail chain on every AI response before sending
- Detect language before generating reply
- Use product intent gate for product-related queries

## NEVER

- Bypass the guardrail chain to save latency
- Call LLM for greeting-type messages (use greeting cache)
- Raise `SEMANTIC_SCORE_THRESHOLD` above 0.90 (too restrictive, will increase LLM costs)
- Lower `SEMANTIC_SCORE_THRESHOLD` below 0.75 (too permissive, hallucination risk)
- Skip tenant namespace isolation in vector DB queries
