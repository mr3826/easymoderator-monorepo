'use strict';

/**
 * Build the canonical product document used by both incremental embedding and
 * the deterministic Qdrant reindex source contract.
 */
const buildEmbeddingText = (product = {}) => {
    const parts = [
        product.name,
        product.name_bn,
    ];

    const variants = product.variants || [];
    if (variants.length) {
        parts.push(`sizes: ${variants.join(', ')}`);
    }

    if (product.category) parts.push(`category: ${product.category}`);
    if (product.ai_category && product.ai_category !== product.category) {
        parts.push(product.ai_category);
    }

    if (product.ai_color_primary) parts.push(product.ai_color_primary);
    if (product.ai_material) parts.push(product.ai_material);
    if (product.ai_attributes?.style) parts.push(product.ai_attributes.style);

    const tags = [...(product.tags || []), ...(product.ai_tags || [])];
    if (tags.length) parts.push(tags.join(' '));

    if (product.description) parts.push(product.description);
    if (product.ai_description && product.ai_description !== product.description) {
        parts.push(product.ai_description);
    }

    if (product.sku) parts.push(`SKU: ${product.sku}`);

    return parts.filter(Boolean).join(' | ');
};

module.exports = { buildEmbeddingText };
