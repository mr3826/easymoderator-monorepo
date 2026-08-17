'use strict';

const {
    normalizeEmbeddingText,
    prepareRetrievalDocument,
    prepareRetrievalQuery,
} = require('../embedding-input');

describe('Gemini Embedding 2 retrieval input formatting', () => {
    test('query and document inputs are asymmetric and normalized', () => {
        expect(normalizeEmbeddingText('  delivery  ')).toBe('delivery');
        expect(prepareRetrievalQuery('  delivery information  '))
            .toBe('task: search result | query: delivery information');
        expect(prepareRetrievalDocument('  answer text  ', { title: ' FAQ ' }))
            .toBe('title: FAQ | text: answer text');
        expect(prepareRetrievalDocument('answer text')).toBe('title: none | text: answer text');
        expect(prepareRetrievalQuery('x')).not.toBe(prepareRetrievalDocument('x'));
    });

    test('empty query and document inputs fail closed', () => {
        expect(() => prepareRetrievalQuery('  ')).toThrow(/required/);
        expect(() => prepareRetrievalDocument(null)).toThrow(/required/);
    });
});
