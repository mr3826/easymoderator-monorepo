# 🔧 IMPLEMENTATION CODE FILES - Integration Guide

**Status:** All code files ready for integration  
**Audience:** Lead Dev, Backend Dev (Developers implementing Phase 4)  
**Date:** March 26, 2026

---

## 📋 CODE FILES CREATED (Ready to Use)

### ✅ TASK 1: Add Product Indexes (Day 1)
**File:** `src/database/migrations/20260326_001_add_product_indexes.js`
**Status:** ✅ READY TO DEPLOY
**What it does:** Creates 4 composite indexes on Products table for faster queries

```bash
# Deploy immediately
npm run db:migrate:dev

# Verify
mysql> SHOW INDEXES FROM Products WHERE Key_name LIKE 'idx_product%';
# Expected: 4 rows (shop_id+name, shop_id+sku, shop_id+category, shop_id+status)

# Load test
npm run test:load:products -- --records 100000
# Expected: Query time <100ms
```

---

### ✅ TASK 2: Latency-Aware LLM Failover (Day 2)
**File:** `src/modules/ai/llm.service.latency-failover.js`
**Status:** ✅ READY TO CODE
**What it does:** 
- Replace chain-based failover with timeout-based intelligent switching
- Measures provider latencies and re-ranks them
- Uses Promise.race() to timeout slow providers
- Falls back to next fastest provider

**Key Changes:**
```javascript
// OLD (v1):
await geminiService.call()  // If timeout, try openai (chain)

// NEW (v2):
await Promise.race([
  geminiService.call(),      // Gemini: 2000ms timeout
  timeoutPromise(2000)
]).catch(err => {
  // Timeout? Try OpenAI next
  return this.callProvider('openai', ...);
});
```

**Integration Steps:**
1. Copy code structure from `llm.service.latency-failover.js`
2. Add to existing `src/modules/ai/llm.service.js`
3. Add ENV variables:
   ```
   LLM_GEMINI_TIMEOUT_MS=2000
   LLM_OPENAI_TIMEOUT_MS=1500
   LLM_ANTHROPIC_TIMEOUT_MS=2500
   LLM_FAILOVER_ENABLED=true
   ```
4. Update message processor to call `callLLMWithLatencyAwareFailover()` instead of chain

**Testing:**
```bash
npm run test:load:latency -- --concurrency 100 --seconds 60
# Expected: P95 <2s, all providers working
```

---

### ✅ TASK 3a: Cost Cap Migration (Day 2)
**File:** `src/database/migrations/20260326_002_add_metadata_costcap.js`
**Status:** ✅ READY TO DEPLOY
**What it does:** Adds metadata schema to track LLM call counts

```bash
# Deploy
npm run db:migrate:dev

# Verify
mysql> DESC messages;
# Expected: metadata (JSON), cost_cap_status (ENUM)

mysql> SHOW INDEXES FROM messages WHERE Key_name LIKE 'idx_msg_%';
# Expected: idx_msg_shop_costcap, idx_msg_shop_date
```

---

### ✅ TASK 3b: Cost Cap Enforcement (Day 2)
**File:** `src/modules/ai/auto-approve.service.update.js`
**Status:** ✅ READY TO CODE
**What it does:**
- Add `shouldCallLLMAgain()` to check if message can call LLM
- Add `incrementLLMCallCount()` to track calls
- Escalate to HITL if ≥2 calls

**Key Methods:**
```javascript
// Before each LLM call:
const check = await autoApproveService.shouldCallLLMAgain(message);
if (!check.canCallLLM) {
  // Escalate
  await guardrailService.handleFailure(message);
  return;
}

// After each LLM call:
await autoApproveService.incrementLLMCallCount(message);
```

**Integration:**
1. Add methods from `auto-approve.service.update.js` to existing service
2. Call `shouldCallLLMAgain()` BEFORE each LLM call
3. Call `incrementLLMCallCount()` AFTER each LLM call
4. If count >= 2, escalate instead of retry

---

### ✅ TASK 4: Guardrail Service (Day 3)
**File:** `src/modules/ai/guardrail.service.js`
**Status:** ✅ ALREADY CREATED & READY
**What it does:** Run 5 guardrails before sending response
- RTO fraud detection
- Prompt injection detection
- Hallucination detection
- Coherence check
- Toxicity check

**Integration:**
```javascript
// After LLM call, before sending:
const guardResult = await guardrailService.validateResponse(
  aiResponse,
  originalMessage,
  conversationId,
  shopId
);

if (!guardResult.pass) {
  // Mark conversation as HITL
  await conversationRepository.update(conversationId, { hitl: true });
  // Alert ops team
  await opsAlertService.createEscalation(guardResult);
  return;
}

// Guardrails passed, safe to send
await conversationRepository.saveMessage(response);
```

---

### ✅ TASK 5: Conversation Lock Service (Day 4)
**File:** `src/modules/conversation/conversation-lock.service.js`
**Status:** ✅ READY TO CODE
**What it does:** 
- Prevent race conditions when processing concurrent messages
- Use Redis atomic operations for locking
- Auto-release after timeout

**Key Methods:**
```javascript
// Before processing:
const lock = await lockService.acquireLock(conversationId, 5000);
if (!lock.success) {
  // Conversation is being processed, queue this message
  await queue(message);
  return;
}

try {
  // Process message
  await processMessage(conversationId, message);
} finally {
  // Always release
  await lockService.releaseLock(conversationId, lock.lockId);
}
```

**Integration:**
1. Inject `ConversationLockService` into message controller
2. Wrap `processMessage()` with lock/unlock
3. Queue messages if lock cannot be acquired
4. Process queued messages after lock release

---

### ✅ TASK 6: Intent Router Hierarchy (Day 5)
**File:** `src/modules/ai/intent-router.service.update.js`
**Status:** ✅ READY TO CODE
**What it does:**
- Reorder routing hierarchy: Cache → SQL Product → Semantic FAQ → LLM
- NEW: Add SQL product matching (BEFORE semantic search)
- Expected: 15-20% fewer LLM calls, 3x faster for product queries

**New Tier 2 Logic:**
```javascript
// After cache miss, try SQL product match
const product = await productRepository.findOne({
  where: {
    shop_id: shopId,
    name: { [Op.like]: `%${extractedProductName}%` }
  }
});

if (product) {
  // Found! Return product info (no LLM needed)
  return formatProductResponse(product);
}

// If no product match, fall through to semantic/LLM
```

**Integration:**
1. Add methods to existing intent-router service
2. Add `matchProductFromMessage()` between cache and semantic
3. Set index requirement: **Must have TASK 1 indexes deployed first**
4. Expected impact: P95 latency reduction, ~20% cost savings

---

## 🔄 INTEGRATION CHECKLIST

### Before Starting (Prerequisites)

- [ ] All 5 database indexes exist (TASK 1 deployed)
- [ ] ENV variables added (.env + .env.example)
- [ ] Redis connection working
- [ ] Code review team available for PRs

### Day 1: Index Migration

```bash
[ ] Deploy: 20260326_001_add_product_indexes.js
[ ] Verify: SHOW INDEXES FROM Products
[ ] Test: npm run test:load:products
[ ] Merge to staging branch
```

### Day 2: Latency Failover + Cost Cap

```bash
[ ] Update: src/modules/ai/llm.service.js
    - Add callLLMWithLatencyAwareFailover() method
    - Add getRankedProviders() method
    - Add recordLatencyMetric() method

[ ] Deploy: 20260326_002_add_metadata_costcap.js
[ ] Verify: DESC messages; SHOW INDEXES

[ ] Update: src/modules/ai/auto-approve.service.js
    - Add shouldCallLLMAgain() method
    - Add incrementLLMCallCount() method

[ ] Update: src/modules/conversation/ai-chatbot.controller.js
    - Before LLM: check shouldCallLLMAgain()
    - After LLM: increment counter
    - If count >= 2: escalate

[ ] Test: npm run test:load:latency
[ ] Merge to staging
```

### Day 3: Guardrails + Escalation

```bash
[ ] Verify: guardraf.service.js already exists
[ ] Update: src/modules/conversation/ai-chatbot.controller.js
    - After LLM response: call guardrailService.validateResponse()
    - On failure: mark HITL + alert ops

[ ] Update: runbook with escalation workflow
[ ] Train ops team
[ ] Test: npm run test:guardrails
[ ] Merge to staging
```

### Day 4: Conversation Lock

```bash
[ ] Create: src/modules/conversation/conversation-lock.service.js
    (or update existing conversation-state.service.js)

[ ] Update: src/modules/conversation/ai-chatbot.controller.js
    - Wrap processMessage with lock/unlock
    - Queue messages if lock held
    - Release after processing

[ ] Test: npm run test:load:concurrency -- --messages 1000
[ ] Merge to staging
```

### Day 5: Intent Router

```bash
[ ] Update: src/modules/ai/intent-router.service.js
    - Add matchProductFromMessage() [Tier 2]
    - Add formatProductResponse()
    - Reorder: Cache → SQL Product → Semantic → LLM

[ ] Test: npm run test:load:products-in-messages
[ ] Verify: Product queries <200ms
[ ] Merge to staging
```

### Week 2: Final Integration Testing

```bash
[ ] Run all tests: npm run test:all
[ ] Load test: npm run test:load:* (all scenarios)
[ ] Check logs: Verify no errors, all routes working
[ ] Performance: P95 <2s gate
[ ] Cost: <$0.005/msg gate
[ ] Code review: All PRs approved
```

---

## 🧪 TESTING COMMANDS (Run Daily)

```bash
# Unit tests
npm run test:unit -- "*.spec.js"

# Integration tests
npm run test:integration -- "*.e2e.js"

# Load tests by feature
npm run test:load:latency      # P95 <2s?
npm run test:load:products     # Product queries <100ms?
npm run test:load:cost         # Max 2 LLM calls?
npm run test:load:concurrency  # Locks working?
npm run test:guardrails        # All 5 guards pass?

# Combined final test
npm run test:all
```

---

## 🚀 DEPLOYMENT ORDER (Critical Path)

```
1. TASK 1: Index migration       (Day 1, 1 hour)
2. TASK 2: Latency failover      (Day 2, 8 hours)
3. TASK 3: Cost cap              (Day 2, parallel, 4 hours)
4. TASK 4: Guardrails            (Day 3, integration, 2 hours)
5. TASK 5: Conversation lock     (Day 4, 4 hours)
6. TASK 6: Intent router         (Day 5, 3 hours)

All other tasks (7-14) can run in parallel starting Day 3
```

---

## 📞 COMMON INTEGRATION ISSUES & FIXES

### Issue 1: Index Migration Fails
**Cause:** MySQL version < 5.7 doesn't support composite indexes
**Fix:** Verify MySQL version: `SELECT VERSION();` (need ≥5.7)

### Issue 2: Timeout Not Working
**Cause:** Promise.race() resolves before timeout
**Fix:** Ensure timeout <= provider timeout (e.g., Gemini 2000ms > Gemini default 3000ms)

### Issue 3: Guardrail False Positives (Blocks Legitimate Responses)
**Cause:** Hallucination threshold too aggressive
**Fix:** Lower threshold in ENV: `HALLUCINATION_THRESHOLD=0.7` (from 0.9)

### Issue 4: Lock Deadlock (Message Never Completes)
**Cause:** Lock not released due to exception
**Fix:** Use try/finally: `try { process() } finally { releaseLock() }`

### Issue 5: SQL Product Match Too Slow
**Cause:** Indexes not deployed yet
**Fix:** Verify TASK 1 completed: `SHOW INDEXES FROM Products`

---

## ✅ SUCCESS GATES (Before Go-Live)

All of these MUST pass:

```bash
[ ] npm run test:unit            # All unit tests pass
[ ] npm run test:integration     # All integration tests pass
[ ] npm run test:load:latency    # P95 <2s
[ ] npm run test:load:cost       # <$0.005/msg
[ ] Guard:rate >40%              # Cache hit rate
[ ] npm run db:validate          # Database integrity
[ ] Code review                  # Lead Dev approved all PRs
[ ] Ops training                 # Team trained & pilot tested
```

---

## 📊 MONITORING AFTER DEPLOYMENT

**Setup alerts for:**
- `P95_LATENCY_MS > 2500` → Page on-call
- `COST_PER_MSG > 0.007` → Alert DevOps
- `GUARDRAIL_VIOLATIONS > 1%` → Adjust thresholds
- `LOCK_TIMEOUT > 5%` → Increase timeout or scale
- `AUTH_FAILURES > 0.1%` → Check API keys

---

## 🎯 Next Step

Pick up the critical path code file that matches today's task:

- **Today (Day 1):** Deploy `20260326_001_add_product_indexes.js` immediately
- **Tomorrow (Day 2):** Integrate `llm.service.latency-failover.js` + cost cap
- **Wednesday (Day 3):** Integrate `guardrail.service.js` + ops training
- **Thursday (Day 4):** Integrate `conversation-lock.service.js`
- **Friday (Day 5):** Integrate `intent-router.service.update.js`

**Questions?** Check the IMPLEMENTATION_SPEC_PHASE4.md or ask Tech Lead.

