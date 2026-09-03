'use strict';

jest.mock('../shop.service', () => ({
    getShopAiSettings: jest.fn(),
}));

const shopService = require('../shop.service');
const {
    AI_REPLY_MODES,
    DEFAULT_AI_REPLY_MODE,
    normalizeAiReplyMode,
    getEffectiveAiReplyMode,
    isAutoSendMode,
    isNonDeliveringMode,
} = require('../ai-reply-mode');

describe('AI reply mode', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('normalizeAiReplyMode', () => {
        test('uses MANUAL as the default', () => {
            expect(DEFAULT_AI_REPLY_MODE).toBe(AI_REPLY_MODES.MANUAL);
            expect(normalizeAiReplyMode()).toBe(AI_REPLY_MODES.MANUAL);
        });

        test.each([null, '', '   ', 'GARBAGE', {}, 42])(
            'normalizes %p to MANUAL',
            (value) => {
                expect(normalizeAiReplyMode(value)).toBe(AI_REPLY_MODES.MANUAL);
            },
        );

        test.each([
            ['AUTO', AI_REPLY_MODES.AUTO],
            ['DRAFT', AI_REPLY_MODES.DRAFT],
            ['MANUAL', AI_REPLY_MODES.MANUAL],
            ['AI_ACTIVE', AI_REPLY_MODES.AUTO],
            ['AI_SUGGEST_ONLY', AI_REPLY_MODES.DRAFT],
            ['HUMAN_ACTIVE', AI_REPLY_MODES.MANUAL],
        ])('normalizes %s to %s', (value, expected) => {
            expect(normalizeAiReplyMode(value)).toBe(expected);
        });
    });

    describe('mode predicates', () => {
        test('recognizes AUTO and its legacy alias as auto-send', () => {
            expect(isAutoSendMode(AI_REPLY_MODES.AUTO)).toBe(true);
            expect(isAutoSendMode('AI_ACTIVE')).toBe(true);
            expect(isAutoSendMode(AI_REPLY_MODES.DRAFT)).toBe(false);
        });

        test('recognizes DRAFT and MANUAL as non-delivering', () => {
            expect(isNonDeliveringMode(AI_REPLY_MODES.DRAFT)).toBe(true);
            expect(isNonDeliveringMode(AI_REPLY_MODES.MANUAL)).toBe(true);
            expect(isNonDeliveringMode('AI_SUGGEST_ONLY')).toBe(true);
            expect(isNonDeliveringMode(AI_REPLY_MODES.AUTO)).toBe(false);
        });
    });

    describe('getEffectiveAiReplyMode', () => {
        test('resolves and normalizes the shop AI settings mode', async () => {
            shopService.getShopAiSettings.mockResolvedValue({ automation_mode: 'AI_ACTIVE' });

            await expect(getEffectiveAiReplyMode('shop-1')).resolves.toBe(AI_REPLY_MODES.AUTO);
            expect(shopService.getShopAiSettings).toHaveBeenCalledWith('shop-1');
        });

        test('returns MANUAL when the shop settings lookup fails', async () => {
            shopService.getShopAiSettings.mockRejectedValue(new Error('settings unavailable'));

            await expect(getEffectiveAiReplyMode('shop-1')).resolves.toBe(AI_REPLY_MODES.MANUAL);
        });
    });
});
