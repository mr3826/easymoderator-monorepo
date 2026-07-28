'use strict';

/**
 * Circuit Breaker for LLM Providers
 *
 * Prevents cascading failures during Gemini/OpenAI outages. Per-provider state
 * is stored in Redis so all worker processes see a consistent circuit state.
 *
 * States:
 *   closed  (default) — calls pass through normally
 *   open    — calls are rejected immediately; resets to half-open after RESET_TIMEOUT_SECS
 *
 * When a provider trips (≥3 consecutive failures), connected dashboards receive
 * an SSE 'llm_outage' event and a Slack alert is sent.
 */

const { cacheRedis } = require('../../config/redis');

const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_SECS = 300; // 5 minutes auto-reset

class CircuitOpenError extends Error {
    constructor(provider) {
        super(`LLM circuit open for provider: ${provider}. Calls are paused for ${RESET_TIMEOUT_SECS / 60} min.`);
        this.name = 'CircuitOpenError';
        this.provider = provider;
    }
}

class CircuitBreaker {
    /**
     * Wrap an LLM call in the circuit breaker.
     * @param {string} provider — e.g. 'gemini' | 'openai'
     * @param {Function} fn — async function to execute
     */
    async callWithBreaker(provider, fn) {
        const stateKey = `cb:state:${provider}`;
        const failKey = `cb:failures:${provider}`;
        const timeoutMs = parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT_MS) || 30000;

        // Fast path: check if circuit is open
        let state;
        try {
            state = await cacheRedis.get(stateKey);
        } catch { /* Redis unavailable — assume closed */ }

        if (state === 'open') {
            throw new CircuitOpenError(provider);
        }

        // Promise.race does not cancel the loser, so the timer has to be cleared
        // explicitly. Without this every LLM call left a 30s timer on the event
        // loop — harmless in a long-lived worker, but it delays process exit and
        // keeps Jest hanging after the suite finishes.
        let timer;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`LLM call timed out after ${timeoutMs}ms`)), timeoutMs);
            });
            const result = await Promise.race([fn(), timeoutPromise]);
            // Success: reset failure counter
            cacheRedis.del(failKey).catch(err => console.warn('[circuit-breaker] Redis DEL failed', { error: err.message }));
            return result;
        } catch (err) {
            // Increment consecutive failure count
            let failures = FAILURE_THRESHOLD; // Assume worst if Redis fails
            try {
                failures = await cacheRedis.incr(failKey);
                await cacheRedis.expire(failKey, RESET_TIMEOUT_SECS);
            } catch { /* Redis unavailable */ }

            if (failures >= FAILURE_THRESHOLD) {
                try {
                    await cacheRedis.setex(stateKey, RESET_TIMEOUT_SECS, 'open');
                } catch { /* Redis unavailable */ }

                console.error(
                    `[circuit-breaker] Circuit OPENED for ${provider} after ${failures} consecutive failures. ` +
                    `Auto-resets in ${RESET_TIMEOUT_SECS}s.`
                );
                this._notifyOutage(provider, failures);
            }

            throw err;
        } finally {
            clearTimeout(timer);
        }
    }

    async isOpen(provider) {
        try {
            return (await cacheRedis.get(`cb:state:${provider}`)) === 'open';
        } catch {
            return false;
        }
    }

    async reset(provider) {
        await cacheRedis.del(`cb:state:${provider}`);
        await cacheRedis.del(`cb:failures:${provider}`);
        console.log(`[circuit-breaker] Circuit manually reset for ${provider}`);
    }

    _notifyOutage(provider, failureCount) {
        // Slack alert — best-effort, non-blocking
        const slackUrl = process.env.SLACK_ALERT_WEBHOOK_URL;
        if (slackUrl) {
            fetch(slackUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: `⚡ *[Circuit Breaker]* LLM provider \`${provider}\` tripped after ${failureCount} consecutive failures. Circuit is OPEN for ${RESET_TIMEOUT_SECS / 60} min. AI replies are paused.`,
                }),
            }).catch(() => {});
        }

        // SSE broadcast to connected dashboards — best-effort
        try {
            const sseManager = require('../../utils/sse-manager');
            if (typeof sseManager.emitToAll === 'function') {
                sseManager.emitToAll('llm_outage', {
                    provider,
                    message: `LLM provider ${provider} is currently unavailable. AI replies are paused for ${RESET_TIMEOUT_SECS / 60} minutes.`,
                });
            }
        } catch { /* SSE not available */ }
    }
}

const circuitBreaker = new CircuitBreaker();

module.exports = { circuitBreaker, CircuitOpenError };
