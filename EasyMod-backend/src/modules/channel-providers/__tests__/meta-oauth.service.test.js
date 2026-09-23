'use strict';

// Mock the OAuth state store so tests don't need a real Redis instance.
jest.mock('../oauth-state.store', () => ({
    put:  jest.fn().mockResolvedValue(undefined),
    get:  jest.fn(),
    take: jest.fn().mockResolvedValue({
        userId: 'user-xyz',
        shopId: 'shop-abc',
        platform: 'facebook',
        redirectUri: 'https://app.easymod.tech/channels/oauth-callback',
    }),
    TTL_SECONDS: 900,
}));

// Capture the scopes passed into buildAuthUrl by stubbing the provider registry.
const mockBuildAuthUrl = jest.fn().mockResolvedValue('https://www.facebook.com/v22.0/dialog/oauth?scope=stub');
const mockSubscribeWebhook = jest.fn().mockResolvedValue(undefined);
const mockVerifyWebhookSubscription = jest.fn();
const mockExchangeCode = jest.fn().mockResolvedValue({ userToken: 'user-tok' });
const mockListManagedAssets = jest.fn().mockResolvedValue([]);
const mockGetOAuthIdentity = jest.fn().mockResolvedValue({
    appScopedUserId: 'app-user-1',
    pageScopedIdentities: [{ pageId: 'PAGE_42', pageScopedUserId: 'psid-1' }],
});
const PAGE_TOKEN_SENTINEL = 'PAGE_SECRET_SENTINEL_42';
const PAGE_TOKEN_A = 'PAGE_SECRET_SENTINEL_A';
const PAGE_TOKEN_B = 'PAGE_SECRET_SENTINEL_B';

jest.mock('../provider.registry', () => ({
    getProvider: () => ({
        buildAuthUrl: mockBuildAuthUrl,
        exchangeCode: mockExchangeCode,
        listManagedAssets: mockListManagedAssets,
        getOAuthIdentity: mockGetOAuthIdentity,
        subscribeWebhook: mockSubscribeWebhook,
        verifyWebhookSubscription: mockVerifyWebhookSubscription,
    }),
}));

const mockIdentityUpdate = jest.fn().mockResolvedValue(undefined);
const mockIdentityRetire = jest.fn().mockResolvedValue([1]);
const mockIdentityFindOrCreate = jest.fn().mockResolvedValue([
    { update: mockIdentityUpdate },
]);
jest.mock('../meta-user-identity.entity', () => ({
    update: mockIdentityRetire,
    findOrCreate: mockIdentityFindOrCreate,
}));
jest.mock('../../../utils/database/database-setup', () => ({
    sequelize: {
        transaction: jest.fn(async (callback) => callback({ id: 'identity-tx' })),
    },
}));

const mockUpsertFromOAuth = jest.fn();
const mockUpdateStatus = jest.fn().mockResolvedValue({});
const mockConfirmWebhookActive = jest.fn();
const mockDisconnect = jest.fn().mockResolvedValue({});
const mockFindByShopAndAsset = jest.fn();

jest.mock('../meta-channel.service', () => ({
    upsertFromOAuth: mockUpsertFromOAuth,
    updateStatus: mockUpdateStatus,
    confirmWebhookActive: mockConfirmWebhookActive,
    disconnect: mockDisconnect,
    findByShopAndAsset: mockFindByShopAndAsset,
}));

const stateStore = require('../oauth-state.store');
const oauthService = require('../meta-oauth.service');

describe('initiateOAuth (facebook) permission surface', () => {
    beforeEach(() => jest.clearAllMocks());

    // Under Facebook Login for Business the Meta Login Configuration owns the
    // permission set, so the service must not negotiate permissions at all.
    // It still passes an empty `scopes` to keep the ChannelProvider contract;
    // what matters is that it never populates it. See
    // docs/incidents/2026-09-22-meta-login-unavailable.md.
    test('requests no runtime permissions and never injects business_management or Instagram', async () => {
        await oauthService.initiateOAuth('user-1', 'shop-1', 'facebook');
        const { scopes } = mockBuildAuthUrl.mock.calls[0][0];

        expect(scopes).toEqual([]);
        expect(scopes).not.toContain('business_management');
        expect(scopes).not.toContain('instagram_basic');
        expect(scopes).not.toContain('instagram_manage_messages');
        expect(scopes).not.toContain('instagram_manage_comments');
    });

    // The provider owns config_id; the service must not invent one or reach
    // around the provider to build its own authorization URL.
    test('delegates the authorization URL to the provider and returns it unchanged', async () => {
        mockBuildAuthUrl.mockResolvedValueOnce('https://www.facebook.com/v22.0/dialog/oauth?config_id=stub');
        const result = await oauthService.initiateOAuth('user-1', 'shop-1', 'facebook');

        expect(mockBuildAuthUrl).toHaveBeenCalledTimes(1);
        expect(result.redirectUrl).toBe('https://www.facebook.com/v22.0/dialog/oauth?config_id=stub');
    });

    // A provider that fails closed on a missing configuration must surface as a
    // failed initiation, not as a half-built dialog or a swallowed error.
    test('propagates a fail-closed provider error instead of returning a URL', async () => {
        mockBuildAuthUrl.mockRejectedValueOnce(
            Object.assign(new Error('Facebook login is not configured.'), {
                status: 500,
                code: 'META_LOGIN_CONFIG_ID_INVALID',
            }),
        );

        await expect(oauthService.initiateOAuth('user-1', 'shop-1', 'facebook'))
            .rejects.toMatchObject({ code: 'META_LOGIN_CONFIG_ID_INVALID' });
    });

    test('builds an OAuth redirect URL + facebook-prefixed state', async () => {
        const result = await oauthService.initiateOAuth('user-1', 'shop-1', 'facebook');
        expect(result.redirectUrl).toBeTruthy();
        expect(result.state).toMatch(/^facebook:/);
    });

    test('stores a reconnect target in the server-side OAuth state', async () => {
        await oauthService.initiateOAuth('user-1', 'shop-1', 'facebook', {
            targetChannelId: 'channel-1',
            targetAssetId: 'PAGE_1',
        });

        expect(stateStore.put).toHaveBeenCalledWith(
            expect.stringMatching(/^facebook:/),
            expect.objectContaining({
                reconnectChannelId: 'channel-1',
                reconnectAssetId: 'PAGE_1',
            }),
        );
    });
});

describe('initiateOAuth state binding', () => {
    const config = require('../../../config/config');
    const REDIRECT = 'https://app.easymod.tech/channels/oauth-callback';
    let savedRedirect;

    beforeEach(() => {
        jest.clearAllMocks();
        savedRedirect = config.metaOAuthRedirectUri;
        config.metaOAuthRedirectUri = REDIRECT;
    });

    afterEach(() => {
        config.metaOAuthRedirectUri = savedRedirect;
    });

    test('state is platform:shop:user plus a 128-bit hex nonce', async () => {
        const { state } = await oauthService.initiateOAuth('user-1', 'shop-1', 'facebook');
        expect(state).toMatch(/^facebook:shop-1:user-1:[0-9a-f]{32}$/);
    });

    test('draws the nonce from the CSPRNG (crypto.randomBytes, 16 bytes)', async () => {
        // The format and uniqueness tests below would also pass for Math.random().
        const crypto = require('crypto');
        const spy = jest.spyOn(crypto, 'randomBytes');
        try {
            await oauthService.initiateOAuth('user-1', 'shop-1', 'facebook');
            expect(spy).toHaveBeenCalledWith(16);
        } finally {
            spy.mockRestore();
        }
    });

    test('every initiation gets a fresh nonce', async () => {
        const states = new Set();
        for (let i = 0; i < 25; i += 1) {
            const { state } = await oauthService.initiateOAuth('user-1', 'shop-1', 'facebook');
            states.add(state);
        }
        expect(states.size).toBe(25);
    });

    test('returns, stores and dials with the same state value', async () => {
        const { state } = await oauthService.initiateOAuth('user-1', 'shop-1', 'facebook');

        expect(stateStore.put).toHaveBeenCalledWith(
            state,
            expect.objectContaining({ userId: 'user-1', shopId: 'shop-1', platform: 'facebook' }),
        );
        expect(mockBuildAuthUrl.mock.calls[0][0].state).toBe(state);
    });

    test('binds the exact redirect URI into both the stored state and the dialog request', async () => {
        await oauthService.initiateOAuth('user-1', 'shop-1', 'facebook');

        expect(stateStore.put.mock.calls[0][1].redirectUri).toBe(REDIRECT);
        expect(mockBuildAuthUrl.mock.calls[0][0].redirectUri).toBe(REDIRECT);
    });

    test('passes no scopes, leaving the consent request to the provider allowlist', async () => {
        await oauthService.initiateOAuth('user-1', 'shop-1', 'facebook');
        expect(mockBuildAuthUrl.mock.calls[0][0].scopes).toEqual([]);
    });
});

// The 403 paths for a different user, shop or platform are covered by the
// test.each in 'OAuth callback null-state guards'. Only the redirect binding is
// added here. The state store and provider are mocked in this file: single-use
// consumption and TTL are covered by the oauth-state store tests, and note that
// handleCallback consumes the state (take) before it checks who is calling.
describe('OAuth callback redirect URI binding', () => {
    const config = require('../../../config/config');
    let savedRedirect;

    beforeEach(() => {
        jest.clearAllMocks();
        savedRedirect = config.metaOAuthRedirectUri;
    });

    afterEach(() => {
        config.metaOAuthRedirectUri = savedRedirect;
    });

    test('exchanges the code with the redirect URI stored in state, not live config', async () => {
        config.metaOAuthRedirectUri = 'https://changed.example.com/channels/oauth-callback';

        await oauthService.handleCallback('auth-code', 'state-ok', 'user-xyz', 'shop-abc');

        expect(mockExchangeCode).toHaveBeenCalledWith({
            code: 'auth-code',
            redirectUri: 'https://app.easymod.tech/channels/oauth-callback',
        });
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
        const pages = [{
            id: 'PAGE_42',
            name: 'My Page',
            category: null,
            pictureUrl: null,
            tasks: ['MESSAGING', 'MANAGE'],
            connectable: true,
            reason: null,
        }];
        mockListManagedAssets.mockResolvedValueOnce(pages);

        const result = await oauthService.handleCallback('auth-code', 'state-ok', 'user-xyz', 'shop-abc');

        expect(result.pages).toEqual(pages);
        expect(result.tempToken).toMatch(/^[a-f0-9]{64}$/);
        expect(result.reconnectChannelId).toBeNull();
        expect(result.reconnectAssetId).toBeNull();
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
        expect(mockExchangeCode).toHaveBeenCalledWith({
            code: 'auth-code',
            redirectUri: 'https://app.easymod.tech/channels/oauth-callback',
        });
    });

    test('retains the discovered Page credential server-side without returning or logging it', async () => {
        const pages = [{
            id: 'PAGE_42',
            name: 'My Page',
            category: 'Shopping',
            pictureUrl: null,
            tasks: ['MESSAGING', 'MANAGE'],
            connectable: true,
            reason: null,
            access_token: PAGE_TOKEN_SENTINEL,
        }];
        mockListManagedAssets.mockImplementationOnce(async ({ pageCredentials }) => {
            pageCredentials.PAGE_42 = {
                pageId: 'PAGE_42',
                token: PAGE_TOKEN_SENTINEL,
                expiresAt: null,
            };
            return pages;
        });
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        try {
            const result = await oauthService.handleCallback('auth-code', 'state-ok', 'user-xyz', 'shop-abc');
            const serializedResponse = JSON.stringify(result);
            const serializedLogs = JSON.stringify(logSpy.mock.calls);

            expect(result.pages).toEqual([expect.objectContaining({ id: 'PAGE_42' })]);
            expect(result.pages[0]).not.toHaveProperty('access_token');
            expect(serializedResponse).not.toContain(PAGE_TOKEN_SENTINEL);
            expect(serializedLogs).not.toContain(PAGE_TOKEN_SENTINEL);
            expect(stateStore.put).toHaveBeenCalledWith(
                `callback:shop-abc:facebook:${result.tempToken}`,
                expect.objectContaining({
                    pageCredentials: {
                        PAGE_42: {
                            pageId: 'PAGE_42',
                            token: PAGE_TOKEN_SENTINEL,
                            expiresAt: null,
                        },
                    },
                }),
            );
        } finally {
            logSpy.mockRestore();
        }
    });

    test('carries a reconnect target from OAuth state into the opaque callback payload', async () => {
        stateStore.take.mockResolvedValueOnce({
            userId: 'user-xyz',
            shopId: 'shop-abc',
            platform: 'facebook',
            redirectUri: 'https://app.easymod.tech/channels/oauth-callback',
            reconnectChannelId: 'channel-1',
            reconnectAssetId: 'PAGE_42',
        });

        const result = await oauthService.handleCallback('auth-code', 'state-targeted', 'user-xyz', 'shop-abc');

        expect(result).toEqual(expect.objectContaining({
            reconnectChannelId: 'channel-1',
            reconnectAssetId: 'PAGE_42',
        }));
        expect(stateStore.put).toHaveBeenCalledWith(
            expect.stringMatching(/^callback:shop-abc:facebook:/),
            expect.objectContaining({
                reconnectChannelId: 'channel-1',
                reconnectAssetId: 'PAGE_42',
            }),
        );
    });

    test.each([
        ['different user', { userId: 'user-other', shopId: 'shop-abc', platform: 'facebook' }],
        ['different shop', { userId: 'user-xyz', shopId: 'shop-other', platform: 'facebook' }],
        ['wrong platform', { userId: 'user-xyz', shopId: 'shop-abc', platform: 'instagram' }],
    ])('rejects state bound to a %s before exchanging the code', async (_label, stored) => {
        stateStore.take.mockResolvedValueOnce(stored);
        await expect(
            oauthService.handleCallback('auth-code', 'state-mismatch', 'user-xyz', 'shop-abc'),
        ).rejects.toMatchObject({ status: 403 });
        expect(mockExchangeCode).not.toHaveBeenCalled();
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
        mockFindByShopAndAsset.mockResolvedValue(CHANNEL);
        mockConfirmWebhookActive.mockResolvedValue(CHANNEL);
        mockSubscribeWebhook.mockResolvedValue(undefined);
        stateStore.get.mockResolvedValue({
            userToken: 'stored-user-token',
            platform: 'facebook',
            pages: [{
                id: ASSET_ID,
                name: 'Stored Page Name',
                tasks: ['MESSAGING', 'MANAGE'],
                connectable: true,
                reason: null,
            }],
            metaIdentity: {
                appScopedUserId: 'app-user-1',
                pageScopedIdentities: [{ pageId: ASSET_ID, pageScopedUserId: 'psid-1' }],
            },
            userId: USER_ID,
            shopId: SHOP_ID,
            pageCredentials: {
                [ASSET_ID]: {
                    pageId: ASSET_ID,
                    token: PAGE_TOKEN_SENTINEL,
                    expiresAt: null,
                },
            },
        });
    });

    test.each([
        ['missing', undefined],
        ['non-array', 'MESSAGING'],
        ['non-string entry', ['MESSAGING', 7]],
        ['malformed entry', ['MESSAGING', 'MANAGE!']],
        ['missing subscription task', ['MESSAGING']],
    ])('rejects a %s Page before Meta token exchange or channel upsert', async (_label, tasks) => {
        const page = { id: ASSET_ID, name: 'Stored Page Name', tasks };
        stateStore.get.mockResolvedValueOnce({
            userToken: 'stored-user-token',
            platform: 'facebook',
            pages: [page],
            metaIdentity: {
                appScopedUserId: 'app-user-1',
                pageScopedIdentities: [{ pageId: ASSET_ID, pageScopedUserId: 'psid-1' }],
            },
            userId: USER_ID,
            shopId: SHOP_ID,
            pageCredentials: {
                [ASSET_ID]: {
                    pageId: ASSET_ID,
                    token: PAGE_TOKEN_SENTINEL,
                    expiresAt: null,
                },
            },
        });

        await expect(
            oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook'),
        ).rejects.toMatchObject({
            status: 403,
            code: 'META_PAGE_TASKS_REQUIRED',
        });

        expect(mockUpsertFromOAuth).not.toHaveBeenCalled();
    });

    test('re-derives eligibility from normalized tasks held in the callback payload', async () => {
        stateStore.get.mockResolvedValueOnce({
            userToken: 'stored-user-token',
            platform: 'facebook',
            pages: [{
                id: ASSET_ID,
                name: 'Stored Page Name',
                tasks: [' messaging ', ' create   content '],
                connectable: false,
                reason: 'tampered-client-value',
            }],
            metaIdentity: {
                appScopedUserId: 'app-user-1',
                pageScopedIdentities: [{ pageId: ASSET_ID, pageScopedUserId: 'psid-1' }],
            },
            userId: USER_ID,
            shopId: SHOP_ID,
            pageCredentials: {
                [ASSET_ID]: {
                    pageId: ASSET_ID,
                    token: PAGE_TOKEN_SENTINEL,
                    expiresAt: null,
                },
            },
        });
        mockVerifyWebhookSubscription.mockResolvedValue({ ok: true, fields: ['messages'] });

        await oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook');

        expect(mockUpsertFromOAuth).toHaveBeenCalledWith(expect.objectContaining({
            pageAccessToken: PAGE_TOKEN_SENTINEL,
        }));
    });

    test('fails closed when the authorized Page has no server-side credential', async () => {
        stateStore.get.mockResolvedValueOnce({
            userToken: 'stored-user-token',
            platform: 'facebook',
            pages: [{
                id: ASSET_ID,
                name: 'Stored Page Name',
                tasks: ['MESSAGING', 'MANAGE'],
            }],
            metaIdentity: {
                appScopedUserId: 'app-user-1',
                pageScopedIdentities: [{ pageId: ASSET_ID, pageScopedUserId: 'psid-1' }],
            },
            userId: USER_ID,
            shopId: SHOP_ID,
            pageCredentials: {},
        });

        await expect(
            oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook'),
        ).rejects.toMatchObject({
            status: 502,
            code: 'META_PAGE_ACCESS_TOKEN_MISSING',
        });

        expect(mockUpsertFromOAuth).not.toHaveBeenCalled();
        expect(mockSubscribeWebhook).not.toHaveBeenCalled();
    });

    test('calls updateStatus(ERROR, webhook_subscription_unverified) when verify returns ok:false', async () => {
        mockVerifyWebhookSubscription.mockResolvedValue({ ok: false, fields: [] });

        await oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook');

        expect(mockUpsertFromOAuth).toHaveBeenCalledWith(expect.objectContaining({
            displayName: 'Stored Page Name',
            pageAccessToken: PAGE_TOKEN_SENTINEL,
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
        expect(mockIdentityRetire).toHaveBeenCalledWith(
            { is_current_connection: false },
            expect.objectContaining({ where: { channel_id: 'chan-1' } }),
        );
        expect(mockIdentityUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ is_current_connection: true }),
            expect.objectContaining({ transaction: expect.anything() }),
        );
    });

    test('fails closed and clears the Page token when identity persistence fails', async () => {
        mockIdentityFindOrCreate.mockRejectedValueOnce(new Error('identity database unavailable'));

        await expect(
            oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook'),
        ).rejects.toThrow('identity database unavailable');

        expect(mockDisconnect).toHaveBeenCalledWith('chan-1', {
            status: 'ERROR',
            lastError: 'meta_identity_mapping_failed',
        });
        expect(mockSubscribeWebhook).not.toHaveBeenCalled();
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

        expect(mockUpsertFromOAuth).not.toHaveBeenCalled();
    });

    test.each([
        ['different user', { userId: 'user-other', shopId: SHOP_ID }],
        ['different shop', { userId: USER_ID, shopId: 'shop-other' }],
    ])('rejects a connect attempt from a %s before reading the Page credential', async (_label, binding) => {
        stateStore.get.mockResolvedValueOnce({
            userToken: 'stored-user-token',
            platform: 'facebook',
            pages: [{ id: ASSET_ID, name: 'Stored Page Name', tasks: ['MESSAGING', 'MANAGE'] }],
            metaIdentity: {
                appScopedUserId: 'app-user-1',
                pageScopedIdentities: [{ pageId: ASSET_ID, pageScopedUserId: 'psid-1' }],
            },
            ...binding,
            pageCredentials: {
                [ASSET_ID]: { pageId: ASSET_ID, token: PAGE_TOKEN_SENTINEL, expiresAt: null },
            },
        });

        await expect(
            oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook'),
        ).rejects.toMatchObject({ status: 403 });

        expect(mockUpsertFromOAuth).not.toHaveBeenCalled();
    });

    test('uses the credential bound to the selected Page in a multi-Page callback', async () => {
        const secondPageId = 'PAGE_99';
        stateStore.get.mockResolvedValueOnce({
            userToken: 'stored-user-token',
            platform: 'facebook',
            pages: [
                { id: ASSET_ID, name: 'Page A', tasks: ['MESSAGING', 'MANAGE'] },
                { id: secondPageId, name: 'Page B', tasks: ['MESSAGING', 'MANAGE'] },
            ],
            metaIdentity: {
                appScopedUserId: 'app-user-1',
                pageScopedIdentities: [{ pageId: secondPageId, pageScopedUserId: 'psid-b' }],
            },
            userId: USER_ID,
            shopId: SHOP_ID,
            pageCredentials: {
                [ASSET_ID]: { pageId: ASSET_ID, token: PAGE_TOKEN_A, expiresAt: null },
                [secondPageId]: { pageId: secondPageId, token: PAGE_TOKEN_B, expiresAt: null },
            },
        });
        mockVerifyWebhookSubscription.mockResolvedValue({ ok: true, fields: ['messages'] });

        await oauthService.connectPage(secondPageId, 'Browser supplied name', 'user-tok', USER_ID, SHOP_ID, 'facebook');

        expect(mockUpsertFromOAuth).toHaveBeenCalledWith(expect.objectContaining({
            metaAssetId: secondPageId,
            displayName: 'Page B',
            pageAccessToken: PAGE_TOKEN_B,
        }));
        expect(mockUpsertFromOAuth).not.toHaveBeenCalledWith(expect.objectContaining({
            pageAccessToken: PAGE_TOKEN_A,
        }));
    });

    test('rejects a credential whose binding does not match the authorized Page ID', async () => {
        stateStore.get.mockResolvedValueOnce({
            userToken: 'stored-user-token',
            platform: 'facebook',
            pages: [{ id: ASSET_ID, name: 'Stored Page Name', tasks: ['MESSAGING', 'MANAGE'] }],
            metaIdentity: {
                appScopedUserId: 'app-user-1',
                pageScopedIdentities: [{ pageId: ASSET_ID, pageScopedUserId: 'psid-1' }],
            },
            userId: USER_ID,
            shopId: SHOP_ID,
            pageCredentials: {
                [ASSET_ID]: { pageId: 'PAGE_OTHER', token: PAGE_TOKEN_A, expiresAt: null },
            },
        });

        await expect(
            oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook'),
        ).rejects.toMatchObject({
            status: 502,
            code: 'META_PAGE_ACCESS_TOKEN_MISSING',
        });

        expect(mockUpsertFromOAuth).not.toHaveBeenCalled();
        expect(mockSubscribeWebhook).not.toHaveBeenCalled();
    });

    test('rejects a reconnect callback that targets a different channel or Page', async () => {
        stateStore.get.mockResolvedValueOnce({
            userToken: 'stored-user-token',
            platform: 'facebook',
            pages: [{
                id: ASSET_ID,
                name: 'Stored Page Name',
                tasks: ['MESSAGING', 'MANAGE'],
            }],
            metaIdentity: {
                appScopedUserId: 'app-user-1',
                pageScopedIdentities: [{ pageId: ASSET_ID, pageScopedUserId: 'psid-1' }],
            },
            userId: USER_ID,
            shopId: SHOP_ID,
            reconnectChannelId: 'expected-channel',
            reconnectAssetId: ASSET_ID,
        });
        mockFindByShopAndAsset.mockResolvedValueOnce({ id: 'different-channel' });

        await expect(
            oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook'),
        ).rejects.toMatchObject({
            status: 409,
            code: 'META_RECONNECT_TARGET_MISMATCH',
        });

        expect(mockUpsertFromOAuth).not.toHaveBeenCalled();
    });

    test('returns the updated unhealthy status when webhook verification fails', async () => {
        mockVerifyWebhookSubscription.mockResolvedValue({ ok: false, fields: [] });
        const unhealthyChannel = {
            id: 'chan-1',
            status: 'ERROR',
            toJSON: () => ({ id: 'chan-1', status: 'ERROR' }),
        };
        mockUpdateStatus.mockResolvedValueOnce(unhealthyChannel);

        const result = await oauthService.connectPage(ASSET_ID, 'My Page', 'user-tok', USER_ID, SHOP_ID, 'facebook');

        expect(result).toEqual(expect.objectContaining({
            status: 'ERROR',
            isHealthy: false,
            needsReconnect: true,
        }));
    });
});
