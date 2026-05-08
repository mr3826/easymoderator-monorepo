/**
 * BanglaBERT Intent Classifier Client
 *
 * Thin HTTP wrapper around the BanglaBERT microservice (services/banglish-bert)
 * running on BERT_SERVICE_URL (default: http://localhost:8001).
 *
 * Returns null instead of throwing so callers can safely fall through to the
 * keyword / LLM pipeline when the service is unavailable.
 *
 * Response shape: { primaryIntent, confidence, intents, model }
 * Intent labels:  availability_query | price_query | order_intent | size_query |
 *                 payment_intent | delivery_query | return_query | greeting | other
 */

const BERT_URL = process.env.BERT_SERVICE_URL || 'http://localhost:8001';
const BERT_TIMEOUT_MS = parseInt(process.env.BERT_TIMEOUT_MS || '800', 10);

// Lightweight in-process availability flag — skip requests when service is
// known to be down, reset after RECOVERY_INTERVAL_MS.
let _available = true;
const RECOVERY_INTERVAL_MS = 30_000;

const _markUnavailable = () => {
    _available = false;
    setTimeout(() => { _available = true; }, RECOVERY_INTERVAL_MS);
};

/**
 * Classify a customer message intent.
 *
 * @param {string} text    - Raw customer message
 * @param {string} [shopId]
 * @returns {Promise<{primaryIntent: string, confidence: number, model: string}|null>}
 */
const classify = async (text, shopId = '') => {
    if (!_available || !text) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BERT_TIMEOUT_MS);

    try {
        const res = await fetch(`${BERT_URL}/classify`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ text, shop_id: shopId }),
            signal:  controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) return null;

        const data = await res.json();
        return {
            primaryIntent: data.primaryIntent || 'other',
            confidence:    typeof data.confidence === 'number' ? data.confidence : 0,
            intents:       data.intents || [],
            model:         data.model || 'unknown',
        };
    } catch {
        clearTimeout(timer);
        _markUnavailable();
        return null;
    }
};

/**
 * Health-check the BanglaBERT service (called once at startup if desired).
 *
 * @returns {Promise<boolean>}
 */
const isHealthy = async () => {
    try {
        const res = await fetch(`${BERT_URL}/health`, { signal: AbortSignal.timeout(1000) });
        return res.ok;
    } catch {
        return false;
    }
};

module.exports = { classify, isHealthy };
