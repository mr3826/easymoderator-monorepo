/**
 * Vision policy — one switch for every image-understanding path.
 *
 * EasyModerator deliberately does NOT send image bytes to an LLM. Product
 * grounding comes from text: names, descriptions, prices, variants, stock,
 * categories, shop knowledge, FAQs, and delivery/payment settings. Product
 * images are stored and displayed, never analysed.
 *
 * Four paths would otherwise call a vision model, and all four consult this:
 *   1. product-ai.service.js        — attribute extraction on product upload
 *   2. intent-router.service.js     — attributes from a customer-sent photo
 *   3. image-product-matcher.service.js — vision tier of image→product matching
 *   4. clip-client.service.js       — image embeddings for visual similarity
 *
 * Default OFF. Set AI_VISION_ENABLED=true only if a product requirement
 * explicitly calls for image understanding; doing so re-introduces per-image
 * token cost (~1,065–1,090 input tokens per image on gemini-3.1-flash-lite,
 * billed flat regardless of resolution — see docs/ai-cost/AI_COST_AUDIT.md).
 */

const visionEnabled = () => process.env.AI_VISION_ENABLED === 'true';

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

module.exports = { visionEnabled, stripImageBlocks };
