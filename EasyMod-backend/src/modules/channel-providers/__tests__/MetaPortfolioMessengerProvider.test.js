'use strict';

const axios = require('axios');
const config = require('../../../config/config');

jest.mock('axios');

const MetaMessengerProvider = require('../providers/MetaMessengerProvider');
const MetaPortfolioMessengerProvider = require('../providers/MetaPortfolioMessengerProvider');

describe('MetaPortfolioMessengerProvider', () => {
    let provider;
    let baseListSpy;

    beforeEach(() => {
        process.env.META_APP_ID = 'test-app-id';
        process.env.META_APP_SECRET = 'test-app-secret';
        config.metaAppId = 'test-app-id';
        config.metaAppSecret = 'test-app-secret';
        provider = new MetaPortfolioMessengerProvider();
        baseListSpy = jest.spyOn(MetaMessengerProvider.prototype, 'listManagedAssets');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.resetAllMocks();
    });

    function debugToken(messagingIds, metadataIds, showListIds = messagingIds) {
        const entry = (scope, targetIds) => ({
            scope,
            ...(targetIds === undefined ? {} : { target_ids: targetIds }),
        });
        return {
            data: {
                data: {
                    is_valid: true,
                    app_id: 'test-app-id',
                    scopes: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'],
                    granular_scopes: [
                        entry('pages_messaging', messagingIds),
                        entry('pages_manage_metadata', metadataIds),
                        entry('pages_show_list', showListIds),
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
            tasks: [],
            connectable: true,
            reason: null,
            eligibilitySource: 'GRANULAR_PERMISSIONS',
            taskAvailability: 'UNAVAILABLE',
        });
    });

    test('preserves Pages from the base discovery when both required grants are ALL', async () => {
        const basePage = { id: 'P_ALL', name: 'All Pages result', connectable: true, tasks: ['MESSAGING', 'MANAGE'] };
        baseListSpy.mockResolvedValue([basePage]);
        axios.get.mockResolvedValueOnce(debugToken(undefined, undefined, undefined));

        await expect(provider.listManagedAssets({ userToken: 'user-token' })).resolves.toEqual([basePage]);
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['ALL + EXPLICIT', undefined, ['P_EXPLICIT']],
        ['EXPLICIT + ALL', ['P_EXPLICIT'], undefined],
    ])('recovers the intersection for %s without broadening it', async (_label, messagingIds, metadataIds) => {
        baseListSpy.mockResolvedValue([]);
        axios.get
            .mockResolvedValueOnce(debugToken(messagingIds, metadataIds, undefined))
            .mockResolvedValueOnce({
                data: {
                    id: 'P_EXPLICIT',
                    name: 'Explicit Page',
                    access_token: 'explicit-page-token',
                },
            });

        const result = await provider.listManagedAssets({ userToken: 'user-token' });

        expect(result).toEqual([expect.objectContaining({
            id: 'P_EXPLICIT',
            connectable: true,
            eligibilitySource: 'GRANULAR_PERMISSIONS',
            taskAvailability: 'UNAVAILABLE',
        })]);
        expect(axios.get.mock.calls[1][1].params.fields).toBe('id,name,access_token');
    });

    test('retains minimal-hydration credentials in the server-only sink', async () => {
        const pageCredentials = Object.create(null);
        baseListSpy.mockResolvedValue([]);
        axios.get
            .mockResolvedValueOnce(debugToken(['P_PORTFOLIO'], ['P_PORTFOLIO']))
            .mockResolvedValueOnce({
                data: {
                    id: 'P_PORTFOLIO',
                    name: 'Portfolio Page',
                    access_token: 'PAGE_SECRET_SENTINEL_PORTFOLIO',
                },
            });

        const result = await provider.listManagedAssets({ userToken: 'user-token', pageCredentials });

        expect(result[0]).not.toHaveProperty('access_token');
        expect(JSON.stringify(result)).not.toContain('PAGE_SECRET_SENTINEL_PORTFOLIO');
        expect(pageCredentials).toEqual({
            P_PORTFOLIO: {
                pageId: 'P_PORTFOLIO',
                token: 'PAGE_SECRET_SENTINEL_PORTFOLIO',
                expiresAt: null,
            },
        });
    });

    test('does not recover a Page unless both Messenger and metadata grants target it', async () => {
        baseListSpy.mockResolvedValue([]);
        axios.get.mockResolvedValueOnce(debugToken(['P_PORTFOLIO'], []));

        await expect(provider.listManagedAssets({ userToken: 'user-token' })).resolves.toEqual([]);

        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(axios.get.mock.calls[0][0]).toContain('/debug_token');
    });

    test('fails closed when pages_manage_metadata is absent from verified scopes', async () => {
        baseListSpy.mockResolvedValue([]);
        axios.get.mockResolvedValueOnce({
            data: {
                data: {
                    is_valid: true,
                    app_id: 'test-app-id',
                    scopes: ['pages_show_list', 'pages_messaging'],
                    granular_scopes: [
                        { scope: 'pages_show_list' },
                        { scope: 'pages_messaging' },
                    ],
                },
            },
        });

        await expect(provider.listManagedAssets({ userToken: 'user-token' })).resolves.toEqual([]);
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('does not replace explicitly insufficient Page tasks with minimal hydration', async () => {
        baseListSpy.mockResolvedValue([
            {
                id: 'P_PORTFOLIO',
                name: 'Portfolio Page',
                tasks: ['CREATE_CONTENT'],
                connectable: false,
                reason: 'META_PAGE_TASKS_REQUIRED',
                eligibilitySource: 'META_TASKS',
                taskAvailability: 'PRESENT',
            },
        ]);
        axios.get.mockResolvedValueOnce(debugToken(['P_PORTFOLIO'], ['P_PORTFOLIO']));

        const result = await provider.listManagedAssets({ userToken: 'user-token' });

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            id: 'P_PORTFOLIO',
            connectable: false,
            tasks: ['CREATE_CONTENT'],
            eligibilitySource: 'META_TASKS',
            taskAvailability: 'PRESENT',
        });
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('preserves directly managed Pages when the portfolio fallback is unavailable', async () => {
        baseListSpy.mockResolvedValue([
            { id: 'P_DIRECT', name: 'Direct Page', connectable: true, tasks: ['MESSAGING', 'MANAGE'] },
        ]);
        const networkError = new Error('temporary network failure');
        networkError.code = 'ECONNRESET';
        axios.get.mockRejectedValueOnce(networkError);

        await expect(provider.listManagedAssets({ userToken: 'user-token' })).resolves.toEqual([
            { id: 'P_DIRECT', name: 'Direct Page', connectable: true, tasks: ['MESSAGING', 'MANAGE'] },
        ]);
    });

    test('fails closed when the strict grant probe returns an authentication error', async () => {
        baseListSpy.mockResolvedValue([
            { id: 'P_DIRECT', name: 'Direct Page', connectable: true, tasks: ['MESSAGING', 'MANAGE'] },
        ]);
        axios.get.mockRejectedValueOnce({
            response: { status: 400, data: { error: { code: 190, error_subcode: 463, message: 'Invalid OAuth access token' } } },
        });

        await expect(provider.listManagedAssets({ userToken: 'user-token' })).resolves.toEqual([]);
    });

    test('filters base assets through a later narrowed strict grant', async () => {
        baseListSpy.mockResolvedValue([
            { id: 'P_ALLOWED', name: 'Allowed', connectable: true, tasks: ['MESSAGING', 'MANAGE'] },
            { id: 'P_REVOKED', name: 'Revoked', connectable: true, tasks: ['MESSAGING', 'MANAGE'] },
        ]);
        axios.get.mockResolvedValueOnce(debugToken(['P_ALLOWED'], ['P_ALLOWED'], ['P_ALLOWED']));

        await expect(provider.listManagedAssets({ userToken: 'user-token' })).resolves.toEqual([
            { id: 'P_ALLOWED', name: 'Allowed', connectable: true, tasks: ['MESSAGING', 'MANAGE'] },
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
