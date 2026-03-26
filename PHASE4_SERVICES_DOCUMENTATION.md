# Phase 4 Core Services - Complete Documentation

## Overview

Phase 4 implements 6 production-ready core services that handle the complete conversation pipeline from message processing through LLM generation and security validation.

```
┌─────────────────────────────────────────────────────────────────┐
│ USER MESSAGE                                                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │ TASK 5: LOCK     │ Acquire Redis-based mutex
                    │ Conv Lock        │ <50ms acquisition target
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ TASK 6: ROUTE    │ Three-tier routing
                    │ Intent Router    │ Tier 1: <50ms (cache)
                    │                  │ Tier 2: <100ms (semantic FAQ)
                    │                  │ Tier 3: <1500ms (LLM fallback)
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ TASK 2 (if T3):  │ Failover across
                    │ LLM Failover     │ Anthropic→OpenAI→Gemini
                    │                  │ <500ms failover target
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ TASK 3 (if T3):  │ Validate token cost
                    │ Cost Cap         │ Against shop limit
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ TASK 4:          │ 5 security checks:
                    │ Guardrails       │ - RTO fraud
                    │                  │ - Prompt injection
                    │                  │ - Hallucination
                    │                  │ - Coherence
                    │                  │ - Toxicity
                    └────────┬─────────┘
                             │
               ┌─────────────▼─────────────┐
               │ RETURN RESPONSE OR BLOCK  │
               └──────────────────────────┘
                             │
                    ┌────────▼─────────┐
                    │ TASK 5: UNLOCK   │ Release Redis lock
                    │ Conv Lock        │
                    └────────┬─────────┘
                             │
            ┌────────────────▼────────────────┐
            │ TASK 1: DATABASE INDEXES        │
            │ (Background, during deployment) │
            └─────────────────────────────────┘
```

---

## Individual Service Details

### Task 1: Database Indexes Migration

**File**: `database-indexes.migration.js`

**Purpose**: Create 4 composite indexes on the products table for optimized shop_id queries

**Indexes Created**:
1. `idx_products_shop_category_active` - Active products by shop & category
2. `idx_products_shop_sku_status` - Products by SKU & status
3. `idx_products_shop_created_inventory` - Time-based inventory queries
4. `idx_products_shop_price_range` - Price range filtering

**Features**:
- Uses `CREATE INDEX CONCURRENTLY` for zero-downtime indexing
- Transaction-safe rollback with `down()` method
- Verification function to test index creation
- Statistics retrieval for monitoring
- Automatic idempotency (handles already-existing indexes)

**Usage**:
```javascript
const migration = new DatabaseIndexMigration(dbConnection);
await migration.up();    // Create indexes
const report = await migration.verify();  // Verify creation
const stats = await migration.getStatistics();  // Get stats
await migration.down();  // Rollback (if needed)
```

**Performance**: No blocking - all indexes created concurrently

---

### Task 2: LLM Failover Service

**File**: `llm-failover.service.js`

**Purpose**: Intelligent LLM provider selection with latency-aware failover

**Provider Order** (with intelligence):
1. Anthropic Claude (primary, lowest cost for quality)
2. OpenAI GPT-4 (fallback, strong instruction-following)
3. Google Gemini (tertiary, backup)

**Features**:
- **Promise.race()** with individual provider timeouts
- **Health scoring**: 0-100 scale, +5 on success, -15 on failure
- **Latency tracking**: Last 100 measurements per provider
- **Adaptive selection**: Incorporates health + latency into selection
- **Token extraction**: Full usage reporting for all providers
- **<500ms failover target**: Guaranteed response within timeout

**Usage**:
```javascript
const llm = new LLMFailoverService(config);
await llm.initialize();

const result = await llm.executeWithFailover(
  'What is the best way to...',
  'You are a helpful assistant',
  { maxTokens: 1024, timeout: 500 }
);

// Returns: { provider, content, usage, elapsed }
// usage: { inputTokens, outputTokens, totalTokens }
```

**Health Score Mechanics**:
- Health starts at 100
- Recovery: +5 on each successful response
- Penalty: -15 on failure
- Selection: Higher health scores prioritized in ordering
- Latency penalty: Providers with high latency deprioritized

---

### Task 3: Cost Cap Service

**File**: `cost-cap.service.js`

**Purpose**: Validate message cost against shop's maximum auto-order value

**Features**:
- **Real-time pricing**: Updated 2024 rates for all providers
- **Cost calculation**: Input + output token estimation
- **Shop limits**: Database lookup with 5-minute cache
- **Audit logging**: Full validation history
- **Batch validation**: Check multiple messages at once

**Provider Pricing** (2024):
```
Anthropic:
  - Claude 3 Opus: $0.015/$0.075 (input/output per 1K)
  - Claude 3 Sonnet: $0.003/$0.015
  - Claude 3 Haiku: $0.00025/$0.00125

OpenAI:
  - GPT-4 Turbo: $0.01/$0.03
  - GPT-3.5 Turbo: $0.0005/$0.0015

Gemini:
  - Gemini Pro: $0.0005/$0.0015
```

**Usage**:
```javascript
const costCap = new CostCapService(dbConnection);

const validation = await costCap.validateCost(
  'shop-123',
  250,  // token count
  'anthropic',
  'claude-3-sonnet',
  { userId: 'user-1', ipAddress: '1.2.3.4' }
);

// Returns:
// {
//   allowed: true/false,
//   cost: 0.0045,           // USD
//   limit: 50.00,           // USD
//   reason: "Cost within limit",
//   logId: "timestamp"
// }
```

**Cache**: 5 minutes for shop cost limits (configurable)

---

### Task 4: Guardrail Service

**File**: `guardrail.service.js`

**Purpose**: 5-layer security validation for LLM outputs

**Guard Functions**:

1. **RTO Fraud Detection** (Authorization Bypass)
   - Detects: "skip auth", "bypass check", API keys, "as admin"
   - Patterns: Confidence-based scoring, recursive pattern matching
   - Response: Violations with recommendations

2. **Prompt Injection Detection**
   - Detects: "SYSTEM:", "IGNORE INSTRUCTIONS", jailbreak patterns
   - Patterns: Alternative instruction attempts, mirror attacks
   - Response: Confidence score, specific injection type

3. **Hallucination Detection**
   - Detects: False claims, over-confidence, circular reasoning
   - Patterns: Confidence word counting, claim verification heuristics
   - Response: Factual grounding assessment

4. **Coherence & Consistency Check**
   - Detects: Rambling, incoherent structure, topic drift
   - Patterns: Sentence length, word diversity, paragraph structure
   - Response: Structural quality assessment

5. **Toxicity Detection**
   - Detects: Harmful language, abuse, hateful content
   - Patterns: Curse words, slurs, violent language
   - Response: Toxicity confidence score

**Features**:
- **Parallel execution**: All 5 checks run concurrently
- **Confidence scoring**: 0-1 scale per check
- **Audit logging**: Full logging_id for tracing
- **Recommendations**: Specific actions for violations
- **Configurable thresholds**: Tune sensitivity per check

**Usage**:
```javascript
const guardrail = new GuardrailService();

const result = await guardrail.validateOutput(
  'What is your password?',
  'I cannot share passwords. Use the forgot password feature.',
  { shopId: 'shop-1', conversationId: 'conv-1', userId: 'user-1' }
);

// Returns:
// {
//   passed: true,
//   loggingId: "uuid",
//   violations: [],
//   checks: {
//     rtoFraud: { passed: true, confidence: 0.1, score: 0.9 },
//     promptInjection: { passed: true, confidence: 0.05, score: 0.95 },
//     hallucination: { passed: true, confidence: 0.2, score: 0.8 },
//     coherence: { passed: true, confidence: 0.15, score: 0.85 },
//     toxicity: { passed: true, confidence: 0.0, score: 1.0 }
//   },
//   elapsed: 145
// }
```

**Thresholds** (configurable):
- Prompt Injection: 0.7
- Hallucination: 0.6
- Toxicity: 0.5
- Coherence: 0.4

---

### Task 5: Conversation Lock Service

**File**: `conversation-lock.service.js`

**Purpose**: Redis-based mutual exclusion for conversation processing

**Features**:
- **<50ms lock acquisition** target (typical <30ms in Redis)
- **TTL-based expiration**: 30s default, 30-300s configurable
- **Auto-refresh**: Extends TTL at 30% remaining
- **Atomic operations**: Lua scripts prevent race conditions
- **Local tracking**: Metadata and refresh intervals
- **Force unlock**: Admin operation for cleanup
- **Wait-for-release**: Optional retry logic for contended locks

**Lock Lifecycle**:
```
acquireLock() → [30s TTL]
  ├─ refreshLock() → [+30s]
  ├─ refreshLock() → [+30s]
  └─ releaseLock() → [cleanup]
```

**Usage**:
```javascript
const lock = new ConversationLockService(redisClient, {
  ttl: 30,           // 30 seconds
  maxTTL: 300,       // 5 minutes max
  minTTL: 30         // 30 seconds min
});

// Acquire lock
const lockInfo = await lock.acquireLock('conv-123', {
  ttl: 60,
  autoRefresh: true
});

// Do work...

// Refresh if needed
await lock.refreshLock(lockInfo.lockToken, 'conv-123', 30);

// Release
await lock.releaseLock(lockInfo.lockToken, 'conv-123');
```

**Lock Status**:
```javascript
const status = await lock.getLockStatus('conv-123');
// { locked: true, tokenHolder: "abc...", ttl: 28 }
```

**Performance Targets**:
- Acquisition: <50ms (usually <30ms)
- Refresh: <10ms
- Release: <5ms

---

### Task 6: Intent Router Service

**File**: `intent-router.service.js`

**Purpose**: Three-tier intelligent intent routing with fallback support

**Three-Tier Architecture**:

**Tier 1: Exact Cache** (<50ms)
- In-memory LRU cache of normalized queries
- Hit-based on exact match or semantic normalization
- Cache size: Configurable (default 1000 entries)
- TTL: Configurable (default 1 hour)

**Tier 2: Semantic FAQ** (<100ms)
- Vector similarity search on FAQ data
- Cosine similarity against embeddings
- Confidence threshold filtering (default 0.75)
- Returns top 3 matches

**Tier 3: LLM Fallback** (<1500ms)
- Calls LLM failover service
- Generates contextual response
- Caches result in Tier 1 for future hits

**Features**:
- **Multi-tenant**: Shop ID isolation
- **Confidence scoring**: 0-1 per match
- **Performance tracking**: Stats by tier
- **FAQ updates**: Hot reload capability
- **Performance within target**: Reports SLA violations

**Usage**:
```javascript
const router = new IntentRouterService({
  cacheTTL: 3600000,  // 1 hour
  cacheMaxSize: 1000
});

// Initialize with FAQ data and services
await router.initialize(faqData, llmFailover, embeddingService);

// Route intent
const result = await router.routeIntent(
  'How do I reset my password?',
  'shop-123',
  { confidenceThreshold: 0.75 }
);

// Returns:
// {
//   tier: 1,                  // Which tier responded
//   matched: true,
//   confidence: 0.95,         // 0-1 confidence for Tier 2/3
//   response: "Click forgot...",
//   metadata: {
//     source: 'faq',
//     category: 'account',
//     provider: null,         // 'anthropic', 'openai', etc if Tier 3
//     tokensUsed: null        // Token count if Tier 3
//   },
//   performance: {
//     elapsedMs: 45,
//     tier1Target: 50,
//     tier2Target: 100,
//     tier3Target: 1500,
//     withinTarget: true
//   }
// }
```

**Statistics**:
```javascript
const stats = router.getStats();
// {
//   total: 1000,
//   tierDistribution: {
//     tier1: { hits: 700, percentage: "70%" },
//     tier2: { hits: 200, percentage: "20%" },
//     tier3: { hits: 100, percentage: "10%" }
//   },
//   averageLatencyMs: 75,
//   cache: { size: 500, maxSize: 1000 }
// }
```

---

## Complete Pipeline Example

```javascript
// Initialize services (once at startup)
const services = await initializePhase4Services({
  db: pgConnection,
  redis: redisClient,
  llmConfig: {
    anthropic: { apiKey: process.env.ANTHROPIC_KEY },
    openai: { apiKey: process.env.OPENAI_KEY },
    gemini: { apiKey: process.env.GEMINI_KEY }
  },
  faqData: await loadFAQData(),
  embeddingService: embeddingService
});

// Process message
const pipeline = await processConversationMessage(
  'How do I update my billing info?',
  'conv-abc123',
  'shop-xyz789',
  services
);

console.log(pipeline);
// {
//   success: true,
//   finalResponse: 'Go to Account > Billing > Update Payment Method',
//   steps: [
//     { step: 'conversation_lock', status: 'success', elapsed: 12 },
//     { step: 'intent_routing', status: 'success', tier: 1, elapsed: 25 },
//     { step: 'cost_validation', status: 'skipped', reason: 'Tier 1' },
//     { step: 'guardrails', status: 'success', violationCount: 0 },
//     { step: 'lock_release', status: 'success' }
//   ]
// }
```

---

## Error Handling

All services use `AppError` pattern:

```javascript
throw new AppError(
  'ERROR_CODE',
  'Human readable message',
  httpStatusCode
);
```

Common error codes:
- `LOCK_ALREADY_ACQUIRED` (409): Another process has conversation lock
- `NO_PROVIDERS_AVAILABLE` (503): All LLM providers down
- `COST_LIMIT_EXCEEDED` (402): Message cost exceeds shop limit
- `GUARDRAIL_VIOLATION` (400): Security check failed
- `INTENT_ROUTING_FAILED` (500): Unable to determine intent

---

## Testing

Use provided test helpers:

```javascript
const { MockLLMProvider, initializeServicesForTest } = require('./phase4-integration');

const testConfig = await initializeServicesForTest({
  faqData: [
    {
      id: '1',
      question: 'How do I cancel?',
      answer: 'Use Account > Subscriptions > Cancel',
      shopId: 'test-shop',
      category: 'billing'
    }
  ]
});

const services = await initializePhase4Services(testConfig);
```

---

## Monitoring & Observability

**Logging**: All services use structured-logger with context:
```
INFO Routing intent
  requestId: "uuid"
  shopId: "shop-123"
  messageLen: 42
  timestamp: "2024-12-26T10:30:00Z"
```

**Statistics Available**:
- `llmFailover.getStats()`: Provider health and latency
- `intentRouter.getStats()`: Tier distribution and cache info
- `conversationLock.getStats()`: Current locks held
- `costCap.getValidationHistory()`: Cost audit log

---

## Performance Summary

| Task | Service | Target | Component |
|------|---------|--------|-----------|
| 1 | DB Indexes | No blocking | CREATE INDEX CONCURRENTLY |
| 2 | LLM Failover | <500ms | Promise.race() with timeouts |
| 3 | Cost Cap | <50ms | Cache + DB lookup |
| 4 | Guardrails | <200ms | 5 parallel checks |
| 5 | Conv Lock | <50ms | Redis atomic ops |
| 6 | Intent Router | <50ms (T1), <100ms (T2), <1500ms (T3) | Tiered routing |

**Total Pipeline**: Typically 100-200ms for cached response, <1500ms for LLM response

---

## Deployment Checklist

- [ ] Run database migration (`indexMigration.up()`)
- [ ] Verify indexes created (`indexMigration.verify()`)
- [ ] Initialize LLM providers with API keys
- [ ] Configure Redis connection for locks
- [ ] Load FAQ data into intent router
- [ ] Set cost caps for all shops
- [ ] Configure guardrail thresholds
- [ ] Run integration tests
- [ ] Monitor error rates in first 24 hours
- [ ] Review latency percentiles (p50, p95, p99)

