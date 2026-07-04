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
});
