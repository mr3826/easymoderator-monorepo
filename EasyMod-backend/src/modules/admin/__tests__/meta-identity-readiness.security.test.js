'use strict';

const mockModels = {
    AuditLog: { findAndCountAll: jest.fn() },
    Invoice: {},
    Message: {},
    MetaChannel: { count: jest.fn() },
    MetaUserIdentity: { count: jest.fn(), max: jest.fn() },
    Order: {},
    Shop: {},
    Subscription: {},
    User: {},
};

jest.mock('../../entities', () => mockModels);
jest.mock('../../../utils/cache.service', () => ({
    get: jest.fn(),
    set: jest.fn(),
    deleteForShop: jest.fn(),
}));

const service = require('../admin.service');

describe('Meta identity coverage readiness', () => {
    beforeEach(() => jest.clearAllMocks());

    test('reports only aggregate connected-channel mapping coverage', async () => {
        const capturedAt = new Date('2026-07-23T08:00:00.000Z');
        mockModels.MetaChannel.count.mockResolvedValue(5);
        mockModels.MetaUserIdentity.count.mockResolvedValue(3);
        mockModels.MetaUserIdentity.max.mockResolvedValue(capturedAt);

        await expect(service.getMetaIdentityReadiness()).resolves.toEqual({
            totalConnectedChannels: 5,
            channelsWithValidMappings: 3,
            connectedChannelsMissingMappings: 2,
            mostRecentMappingCaptureAt: capturedAt,
            ready: false,
        });

        const mappingQuery = mockModels.MetaUserIdentity.count.mock.calls[0][0];
        expect(mappingQuery).toEqual(expect.objectContaining({
            distinct: true,
            col: 'channel_id',
            where: expect.objectContaining({
                page_scoped_user_id: expect.any(Object),
                is_current_connection: true,
            }),
        }));
        expect(mappingQuery.include[0]).toEqual(expect.objectContaining({
            as: 'channel',
            required: true,
            where: { status: 'CONNECTED' },
        }));
    });

    test('is ready only when every connected channel has a valid mapping', async () => {
        mockModels.MetaChannel.count.mockResolvedValue(2);
        mockModels.MetaUserIdentity.count.mockResolvedValue(2);
        mockModels.MetaUserIdentity.max.mockResolvedValue(null);

        await expect(service.getMetaIdentityReadiness()).resolves.toMatchObject({
            totalConnectedChannels: 2,
            connectedChannelsMissingMappings: 0,
            ready: true,
        });
    });
});
