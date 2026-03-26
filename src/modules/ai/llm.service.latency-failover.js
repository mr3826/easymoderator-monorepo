// src/modules/ai/llm.service.latency-failover.js
// TASK 2: Latency-Aware LLM Failover Implementation
// Purpose: Replace chain-based failover with timeout-based intelligent fallback
// Owner: Lead Dev
// Effort: 0.75 days
// Deadline: End of Day 2

const { Injectable, Logger } = require('@nestjs/common');

@Injectable()
class LLMService {
  private logger = new Logger('LLMService');

  constructor(
    private anthropicService,
    private openaiService,
    private geminiService,
    private deepseekService,
    private telemetryService
  ) {}

  /**
   * MAIN METHOD: Call LLM with Latency-Aware Failover
   * 
   * Key Changes from v1:
   * - Uses Promise.race() to timeout slow providers
   * - Measures latency per provider
   * - Skips slow providers if fast ones available
   * - Falls back to next fastest provider on timeout
   * 
   * @param message - Customer message
   * @param conversationContext - Chat history
   * @param shopId - Shop context
   * @returns { response, provider, latency, fallbackUsed }
   */
  async callLLMWithLatencyAwareFailover(
    message,
    conversationContext,
    shopId
  ) {
    const startTime = Date.now();
    const callId = this.generateCallId();

    this.logger.log(`[${callId}] Starting latency-aware LLM call for shop ${shopId}`);

    // Step 1: Determine provider order based on recent latencies
    const providerOrder = await this.getRankedProviders(shopId);
    this.logger.debug(`[${callId}] Provider ranking: ${providerOrder.map(p => p.name).join(' → ')}`);

    // Step 2: Try each provider with timeout
    for (let i = 0; i < providerOrder.length; i++) {
      const provider = providerOrder[i];
      
      try {
        this.logger.debug(`[${callId}] Attempt ${i + 1}: Calling ${provider.name} (timeout: ${provider.timeoutMs}ms)`);

        const result = await this.callProviderWithTimeout(
          provider.name,
          message,
          conversationContext,
          shopId,
          provider.timeoutMs
        );

        const latency = Date.now() - startTime;
        this.logger.log(`[${callId}] ✅ SUCCESS with ${provider.name} in ${latency}ms`);

        // Record latency for future ranking
        await this.recordLatencyMetric(provider.name, shopId, latency);

        return {
          response: result.response,
          provider: provider.name,
          latency,
          fallbackUsed: i > 0,
          tokenUsage: result.tokenUsage,
          success: true
        };

      } catch (error) {
        const latency = Date.now() - startTime;
        const errorType = this.classifyError(error);

        this.logger.warn(
          `[${callId}] ❌ ${provider.name} failed after ${latency}ms: ${errorType} - ${error.message}`
        );

        // Record failure for future ranking
        await this.recordFailureMetric(provider.name, shopId, errorType);

        // If timeout and more providers available, continue
        if (errorType === 'TIMEOUT' && i < providerOrder.length - 1) {
          this.logger.debug(`[${callId}] Timeout on ${provider.name}, trying next provider`);
          continue;
        }

        // If last provider or non-timeout error, throw
        if (i === providerOrder.length - 1) {
          throw new Error(`All LLM providers exhausted. Last error: ${error.message}`);
        }
      }
    }

    throw new Error('No LLM provider available');
  }

  /**
   * Call individual provider with Promise.race() timeout
   * 
   * @param providerName - 'gemini', 'openai', 'anthropic', 'deepseek'
   * @param message - Customer message
   * @param context - Chat history
   * @param shopId - Shop ID
   * @param timeoutMs - Timeout in milliseconds
   */
  private async callProviderWithTimeout(
    providerName,
    message,
    context,
    shopId,
    timeoutMs
  ) {
    // Create timeout promise
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Provider timeout after ${timeoutMs}ms`)),
        timeoutMs
      )
    );

    // Create provider call promise
    const providerCall = this.callProvider(providerName, message, context, shopId);

    // Race: whichever finishes first (provider or timeout)
    try {
      const result = await Promise.race([providerCall, timeoutPromise]);
      return result;
    } catch (error) {
      if (error.message.includes('timeout')) {
        throw new Error(`TIMEOUT: ${providerName} exceeded ${timeoutMs}ms`);
      }
      throw error;
    }
  }

  /**
   * Actual provider calls (one per provider)
   */
  private async callProvider(providerName, message, context, shopId) {
    switch (providerName) {
      case 'gemini':
        return await this.geminiService.generateResponse(message, context, shopId);
      case 'openai':
        return await this.openaiService.generateResponse(message, context, shopId);
      case 'anthropic':
        return await this.anthropicService.generateResponse(message, context, shopId);
      case 'deepseek':
        return await this.deepseekService.generateResponse(message, context, shopId);
      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  }

  /**
   * Get ranked list of providers based on recent latencies + costs
   * 
   * Variables (from ENV):
   * - LLM_GEMINI_TIMEOUT_MS (default: 2000)
   * - LLM_OPENAI_TIMEOUT_MS (default: 1500)
   * - LLM_ANTHROPIC_TIMEOUT_MS (default: 2500)
   * - LLM_DEEPSEEK_TIMEOUT_MS (default: 3000)
   * 
   * Ranking logic:
   * 1. Get last 100 calls per provider from telemetry
   * 2. Calculate success rate + avg latency + cost
   * 3. Score = (success_rate × 0.4) + (inverse_latency × 0.3) + (inverse_cost × 0.3)
   * 4. Return sorted by score DESC
   * 
   * @param shopId - Shop ID (for shop-specific optimization)
   * @returns Array<{ name, timeoutMs, score, recentLatency }>
   */
  private async getRankedProviders(shopId) {
    const providers = ['gemini', 'openai', 'anthropic', 'deepseek'];
    
    const scores = await Promise.all(
      providers.map(async (name) => {
        const metrics = await this.telemetryService.getProviderMetrics(
          shopId,
          name,
          { limit: 100, timeWindow: 3600000 } // Last 100 calls in 1 hour
        );

        const successRate = metrics.successCount / Math.max(metrics.totalCount, 1);
        const avgLatency = metrics.avgLatency || 2000;
        const avgCost = metrics.avgCost || 0.001;

        // Composite score
        const score = 
          (successRate * 0.4) +
          ((4000 - avgLatency) / 4000 * 0.3) + // Inverse latency (lower is better)
          ((0.005 - avgCost) / 0.005 * 0.3);   // Inverse cost (lower is better)

        return {
          name,
          timeoutMs: this.getTimeoutForProvider(name),
          score: Math.max(0, score),
          recentLatency: avgLatency,
          successRate: (successRate * 100).toFixed(1)
        };
      })
    );

    // Sort by score DESC (highest first)
    const ranked = scores.sort((a, b) => b.score - a.score);

    this.logger.debug(`Provider ranking for shop ${shopId}:`);
    ranked.forEach((p, i) => {
      this.logger.debug(
        `  ${i + 1}. ${p.name}: score=${p.score.toFixed(2)}, ` +
        `latency=${p.recentLatency}ms, success=${p.successRate}%`
      );
    });

    return ranked;
  }

  /**
   * Get timeout for provider from ENV or defaults
   * Defaults tuned to real-world latencies:
   * - Gemini: 2000ms (fastest, but occasionally slow)
   * - OpenAI: 1500ms (very consistent)
   * - Anthropic: 2500ms (slower but reliable)
   * - Deepseek: 3000ms (slowest)
   */
  private getTimeoutForProvider(name) {
    const timeouts = {
      gemini: parseInt(process.env.LLM_GEMINI_TIMEOUT_MS || '2000'),
      openai: parseInt(process.env.LLM_OPENAI_TIMEOUT_MS || '1500'),
      anthropic: parseInt(process.env.LLM_ANTHROPIC_TIMEOUT_MS || '2500'),
      deepseek: parseInt(process.env.LLM_DEEPSEEK_TIMEOUT_MS || '3000')
    };
    return timeouts[name] || 2000;
  }

  /**
   * Record latency metric for provider ranking
   * Used to update provider scores over time
   */
  private async recordLatencyMetric(providerName, shopId, latencyMs) {
    try {
      await this.telemetryService.createEvent({
        type: 'LLM_CALL_SUCCESS',
        provider: providerName,
        shopId,
        latency: latencyMs,
        timestamp: new Date()
      });
    } catch (error) {
      this.logger.warn(`Failed to record latency metric: ${error.message}`);
    }
  }

  /**
   * Record failure metric for provider ranking
   */
  private async recordFailureMetric(providerName, shopId, errorType) {
    try {
      await this.telemetryService.createEvent({
        type: 'LLM_CALL_FAILURE',
        provider: providerName,
        shopId,
        errorType,
        timestamp: new Date()
      });
    } catch (error) {
      this.logger.warn(`Failed to record failure metric: ${error.message}`);
    }
  }

  /**
   * Classify error type for better handling
   */
  private classifyError(error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('timeout')) return 'TIMEOUT';
    if (msg.includes('rate limit') || msg.includes('429')) return 'RATE_LIMIT';
    if (msg.includes('auth') || msg.includes('401')) return 'AUTH';
    if (msg.includes('not found') || msg.includes('404')) return 'NOT_FOUND';
    if (msg.includes('500') || msg.includes('internal')) return 'SERVER_ERROR';
    return 'UNKNOWN';
  }

  /**
   * Generate unique call ID for logging
   */
  private generateCallId() {
    return `llm_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }
}

module.exports = LLMService;
