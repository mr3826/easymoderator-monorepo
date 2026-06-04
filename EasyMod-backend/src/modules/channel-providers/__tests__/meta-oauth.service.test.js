'use strict';

// Capture the scopes passed into buildAuthUrl by stubbing the provider registry.
const mockBuildAuthUrl = jest.fn().mockResolvedValue('https://www.facebook.com/v22.0/dialog/oauth?scope=stub');

jest.mock('../provider.registry', () => ({
    getProvider: () => ({
        buildAuthUrl: mockBuildAuthUrl,
        exchangeCode: jest.fn(),
        listManagedAssets: jest.fn().mockResolvedValue([]),
        getAssetAccessToken: jest.fn(),
        subscribeWebhook: jest.fn(),
    }),
}));
jest.mock('../meta-channel.service', () => ({ upsertFromOAuth: jest.fn() }));

const oauthService = require('../meta-oauth.service');

describe('initiateUnifiedOAuth scopes', () => {
    beforeEach(() => mockBuildAuthUrl.mockClear());

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
