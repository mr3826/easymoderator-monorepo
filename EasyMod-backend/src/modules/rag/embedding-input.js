'use strict';

const normalizeEmbeddingText = (text) => String(text ?? '').trim();

/**
 * Gemini Embedding 2 asymmetric search contract. These exact prefixes are
 * provider input, not user-visible content and must be versioned with the
 * embedding space identity.
 */
const prepareRetrievalQuery = (query) => {
    const content = normalizeEmbeddingText(query);
    if (!content) throw new Error('retrieval query text is required');
    return `task: search result | query: ${content}`;
};

const prepareRetrievalDocument = (text, { title = null } = {}) => {
    const content = normalizeEmbeddingText(text);
    if (!content) throw new Error('retrieval document text is required');
    const normalizedTitle = normalizeEmbeddingText(title) || 'none';
    return `title: ${normalizedTitle} | text: ${content}`;
};

module.exports = {
    normalizeEmbeddingText,
    prepareRetrievalQuery,
    prepareRetrievalDocument,
};
