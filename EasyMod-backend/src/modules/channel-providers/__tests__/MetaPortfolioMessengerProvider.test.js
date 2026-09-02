'use strict';

const axios = require('axios');

jest.mock('axios');

const MetaMessengerProvider = require('../providers/MetaMessengerProvider');
const MetaPortfolioMessengerProvider = require('../providers/MetaPortfolioMessengerProvider');

describe('MetaPortfolioMessengerProvider', () => {
    let provider;
    let baseListSpy;

    beforeEach(() => {
        process.env.META_APP_ID = 'test-app-id';
        process.env.META_APP_SECRET = 'test-app-secret';
        provider = new MetaPortfolioMessengerProvider();
        baseListSpy = jest.spyOn(MetaMessengerProvider.prototype, 'listManagedAssets');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.resetAllMocks();
    });

    function debugToken(messagingIds, metadataIds) {
        return {
            data: {
                data: {
                    granular_scopes: [
                        { scope: 'pages_messaging', target_ids: messagingIds },
                        { scope: 'pages_manage_metadata', target_ids: metadataIds },
                    ],
                },
            },
        };
    }

    test('merges a Business Portfolio Page with a directly managed Page', async () => {
        baseListSpy.mockResolvedValue([
            {
                id: 'P_DIRECT',
                name: 'Direct Page',
                tasks: ['MESSAGING', 'MANAGE'],
                connectable: true,
                reason: null,
            },
        ]);

        axios.get.mockImplementation((url, request = {}) => {
            if (String(url).includes('/debug_token')) {
                return Promise.resolve(debugToken(
                    ['P_DIRECT', 'P_PORTFOLIO'],
                    ['P_DIRECT', 'P_PORTFOLIO'],
                ));
            }
            if (String(url).endsWith('/P_PORTFOLIO')) {
                expect(request.params.fields).toBe('id,name,access_token');
                return Promise.resolve({
                    data: {
                        id: 'P_PORTFOLIO',
                        name: 'Portfolio Page',
                        access_token: 'portfolio-page-token',
                    },
                });
            }
            throw new Error(`unexpected URL ${url}`);
        });

        const result = await provider.listManagedAssets({ userToken: 'user-token' });

        expect(result.map((asset) => asset.id)).toEqual(['P_DIRECT', 'P_PORTFOLIO']);
        expect(result.find((asset) => asset.id === 'P_PORTFOLIO')).toMatchObject({
            name: 'Portfolio Page',
            tasks: ['MESSAGING', 'MANAGE'],
            connectable: true,
            reason: null,
        });
    });

    test('does not recover a Page unless both Messenger and metadata grants target it', async () => {
        baseListSpy.mockResolvedValue([]);
        axios.get.mockResolvedValueOnce(debugToken(['P_PORTFOLIO'], []));

        await expect(provider.listManagedAssets({ userToken: 'user-token' })).resolves.toEqual([]);

        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(axios.get.mock.calls[0][0]).toContain('/debug_token');
    });

    test('replaces a non-connectable rich hydration with verified minimal hydration', async () => {
        baseListSpy.mockResolvedValue([
            {
                id: 'P_PORTFOLIO',
                name: 'Portfolio Page',
                tasks: [],
                connectable: false,
                reason: 'META_PAGE_TASKS_REQUIRED',
            },
        ]);
        axios.get
            .mockResolvedValueOnce(debugToken(['P_PORTFOLIO'], ['P_PORTFOLIO']))
            .mockResolvedValueOnce({
                data: {
                    id: 'P_PORTFOLIO',
                    name: 'Portfolio Page',
                    access_token: 'portfolio-page-token',
                },
            });

        const result = await provider.listManagedAssets({ userToken: 'user-token' });

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: 'P_PORTFOLIO',
            connectable: true,
            tasks: ['MESSAGING', 'MANAGE'],
        });
    });

    test('preserves directly managed Pages when the portfolio fallback is unavailable', async () => {
        baseListSpy.mockResolvedValue([
            { id: 'P_DIRECT', name: 'Direct Page', connectable: true, tasks: ['MESSAGING', 'MANAGE'] },
        ]);
        axios.get.mockRejectedValueOnce({
            response: { data: { error: { code: 10, error_subcode: 200 } } },
        });

        await expect(provider.listManagedAssets({ userToken: 'user-token' })).resolves.toEqual([
            { id: 'P_DIRECT', name: 'Direct Page', connectable: true, tasks: ['MESSAGING', 'MANAGE'] },
        ]);
    });

    test('does not expose the Page access token returned by minimal hydration', async () => {
        baseListSpy.mockResolvedValue([]);
        axios.get
            .mockResolvedValueOnce(debugToken(['P_PORTFOLIO'], ['P_PORTFOLIO']))
            .mockResolvedValueOnce({
                data: {
                    id: 'P_PORTFOLIO',
                    name: 'Portfolio Page',
                    access_token: 'must-not-leak',
                },
            });

        const result = await provider.listManagedAssets({ userToken: 'user-token' });

        expect(JSON.stringify(result)).not.toContain('must-not-leak');
        expect(result[0]).not.toHaveProperty('access_token');
    });
});
