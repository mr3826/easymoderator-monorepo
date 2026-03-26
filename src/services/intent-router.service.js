/**
 * Intent Router Service - Three-tier routing strategy
 * FIXES BLOCKING #5: Complete implementation of all tier methods
 * Tier 1: Exact Cache (O(1), <50ms)
 * Tier 2: Semantic FAQ (O(log n), <100ms)
 * Tier 3: LLM Fallback (O(n), <1500ms)
 */

const { createLogger } = require('../utils/structured-logger');
const { AppError } = require('../utils/AppError');
const logger = createLogger('IntentRouterService');

const INTENT_ROUTER_CONSTANTS = {
  EXACT_CACHE_MAX_ENTRIES: 1000,
  EXACT_CACHE_TTL_MS: 5 * 60 * 1000,
  TIER1_TARGET_MS: 50,
  TIER2_TARGET_MS: 100,
  TIER3_TARGET_MS: 1500,
  SEMANTIC_SIMILARITY_THRESHOLD: 0.75,
  SEMANTIC_MAX_RESULTS: 5,
  LLM_COST_CAP_TOKENS: 5000,
  LLM_CONFIDENCE_THRESHOLD: 0.85
};

class IntentRouterService {
  constructor(options = {}) {
    this.config = options.config || {};
    this.llmProvider = options.llmProvider;
    this.semanticIndex = options.semanticIndex;
    this.costCapService = options.costCapService;
    this.conversationService = options.conversationService;
    this.exactCache = new Map();
    this.cacheExpiry = new Map();
    this.metrics = { tier1Hits: 0, tier1Misses: 0, tier2Hits: 0, tier2Misses: 0, tier3Calls: 0 };
  }

  async classifyAndRoute(userMessage, shopId, conversationContext = {}) {
    const startTime = Date.now();
    const messageHash = this._hashMessage(userMessage, shopId);
    const loggingId = `intent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      const tier1Result = await this._tier1ExactCache(userMessage, shopId, messageHash);
      if (tier1Result) {
        this.metrics.tier1Hits++;
        logger.debug('Tier 1 hit', { loggingId, duration_ms: Date.now() - startTime });
        return tier1Result;
      }
      this.metrics.tier1Misses++;

      const tier2Result = await this._tier2SemanticFAQ(userMessage, shopId);
      if (tier2Result) {
        this.metrics.tier2Hits++;
        this._cacheExactMatch(userMessage, shopId, tier2Result);
        logger.debug('Tier 2 hit', { loggingId, similarity: tier2Result.confidence });
        return tier2Result;
      }
      this.metrics.tier2Misses++;

      const tier3Result = await this._tier3LLMFallback(userMessage, shopId, conversationContext, loggingId);
      this.metrics.tier3Calls++;
      if (tier3Result.confidence >= INTENT_ROUTER_CONSTANTS.LLM_CONFIDENCE_THRESHOLD) {
        this._cacheExactMatch(userMessage, shopId, tier3Result);
      }
      logger.info('Tier 3 used', { loggingId, duration_ms: Date.now() - startTime });
      return tier3Result;
    } catch (error) {
      logger.error('Intent routing failed', { loggingId, error: error.message });
      throw new AppError('Failed to route intent', 500, 'INTENT_ROUTING_FAILED', { loggingId });
    }
  }

  async _tier1ExactCache(userMessage, shopId, messageHash) {
    const cacheKey = `${shopId}:${messageHash}`;
    if (this.exactCache.has(cacheKey)) {
      const expiry = this.cacheExpiry.get(cacheKey);
      if (expiry && Date.now() < expiry) return this.exactCache.get(cacheKey);
      this.exactCache.delete(cacheKey);
      this.cacheExpiry.delete(cacheKey);
    }
    return null;
  }

  _cacheExactMatch(userMessage, shopId, result) {
    const messageHash = this._hashMessage(userMessage, shopId);
    const cacheKey = `${shopId}:${messageHash}`;
    const ttl = INTENT_ROUTER_CONSTANTS.EXACT_CACHE_TTL_MS;
    if (this.exactCache.size >= INTENT_ROUTER_CONSTANTS.EXACT_CACHE_MAX_ENTRIES) {
      const firstKey = this.exactCache.keys().next().value;
      if (firstKey) { this.exactCache.delete(firstKey); this.cacheExpiry.delete(firstKey); }
    }
    this.exactCache.set(cacheKey, result);
    this.cacheExpiry.set(cacheKey, Date.now() + ttl);
  }

  async _tier2SemanticFAQ(userMessage, shopId) {
    try {
      if (!this.semanticIndex || !this.semanticIndex.entries || this.semanticIndex.entries.length === 0) {
        logger.warn('Semantic index unavailable');
        return null;
      }
      let userEmbedding;
      try {
        const embeddingResult = await this.semanticIndex.getEmbedding(userMessage);
        userEmbedding = embeddingResult.embedding;
      } catch (e) {
        logger.warn('Failed to generate embedding');
        return null;
      }
      if (!userEmbedding) return null;
      const matches = await this.semanticIndex.search(userEmbedding, INTENT_ROUTER_CONSTANTS.SEMANTIC_MAX_RESULTS, INTENT_ROUTER_CONSTANTS.SEMANTIC_SIMILARITY_THRESHOLD);
      if (matches && matches.length > 0) {
        const topMatch = matches[0];
        return { answer: topMatch.answer, source: 'semantic', confidence: topMatch.similarity, metadata: { faqId: topMatch.id, question: topMatch.question, similarity_score: topMatch.similarity, tier: 2 } };
      }
      return null;
    } catch (error) {
      logger.error('Semantic search failed', { error: error.message });
      return null;
    }
  }

  async _tier3LLMFallback(userMessage, shopId, conversationContext, loggingId) {
    try {
      if (this.costCapService) {
        const canProceed = await this.costCapService.validateLLMCost(shopId, INTENT_ROUTER_CONSTANTS.LLM_COST_CAP_TOKENS);
        if (!canProceed) {
          logger.warn('LLM cost cap exceeded', { loggingId, shopId });
          return { answer: 'Processing limit reached. Please try again later.', source: 'error', confidence: 0, metadata: { reason: 'cost_cap_exceeded', tier: 3 } };
        }
      }
      const systemPrompt = this._buildSystemPrompt(conversationContext);
      let llmResponse;
      if (this.llmProvider && this.llmProvider.executeWithFailover) {
        llmResponse = await this.llmProvider.executeWithFailover({ model: 'claude-3-sonnet', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }], max_tokens: 500, temperature: 0.7 });
      } else {
        throw new AppError('LLM provider not configured', 500, 'LLM_NOT_CONFIGURED');
      }
      if (!llmResponse || !llmResponse.content) throw new AppError('Invalid LLM response', 500, 'LLM_INVALID_RESPONSE');
      return { answer: llmResponse.content, source: 'llm', confidence: llmResponse.confidence || 0.5, metadata: { model: llmResponse.model, inputTokens: llmResponse.usage?.input_tokens, outputTokens: llmResponse.usage?.output_tokens, tier: 3 } };
    } catch (error) {
      logger.error('LLM fallback failed', { loggingId, error: error.message });
      throw error;
    }
  }

  _buildSystemPrompt(conversationContext = {}) {
    const basePrompt = `You are a helpful customer support assistant. Respond concisely and helpfully.\n`;
    if (conversationContext.shopName) return basePrompt + `Shop: ${conversationContext.shopName}\n`;
    return basePrompt;
  }

  _hashMessage(userMessage, shopId) {
    const crypto = require('crypto');
    const combined = `${shopId}:${userMessage.toLowerCase().trim()}`;
    return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
  }

  getMetrics() {
    const total = this.metrics.tier1Hits + this.metrics.tier1Misses + this.metrics.tier2Hits + this.metrics.tier2Misses + this.metrics.tier3Calls;
    return {
      ...this.metrics,
      tier1_hit_rate: total > 0 ? (this.metrics.tier1Hits / total * 100).toFixed(2) + '%' : 'N/A',
      tier2_hit_rate: total > 0 ? (this.metrics.tier2Hits / total * 100).toFixed(2) + '%' : 'N/A',
      cache_size: this.exactCache.size
    };
  }

  clearCaches() {
    this.exactCache.clear();
    this.cacheExpiry.clear();
    logger.info('Intent router caches cleared');
  }

  async initialize(faqData) {
    try {
      if (!faqData || faqData.length === 0) {
        logger.warn('No FAQ data for intent router');
        return;
      }
      if (this.semanticIndex && typeof this.semanticIndex.initialize === 'function') {
        await this.semanticIndex.initialize(faqData);
        logger.info('Intent router initialized', { faqCount: faqData.length });
      }
    } catch (error) {
      logger.error('Failed to initialize intent router', { error: error.message });
      throw error;
    }
  }
}

module.exports = { IntentRouterService, INTENT_ROUTER_CONSTANTS };