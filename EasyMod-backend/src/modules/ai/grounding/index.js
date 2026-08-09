'use strict';

/**
 * AI grounding boundary — public surface.
 *
 * Import from here, not from the individual files, so the boundary stays a
 * boundary: callers get evidence resolution, prompt rendering, the outbound gate
 * and the decision log through one door.
 */

const contract = require('./grounding.contract');
const productEvidence = require('./product-evidence.service');
const groundingPrompt = require('./grounding-prompt');
const outboundGate = require('./outbound-grounding.gate');
const { createLogger } = require('../../../utils/structured-logger');

const logger = createLogger('AIGrounding');

const { GroundingDecision, ReasonCode, ProductEvidenceStatus, MediaStatus } = contract;

/**
 * Operational event name for a grounding outcome. Kept as a small closed set so
 * dashboards and alerts can be built on it without parsing free text.
 */
const eventNameFor = (decision, reasonCode) => {
    if (decision === GroundingDecision.SUPPRESS) return 'reply_suppressed';
    if (decision === GroundingDecision.SAFE_FALLBACK) {
        switch (reasonCode) {
            case ReasonCode.PRODUCT_NOT_FOUND: return 'product_not_found';
            case ReasonCode.PRODUCT_ATTRIBUTE_UNKNOWN: return 'product_attribute_unknown';
            case ReasonCode.PRODUCT_IMAGE_UNAVAILABLE: return 'product_image_unavailable';
            case ReasonCode.KNOWLEDGE_NOT_FOUND: return 'knowledge_not_found';
            case ReasonCode.RETRIEVAL_FAILED: return 'retrieval_failed';
            case ReasonCode.MODEL_OUTPUT_INVALID: return 'model_output_rejected';
            default: return 'grounding_validation_failed';
        }
    }
    return 'grounded_reply_sent';
};

/**
 * Emit the one log line that explains, in production, why a reply was accepted
 * or rejected. Correlation fields only — never message bodies, tokens, Meta
 * credentials or customer PII.
 */
const logGroundingDecision = ({
    shopId, conversationId, messageId, provider, decision, reasonCode,
    evidence = contract.emptyEvidence(), violations = [], latencyMs = null,
}) => {
    const event = eventNameFor(decision, reasonCode);
    const payload = {
        event,
        shopId,
        conversationId,
        messageId: messageId || null,
        provider: provider || null,
        decision,
        reasonCode,
        productStatus: evidence.productStatus,
        mediaStatus: evidence.mediaStatus,
        verifiedProductIds: evidence.verifiedProducts.map(p => p.id),
        mediaProductId: evidence.mediaProductId,
        knowledgeIds: evidence.knowledgeIds,
        violations,
        latencyMs,
    };
    if (decision === GroundingDecision.SEND) logger.info(event, payload);
    else logger.warn(event, payload);
    return payload;
};

module.exports = {
    ...contract,
    ...productEvidence,
    ...groundingPrompt,
    ...outboundGate,
    logGroundingDecision,
    eventNameFor,
    GroundingDecision,
    ReasonCode,
    ProductEvidenceStatus,
    MediaStatus,
};
