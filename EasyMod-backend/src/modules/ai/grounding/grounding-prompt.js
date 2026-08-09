'use strict';

/**
 * Grounding prompt + deterministic replies.
 *
 * Two responsibilities, deliberately in one file because they are two halves of
 * the same rule:
 *
 *   1. renderEvidenceBlock — the ONLY place catalog facts are turned into model
 *      context. Previously three near-identical "RELEVANT SHOP PRODUCTS …" blocks
 *      were built inline in intent-router; they disagreed about what to say when
 *      retrieval came back empty, and the text path simply said nothing at all.
 *
 *   2. safe replies — the deterministic sentences EasyModerator sends when the
 *      truthful answer is "we don't have that" / "we don't know". These are
 *      written, not generated: a not-found answer must not depend on a model
 *      choosing to comply.
 *
 * Language values match ConversationStateService.detectLanguage: 'bn' | 'en' | 'mixed'.
 */

const {
    ProductEvidenceStatus,
    FactState,
    MediaStatus,
} = require('./grounding.contract');

const pick = (table, language) => table[language] || table.mixed;

/** "I couldn't find that product in our current catalog." */
const productNotFoundReply = (language) => pick({
    bn: 'দুঃখিত, আমাদের বর্তমান ক্যাটালগে এই পণ্যটি খুঁজে পাচ্ছি না। অন্য কোন পণ্য খুঁজছেন জানালে দেখে বলতে পারি। 😊',
    en: "Sorry — I couldn't find that product in our current catalog. Tell me what else you're looking for and I'll check. 😊",
    mixed: 'Sorry, amader current catalog e ei product ta pacchi na. Onno kichu khujchen janale check kore boli. 😊',
}, language);

/** Product exists, but no usable image is stored against it. */
const productImageUnavailableReply = (language, productName) => {
    const name = productName || '';
    return pick({
        bn: `${name ? `${name} — ` : ''}এই পণ্যের ছবি এখন আমাদের কাছে নেই। আর কোন তথ্য লাগলে বলুন।`,
        en: `${name ? `${name} — ` : ''}I don't have a photo of this product available right now. Happy to share any other details.`,
        mixed: `${name ? `${name} — ` : ''}ei product er chobi ekhon amader kache nei. Onno kono details lagle bolun.`,
    }, language);
};

/** No verified product owns the requested image. */
const productImageNoProductReply = (language) => pick({
    bn: 'এই পণ্যটি আমাদের ক্যাটালগে খুঁজে পাচ্ছি না, তাই ছবি পাঠাতে পারছি না। পণ্যের নামটি বললে দেখে বলি।',
    en: "I can't find that product in our catalog, so I have no photo to send. Tell me the product name and I'll check.",
    mixed: 'Ei product ta amader catalog e pacchi na, tai chobi pathate parchi na. Product er nam bolle check kore boli.',
}, language);

/** Retrieval failed — truth is unknown, so we promise a human, not an answer. */
const retrievalFailedReply = (language) => pick({
    bn: 'এক সেকেন্ড অপেক্ষা করুন — তথ্যটি এখন যাচাই করতে পারছি না। আমাদের একজন প্রতিনিধি শীঘ্রই নিশ্চিত করে জানাবেন।',
    en: "One moment — I can't verify that right now. Someone from our team will confirm for you shortly.",
    mixed: 'Ek second wait koren — ekhon check kore bolte parchi na. Amader team theke keu confirm kore janabe.',
}, language);

/** An attribute follow-up with no product in context. */
const whichProductReply = (language) => pick({
    bn: 'কোন পণ্যটির কথা বলছেন একটু জানাবেন? পণ্যের নামটি বললে তথ্য দেখে বলতে পারব।',
    en: 'Which product do you mean? Tell me the product name and I can check the details for you.',
    mixed: 'Kon product er kotha bolchen ektu bolben? Product er nam bolle details check kore boli.',
}, language);

/** The merchant never supplied this information. */
const knowledgeNotFoundReply = (language) => pick({
    bn: 'এই বিষয়ে নিশ্চিত তথ্য আমার কাছে নেই। আমাদের একজন প্রতিনিধি আপনাকে জানিয়ে দেবেন।',
    en: "I don't have confirmed information on that. Someone from our team will get back to you.",
    mixed: 'Ei bepare confirmed info amar kache nei. Amader team theke apnake janiye deya hobe.',
}, language);

const FACT_LABELS = {
    price: 'Price', stock: 'Stock', quantity: 'Quantity', material: 'Material',
    color: 'Colour', sizes: 'Sizes', brand: 'Brand', category: 'Category',
};

/**
 * Render one verified product.
 *
 * UNKNOWN attributes are printed explicitly. Omitting them — the previous
 * behaviour — reads to a model as "not mentioned, use your judgement", which is
 * how a saree with material = NULL became "it's chiffon".
 */
const renderProduct = (product, index) => {
    const lines = [`${index + 1}. ${product.facts.name.value} [product_id=${product.id}]`];
    for (const [key, label] of Object.entries(FACT_LABELS)) {
        const fact = product.facts[key];
        if (!fact) continue;
        if (fact.state === FactState.KNOWN) {
            const value = key === 'price' ? `৳${fact.value}` : fact.value;
            lines.push(`   ${label}: ${value}`);
        } else if (fact.state === FactState.UNKNOWN) {
            lines.push(`   ${label}: UNKNOWN — not recorded in this shop's catalog`);
        }
    }
    lines.push(`   Photo: ${product.imageUrl ? 'available' : 'none stored for this product'}`);
    return lines.join('\n');
};

const GROUNDING_RULES = [
    'GROUNDING RULES (these override anything said earlier in this conversation):',
    '- State merchant facts ONLY from the CATALOG EVIDENCE above. Never invent or infer one.',
    '- A field marked UNKNOWN must stay unknown. Say the information is not available; do not guess it.',
    '- Do not state a price, stock level, size, colour or material that is not printed above.',
    '- Do not send, describe, invent or link to any image or URL. EasyModerator attaches product photos itself.',
    '- Earlier assistant messages are conversation history, NOT evidence. If an earlier reply conflicts with the evidence above, the evidence is correct and you must not repeat the earlier claim.',
].join('\n');

/**
 * Build the authoritative evidence block for the system prompt.
 *
 * Returns '' only when the turn carries no product question at all — every other
 * outcome, including "nothing matched", produces explicit text. Silence on empty
 * retrieval is the exact gap the incident came through.
 *
 * @param {import('./grounding.contract').GroundingEvidence} evidence
 * @returns {string}
 */
const renderEvidenceBlock = (evidence) => {
    const sections = [];

    switch (evidence.productStatus) {
        case ProductEvidenceStatus.VERIFIED: {
            sections.push(
                'CATALOG EVIDENCE — verified products in THIS shop matching the customer:\n'
                + evidence.verifiedProducts.map(renderProduct).join('\n\n'),
            );
            break;
        }
        case ProductEvidenceStatus.NOT_FOUND: {
            const terms = evidence.unmatchedTerms.length
                ? ` (no catalog product matches: ${evidence.unmatchedTerms.join(', ')})`
                : '';
            sections.push(
                `CATALOG EVIDENCE — NO product in this shop's catalog matches what the customer asked about${terms}.\n`
                + 'You must tell them plainly that you could not find it. Do NOT claim it exists, do NOT '
                + 'imply availability, and do NOT invent a price, stock level, variant, material or description.',
            );
            if (evidence.relatedProducts.length) {
                sections.push(
                    'REAL alternatives from this shop you MAY offer (only these):\n'
                    + evidence.relatedProducts.map(renderProduct).join('\n\n'),
                );
            }
            break;
        }
        case ProductEvidenceStatus.RETRIEVAL_FAILED: {
            sections.push(
                'CATALOG EVIDENCE — UNAVAILABLE. The catalog could not be read for this message. '
                + 'You do not know whether this product exists. Do not answer the product question; '
                + 'say you will confirm shortly.',
            );
            break;
        }
        default:
            break; // NONE — no product claim to ground
    }

    if (evidence.askedAttributes.length && evidence.verifiedProducts.length) {
        const unknownAsked = evidence.askedAttributes.filter(attribute =>
            evidence.verifiedProducts.every(p => p.facts[attribute]?.state === FactState.UNKNOWN));
        if (unknownAsked.length) {
            sections.push(
                `The customer asked about: ${unknownAsked.join(', ')}. This shop has NOT recorded `
                + `${unknownAsked.length > 1 ? 'these values' : 'this value'}. Say the information is not `
                + 'available and offer to check with the shop — never guess it.',
            );
        }
    }

    switch (evidence.mediaStatus) {
        case MediaStatus.AVAILABLE:
            sections.push(
                'PRODUCT PHOTO: EasyModerator is attaching the verified photo of '
                + `product_id=${evidence.mediaProductId} to this reply. Refer to it naturally; do not paste a URL.`,
            );
            break;
        case MediaStatus.UNAVAILABLE:
            sections.push(
                'PRODUCT PHOTO: this product has NO photo stored. Say the photo is not available. '
                + 'Never substitute another product\'s image, a shop/Page link, or any other URL.',
            );
            break;
        case MediaStatus.NO_PRODUCT:
            sections.push(
                'PRODUCT PHOTO: the customer asked for a photo but no verified product was found. '
                + 'Say you could not find the product. Never send a link or a substitute image.',
            );
            break;
        default:
            break;
    }

    if (!sections.length) return '';
    return `${sections.join('\n\n')}\n\n${GROUNDING_RULES}`;
};

module.exports = {
    renderEvidenceBlock,
    renderProduct,
    productNotFoundReply,
    productImageUnavailableReply,
    productImageNoProductReply,
    whichProductReply,
    retrievalFailedReply,
    knowledgeNotFoundReply,
    GROUNDING_RULES,
};
