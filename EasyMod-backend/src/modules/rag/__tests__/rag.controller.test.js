'use strict';

jest.mock('src/modules/rag/rag.service', () => ({
    ingestData: jest.fn(() => Promise.resolve({ success: true, ingestionId: 'point-1' })),
    queryData: jest.fn(() => Promise.resolve({ success: true, results: [] })),
}));

const ragService = require('src/modules/rag/rag.service');
const controller = require('../rag.controller');

const createRes = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
};

describe('rag.controller', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('maps validated ingest data into ragService text input', async () => {
        const req = {
            body: {
                data: 'Delivery takes 2 days',
                content_type: 'text',
                collection_id: '11111111-2222-4333-8444-555555555555',
                metadata: { documentId: 'manual-test', shopId: 'shop-1' },
            },
        };
        const res = createRes();
        const next = jest.fn();

        await controller.ingestData(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(ragService.ingestData).toHaveBeenCalledWith({
            text: 'Delivery takes 2 days',
            metadata: {
                documentId: 'manual-test',
                shopId: 'shop-1',
                contentType: 'text',
                collectionId: '11111111-2222-4333-8444-555555555555',
            },
        });
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            success: true,
            data: { success: true, ingestionId: 'point-1' },
        });
    });
});
