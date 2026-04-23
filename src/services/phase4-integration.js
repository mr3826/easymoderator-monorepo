/**
 * Phase 4 Core Services - Integration Guide & Test Hooks
 * 
 * This file demonstrates how all 6 services work together in the conversation pipeline
 * and provides initialization patterns and usage examples.
 */

// ============================================================================
// INITIALIZATION & SETUP
// ============================================================================

const DatabaseIndexMigration = require('./database-indexes.migration');
const LLMFailoverService = require('./llm-failover.service');
const CostCapService = require('./cost-cap.service');
const GuardrailService = require('./guardrail.service');
const ConversationLockService = require('./conversation-lock.service');
const IntentRouterService = require('./intent-router.service');

/**
 * Complete Phase 4 service initialization
 * Call this once at application startup
 */
async function initializePhase4Services(config) {
  const { db, redis, llmConfig, faqData, embeddingService } = config;

  console.log('🚀 Initializing Phase 4 Core Services...');

  try {
    // 1. DATABASE INDEXES (Task 1)
    const indexMigration = new DatabaseIndexMigration(db);
    const indexResult = await indexMigration.up();
    console.log('✓ Database indexes created:', indexResult.results.length, 'indexes');

    // 2. LLM FAILOVER (Task 2)
    const llmFailover = new LLMFailoverService(llmConfig);
    await llmFailover.initialize();
    console.log('✓ LLM failover service initialized');

    // 3. COST CAP (Task 3)
    const costCap = new CostCapService(db);
    console.log('✓ Cost cap service initialized');

    // 4. GUARDRAIL (Task 4)
    const guardrail = new GuardrailService({});
    console.log('✓ Guardrail service initialized');

    // 5. CONVERSATION LOCK (Task 5)
    const conversationLock = new ConversationLockService(redis, {
      ttl: 30,
      maxTTL: 300,
      acquireTimeout: 5000
    });
    console.log('✓ Conversation lock service initialized');

    // 6. INTENT ROUTER (Task 6)
    const intentRouter = new IntentRouterService({
      cacheTTL: 3600000,
      cacheMaxSize: 1000
    });
    await intentRouter.initialize(faqData, llmFailover, embeddingService);
    console.log('✓ Intent router service initialized');

    return {
      indexMigration,
      llmFailover,
      costCap,
      guardrail,
      conversationLock,
      intentRouter
    };

  } catch (error) {
    console.error('❌ Phase 4 initialization failed:', error.message);
    throw error;
  }
}

// ============================================================================
// CONVERSATION PROCESSING PIPELINE
// ============================================================================

/**
 * Complete conversation processing with all Phase 4 services
 * This is the main workflow that uses all 6 services
 */
async function processConversationMessage(
  userMessage,
  conversationId,
  shopId,
  services
) {
  const { conversationLock, intentRouter, costCap, guardrail, llmFailover } = services;
  
  const pipeline = {
    steps: [],
    errors: [],
    success: false
  };

  // STEP 1: Acquire conversation lock (Task 5)
  console.log('📍 Step 1: Acquiring conversation lock...');
  let lockToken;

  try {
    const lockResult = await conversationLock.acquireLock(conversationId, {
      ttl: 60,
      autoRefresh: true
    });

    lockToken = lockResult.lockToken;

    pipeline.steps.push({
      step: 'conversation_lock',
      status: 'success',
      elapsed: lockResult.elapsed,
      expiresAt: lockResult.expiresAt
    });

    console.log(`✓ Lock acquired (${lockResult.elapsed}ms)`);

  } catch (error) {
    pipeline.steps.push({
      step: 'conversation_lock',
      status: 'failed',
      error: error.message
    });

    pipeline.errors.push(error);
    console.error('❌ Lock acquisition failed:', error.message);
    return pipeline;
  }

  try {
    // STEP 2: Route user intent (Task 6)
    console.log('📍 Step 2: Routing user intent...');

    const routingResult = await intentRouter.routeIntent(userMessage, shopId, {
      confidenceThreshold: 0.75
    });

    pipeline.steps.push({
      step: 'intent_routing',
      status: 'success',
      tier: routingResult.tier,
      confidence: routingResult.confidence,
      elapsed: routingResult.performance.elapsedMs
    });

    console.log(`✓ Intent routed to Tier ${routingResult.tier} (${routingResult.performance.elapsedMs}ms)`);

    // STEP 3: Validate cost (Task 3)
    // Only for LLM-generated responses (Tier 3)
    if (routingResult.tier === 3) {
      console.log('📍 Step 3: Validating LLM cost...');

      const costValidation = await costCap.validateCost(
        shopId,
        routingResult.metadata.tokensUsed?.totalTokens || 250,
        routingResult.metadata.provider,
        'unknown',
        { userId: null, ipAddress: null }
      );

      pipeline.steps.push({
        step: 'cost_validation',
        status: costValidation.allowed ? 'success' : 'blocked',
        cost: costValidation.cost,
        limit: costValidation.limit
      });

      if (!costValidation.allowed) {
        pipeline.errors.push(new Error(costValidation.reason));
        console.warn('⚠️ Cost limit exceeded:', costValidation.reason);
      } else {
        console.log(`✓ Cost validation passed ($${costValidation.cost})`);
      }
    } else {
      pipeline.steps.push({
        step: 'cost_validation',
        status: 'skipped',
        reason: 'Tier 1/2 response - no LLM cost'
      });
    }

    // STEP 4: Run security guardrails (Task 4)
    console.log('📍 Step 4: Running security guardrails...');

    const guardrailResult = await guardrail.validateOutput(
      userMessage,
      routingResult.response,
      { shopId, conversationId }
    );

    pipeline.steps.push({
      step: 'guardrails',
      status: guardrailResult.passed ? 'success' : 'violations',
      loggingId: guardrailResult.loggingId,
      violationCount: guardrailResult.violations.length,
      violations: guardrailResult.violations.map(v => v.type)
    });

    if (!guardrailResult.passed) {
      console.warn('⚠️ Guardrail violations detected:');
      guardrailResult.violations.forEach(v => {
        console.warn(`   - ${v.type}: ${v.reason}`);
      });
    } else {
      console.log('✓ All guardrails passed');
    }

    // STEP 5: LLM Failover (Task 2) - Already executed in Tier 3
    if (routingResult.tier === 3) {
      pipeline.steps.push({
        step: 'llm_failover',
        status: 'success',
        provider: routingResult.metadata.provider,
        tokensUsed: routingResult.metadata.tokensUsed
      });
    }

    pipeline.success = true;
    pipeline.finalResponse = routingResult.response;
    console.log('✅ Message processing completed successfully');

  } finally {
    // STEP 6: Release conversation lock (Task 5)
    console.log('📍 Releasing conversation lock...');

    try {
      await conversationLock.releaseLock(lockToken, conversationId);
      pipeline.steps.push({
        step: 'lock_release',
        status: 'success'
      });
      console.log('✓ Lock released');
    } catch (releaseError) {
      pipeline.steps.push({
        step: 'lock_release',
        status: 'failed',
        error: releaseError.message
      });
      console.warn('⚠️ Lock release failed:', releaseError.message);
    }
  }

  return pipeline;
}

// ============================================================================
// UNIT TEST HOOKS
// ============================================================================

/**
 * Test helper: Mock LLM provider for unit tests
 */
class MockLLMProvider {
  async executeWithFailover(message, systemPrompt, options) {
    return {
      content: `Mock response to: ${message}`,
      provider: 'mock',
      usage: {
        inputTokens: 50,
        outputTokens: 100,
        totalTokens: 150
      },
      elapsed: 100
    };
  }

  getStats() {
    return { provider: 'mock' };
  }
}

/**
 * Test helper: Initialize services for testing
 */
async function initializeServicesForTest(config = {}) {
  const mockDb = config.db || {
    getConnection: async () => ({
      query: async () => ({ rows: [{ max_auto_order_value: 50 }] }),
      release: async () => {}
    })
  };

  const mockRedis = config.redis || {
    set: async () => 'OK',
    get: async () => null,
    ttl: async () => -2,
    del: async () => 1,
    eval: async () => 1
  };

  const mockEmbedding = config.embeddingService || {
    embed: async (text) => new Array(768).fill(Math.random()).map(x => x - 0.5)
  };

  return {
    db: mockDb,
    redis: mockRedis,
    llmConfig: config.llmConfig || {
      openai: { apiKey: 'mock' },
      gemini: { apiKey: 'mock' }
    },
    embeddingService: mockEmbedding,
    faqData: config.faqData || [
      {
        id: '1',
        question: 'How do I reset my password?',
        answer: 'Use the forgot password link on the login page.',
        shopId: 'test-shop',
        category: 'account'
      }
    ]
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Service classes
  DatabaseIndexMigration,
  LLMFailoverService,
  CostCapService,
  GuardrailService,
  ConversationLockService,
  IntentRouterService,

  // Initialization
  initializePhase4Services,
  initializeServicesForTest,

  // Pipeline
  processConversationMessage,

  // Test helpers
  MockLLMProvider,

  // Documentation
  INTEGRATION_GUIDE: {
    description: 'Phase 4 Core Services Integration',
    task1: 'database-indexes.migration.js - Task 1: Database indexing',
    task2: 'llm-failover.service.js - Task 2: LLM provider failover',
    task3: 'cost-cap.service.js - Task 3: Cost validation',
    task4: 'guardrail.service.js - Task 4: Security guardrails',
    task5: 'conversation-lock.service.js - Task 5: Redis-based locking',
    task6: 'intent-router.service.js - Task 6: Three-tier intent routing',
    pipeline: 'processConversationMessage(userMessage, conversationId, shopId, services)'
  }
};
