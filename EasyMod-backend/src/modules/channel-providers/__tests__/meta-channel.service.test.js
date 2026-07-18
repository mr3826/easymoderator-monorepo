'use strict';

const mockTransaction = {
    commit: jest.fn(),
    rollback: jest.fn(),
};

const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

const mockDrainChannelJobs = jest.fn();

const mockMetaChannel = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
};

const mockMetaChannelSettings = {
    findOrCreate: jest.fn(),
};

jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(),
    },
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => mockLogger),
}));

jest.mock('../../../jobs/message-queue', () => ({
    drainChannelJobs: mockDrainChannelJobs,
}));

jest.mock('../meta-channel.entity', () => mockMetaChannel);
jest.mock('../meta-channel-settings.entity', () => mockMetaChannelSettings);

const { sequelize } = require('../../../utils/database/database-setup');
const metaChannelService = require('../meta-channel.service');

function makeConflict(overrides = {}) {
    return {
        id: 'old-channel',
        shop_id: 'old-shop',
        platform: 'facebook',
        status: 'CONNECTED',
        connected_by_user_id: null,
        page_access_token_ct: 'old-page-token',
        save: jest.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function makeCreatedChannel(overrides = {}) {
    return {
        id: 'new-channel',
        shop_id: 'new-shop',
        platform: 'facebook',
        meta_asset_id: 'PAGE_1',
        ...overrides,
    };
}

async function connect(overrides = {}) {
    return metaChannelService.upsertFromOAuth({
        shopId: 'new-shop',
        userId: 'new-user',
        platform: 'facebook',
        metaAssetId: 'PAGE_1',
        displayName: 'New Page',
        pageAccessToken: 'new-page-token',
        tokenExpiresAt: null,
        webhookVerifyToken: null,
        webhookSubscribedFields: [],
        ...overrides,
    });
}

describe('MetaChannelService cross-shop Meta asset claims', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTransaction.commit.mockResolvedValue(undefined);
        mockTransaction.rollback.mockResolvedValue(undefined);
        sequelize.transaction.mockResolvedValue(mockTransaction);
        mockMetaChannel.findAll.mockResolvedValue([]);
        mockMetaChannel.findOne.mockResolvedValue(null);
        mockMetaChannel.create.mockResolvedValue(makeCreatedChannel());
        mockMetaChannelSettings.findOrCreate.mockResolvedValue([{}, true]);
        mockDrainChannelJobs.mockResolvedValue({ removed: 0 });
    });

    test('releases legacy cross-shop claims with no connected_by_user_id after fresh OAuth', async () => {
        const legacyClaim = makeConflict({ connected_by_user_id: null });
        mockMetaChannel.findAll.mockResolvedValue([legacyClaim]);
        const created = makeCreatedChannel();
        mockMetaChannel.create.mockResolvedValue(created);

        const result = await connect();

        expect(result).toBe(created);
        expect(legacyClaim.status).toBe('DISCONNECTED');
        expect(legacyClaim.page_access_token_ct).toBeNull();
        expect(legacyClaim.last_error).toBe('reassigned_to_new_shop_after_fresh_meta_oauth');
        expect(legacyClaim.save).toHaveBeenCalledWith({ transaction: mockTransaction });
        expect(mockDrainChannelJobs).toHaveBeenCalledWith({
            metaChannelId: 'old-channel',
            shopId: 'old-shop',
            platform: 'facebook',
        });
        expect(mockTransaction.commit).toHaveBeenCalledTimes(1);
        expect(mockTransaction.rollback).not.toHaveBeenCalled();
    });

    test('blocks a modern active claim owned by a different EasyModerator user', async () => {
        const activeClaim = makeConflict({
            connected_by_user_id: 'other-user',
            page_access_token_ct: 'still-active-token',
        });
        mockMetaChannel.findAll.mockResolvedValue([activeClaim]);

        await expect(connect()).rejects.toMatchObject({
            status: 409,
            code: 'META_ASSET_ALREADY_CONNECTED',
        });

        expect(activeClaim.save).not.toHaveBeenCalled();
        expect(mockMetaChannel.create).not.toHaveBeenCalled();
        expect(mockTransaction.rollback).toHaveBeenCalledTimes(1);
        expect(mockTransaction.commit).not.toHaveBeenCalled();
        expect(mockDrainChannelJobs).not.toHaveBeenCalled();
    });

    test('releases non-routable cross-shop claims before connecting the Page to this shop', async () => {
        const expiredClaim = makeConflict({
            status: 'TOKEN_EXPIRED',
            connected_by_user_id: 'other-user',
        });
        mockMetaChannel.findAll.mockResolvedValue([expiredClaim]);

        await connect();

        expect(expiredClaim.status).toBe('DISCONNECTED');
        expect(expiredClaim.page_access_token_ct).toBeNull();
        expect(mockMetaChannel.create).toHaveBeenCalledWith(
            expect.objectContaining({
                shop_id: 'new-shop',
                meta_asset_id: 'PAGE_1',
                status: 'CONNECTED',
            }),
            { transaction: mockTransaction }
        );
    });

    test('findByMetaAssetId only resolves the currently connected channel for webhook routing', async () => {
        const connected = makeCreatedChannel();
        mockMetaChannel.findOne.mockResolvedValue(connected);

        await expect(metaChannelService.findByMetaAssetId('PAGE_1')).resolves.toBe(connected);

        expect(mockMetaChannel.findOne).toHaveBeenCalledWith({
            where: { meta_asset_id: 'PAGE_1', status: 'CONNECTED' },
            order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
        });
    });
});
