'use strict';

/**
 * Grounding contract — the shared vocabulary of the AI trust boundary.
 *
 * THE LLM IS NOT A SOURCE OF MERCHANT FACTS. Every merchant-specific fact a
 * reply may state (existence, price, stock, variants, material, media, policy)
 * must be traceable to a row EasyModerator owns. This module defines the types
 * that carry that traceability; nothing here talks to a model or a database.
 *
 * One vocabulary, one place: the generation side (grounding-prompt) and the
 * validation side (outbound-grounding.gate) both read these constants, so a
 * rule can never drift between "what we told the model" and "what we enforce".
 *
 * Architecture, failure behaviour and the rules for extending this safely:
 * docs/ai-cost/AI_TRUST_BOUNDARY.md
 */

/**
 * Outcome of authoritative product retrieval for one customer turn.
 *
 * NONE vs NOT_FOUND is the distinction that was missing in production: NONE
 * means the customer never asked about a product entity, NOT_FOUND means they
 * did and this shop's catalog does not contain it. Collapsing the two is what
 * let a "chiffon saree ache?" reach the model with no evidence and no signal
 * that evidence was expected.
 */
const ProductEvidenceStatus = Object.freeze({
    NONE: 'NONE',                         // no product entity was asked about
    VERIFIED: 'VERIFIED',                 // ≥1 product in THIS shop matches every identifying term
    NOT_FOUND: 'NOT_FOUND',               // a product entity was asked about; catalog has no match
    RETRIEVAL_FAILED: 'RETRIEVAL_FAILED', // DB/vector error — truth is unknown, never guess
});

/** State of a single attribute on a verified product. */
const FactState = Object.freeze({
    KNOWN: 'KNOWN',
    UNKNOWN: 'UNKNOWN',               // catalog column is NULL/empty — must stay unknown
    NOT_APPLICABLE: 'NOT_APPLICABLE', // attribute cannot apply to this product kind
});

/** Media provenance outcome for a product-image request. */
const MediaStatus = Object.freeze({
    NOT_REQUESTED: 'NOT_REQUESTED',
    AVAILABLE: 'AVAILABLE',       // verified product owns a usable image URL
    UNAVAILABLE: 'UNAVAILABLE',   // verified product exists but has no usable image
    NO_PRODUCT: 'NO_PRODUCT',     // image asked for, but no verified product to own it
});

/** Final authority over whether a candidate reply reaches Meta. */
const GroundingDecision = Object.freeze({
    SEND: 'SEND',                   // candidate is supported by evidence
    SAFE_FALLBACK: 'SAFE_FALLBACK', // candidate replaced by a deterministic truthful reply
    SUPPRESS: 'SUPPRESS',           // nothing safe can be said; withhold and hand off
});

/**
 * Why a decision was taken. Emitted on every grounding log line so production
 * can answer "why was this reply accepted or rejected?" without re-running it.
 */
const ReasonCode = Object.freeze({
    GROUNDED: 'GROUNDED',
    PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
    PRODUCT_ATTRIBUTE_UNKNOWN: 'PRODUCT_ATTRIBUTE_UNKNOWN',
    PRODUCT_IMAGE_UNAVAILABLE: 'PRODUCT_IMAGE_UNAVAILABLE',
    KNOWLEDGE_NOT_FOUND: 'KNOWLEDGE_NOT_FOUND',
    GROUNDING_VALIDATION_FAILED: 'GROUNDING_VALIDATION_FAILED',
    RETRIEVAL_FAILED: 'RETRIEVAL_FAILED',
    MODEL_OUTPUT_INVALID: 'MODEL_OUTPUT_INVALID',
    MODEL_OUTPUT_UNGROUNDED: 'MODEL_OUTPUT_UNGROUNDED',
    UNSUPPORTED_PRICE_CLAIM: 'UNSUPPORTED_PRICE_CLAIM',
    UNSUPPORTED_URL_CLAIM: 'UNSUPPORTED_URL_CLAIM',
});

/**
 * @typedef {object} VerifiedProduct
 * @property {string} id               - products.id, fetched under shop_id scope
 * @property {string} shopId           - owner shop; media/attribute reads assert this
 * @property {string} name
 * @property {number} price
 * @property {object} facts            - attribute → { state: FactState, value }
 * @property {string[]} matchedTerms   - customer terms this product actually satisfies
 * @property {string|null} imageUrl    - only ever a URL stored on THIS product row
 */

/**
 * @typedef {object} GroundingEvidence
 * The authoritative record of what EasyModerator actually knows for one turn.
 * Produced before generation, consumed by generation AND by the outbound gate.
 *
 * @property {string} shopId
 * @property {string} productStatus            - ProductEvidenceStatus
 * @property {VerifiedProduct[]} verifiedProducts
 * @property {VerifiedProduct[]} relatedProducts - real catalog rows, partial match only
 * @property {string[]} unmatchedTerms         - identifying terms no product satisfies
 * @property {string[]} askedAttributes        - attributes the customer asked about
 * @property {string} mediaStatus              - MediaStatus
 * @property {string|null} mediaUrl            - provenance-checked product image
 * @property {string|null} mediaProductId
 * @property {string[]} knowledgeIds
 * @property {boolean} knowledgeFound
 * @property {string} sourceText               - every authoritative string given to the model
 * @property {string[]} allowedUrls            - the only URLs a reply may contain
 * @property {string|null} failure             - retrieval error class, if any
 * @property {string|null} retrievedAt         - retrieval timestamp
 * @property {string|null} freshnessExpiresAt  - evidence expiry timestamp
 * @property {string|null} snapshotHash        - hash of the retrieval snapshot
 */

/** An empty evidence record — the safe default when nothing has been retrieved yet. */
const emptyEvidence = (shopId = null) => ({
    shopId,
    productStatus: ProductEvidenceStatus.NONE,
    verifiedProducts: [],
    relatedProducts: [],
    unmatchedTerms: [],
    askedAttributes: [],
    mediaStatus: MediaStatus.NOT_REQUESTED,
    mediaUrl: null,
    mediaProductId: null,
    knowledgeIds: [],
    knowledgeFound: false,
    sourceText: '',
    allowedUrls: [],
    failure: null,
    retrievedAt: null,
    freshnessExpiresAt: null,
    snapshotHash: null,
});

/**
 * Append authoritative text to the evidence record.
 *
 * Everything the model is allowed to quote from must pass through here, because
 * the outbound gate decides "is this number supported?" by searching sourceText.
 * Text that reaches the prompt without being recorded here is, by construction,
 * unquotable — which is the failure-closed behaviour we want.
 */
const withSourceText = (evidence, text) => {
    if (!text) return evidence;
    evidence.sourceText = evidence.sourceText ? `${evidence.sourceText}\n${text}` : String(text);
    return evidence;
};

/**
 * Reply sources whose text was produced by a language model, and therefore
 * needs its claims validated. Everything else — order-flow steps, greeting
 * templates, the deterministic grounding replies — is EasyModerator-authored
 * from its own data and is authoritative by construction. The response cache
 * counts as model output because that is what it stores.
 *
 * The trust boundary is around the MODEL, not around every string: validating
 * our own written copy would reject correct order totals we just computed.
 */
const MODEL_REPLY_SOURCES = new Set(['llm', 'faq', 'cache']);

const isModelGenerated = (source) => MODEL_REPLY_SOURCES.has(source);

/** True when the customer asked about a product entity, whatever the outcome. */
const askedAboutProduct = (evidence) =>
    evidence.productStatus !== ProductEvidenceStatus.NONE;

/** True when a merchant fact may be stated at all for this turn. */
const hasVerifiedProduct = (evidence) =>
    evidence.productStatus === ProductEvidenceStatus.VERIFIED
    && evidence.verifiedProducts.length > 0;

module.exports = {
    ProductEvidenceStatus,
    FactState,
    MediaStatus,
    GroundingDecision,
    ReasonCode,
    emptyEvidence,
    withSourceText,
    askedAboutProduct,
    hasVerifiedProduct,
    MODEL_REPLY_SOURCES,
    isModelGenerated,
};
