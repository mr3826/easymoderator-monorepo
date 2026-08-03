/**
 * Vision policy — the switches for every image-understanding path.
 *
 * Two switches, because the two sides of "image understanding" have opposite
 * economics and therefore opposite defaults.
 *
 * AI_PHOTO_MATCH_ENABLED (default ON) — the customer's photo.
 *   A customer pasting a product screenshot with "eita ache?" is the dominant
 *   F-commerce inbox entry point, and it cannot be served from text: there is
 *   no text. One extraction call turns the photo into searchable attributes,
 *   which is what makes the advertised image_understanding feature real.
 *   Cost: ~1,065–1,090 input tokens per photo on gemini-3.1-flash-lite, billed
 *   flat regardless of resolution (docs/ai-cost/AI_COST_AUDIT.md), so
 *   compressing the customer's image saves nothing. Paths 2 and 3 below.
 *
 * AI_VISION_ENABLED (default OFF) — everything else.
 *   Analysing the merchant's own product images, and attaching raw image bytes
 *   to the final reply call. Both were measured as not worth it: product
 *   attributes derived from the merchant's own text beat the vision path by 4.1
 *   points of rank-1 retrieval accuracy at zero provider cost, and the reply
 *   call is already grounded on the extracted description plus live DB rows, so
 *   re-sending the bytes doubles the per-photo image cost to buy very little.
 *   Paths 1 and 4 below, plus stripImageBlocks.
 *
 * The paths that consult this:
 *   1. product-ai.service.js        — attribute extraction on product upload
 *   2. intent-router.service.js     — attributes from a customer-sent photo
 *   3. image-product-matcher.service.js — vision tier of image→product matching
 *   4. clip-client.service.js       — image embeddings for visual similarity
 *
 * The binding constraint on the photo path is rate limit, not money: a free
 * Gemini key allows 15 requests/minute across the whole app, and a photo
 * message costs two calls. Set AI_PHOTO_MATCH_ENABLED=false to shed that load
 * without a deploy.
 */

const visionEnabled = () => process.env.AI_VISION_ENABLED === 'true';

/**
 * Is customer-photo → product matching on? Default ON — opt out, not opt in.
 */
const photoMatchEnabled = () => process.env.AI_PHOTO_MATCH_ENABLED !== 'false';

/**
 * Strip image blocks from an outgoing messages array, keeping the text.
 *
 * Skipping attribute extraction is not enough on its own: if image blocks stay
 * in the final chat payload the provider still receives — and bills for — the
 * image. Returns the array unchanged when vision is enabled.
 */
const stripImageBlocks = (messages = []) => {
    if (visionEnabled()) return messages;
    return messages.map((m) => {
        if (!Array.isArray(m.content)) return m;
        const text = m.content
            .filter((b) => b && b.type !== 'image_url')
            .map((b) => b.text || '')
            .filter(Boolean)
            .join('\n');
        return { ...m, content: text || '[the customer sent a photo]' };
    });
};

module.exports = { visionEnabled, photoMatchEnabled, stripImageBlocks };
