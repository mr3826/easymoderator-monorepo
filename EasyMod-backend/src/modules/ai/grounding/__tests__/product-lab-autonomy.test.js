'use strict';

const {
    knowledgeNotFoundReply,
    retrievalFailedReply,
    renderEvidenceBlock,
} = require('../grounding-prompt');
const { ProductEvidenceStatus, MediaStatus } = require('../grounding.contract');

describe('isolated Product Lab autonomous response policy', () => {
    const previous = process.env.EASYMOD_PRODUCT_LAB_AUTONOMOUS;

    afterEach(() => {
        if (previous === undefined) delete process.env.EASYMOD_PRODUCT_LAB_AUTONOMOUS;
        else process.env.EASYMOD_PRODUCT_LAB_AUTONOMOUS = previous;
    });

    test('preserves the existing production follow-up copy when the Lab policy is unset', () => {
        delete process.env.EASYMOD_PRODUCT_LAB_AUTONOMOUS;
        expect(knowledgeNotFoundReply('en')).toContain('Someone from our team');
        expect(retrievalFailedReply('en')).toContain('Someone from our team');
    });

    test('uses truthful catalog-unavailable replies without promising human follow-up in the Lab', () => {
        process.env.EASYMOD_PRODUCT_LAB_AUTONOMOUS = '1';
        expect(knowledgeNotFoundReply('en')).toBe(
            "I don't have confirmed information about that product detail in this shop's catalog. Ask me about another listed detail.",
        );
        expect(retrievalFailedReply('en')).toBe("I can't verify the catalog right now. Please try again in a moment.");
        expect(knowledgeNotFoundReply('mixed')).not.toMatch(/(?:team|representative).*(?:confirm|get back|follow|contact)|(?:confirm|follow up) shortly/i);
        expect(retrievalFailedReply('bn')).not.toMatch(/প্রতিনিধি|জানাবেন/);
    });

    test('tells the model to offer a retry instead of inventing a human follow-up', () => {
        process.env.EASYMOD_PRODUCT_LAB_AUTONOMOUS = '1';
        const prompt = renderEvidenceBlock({
            shopId: 'fixture-shop-a',
            productStatus: ProductEvidenceStatus.RETRIEVAL_FAILED,
            verifiedProducts: [],
            relatedProducts: [],
            unmatchedTerms: [],
            askedAttributes: ['price'],
            mediaStatus: MediaStatus.NOT_REQUESTED,
        });
        expect(prompt).toContain('invite them to retry later');
        expect(prompt).toContain('Do not promise human follow-up');
        expect(prompt).not.toContain('say you will confirm shortly');
    });
});
