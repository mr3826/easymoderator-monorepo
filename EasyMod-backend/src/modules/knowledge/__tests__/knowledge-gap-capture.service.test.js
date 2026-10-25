'use strict';

jest.mock('../../analytics/knowledge-gap.entity', () => ({
    create: jest.fn(),
}));

const KnowledgeGap = require('../../analytics/knowledge-gap.entity');
const {
    recordKnowledgeGap,
    normalizePlatform,
} = require('../knowledge-gap-capture.service');

describe('knowledge-gap-capture.service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does not write when shop or question is missing', async () => {
        await expect(recordKnowledgeGap({ shopId: 'shop-1', question: '   ' }))
            .resolves.toEqual({ logged: false, reason: 'missing_required_fields' });
        await expect(recordKnowledgeGap({ question: 'What is delivery charge?' }))
            .resolves.toEqual({ logged: false, reason: 'missing_required_fields' });

        expect(KnowledgeGap.create).not.toHaveBeenCalled();
    });

    it('normalizes common Meta platforms', () => {
        expect(normalizePlatform('facebook')).toBe('messenger');
        expect(normalizePlatform('messenger')).toBe('messenger');
        expect(normalizePlatform('instagram')).toBe('instagram');
        expect(normalizePlatform('')).toBe('unknown');
    });

    it('writes a trimmed knowledge gap row', async () => {
        KnowledgeGap.create.mockResolvedValue({ id: 42 });

        await expect(recordKnowledgeGap({
            shopId: 'shop-1',
            question: '  What is your size chart?  ',
            platform: 'facebook',
            language: 'mixed',
            source: 'low_confidence_handoff',
        })).resolves.toEqual({ logged: true, id: 42 });

        expect(KnowledgeGap.create).toHaveBeenCalledWith({
            shop_id: 'shop-1',
            question: 'What is your size chart?',
            platform: 'messenger',
            language: 'mixed',
            source: 'low_confidence_handoff',
        });
    });

    // Pilot+ P+05 hygiene: gap rows must not become contact/P2P records.
    it.each([
        ['delivery to mirpur? call 01712345678', 'delivery to mirpur? call [masked]'],
        ['amar trxid ABC123XY payment hoise', 'amar [masked] payment hoise'],
        ['paid 1650 taka ref 8801799887766', 'paid 1650 taka ref [masked]'],
        ['mail shop@example.com for bill', 'mail [masked] for bill'],
    ])('redacts sensitive values: %s', async (input, expected) => {
        KnowledgeGap.create.mockResolvedValue({ id: 1 });
        await recordKnowledgeGap({ shopId: 'shop-1', question: input, platform: 'messenger' });
        expect(KnowledgeGap.create.mock.calls[0][0].question).toBe(expected);
    });
});
