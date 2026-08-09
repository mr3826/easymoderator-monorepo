'use strict';

/**
 * Outbound grounding gate — EasyModerator's final authority over what reaches Meta.
 *
 * Runs on EVERY candidate reply, whatever produced it: gemini-lite, gemini-pro,
 * the OpenAI fallback, the response cache, the FAQ tier, or a future provider.
 * Provider selection happens strictly inside this boundary, so a model swap can
 * never remove the guarantees.
 *
 * The gate is deterministic and calls no model. A model cannot be asked to grade
 * its own truthfulness — that is the property the incident depended on.
 *
 * Checks, in order of severity:
 *   1. candidate is a usable string            → MODEL_OUTPUT_INVALID
 *   2. catalog could not be read               → RETRIEVAL_FAILED
 *   3. asserts availability of something absent → PRODUCT_NOT_FOUND
 *   4. states a figure no source supports       → UNSUPPORTED_PRICE_CLAIM
 *   5. contains a URL no evidence authorises    → UNSUPPORTED_URL_CLAIM
 *   6. answers an UNKNOWN attribute as if known → PRODUCT_ATTRIBUTE_UNKNOWN
 *
 * A failed check never lets the candidate through in edited form; it is replaced
 * wholesale by a written reply that is true by construction.
 */

const {
    ProductEvidenceStatus,
    FactState,
    MediaStatus,
    GroundingDecision,
    ReasonCode,
    emptyEvidence,
} = require('./grounding.contract');
const {
    productNotFoundReply,
    productImageUnavailableReply,
    productImageNoProductReply,
    retrievalFailedReply,
} = require('./grounding-prompt');
const { ATTRIBUTE_VOCABULARY } = require('./product-evidence.service');

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Normalise a numeric string for comparison: Bengali digits → ASCII, drop separators. */
const normaliseNumber = (raw) => String(raw)
    .replace(/[০-৯]/g, (d) => String(BENGALI_DIGITS.indexOf(d)))
    .replace(/[,\s]/g, '')
    .replace(/\.0+$/, '');

/** Currency-adjacent figures only — "2-3 din" is a lead time, not a price claim. */
const PRICE_CLAIM_PATTERN =
    /(?:৳|tk\.?|taka|টাকা|bdt|rs\.?)\s*([\d০-৯][\d০-৯,]*(?:\.\d+)?)|([\d০-৯][\d০-৯,]*(?:\.\d+)?)\s*(?:৳|tk\b|taka|টাকা|bdt)/gi;

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;

/** Every URL appearing in a block of authoritative merchant text. */
const extractUrls = (text) => (typeof text === 'string'
    ? [...text.matchAll(URL_PATTERN)].map(m => m[0].replace(/[.,);]+$/, '').replace(/\/+$/, ''))
    : []);

/** Affirmative availability, EN / Banglish / Bengali. */
const AVAILABILITY_ASSERTION =
    /\b(?:we have|in stock|is available|are available|yes we|ache|achhe|ase|paben|peye jaben)\b|আছে|স্টকে|পাবেন/i;

/** Any phrasing that admits the value is not known. */
const UNAVAILABILITY_MARKER =
    /\b(?:unknown|not available|unavailable|no information|not recorded|not listed|don'?t have|do not have|can'?t confirm|cannot confirm|not sure|nei|nai|jana nei|ullekh nei)\b|নেই|জানা\s*নেই|তথ্য\s*নেই|নিশ্চিত|উল্লেখ\s*নেই/i;

/** Every figure a reply is allowed to state, drawn only from authoritative text. */
const supportedNumbers = (evidence) => {
    const supported = new Set();
    const addAll = (text) => {
        if (!text) return;
        const normalisedText = normaliseNumber(text);
        for (const match of normalisedText.matchAll(/\d+(?:\.\d+)?/g)) {
            supported.add(normaliseNumber(match[0]));
        }
    };
    addAll(evidence.sourceText);
    for (const product of [...evidence.verifiedProducts, ...evidence.relatedProducts]) {
        for (const fact of Object.values(product.facts || {})) {
            if (fact.state === FactState.KNOWN && fact.value !== null) addAll(String(fact.value));
        }
    }
    return supported;
};

/** Figures the candidate states that no source supports. */
const unsupportedPriceClaims = (candidate, evidence) => {
    const supported = supportedNumbers(evidence);
    const offending = [];
    for (const match of candidate.matchAll(PRICE_CLAIM_PATTERN)) {
        const raw = match[1] || match[2];
        if (!raw) continue;
        const value = normaliseNumber(raw);
        if (!supported.has(value)) offending.push(value);
    }
    return offending;
};

/** URLs the candidate states that no evidence authorises. */
const unsupportedUrls = (candidate, evidence) => {
    const allowed = new Set((evidence.allowedUrls || []).map(u => u.replace(/\/+$/, '')));
    const offending = [];
    for (const match of candidate.matchAll(URL_PATTERN)) {
        const url = match[0].replace(/[.,);]+$/, '').replace(/\/+$/, '');
        if (!allowed.has(url)) offending.push(url);
    }
    return offending;
};

/** Attributes the customer asked about that the catalog records as UNKNOWN. */
const unknownAskedAttributes = (evidence) => {
    if (!evidence.verifiedProducts.length) return [];
    return (evidence.askedAttributes || []).filter(attribute =>
        evidence.verifiedProducts.every(p => p.facts?.[attribute]?.state === FactState.UNKNOWN));
};

/**
 * A written reply for the failure at hand. Never assembled from model output —
 * that is the whole point — and never states a fact the evidence lacks.
 */
const buildSafeFallback = (evidence, language, reasonCode) => {
    switch (reasonCode) {
        case ReasonCode.RETRIEVAL_FAILED:
            return retrievalFailedReply(language);

        case ReasonCode.PRODUCT_IMAGE_UNAVAILABLE:
            return productImageUnavailableReply(language, evidence.verifiedProducts[0]?.name);

        case ReasonCode.PRODUCT_ATTRIBUTE_UNKNOWN: {
            const product = evidence.verifiedProducts[0];
            const attributes = unknownAskedAttributes(evidence).join(', ');
            // Known facts are still delivered — guardrails must not make the
            // assistant useless (see the real-product regression test).
            const known = product.facts.price.state === FactState.KNOWN
                ? `${product.name} — ৳${product.facts.price.value}. `
                : `${product.name}. `;
            return language === 'bn'
                ? `${known}তবে ${attributes} সম্পর্কে তথ্য আমাদের ক্যাটালগে নেই, তাই নিশ্চিত করে বলতে পারছি না।`
                : language === 'en'
                    ? `${known}I don't have the ${attributes} information recorded for it, so I can't confirm that.`
                    : `${known}Tobe ${attributes} er info amader catalog e record kora nei, tai confirm kore bolte parchi na.`;
        }

        case ReasonCode.PRODUCT_NOT_FOUND:
        default:
            if (evidence.mediaStatus === MediaStatus.NO_PRODUCT) {
                return productImageNoProductReply(language);
            }
            return productNotFoundReply(language);
    }
};

/**
 * Decide whether a candidate reply may be sent.
 *
 * @param {object} params
 * @param {string} params.candidate  - text produced by the model (or cache/FAQ tier)
 * @param {import('./grounding.contract').GroundingEvidence} [params.evidence]
 * @param {string} [params.language] - 'bn' | 'en' | 'mixed'
 * @param {object[]} [params.attachments] - proposed outbound attachments
 * @returns {{ decision: string, reasonCode: string, text: string|null,
 *             attachments: object[], violations: string[] }}
 */
const evaluateCandidate = ({
    candidate,
    evidence = emptyEvidence(),
    language = 'mixed',
    attachments = [],
    modelGenerated = true,
}) => {
    const violations = [];

    const deny = (reasonCode) => ({
        decision: GroundingDecision.SAFE_FALLBACK,
        reasonCode,
        text: buildSafeFallback(evidence, language, reasonCode),
        // A rejected candidate forfeits its media too: the attachment was chosen
        // to accompany a claim we have just refused to make.
        attachments: [],
        violations,
    });

    // 1. Usable output at all.
    if (typeof candidate !== 'string' || !candidate.trim()) {
        violations.push('empty_or_non_string_candidate');
        if (evidence.productStatus === ProductEvidenceStatus.NONE) {
            // Nothing was asked that we can truthfully answer with a written
            // reply — stay silent and let the worker hand off to a human.
            return {
                decision: GroundingDecision.SUPPRESS,
                reasonCode: ReasonCode.MODEL_OUTPUT_INVALID,
                text: null,
                attachments: [],
                violations,
            };
        }
        return deny(ReasonCode.MODEL_OUTPUT_INVALID);
    }

    // Media provenance is enforced for every reply, model-authored or not: only
    // the image belonging to the verified product of THIS shop may go out.
    const allowedAttachments = attachments.filter(a =>
        a && a.url
        && evidence.mediaStatus === MediaStatus.AVAILABLE
        && a.url === evidence.mediaUrl
        && (!a.productId || a.productId === evidence.mediaProductId));
    if (allowedAttachments.length !== attachments.length) {
        violations.push('attachment_provenance_rejected');
    }

    // EasyModerator-authored text states facts we computed ourselves. Validating
    // it against the retrieval evidence would reject correct order totals and the
    // deterministic not-found copy this very module wrote.
    if (!modelGenerated) {
        return {
            decision: GroundingDecision.SEND,
            reasonCode: ReasonCode.GROUNDED,
            text: candidate,
            attachments: allowedAttachments,
            violations,
        };
    }

    // 2. Truth unknown — never let an outage become an answer.
    if (evidence.productStatus === ProductEvidenceStatus.RETRIEVAL_FAILED) {
        violations.push('catalog_unreadable');
        return deny(ReasonCode.RETRIEVAL_FAILED);
    }

    // 3. Availability asserted for something this catalog does not contain.
    //    Backstop for paths that skip deterministic generation (response cache,
    //    FAQ tier): the normal NOT_FOUND turn never reaches a model at all.
    if (evidence.productStatus === ProductEvidenceStatus.NOT_FOUND) {
        const mentionsMissingTerm = (evidence.unmatchedTerms || [])
            .some(term => candidate.toLowerCase().includes(term));
        if (mentionsMissingTerm && AVAILABILITY_ASSERTION.test(candidate)) {
            violations.push('availability_asserted_for_absent_product');
            return deny(ReasonCode.PRODUCT_NOT_FOUND);
        }
    }

    // 4. Figures must come from a source.
    const badPrices = unsupportedPriceClaims(candidate, evidence);
    if (badPrices.length) {
        violations.push(`unsupported_price:${badPrices.join(',')}`);
        return deny(evidence.productStatus === ProductEvidenceStatus.NOT_FOUND
            ? ReasonCode.PRODUCT_NOT_FOUND
            : ReasonCode.UNSUPPORTED_PRICE_CLAIM);
    }

    // 5. URLs must be provenance-checked media. Catches the Page link offered as
    //    a substitute for a product photo, and any fabricated media URL.
    const badUrls = unsupportedUrls(candidate, evidence);
    if (badUrls.length) {
        violations.push(`unsupported_url:${badUrls.length}`);
        return deny(evidence.mediaStatus === MediaStatus.NO_PRODUCT
            ? ReasonCode.PRODUCT_NOT_FOUND
            : ReasonCode.UNSUPPORTED_URL_CLAIM);
    }

    // 6. An UNKNOWN attribute must be answered as unknown. This is a positive
    //    requirement rather than an attempt to enumerate every way a model could
    //    fabricate a fabric name — the reply must actually admit it does not know.
    const unknownAsked = unknownAskedAttributes(evidence);
    if (unknownAsked.length) {
        const mentionsAttributeValue = unknownAsked.some(attribute =>
            (ATTRIBUTE_VOCABULARY[attribute] || []).some(word => candidate.toLowerCase().includes(word)));
        if (mentionsAttributeValue && !UNAVAILABILITY_MARKER.test(candidate)) {
            violations.push(`attribute_asserted_but_unknown:${unknownAsked.join(',')}`);
            return deny(ReasonCode.PRODUCT_ATTRIBUTE_UNKNOWN);
        }
    }

    return {
        decision: GroundingDecision.SEND,
        reasonCode: ReasonCode.GROUNDED,
        text: candidate,
        attachments: allowedAttachments,
        violations,
    };
};

module.exports = {
    evaluateCandidate,
    extractUrls,
    buildSafeFallback,
    unsupportedPriceClaims,
    unsupportedUrls,
    unknownAskedAttributes,
    normaliseNumber,
};
