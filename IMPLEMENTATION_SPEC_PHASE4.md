# Phase 4 Implementation Specification

**Timeline:** 4.5 weeks | **Team:** 2.5 FTE | **Start Date:** March 26, 2026

---

## CRITICAL PATH (Week 1-2)

### 1️⃣ INDEX PRODUCTS (WSJF 54 | Effort: 0.5 days)

**Status:** 🚨 BLOCKER
**Owner:** Backend Dev
**Deadline:** Day 1 EOD

#### Problem
```
Current SQL: SELECT * FROM Product WHERE shop_id = ? AND name LIKE ?
Growth scenario: 100 shops × 1000 products = 100k products
Without index: Full table scan (100ms → 2s as data grows)
```

#### Solution: Add Composite Index

**Migration File:** `src/database/migrations/20260326_001_add_product_indexes.js`

```javascript
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add main product query index
    await queryInterface.addIndex('Products', 
      { fields: ['shop_id', 'name'] },
      { name: 'idx_product_shop_name' }
    );
    
    // Add secondary indexes for common queries
    await queryInterface.addIndex('Products',
      { fields: ['shop_id', 'sku'] },
      { name: 'idx_product_shop_sku' }
    );
    
    // Add index for inventory search
    await queryInterface.addIndex('Products',
      { fields: ['shop_id', 'category'] },
      { name: 'idx_product_shop_category' }
    );
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('Products', 'idx_product_shop_name');
    await queryInterface.removeIndex('Products', 'idx_product_shop_sku');
    await queryInterface.removeIndex('Products', 'idx_product_shop_category');
  }
};
```

**Deployment Checklist:**
- [ ] Test migration on staging (verify <5min execution)
- [ ] Verify index created: `SHOW INDEXES FROM Products WHERE Key_name = 'idx_product_shop_name';`
- [ ] Run ANALYZE Products; to update statistics
- [ ] Load test: 100k products, measure query time (should be <100ms)

**Rollback Plan:**
```sql
-- If performance regresses, drop indexes
DROP INDEX idx_product_shop_name ON Products;
DROP INDEX idx_product_shop_sku ON Products;
DROP INDEX idx_product_shop_category ON Products;
```

**Success Metric:**
- Query time stays <100ms at 100k products
- No regression on other queries

---

### 2️⃣ LATENCY-AWARE FAILOVER (WSJF 34 | Effort: 0.75 days)

**Status:** 🚨 BLOCKER
**Owner:** Lead Dev
**Deadline:** Day 2 EOD

#### Problem
```
Current failover chain: Gemini → OpenAI → Anthropic
Reality: Gemini P95=4s, OpenAI P95=1.5s, Anthropic P95=5s
Issue: If Gemini times out after 2s, system waits full 4s before trying OpenAI
Result: P95 latency = 4s + retry = 5-6s (fails SLA)
```

#### Solution: Timeout-Based Provider Switching

**File:** `src/modules/ai/llm.service.js`

```javascript
// Add new function: intelligent failover with latency awareness

async callLLMWithLatencyAwareFailover(prompt, messages, options = {}) {
  const providers = [
    { name: 'GEMINI_FLASH', timeout: 2000, weight: 1 },     // Fast timeout
    { name: 'OPENAI_MINI', timeout: 1500, weight: 0.8 },     // Faster
    { name: 'ANTHROPIC_CLAUDE', timeout: 2500, weight: 1.2 } // Slower, lower priority
  ];
  
  const startTime = Date.now();
  const selectedProviders = this.selectProviders(options.shop_id, providers);
  
  for (const provider of selectedProviders) {
    try {
      const providerStartTime = Date.now();
      
      // Create cancellation token with dynamic timeout
      const timeoutMs = provider.timeout;
      const result = await this.callProviderWithTimeout(
        provider.name,
        prompt,
        messages,
        timeoutMs
      );
      
      const elapsedMs = Date.now() - startTime;
      this.logger.info('LLM_CALL_SUCCESS', {
        provider: provider.name,
        totalLatency: elapsedMs,
        timeout: timeoutMs,
        shop_id: options.shop_id
      });
      
      return result;
    } catch (error) {
      const elapsedMs = Date.now() - providerStartTime;
      
      if (error.name === 'TimeoutError') {
        this.logger.warn('PROVIDER_TIMEOUT', {
          provider: provider.name,
          elapsedMs,
          timeout: provider.timeout,
          nextProvider: selectedProviders[selectedProviders.indexOf(provider) + 1]?.name || 'NONE'
        });
        // Continue to next provider (don't wait for full timeout)
        continue;
      } else if (error.name === 'RateLimitError') {
        this.logger.warn('PROVIDER_RATE_LIMITED', { provider: provider.name });
        // Skip rate-limited provider, try next
        continue;
      } else {
        // Log error but don't fail immediately
        this.logger.error('PROVIDER_ERROR', { provider: provider.name, error: error.message });
        continue;
      }
    }
  }
  
  // All providers failed
  throw new Error('All LLM providers exhausted');
}

private async callProviderWithTimeout(providerName, prompt, messages, timeoutMs) {
  return Promise.race([
    this.callProvider(providerName, prompt, messages),
    this.createTimeoutPromise(timeoutMs)
  ]);
}

private createTimeoutPromise(timeoutMs) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      const error = new Error(`Provider timeout after ${timeoutMs}ms`);
      error.name = 'TimeoutError';
      reject(error);
    }, timeoutMs);
  });
}
```

**Provider Selection Logic:**

```javascript
private selectProviders(shopId, defaultProviders) {
  // Get shop-specific LLM preferences
  const shopPrefs = this.shopService.getShopLLMPreferences(shopId);
  
  if (shopPrefs?.providersPreferredOrder) {
    // Use shop preference
    return defaultProviders.filter(p => 
      shopPrefs.providersPreferredOrder.includes(p.name)
    );
  }
  
  // Default: cheapest with good speed (Gemini) → fastest (OpenAI) → fallback (Anthropic)
  return [
    defaultProviders.find(p => p.name === 'GEMINI_FLASH'),
    defaultProviders.find(p => p.name === 'OPENAI_MINI'),
    defaultProviders.find(p => p.name === 'ANTHROPIC_CLAUDE')
  ];
}
```

**Configuration (ENV variables):**

```env
LLM_GEMINI_TIMEOUT_MS=2000
LLM_OPENAI_TIMEOUT_MS=1500
LLM_ANTHROPIC_TIMEOUT_MS=2500
LLM_FAILOVER_ENABLED=true
```

**Testing Checklist:**
- [ ] Load test with 100 concurrent requests, measure P95 latency (should be <2s)
- [ ] Simulate Gemini timeout (inject delay >2s), verify fallback to OpenAI
- [ ] Verify cost is still optimized (Gemini preferred if it responds <timeout)
- [ ] Check logs for provider switching patterns

**Success Metrics:**
- P95 latency <2s consistently
- Fallover chain logs show "PROVIDER_TIMEOUT" events (not full timeout waits)
- Cost per message unchanged (Gemini still primary when fast)

---

### 3️⃣ COST CAP PER MESSAGE (WSJF 48 | Effort: 0.5 days)

**Status:** 🚨 BLOCKER
**Owner:** Backend Dev
**Deadline:** Day 2 EOD

#### Problem
```
Current: If AI response fails confidence check, system may retry but no limit
Risk: Hallucination → retry → hallucination again = 3+ LLM calls
Cost impact: 1 message → $0.01 instead of $0.003
At scale: 100 shops × 100 msg/day × 5% failure rate = 500 extra calls/day
```

#### Solution: Per-Message LLM Call Budget

**File:** `src/modules/ai/auto-approve.service.js`

Add tracking:

```javascript
class AutoApproveService {
  async processWithCostCap(message, conversationId, options = {}) {
    const MAX_LLM_CALLS_PER_MESSAGE = 2; // Hard limit
    const llmCallCount = options.llmCallCount || 0; // incremented by caller
    
    if (llmCallCount >= MAX_LLM_CALLS_PER_MESSAGE) {
      this.logger.warn('COST_CAP_REACHED', {
        conversationId,
        llmCallCount: llmCallCount,
        maxAllowed: MAX_LLM_CALLS_PER_MESSAGE
      });
      
      // Instead of retrying, escalate to human
      return {
        type: 'ESCALATE',
        reason: 'Cost cap exceeded',
        message: 'Unable to generate response; please contact support'
      };
    }
    
    // Process normally
    return this.generateResponse(message, conversationId, options);
  }
}
```

**Message Processing Pipeline Update:**

File: `src/modules/conversation/ai-chatbot.controller.js`

```javascript
async processMessage(req, res) {
  const { message, conversationId } = req.body;
  const conversation = await Conversation.findById(conversationId);
  
  // Initialize LLM call counter
  let llmCallCount = conversation.metadata?.llmCallCount || 0;
  
  try {
    const response = await this.autoApproveService.processWithCostCap(
      message,
      conversationId,
      { llmCallCount }
    );
    
    // If escalation triggered, mark conversation
    if (response.type === 'ESCALATE') {
      await conversation.update({
        hitl: true, // Human-in-the-loop
        metadata: {
          ...conversation.metadata,
          escalation_reason: response.reason,
          escalation_time: new Date()
        }
      });
      
      // Alert ops
      await this.opsAlertService.sendAlert({
        type: 'CONVERSATION_ESCALATION',
        conversationId,
        reason: response.reason,
        shopId: conversation.shop_id
      });
    }
    
    // Increment LLM call count
    llmCallCount++;
    await conversation.update({
      metadata: { ...conversation.metadata, llmCallCount }
    });
    
    return res.json(response);
  } catch (error) {
    // Log error
    this.logger.error('MESSAGE_PROCESSING_ERROR', { error, conversationId });
    res.status(500).json({ error: 'Processing failed' });
  }
}
```

**Database Schema Update:**

Migration: `src/database/migrations/20260326_002_add_metadata_costcap.js`

```javascript
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // If metadata column doesn't exist, add it
    const table = await queryInterface.describeTable('Conversations');
    if (!table.metadata) {
      await queryInterface.addColumn('Conversations', 'metadata', {
        type: Sequelize.JSON,
        defaultValue: {},
        allowNull: false
      });
    }
  },
  
  down: async (queryInterface, Sequelize) => {
    // Keep metadata column (data integrity)
  }
};
```

**Testing:**
- [ ] Simulate 2 LLM call failures, verify 3rd call escalates (not retries)
- [ ] Check conversation.hitl = true after escalation
- [ ] Verify ops alert sent

**Success Metric:**
- Cost logs show max 2 LLM calls per message
- No runaway correction loops

---

### 4️⃣ GUARDRAIL ESCALATION (Remove "Correction Loop") (WSJF 30 | Effort: 1 day)

**Status:** 🚨 BLOCKER
**Owner:** Lead Dev
**Deadline:** Day 3 EOD

#### Clarification
The codebase doesn't have a traditional "correction loop" (retry failed responses). Instead, it uses confidence-based gates. This task is to:
1. **Strengthen guardrail checks** (fraud, hallucination detection)
2. **Escalate failures immediately** instead of silently proceeding
3. **Mark conversations for human review**

#### Solution: Guardrail Failure → Escalation

**File:** `src/modules/ai/guardrail.service.js` (new file)

```javascript
const { Service } = require('@nestjs/common');
const { logger } = require('../../utils/logger');

@Service()
class GuardrailService {
  constructor(
    private rtoShieldService,
    private promptSanitizerService,
    private halluccinationDetectorService
  ) {}

  /**
   * Run all guardrails on AI response
   * Returns: { pass: boolean, violations: [...], severity: 'LOW|MEDIUM|HIGH' }
   */
  async validateResponse(aiResponse, originalMessage, conversationId, shopId) {
    const violations = [];
    
    // 1. Check for RTO fraud (BD context)
    const rtoCheck = await this.rtoShieldService.checkPhoneFraud(
      originalMessage,
      shopId
    );
    if (!rtoCheck.pass) {
      violations.push({
        type: 'RTO_FRAUD_DETECTED',
        severity: 'HIGH',
        reason: rtoCheck.reason,
        riskScore: rtoCheck.score
      });
    }
    
    // 2. Check for prompt injection
    const sanitizationCheck = this.promptSanitizerService.sanitize(originalMessage);
    if (!sanitizationCheck.clean) {
      violations.push({
        type: 'PROMPT_INJECTION_ATTEMPT',
        severity: 'HIGH',
        reason: 'Malicious prompt detected'
      });
    }
    
    // 3. Hallucination detection (contextual)
    const hallucCheck = await this.halluccinationDetectorService.detect(
      aiResponse,
      conversationId
    );
    if (hallucCheck.likelyHallucination) {
      violations.push({
        type: 'HALLUCINATION_LIKELY',
        severity: 'MEDIUM',
        confidence: hallucCheck.confidence,
        reason: hallucCheck.description
      });
    }
    
    // 4. Response coherence check
    if (aiResponse.length < 10 || aiResponse.length > 2000) {
      violations.push({
        type: 'RESPONSE_LENGTH_ANOMALY',
        severity: 'LOW',
        reason: `Response length ${aiResponse.length} chars (expected 10-2000)`
      });
    }
    
    return {
      pass: violations.length === 0,
      violations,
      maxSeverity: violations.length > 0 
        ? Math.max(...violations.map(v => this.severityScore(v.severity)))
        : 0
    };
  }

  private severityScore(severity) {
    return { 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3 }[severity];
  }

  /**
   * Handle guardrail failure
   * Returns escalation object + metadata for ops
   */
  async handleFailure(violations, conversationId, shopId) {
    const escalation = {
      conversationId,
      shopId,
      timestamp: new Date(),
      violations,
      status: 'PENDING_REVIEW',
      handledBy: null
    };
    
    // Store escalation in DB
    await this.conversationRepository.update(conversationId, {
      hitl: true,
      metadata: {
        escalation,
        escalation_time: new Date(),
        guardrail_reason: violations
          .map(v => v.type)
          .join(', ')
      }
    });
    
    // Alert ops (WhatsApp, SMS, or dashboard)
    logger.warn('GUARDRAIL_ESCALATION', {
      conversationId,
      shopId,
      violations: violations.map(v => v.type)
    });
    
    // TODO: Send alert to ops (implemented in n8n refactor)
    
    return escalation;
  }
}

module.exports = GuardrailService;
```

**Integration in Message Processing:**

File: `src/modules/conversation/ai-chatbot.controller.js`

```javascript
async processMessage(req, res) {
  const { message, conversationId } = req.body;
  const conversation = await Conversation.findById(conversationId);
  
  try {
    // 1. Generate AI response
    const aiResponse = await this.intentRouter.processNewIntent(
      message,
      conversationId
    );
    
    // 2. RUN GUARDRAILS (NEW)
    const guardCheck = await this.guardrailService.validateResponse(
      aiResponse,
      message,
      conversationId,
      conversation.shop_id
    );
    
    if (!guardCheck.pass) {
      // Guardrail failed → Escalate to human
      const escalation = await this.guardrailService.handleFailure(
        guardCheck.violations,
        conversationId,
        conversation.shop_id
      );
      
      return res.json({
        error: 'Content flagged for review',
        escalation_id: escalation.conversationId,
        violations: guardCheck.violations
      });
    }
    
    // 3. Continue with auto-approval flow
    const gateCheck = await this.autoApproveService.checkConfidenceGate(
      aiResponse,
      conversation
    );
    
    if (!gateCheck.pass) {
      return res.json({
        message: gateCheck.message,
        confidence: gateCheck.confidence,
        gate_triggered: true
      });
    }
    
    // 4.Send response
    return res.json({
      response: aiResponse,
      confidence: gateCheck.confidence,
      guardrail_passed: true
    });
    
  } catch (error) {
    logger.error('MESSAGE_PROCESSING_ERROR', { error, conversationId });
    res.status(500).json({ error: 'Processing failed' });
  }
}
```

**Testing:**
- [ ] Inject malicious prompt, verify escalation triggered (not processed)
- [ ] Simulate hallucination detection, verify conversation marked for review
- [ ] Check database: `conversations.hitl = true` after guardrail failure
- [ ] Verify logs show guardrail reason

**Success Metric:**
- All guardrail violations logged + escalated
- No silent failures
- Zero correction loops

---

### 5️⃣ ESCALATION RUNBOOK (WSJF 36 | Effort: 0.5 days)

**Status:** 🚨 BLOCKER
**Owner:** Tech Lead (documentation)
**Deadline:** Day 3 EOD

#### Runbook: `docs/ESCALATION_RUNBOOK.md`

```markdown
# EasyMod Escalation Runbook

## When Guardrail Flags a Conversation

**Indicator:** `conversations.hitl = true`, `metadata.escalation_reason` set

**What happened:**
- AI detected fraud (RTO Shield)
- Prompt injection attempt
- Likely hallucination
- Response length anomalies

## Ops Workflow

### 1. Check Alert Channel (WhatsApp/SMS to shop owner)
Shop owner receives:
```
🚨 Alert: AI accuracy check needed
Conversation #12345
Reason: Likely hallucination detected
Action: Check dashboard or reply HELP
```

### 2. Open Dashboard / Admin Panel
Navigate to: `admin/escalations/pending`

**View:**
- Conversation ID
- Customer message
- AI response (flagged)
- Guardrail reason
- Suggested action

### 3. Review & Decide

| Reason | Decision | Action |
|--------|----------|--------|
| **RTO Fraud** | Block | Click "Reject" + log reason |
| **Prompt Injection** | Block | Click "Reject" + report to security |
| **Hallucination** | Revise | Edit AI response + click "Approve" |
| **Length Anomaly** | Approve | Review response + click "Approve" |

### 4. Send Response
If approved: Message sent to customer immediately
If rejected: Customer receives "Unable to process; please contact support"

## Monitoring Dashboard

**Check:** `admin/metrics/escalation`

**Key Metrics:**
- Escalations per day
- Average resolution time
- Approve % vs Reject %
- Top escalation reasons

**SLA:** Resolve within 5 minutes (escalation timestamp → approval/rejection)

## If Escalation Rate Too High

Check:
1. Is guardrail threshold too low? (adjust `HALLUCINATION_CONFIDENCE_THRESHOLD`)
2. Are FAQ matches poor? (retune vector search threshold)
3. Is LLM quality degrading? (switch provider in shop settings)

## Troubleshooting

### Q: Conversation not in escalation queue
A: Check `conversations.metadata.escalation_time` is set. Run query:
```sql
SELECT * FROM Conversations WHERE hitl=true AND metadata->>'escalation_time' > NOW() - INTERVAL '1 hour';
```

### Q: Alert not received on WhatsApp
A: Check n8n workflow status (phase 4-C). Fallback: view on dashboard.

---
```

**Implementation Checklist:**
- [ ] Create runbook file
- [ ] Share with ops team
- [ ] Add to admin panel (dashboard link)
- [ ] Test with pilot shop owner

---

### 6️⃣ CONVERSATION LOCK (WSJF 19.3 | Effort: 1.5 days)

**Status:** 🚨 BLOCKER
**Owner:** Lead Dev
**Deadline:** Day 4 EOD

#### Problem
```
If guardrail escalates a conversation, it enters HITL mode (hitl=true).
But conversation state is still being updated by concurrent messages.
Risk: Parallel messages might corrupt conversation history or create branches.
```

#### Solution: Request-Level Lock + Conversation State Consistency

**File:** `src/modules/conversation/conversation-state.service.js`

```javascript
@Service()
class ConversationStateService {
  constructor(
    private redisService,
    private conversationRepository,
    private messageRepository
  ) {}

  /**
   * Acquire lock before message processing
   * Lock key: `conversation-lock:{conversationId}`
   * TTL: 300 seconds (5 minutes)
   */
  async acquireLock(conversationId, timeout = 5000) {
    const lockKey = `conversation-lock:${conversationId}`;
    const lockId = `${Date.now()}-${Math.random()}`;
    
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      // Try to acquire lock (atomic operation)
      const acquired = await this.redisService.set(
        lockKey,
        lockId,
        'NX',       // Only if doesn't exist
        'EX',       // Expiry
        300         // 5 minutes
      );
      
      if (acquired) {
        logger.info('LOCK_ACQUIRED', { conversationId, lockId });
        return lockId;
      }
      
      // Wait 10ms before retrying
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    throw new Error(`Failed to acquire lock for conversation ${conversationId}`);
  }

  /**
   * Release lock after processing
   */
  async releaseLock(conversationId, lockId) {
    const lockKey = `conversation-lock:${conversationId}`;
    
    // Verify lock is still owned by us (prevent accidental release of other locks)
    const currentLock = await this.redisService.get(lockKey);
    if (currentLock !== lockId) {
      logger.warn('LOCK_ALREADY_RELEASED', { conversationId });
      return;
    }
    
    await this.redisService.del(lockKey);
    logger.info('LOCK_RELEASED', { conversationId });
  }

  /**
   * Process message with lock guarantee
   */
  async processMessageWithLock(conversationId, message, callback) {
    let lockId;
    try {
      // Acquire lock (blocking)
      lockId = await this.acquireLock(conversationId);
      
      // Run critical section
      const result = await callback();
      
      // If conversation in HITL, queue message for review (don't update history)
      const conversation = await this.conversationRepository.findById(conversationId);
      if (conversation.hitl) {
        logger.info('MESSAGE_QUEUED_FOR_REVIEW', { conversationId });
        // Store message but don't add to conversation history yet
        await this.messageRepository.create({
          conversation_id: conversationId,
          sender: 'customer',
          content: message,
          pending_review: true
        });
      } else {
        // Normal flow
        await this.storeMessage(conversationId, message);
      }
      
      return result;
    } finally {
      if (lockId) {
        await this.releaseLock(conversationId, lockId);
      }
    }
  }

  /**
   * Conversation state update (inside locked section)
   */
  async updateConversationState(conversationId, updates) {
    // This should only be called inside a lock
    const conversation = await this.conversationRepository.findById(conversationId);
    return conversation.update(updates);
  }
}
```

**Integration in Controller:**

File: `src/modules/conversation/ai-chatbot.controller.js`

```javascript
async processMessage(req, res) {
  const { message, conversationId } = req.body;
  
  try {
    // Wrap entire processing in conversation lock
    const result = await this.conversationStateService.processMessageWithLock(
      conversationId,
      message,
      async () => {
        // All operations here are guaranteed to be atomic
        
        const conversation = await Conversation.findById(conversationId);
        
        // If in HITL, queue message for review (don't process)
        if (conversation.hitl) {
          logger.info('CONVERSATION_IN_REVIEW', { conversationId });
          return {
            status: 'QUEUED',
            message: 'Conversation under review; your message will be processed soon'
          };
        }
        
        // Normal flow
        const aiResponse = await this.intentRouter.processNewIntent(
          message,
          conversationId
        );
        
        // ... rest of processing
        return { response: aiResponse };
      }
    );
    
    return res.json(result);
  } catch (error) {
    if (error.message.includes('Failed to acquire lock')) {
      return res.status(503).json({ 
        error: 'Conversation is busy; please retry',
        retryAfter: 1000 
      });
    }
    logger.error('MESSAGE_PROCESSING_ERROR', { error, conversationId });
    res.status(500).json({ error: 'Processing failed' });
  }
}
```

**Migration: Track Lock Metadata**

File: `src/database/migrations/20260326_003_add_lock_metadata.js`

```javascript
module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add columns to track lock state (informational only)
    await queryInterface.addColumn('Conversations', 'pending_review_count', {
      type: Sequelize.INTEGER,
      defaultValue: 0,
      allowNull: false
    });
    
    await queryInterface.addColumn('Conversations', 'last_locked_at', {
      type: Sequelize.DATE,
      allowNull: true
    });
  },
  
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('Conversations', 'pending_review_count');
    await queryInterface.removeColumn('Conversations', 'last_locked_at');
  }
};
```

**Testing:**
- [ ] Load test with parallel messages to same conversation while HITL=true
- [ ] Verify lock prevents race condition (messages queued, not lost)
- [ ] Measure lock acquisition latency (should be <50ms)
- [ ] Test timeout (lock auto-release after 5min)

**Success Metric:**
- No race conditions on HITL conversations
- Messages always in order
- Lock latency <50ms

---

### 7️⃣ INTENT ROUTER HIERARCHY (WSJF 13.5 | Effort: 2 days)

**Status:** 🚨 BLOCKER
**Owner:** Lead Dev
**Deadline:** Day 5-6 EOD

#### Current Flow (Cache → Semantic → LLM)
Already implemented! But needs **priority reordering** for BD market:

1. Cache (exact match) — <50ms
2. Semantic FAQ (vector search) — <100ms
3. SQL Product lookup — <150ms
4. Gemini LLM call — 1500-4000ms

#### Change: Front-load SQL for Product/Stock Queries

**File:** `src/modules/ai/intent-router.service.js`

```javascript
async processNewIntent(message, conversationId) {
  const startTime = Date.now();
  
  // Step 1: Check exact cache
  const cacheKey = this.normalisedKey(shopId, message);
  const cached = await this.cacheService.get(cacheKey);
  if (cached) {
    logger.info('INTENT_ROUTER_CACHE_HIT', { 
      latency: Date.now() - startTime 
    });
    return cached;
  }
  
  // Step 2: NEW - SQL Product Query (for stock/price questions)
  const sqlMatch = await this.attemptSQLMatch(message, shopId);
  if (sqlMatch.found) {
    const response = this.formatProductResponse(sqlMatch);
    await this.cacheService.set(cacheKey, response, 300);
    logger.info('INTENT_ROUTER_SQL_HIT', { 
      latency: Date.now() - startTime,
      productId: sqlMatch.productId 
    });
    return response;
  }
  
  // Step 3: Semantic FAQ search
  const semanticMatch = await this.semanticSearch(message, shopId);
  if (semanticMatch.score > 0.82) {
    const response = this.formatFaqResponse(semanticMatch);
    await this.cacheService.set(cacheKey, response, 300);
    logger.info('INTENT_ROUTER_SEMANTIC_HIT', { 
      latency: Date.now() - startTime,
      faqScore: semanticMatch.score 
    });
    return response;
  }
  
  // Step 4: Fallback to LLM
  const llmResponse = await this.callLLM(message, conversationId, shopId);
  await this.cacheService.set(cacheKey, llmResponse, 300);
  logger.info('INTENT_ROUTER_LLM_CALL', { 
    latency: Date.now() - startTime 
  });
  return llmResponse;
}

/**
 * NEW: Attempt SQL match for product queries
 * Detects: "price of X", "stock of X", "how much does X cost"
 */
private async attemptSQLMatch(message, shopId) {
  // Use NLP to detect product query patterns
  const entities = this.extractEntities(message);
  
  if (!entities.product_name) {
    return { found: false };
  }
  
  // Build indexed SQL query
  const product = await Product.findOne({
    where: {
      shop_id: shopId,
      name: { [Op.like]: `%${entities.product_name}%` }
    },
    attributes: ['id', 'name', 'sku', 'price', 'quantity_in_stock']
  });
  
  if (product) {
    return {
      found: true,
      productId: product.id,
      name: product.name,
      sku: product.sku,
      price: product.price,
      stock: product.quantity_in_stock
    };
  }
  
  return { found: false };
}

private formatProductResponse(match) {
  return {
    type: 'PRODUCT_INFO',
    name: match.name,
    sku: match.sku,
    price: `৳${match.price}`,
    stock: match.stock > 0 
      ? `${match.stock} available` 
      : 'Out of stock',
    source: 'PRODUCT_DB',
    confidence: 0.95
  };
}
```

**Entity Extraction (NLP):**

```javascript
private extractEntities(message) {
  // Use NLP library (e.g., compromise, natural)
  // Detect product names, quantities, intents
  
  const nlp = require('compromise');
  const doc = nlp(message);
  
  return {
    intent: this.classifyIntent(message),
    product_name: doc.nouns().out('array')?.[0] || null,
    quantity: doc.numbers().out('array')?.[0] || null,
    action: doc.verbs().out('array')?.[0] || null
  };
}

private classifyIntent(message) {
  const keywords = {
    PRICE: /price|cost|how much|expensive/i,
    STOCK: /stock|available|quantity|do you have/i,
    ORDER: /order|buy|want/i,
    DELIVERY: /deliver|shipping|how long/i,
    RETURN: /return|refund|exchange/i
  };
  
  for (const [intent, pattern] of Object.entries(keywords)) {
    if (pattern.test(message)) {
      return intent;
    }
  }
  
  return 'GENERAL';
}
```

**Update Latency Profile:**

```sql
-- Query before optimization
Query: SELECT * FROM Product WHERE shop_id=1 AND name LIKE '%phone%'
Time: 250ms (full table scan)

-- After index + SQL routing
Query: SELECT * FROM Product WHERE shop_id=1 AND name LIKE '%phone%'
Time: 50ms (index scan)

-- Latency by query type:
- Exact cache hit: 10ms
- Product DB hit: 50ms
- FAQ semantic: 80ms
- LLM call: 1500-4000ms
- P95 overall: <2s
```

**Testing:**
- [ ] Test 100 price queries, verify all use SQL route (<100ms)
- [ ] Test 100 FAQ queries, verify semantic route (<150ms)
- [ ] Test 50 complex queries, verify LLM route with failover
- [ ] Measure P95 latency (target: <2s)

**Success Metric:**
- P95 latency <2s
- 40% of queries use SQL/cache (not LLM)
- Cost per message drops (fewer LLM calls)

---

## NON-CRITICAL PATH (Week 2, Can Parallelize)

### 8️⃣ SQLITE FALLBACK QUEUE (WSJF 17.3)
### 9️⃣ REAL-TIME TOKEN COUNTER (WSJF 18.4)
### 🔟 OFFLINE FAQ CACHE (WSJF 24)
### 1️⃣1️⃣ SELECTIVE BULLMQ (WSJF 17)
### 1️⃣2️⃣ n8n WHATSAPP ALERTS (WSJF 21)
### 1️⃣3️⃣ COST ATTRIBUTION (WSJF 25.3)
### 1️⃣4️⃣ OPS TRAINING (WSJF 17.3)

*(Detailed specs in Phase 4-B section)*

---

## DEPLOYMENT CHECKLIST

- [ ] All migrations tested on staging
- [ ] Code reviewed + approved
- [ ] Load tests pass
- [ ] Guardrail alerts configured
- [ ] Ops trained on runbook
- [ ] Pilot shop selected
- [ ] Rollback plans documented

---

## TIMELINE SUMMARY

| Phase | Items | Timeline | Status |
|-------|-------|----------|--------|
| **4-A** | Index, Failover, Cost Cap, Correction Loop, Runbook, Lock | Week 1 | 🚨 In Progress |
| **4-B** | SQLite, Token Counter, FAQ Cache, BullMQ, n8n, Attribution | Week 2 | ⏳ Ready |
| **4-C** | Shop Dashboard, Bengali, Ops Training | Week 3 | 📊 Deferred if tight |

