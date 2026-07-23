'use strict';

const mockDeliveryIntegration = {
    findAll: jest.fn(),
};

jest.mock('../../modules/entities', () => ({
    DeliveryIntegration: mockDeliveryIntegration,
}));

const { assertProductionIntegrations } = require('../production-integration.validator');

describe('production integration validator', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        jest.clearAllMocks();
    });

    test('skips database checks outside production', async () => {
        process.env.NODE_ENV = 'test';
        await expect(assertProductionIntegrations()).resolves.toEqual({ validated: 0 });
        expect(mockDeliveryIntegration.findAll).not.toHaveBeenCalled();
    });

    test('accepts active integrations with provider verification credentials', async () => {
        process.env.NODE_ENV = 'production';
        mockDeliveryIntegration.findAll.mockResolvedValue([
            { id: 'pathao-1', provider: 'pathao', credentials: { client_secret: 'secret' } },
            { id: 'steadfast-1', provider: 'steadfast', credentials: { secret_key: 'secret' } },
            { id: 'redx-1', provider: 'redx', credentials: { api_key: 'secret' } },
        ]);

        await expect(assertProductionIntegrations()).resolves.toEqual({ validated: 3 });
    });

    test('fails startup when an active integration cannot verify webhooks', async () => {
        process.env.NODE_ENV = 'production';
        mockDeliveryIntegration.findAll.mockResolvedValue([
            { id: 'pathao-1', provider: 'pathao', credentials: { client_id: 'id-only' } },
        ]);

        await expect(assertProductionIntegrations()).rejects.toThrow(
            'Active courier integrations lack webhook verification credentials: pathao:pathao-1',
        );
    });
});
