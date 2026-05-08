/**
 * LLM Failover Service
 * FIXES BLOCKING #6: Complete implementation of executeWithFailover()
 */

const { createLogger } = require('../utils/structured-logger');
const { AppError } = require('../utils/AppError');
const logger = createLogger('LLMFailoverService');

const FAILOVER_CONSTANTS = {
  PROVIDER_TIMEOUT_MS: 400, TOTAL_TIMEOUT_MS: 3000,
  SUCCESS_WEIGHT: 0.7, SPEED_WEIGHT: 0.3, BASELINE_LATENCY_MS: 200,
  PROVIDERS: {
    gemini: { name: 'gemini', timeout_ms: 400, model: 'gemini-2.0-flash' },
    openai: { name: 'openai', timeout_ms: 400, model: 'gpt-4o-mini' }
  }
};

class ProviderHealth {
  constructor(providerName) {
    this.name = providerName;
    this.successCount = 0;
    this.failureCount = 0;
    this.latencyHistogram = [];
    this.lastFailureTime = null;
    this.circuitBreakerOpen = false;
  }

  getSuccessRate() {
    const total = this.successCount + this.failureCount;
    return total === 0 ? 0.5 : this.successCount / total;
  }

  getAverageLatency() {
    return this.latencyHistogram.length === 0 ? FAILOVER_CONSTANTS.BASELINE_LATENCY_MS : this.latencyHistogram.reduce((a,b) => a+b,0) / this.latencyHistogram.length;
  }

  getP95Latency() {
    if (this.latencyHistogram.length === 0) return FAILOVER_CONSTANTS.BASELINE_LATENCY_MS;
    const sorted = [...this.latencyHistogram].sort((a, b) => a - b);
    return sorted[Math.ceil(sorted.length * 0.95) - 1];
  }

  getHealthScore() {
    const sr = this.getSuccessRate();
    const latency = this.getAverageLatency();
    const ls = Math.max(0, 1 - (latency / FAILOVER_CONSTANTS.BASELINE_LATENCY_MS));
    const score = (sr * FAILOVER_CONSTANTS.SUCCESS_WEIGHT) + (ls * FAILOVER_CONSTANTS.SPEED_WEIGHT);
    return Math.max(0, Math.min(1, score));
  }

  recordSuccess(latencyMs) {
    this.successCount++;
    this.latencyHistogram.push(latencyMs);
    if (this.latencyHistogram.length > 100) this.latencyHistogram.shift();
    this.circuitBreakerOpen = false;
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    const failureRate = this.failureCount / (this.successCount + this.failureCount);
    if (failureRate > 0.5) this.circuitBreakerOpen = true;
  }

  isAvailable() {
    return !this.circuitBreakerOpen;
  }

  attemptRecovery() {
    if (this.circuitBreakerOpen && this.lastFailureTime) {
      if (Date.now() - this.lastFailureTime > 30000) {
        logger.info('Circuit breaker recovery', { provider: this.name });
        this.circuitBreakerOpen = false;
      }
    }
  }
}

class LLMFailoverService {
  constructor(options = {}) {
    this.providers = {};
    this.healthScores = {};
    Object.entries(FAILOVER_CONSTANTS.PROVIDERS).forEach(([key]) => {
      this.healthScores[key] = new ProviderHealth(key);
    });
    this.providerOrder = options.providerOrder || ['gemini', 'openai'];
    this.clients = options.clients || {};
  }

  async executeWithFailover(options = {}) {
    const { messages = [], max_tokens = 2000, temperature = 0.7, loggingId = `llm_${Date.now()}` } = options;
    if (!messages || messages.length === 0) {
      throw new AppError('No messages provided', 400, 'INVALID_REQUEST');
    }

    Object.values(this.healthScores).forEach(h => h.attemptRecovery());

    const available = this.providerOrder
      .filter(n => this.healthScores[n] && this.healthScores[n].isAvailable())
      .sort((a, b) => this.healthScores[b].getHealthScore() - this.healthScores[a].getHealthScore());

    if (available.length === 0) {
      logger.error('All providers unavailable', { loggingId });
      throw new AppError('All LLM providers unavailable', 503, 'LLM_UNAVAILABLE');
    }

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout')), FAILOVER_CONSTANTS.TOTAL_TIMEOUT_MS);
    });

    const promises = available.map(n => this._callProviderWithTimeout(n, options, loggingId));

    try {
      const result = await Promise.race([...promises, timeout]);
      logger.info('LLM success', { loggingId, provider: result.provider, latency_ms: result.latency_ms });
      return result;
    } catch (error) {
      logger.error('All providers failed', { loggingId, error: error.message });
      throw new AppError('Failed to get LLM response', 502, 'LLM_ALL_FAILED');
    }
  }

  async _callProviderWithTimeout(providerName, options, loggingId) {
    const start = Date.now();
    const health = this.healthScores[providerName];
    const timeout = FAILOVER_CONSTANTS.PROVIDERS[providerName].timeout_ms;

    try {
      const client = this.clients[providerName];
      if (!client) throw new Error(`No client: ${providerName}`);

      const timeoutP = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Provider timeout')), timeout);
      });

      const callP = this._executeProviderCall(providerName, client, options);
      const result = await Promise.race([callP, timeoutP]);
      const latency = Date.now() - start;
      health.recordSuccess(latency);

      return {
        content: result.content,
        model: result.model,
        usage: { input_tokens: result.inputTokens, output_tokens: result.outputTokens },
        confidence: 0.95,
        provider: providerName,
        latency_ms: latency
      };
    } catch (error) {
      const latency = Date.now() - start;
      health.recordFailure();
      logger.warn('Provider call failed', { loggingId, provider: providerName, latency_ms: latency });
      throw error;
    }
  }

  async _executeProviderCall(providerName, client, options) {
    switch (providerName) {
      case 'openai': return await this._callOpenAI(client, options);
      case 'gemini': return await this._callGemini(client, options);
      default: throw new Error(`Unknown: ${providerName}`);
    }
  }

  async _callOpenAI(client, options) {
    const resp = await client.chat.completions.create({
      model: FAILOVER_CONSTANTS.PROVIDERS.openai.model,
      max_tokens: options.max_tokens || 2000,
      temperature: options.temperature || 0.7,
      messages: options.messages
    });
    return { content: resp.choices[0].message.content, model: resp.model, inputTokens: resp.usage.prompt_tokens, outputTokens: resp.usage.completion_tokens };
  }

  async _callGemini(client, options) {
    const system = options.messages.find(m => m.role === 'system')?.content || '';
    const users = options.messages.filter(m => m.role !== 'system');
    const resp = await client.generateContent({
      contents: users.map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
      systemInstruction: system || undefined,
      generationConfig: { maxOutputTokens: options.max_tokens || 2000, temperature: options.temperature || 0.7 }
    });
    return { content: resp.response.text(), model: 'gemini-pro', inputTokens: 0, outputTokens: 0 };
  }

  getProviderHealth() {
    const health = {};
    Object.entries(this.healthScores).forEach(([name, score]) => {
      health[name] = {
        available: score.isAvailable(),
        success_rate: (score.getSuccessRate() * 100).toFixed(2) + '%',
        avg_latency_ms: score.getAverageLatency().toFixed(0),
        health_score: (score.getHealthScore() * 100).toFixed(2) + '%'
      };
    });
    return health;
  }

  resetHealthScores() {
    Object.values(this.healthScores).forEach(h => {
      h.successCount = 0;
      h.failureCount = 0;
      h.latencyHistogram = [];
      h.circuitBreakerOpen = false;
    });
  }
}

module.exports = { LLMFailoverService, ProviderHealth, FAILOVER_CONSTANTS };