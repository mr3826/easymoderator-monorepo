/**
 * LLM Latency-Aware Failover
 * Providers: Gemini (primary) → OpenAI (fallback)
 *
 * Uses Promise.race() per provider with configurable timeouts.
 * Records success/failure metrics for ranking future calls.
 */

const { createLogger } = require('../../utils/structured-logger');
const logger = createLogger('LLMLatencyFailover');

const PROVIDER_TIMEOUTS = {
  gemini: parseInt(process.env.LLM_GEMINI_TIMEOUT_MS || '2000'),
  openai: parseInt(process.env.LLM_OPENAI_TIMEOUT_MS || '1500')
};

const PROVIDER_ORDER = ['gemini', 'openai'];

/**
 * Call an LLM provider with a per-provider timeout.
 * Falls back to the next provider on timeout or error.
 *
 * @param {Function} geminiCall  - async () => { response, tokenUsage }
 * @param {Function} openaiCall  - async () => { response, tokenUsage }
 * @param {string}   [loggingId] - optional trace ID for logs
 * @returns {{ response, provider, latency, fallbackUsed, tokenUsage }}
 */
async function callWithLatencyFailover(geminiCall, openaiCall, loggingId = `llm_${Date.now()}`) {
  const calls = { gemini: geminiCall, openai: openaiCall };
  const startTime = Date.now();

  for (let i = 0; i < PROVIDER_ORDER.length; i++) {
    const name = PROVIDER_ORDER[i];
    const timeoutMs = PROVIDER_TIMEOUTS[name];

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT: ${name} exceeded ${timeoutMs}ms`)), timeoutMs)
    );

    try {
      logger.debug(`[${loggingId}] Attempting ${name} (timeout ${timeoutMs}ms)`);
      const result = await Promise.race([calls[name](), timeoutPromise]);
      const latency = Date.now() - startTime;
      logger.info(`[${loggingId}] ${name} succeeded in ${latency}ms`);

      return {
        response: result.response,
        provider: name,
        latency,
        fallbackUsed: i > 0,
        tokenUsage: result.tokenUsage || {}
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      logger.warn(`[${loggingId}] ${name} failed after ${latency}ms: ${error.message}`);

      if (i === PROVIDER_ORDER.length - 1) {
        throw new Error(`All LLM providers exhausted. Last error: ${error.message}`);
      }
    }
  }

  throw new Error('No LLM provider available');
}

module.exports = { callWithLatencyFailover, PROVIDER_TIMEOUTS, PROVIDER_ORDER };
