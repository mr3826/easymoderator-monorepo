'use strict';

/**
 * Confidence Gate
 *
 * Decides whether an auto-generated AI reply should be HELD for a human
 * (because the model's confidence is below the shop's threshold) instead of
 * being delivered straight to the customer.
 *
 * This replaces the unused auto-approve.service.js: that file was written for
 * exactly this purpose but was never wired into the live worker, so a
 * low-confidence reply was always auto-sent. The gate below is called from
 * message-worker.js after the reply is generated and before it is delivered.
 *
 * Holds ONLY in auto-send mode. In DRAFT / AI_SUGGEST_ONLY / MANUAL the policy
 * engine already withholds delivery, so the gate is a no-op there. Deterministic
 * order-flow turns (confidence 1.0) are never held. A null/unknown confidence
 * (AI pipeline failure) is treated as low → held, which is safer than
 * auto-sending an ungrounded fallback.
 *
 * Threshold source of truth: per-shop settings.ai.confidence_threshold (0–100,
 * default 75). Accepts a 0–1 fraction too, so both scales are safe.
 */

const NON_AUTO_MODES = new Set(['DRAFT', 'AI_SUGGEST_ONLY', 'MANUAL']);

const DEFAULT_THRESHOLD = 0.75;

/** Normalize a threshold (0–1 fraction OR 0–100 percentage) to a 0–1 fraction. */
function normalizeThreshold(raw, fallback = DEFAULT_THRESHOLD) {
    if (raw === null || raw === undefined || raw === '' || raw === false) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n > 1 ? Math.min(n, 100) / 100 : n;
}

/** Normalize a model confidence (0–1 OR 0–100) to a 0–1 fraction, or null if unknown. */
function normalizeConfidence(raw) {
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (n > 1) return Math.min(n, 100) / 100;
    return Math.max(n, 0);
}

/**
 * @param {object}  params
 * @param {number}  [params.confidence]          - model confidence (0–1 or 0–100)
 * @param {string}  [params.automationMode]      - shop/channel automation_mode
 * @param {number}  [params.confidenceThreshold] - per-shop confidence_threshold (0–100 or 0–1)
 * @param {boolean} [params.orderFlowHandled]    - true when a deterministic order step produced the reply
 * @returns {boolean} true → hold for human handoff; false → allow normal delivery path
 */
function shouldHoldForLowConfidence({
    confidence,
    // NOT the product default (DRAFT). A non-auto mode makes this gate a no-op,
    // so an omitted mode must assume the auto-send path and actually evaluate.
    automationMode = 'AI_ACTIVE',
    confidenceThreshold,
    orderFlowHandled = false,
} = {}) {
    if (orderFlowHandled) return false;
    if (NON_AUTO_MODES.has(automationMode)) return false;

    const threshold = normalizeThreshold(confidenceThreshold);
    const conf = normalizeConfidence(confidence);
    if (conf === null) return true; // unknown confidence = unsafe = hold

    return conf < threshold;
}

module.exports = {
    shouldHoldForLowConfidence,
    normalizeThreshold,
    normalizeConfidence,
    NON_AUTO_MODES,
    DEFAULT_THRESHOLD,
};
