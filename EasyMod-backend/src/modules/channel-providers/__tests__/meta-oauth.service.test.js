'use strict';

// Mock the OAuth state store so tests don't need a real Redis instance.
jest.mock('../oauth-state.store', () => ({
    put:  jest.fn().mockResolvedValue(undefined),
    get:  jest.fn(),
    take: jest.fn().mockResolvedValue({ userId: 'user-xyz', shopId: 'shop-abc', platform: 'facebook' }),
    TTL_SECONDS: 900,
}));

// Capture the scopes passed into buildAuthUrl by stubbing the provider registry.
const mockBuildAuthUrl = jest.fn().mockResolvedValue('https://www.facebook.com/v22.0/dialog/oauth?scope=stub');
const mockSubscribeWebhook = jest.fn().mockResolvedValue(undefined);
const mockVerifyWebhookSubscription = jest.fn();
const mockGetAssetAccessToken = jest.fn().mockResolvedValue({ token: 'page-tok', expiresAt: null });
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

const stateStore = require('../oauth-state.store');
const oauthService = require('../meta-oauth.service');

describe('initiateOAuth (facebook) scopes', () => {
    beforeEach(() => jest.clearAllMocks());

    test('never injects business_management or any Instagram scope', async () => {
        await oauthService.initiateOAuth('user-1', 'shop-1', 'facebook');
        const { scopes } = mockBuildAuthUrl.mock.calls[0][0];
        // The service delegates the concrete scope list to
        // MetaMessengerProvider.DEFAULT_SCOPES (asserted in the provider test);
        // it must never add Instagram or the high-sensitivity business_management.
        expect(scopes).not.toContain('business_management');
        expect(scopes).not.toContain('instagram_basic');
        expect(scopes).not.toContain('instagram_manage_messages');
        expect(scopes).not.toContain('instagram_manage_comments');
    });

    test('builds an OAuth redirect URL + facebook-prefixed state', async () => {
        const result = await oauthService.initiateOAuth('user-1', 'shop-1', 'facebook');
        expect(result.redirectUrl).toBeTruthy();
        expect(result.state).toMatch(/^facebook:/);
    });
});

describe('OAuth callback null-state guards', () => {
    beforeEach(() => jest.clearAllMocks());

    test('handleCallback rejects with status 400 and "Invalid or expired" when stateStore.take returns null', async () => {
        stateStore.take.mockResolvedValueOnce(null);

        await expect(
            oauthService.handleCallback('auth-code', 'stale-state', 'user-xyz', 'shop-abc'),
        ).rejects.toMatchObject({
            message: 'Invalid or expired OAuth state token',
            status: 400,
        });
    });

    test('handleCallback returns an opaque callback token and stores the Meta user token server-side', async () => {
        const pages = [{ id: 'PAGE_42', name: 'My Page' }];
        mockListManagedAssets.mockResolvedValueOnce(pages);

        const result = await oauthService.handleCallback('auth-code', 'state-ok', 'user-xyz', 'shop-abc');

        expect(result.pages).toEqual(pages);
        expect(result.tempToken).toMatch(/^[a-f0-9]{64}$/);
        expect(result.tempToken).not.toBe('user-tok');
        expect(stateStore.put).toHaveBeenCalledWith(
            `callback:shop-abc:facebook:${result.tempToken}`,
            expect.objectContaining({
                userToken: 'user-tok',
                pages,
                userId: 'user-xyz',
                shopId: 'shop-abc',
                platform: 'facebook',
            }),
        );
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
        mockGetAssetAccessToken.mockResolvedValue({ token: 'page-tok', expiresAt: null });
        mockSubscribeWebhook.mockResolvedValue(undefined);
        stateStore.get.mockResolvedValue({
            userToken: 'stored-user-token',
            platform: 'facebook',
            pages: [{ id: ASSET_ID, name: 'Stored Page Name' }],
            userId: USER_ID,
            shopId: SHOP_ID,
        });
    });

    test('calls updateStatus(ERROR, webhook_subscription_unverified) when verify returns ok:false', async () => {
        mockVerifyWebhookSubscription.mockResolvedValue({ ok: false, fields: [] });

        await oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook');

        expect(mockGetAssetAccessToken).toHaveBeenCalledWith({
            assetId: ASSET_ID,
            userToken: 'stored-user-token',
        });
        expect(mockUpsertFromOAuth).toHaveBeenCalledWith(expect.objectContaining({
            displayName: 'Stored Page Name',
        }));
        expect(mockSubscribeWebhook).toHaveBeenCalledTimes(1);
        expect(mockVerifyWebhookSubscription).toHaveBeenCalledTimes(1);
        expect(mockUpdateStatus).toHaveBeenCalledWith('chan-1', 'ERROR', 'webhook_subscription_unverified');
        expect(mockConfirmWebhookActive).not.toHaveBeenCalled();
    });

    test('calls confirmWebhookActive and NOT updateStatus(ERROR) when verify returns ok:true', async () => {
        mockVerifyWebhookSubscription.mockResolvedValue({ ok: true, fields: ['messages'] });

        await oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook');

        expect(mockConfirmWebhookActive).toHaveBeenCalledWith('chan-1', ['messages']);
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

    test('rejects a Page that was not selected in the Meta OAuth callback', async () => {
        mockVerifyWebhookSubscription.mockResolvedValue({ ok: true, fields: ['messages'] });
        stateStore.get.mockResolvedValueOnce({
            userToken: 'stored-user-token',
            platform: 'facebook',
            pages: [{ id: 'PAGE_OTHER', name: 'Other Page' }],
            userId: USER_ID,
            shopId: SHOP_ID,
        });

        await expect(
            oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook'),
        ).rejects.toMatchObject({
            status: 403,
            message: expect.stringContaining('was not selected'),
        });

        expect(mockGetAssetAccessToken).not.toHaveBeenCalled();
        expect(mockUpsertFromOAuth).not.toHaveBeenCalled();
    });
});
