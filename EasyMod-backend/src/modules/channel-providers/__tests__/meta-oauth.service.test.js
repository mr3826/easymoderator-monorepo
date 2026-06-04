'use strict';

// Mock the OAuth state store so tests don't need a real Redis instance.
jest.mock('../oauth-state.store', () => ({
    put:  jest.fn().mockResolvedValue(undefined),
    take: jest.fn().mockResolvedValue({ userId: 'user-xyz', shopId: 'shop-abc', platform: 'facebook' }),
    TTL_SECONDS: 900,
}));

// Capture the scopes passed into buildAuthUrl by stubbing the provider registry.
const mockBuildAuthUrl = jest.fn().mockResolvedValue('https://www.facebook.com/v22.0/dialog/oauth?scope=stub');
const mockSubscribeWebhook = jest.fn().mockResolvedValue(undefined);
const mockVerifyWebhookSubscription = jest.fn();
const mockGetAssetAccessToken = jest.fn().mockResolvedValue({ token: 'page-tok', expiresAt: null, linkedFbPageId: null });
const mockExchangeCode = jest.fn().mockResolvedValue({ userToken: 'user-tok' });
const mockListManagedAssets = jest.fn().mockResolvedValue([]);

jest.mock('../provider.registry', () => ({
    getProvider: () => ({
        buildAuthUrl: mockBuildAuthUrl,
        exchangeCode: mockExchangeCode,
        listManagedAssets: mockListManagedAssets,
        getAssetAccessToken: mockGetAssetAccessToken,
        subscribeWebhook: mockSubscribeWebhook,
        verifyWebhookSubscription: mockVerifyWebhookSubscription,
    }),
}));

const mockUpsertFromOAuth = jest.fn();
const mockUpdateStatus = jest.fn().mockResolvedValue({});
const mockConfirmWebhookActive = jest.fn().mockResolvedValue({});

jest.mock('../meta-channel.service', () => ({
    upsertFromOAuth: mockUpsertFromOAuth,
    updateStatus: mockUpdateStatus,
    confirmWebhookActive: mockConfirmWebhookActive,
}));

const oauthService = require('../meta-oauth.service');

describe('initiateUnifiedOAuth scopes', () => {
    beforeEach(() => jest.clearAllMocks());

    test('does NOT request business_management', async () => {
        await oauthService.initiateUnifiedOAuth('user-1', 'shop-1');
        const { scopes } = mockBuildAuthUrl.mock.calls[0][0];
        expect(scopes).not.toContain('business_management');
    });

    test('still requests the core messaging + IG scopes', async () => {
        await oauthService.initiateUnifiedOAuth('user-1', 'shop-1');
        const { scopes } = mockBuildAuthUrl.mock.calls[0][0];
        expect(scopes).toEqual(expect.arrayContaining([
            'pages_show_list', 'pages_messaging', 'pages_manage_metadata',
            'instagram_basic', 'instagram_manage_messages',
        ]));
    });
});

describe('handleCallback() null-state guard', () => {
    const stateStore = require('../oauth-state.store');

    beforeEach(() => jest.clearAllMocks());

    test('rejects with status 400 and "Invalid or expired" when stateStore.take returns null', async () => {
        stateStore.take.mockResolvedValueOnce(null);

        await expect(
            oauthService.handleCallback('auth-code', 'stale-state', 'user-xyz', 'shop-abc'),
        ).rejects.toMatchObject({
            message: 'Invalid or expired OAuth state token',
            status: 400,
        });
    });
});

describe('connectPage() webhook verify wiring', () => {
    const SHOP_ID = 'shop-abc';
    const USER_ID = 'user-xyz';
    const ASSET_ID = 'PAGE_42';
    const CHANNEL = { id: 'chan-1', toJSON: () => ({ id: 'chan-1', status: 'CONNECTED' }) };

    beforeEach(() => {
        jest.clearAllMocks();
        mockUpsertFromOAuth.mockResolvedValue(CHANNEL);
        mockGetAssetAccessToken.mockResolvedValue({ token: 'page-tok', expiresAt: null, linkedFbPageId: null });
        mockSubscribeWebhook.mockResolvedValue(undefined);
    });

    test('calls updateStatus(ERROR, webhook_subscription_unverified) when verify returns ok:false', async () => {
        mockVerifyWebhookSubscription.mockResolvedValue({ ok: false, fields: [] });

        await oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook');

        expect(mockSubscribeWebhook).toHaveBeenCalledTimes(1);
        expect(mockVerifyWebhookSubscription).toHaveBeenCalledTimes(1);
        expect(mockUpdateStatus).toHaveBeenCalledWith('chan-1', 'ERROR', 'webhook_subscription_unverified');
        expect(mockConfirmWebhookActive).not.toHaveBeenCalled();
    });

    test('calls confirmWebhookActive and NOT updateStatus(ERROR) when verify returns ok:true', async () => {
        mockVerifyWebhookSubscription.mockResolvedValue({ ok: true, fields: ['messages', 'feed'] });

        await oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook');

        expect(mockConfirmWebhookActive).toHaveBeenCalledWith('chan-1');
        expect(mockUpdateStatus).not.toHaveBeenCalledWith('chan-1', 'ERROR', expect.anything());
    });

    test('calls updateStatus(ERROR, webhook_subscription_failed) when subscribeWebhook throws', async () => {
        mockSubscribeWebhook.mockRejectedValue(new Error('network timeout'));

        const result = await oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook');

        expect(mockUpdateStatus).toHaveBeenCalledWith('chan-1', 'ERROR', 'webhook_subscription_failed');
        expect(result.webhookWarning).toContain('network timeout');
        expect(mockConfirmWebhookActive).not.toHaveBeenCalled();
    });

    test('surfaces webhookWarning in returned object when verify fails', async () => {
        mockVerifyWebhookSubscription.mockResolvedValue({ ok: false, fields: [] });

        const result = await oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook');

        expect(result.webhookWarning).toMatch(/could not be verified/i);
    });

    test('webhookWarning is null when verify succeeds', async () => {
        mockVerifyWebhookSubscription.mockResolvedValue({ ok: true, fields: ['messages'] });

        const result = await oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook');

        expect(result.webhookWarning).toBeNull();
    });
});
