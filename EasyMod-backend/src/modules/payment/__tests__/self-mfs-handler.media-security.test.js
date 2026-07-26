'use strict';

const mockSafeFetchMedia = jest.fn();

jest.mock('../../../utils/safe-media-fetch', () => ({
    safeFetchMedia: mockSafeFetchMedia,
}));
jest.mock('../../ai/llm.service', () => ({ chat: jest.fn() }));
jest.mock('../../entities', () => ({ TrxIDLog: {} }));

const service = require('../self-mfs-handler.service');

describe('self-MFS screenshot media policy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('preprocessing uses the centralized SSRF-safe fetcher and returns a bounded data image', async () => {
        const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
        mockSafeFetchMedia.mockResolvedValue({ buffer: png, mimeType: 'image/png' });

        const result = await service._private.preprocessImage(
            'https://scontent.xx.fbcdn.net/synthetic.png',
        );

        expect(mockSafeFetchMedia).toHaveBeenCalledWith(
            'https://scontent.xx.fbcdn.net/synthetic.png',
            { maxBytes: 5 * 1024 * 1024, timeoutMs: 8000 },
        );
        expect(result).toBe(`data:image/png;base64,${png.toString('base64')}`);
    });
});
