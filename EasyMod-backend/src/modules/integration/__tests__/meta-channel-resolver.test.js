'use strict';

const mockMetaChannelService = {
    findByMetaAssetId: jest.fn(),
};
jest.mock('../../channel-providers/meta-channel.service', () => mockMetaChannelService);

const { resolveConnectedChannel } = require('../meta-channel-resolver');

const connectedChannel = (overrides = {}) => ({
    id: 'channel-1',
    shop_id: 'shop-1',
    platform: 'facebook',
    meta_asset_id: 'page-1',
    status: 'CONNECTED',
    display_name: 'Page One',
    ...overrides,
});

beforeEach(() => jest.clearAllMocks());

describe('resolveConnectedChannel', () => {
    test('returns a routable channel only when the platform and asset match', async () => {
        const channel = connectedChannel();
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(channel);

        await expect(resolveConnectedChannel('page-1', 'facebook')).resolves.toEqual(expect.objectContaining({
            id: 'channel-1',
            shop_id: 'shop-1',
            platform: 'facebook',
            asset_id: 'page-1',
            status: 'CONNECTED',
        }));
    });

    test('fails closed when the resolved channel platform does not match', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(connectedChannel({ platform: 'instagram' }));

        await expect(resolveConnectedChannel('page-1', 'facebook')).resolves.toBeNull();
    });

    test('fails closed when the resolved channel asset does not match the webhook asset', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(connectedChannel({ meta_asset_id: 'page-2' }));

        await expect(resolveConnectedChannel('page-1', 'facebook')).resolves.toBeNull();
    });
});
