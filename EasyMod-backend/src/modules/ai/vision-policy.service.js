/**
 * Vision policy — the switches for every image-understanding path.
 *
 * Two switches, because the two sides of "image understanding" have opposite
 * economics and therefore opposite defaults.
 *
 * AI_PHOTO_MATCH_ENABLED (default OFF) — customer-photo product matching.
 *   Enabling this sends a customer image to the configured model chain for
 *   attribute extraction and product lookup. Gemini is tried first; if it
 *   fails, the existing provider chain can send that image to OpenAI. Keep the
 *   switch off until the owner approves provider terms and image handling.
 *   The switch also gates image-based order selection in order-flow.service.
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
 * The environment value is read per request, but production config is injected
 * at process start. Changing the deployment env requires replacing/restarting
 * both backend and worker; it does not cancel an extraction already underway.
 * Keep AI_VISION_ENABLED=false too when no provider may receive image blocks.
 */

const visionEnabled = () => process.env.AI_VISION_ENABLED === 'true';

/**
 * Is customer-photo → product matching on? Only the exact literal `true` opts in.
 */
const photoMatchEnabled = () => process.env.AI_PHOTO_MATCH_ENABLED === 'true';

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
