'use strict';

const axios = require('axios');
const config = require('../../../config/config');
const MetaMessengerProvider = require('../providers/MetaMessengerProvider');
const { createDiagnostics } = require('../meta-discovery-canary');

jest.mock('axios');

describe('MetaMessengerProvider shop-scoped discovery diagnostics', () => {
    const provider = new MetaMessengerProvider();
    const diagnostics = () => createDiagnostics({
        correlationId: 'correlation-1',
        expectedPageId: '1362174360316889',
        expiresAt: '2026-10-12T20:30:00.000Z',
        initiateRequestId: null,
        callbackRequestId: '22222222-2222-4222-8222-222222222222',
    });

    beforeEach(() => {
        config.metaAppId = 'test-app-id';
        config.metaAppSecret = 'test-app-secret';
        jest.clearAllMocks();
    });

    test('records sanitized token, granular grant, /me/accounts, task and callback evidence on success', async () => {
        const canary = diagnostics();
        axios.get
            .mockResolvedValueOnce({
                status: 200,
                data: {
                    data: {
                        is_valid: true,
                        app_id: 'test-app-id',
                        expires_at: Math.floor(Date.now() / 1000) + 3600,
                        scopes: ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'],
                        granular_scopes: [
                            { scope: 'pages_show_list', target_ids: ['1362174360316889'] },
                            { scope: 'pages_messaging', target_ids: ['1362174360316889'] },
                            { scope: 'pages_manage_metadata', target_ids: ['1362174360316889'] },
                        ],
                    },
                },
            })
            .mockResolvedValueOnce({
                status: 200,
                data: {
                    data: [{
                        id: '1362174360316889',
                        name: 'Kutir Fashion',
                        tasks: ['MESSAGING', 'MANAGE'],
                        access_token: 'PAGE_TOKEN_SENTINEL',
                    }],
                    paging: {},
                },
            });

        const pageCredentials = {};
        const result = await provider.listManagedAssets({
            userToken: 'USER_TOKEN_SENTINEL',
            pageCredentials,
            diagnostics: canary,
        });

        expect(result).toHaveLength(1);
        expect(canary.tokenValid).toBe('YES');
        expect(canary.tokenAppIdMatches).toBe('YES');
        expect(canary.granularScopes.pages_messaging.expectedPage).toBe('YES');
        expect(canary.meAccounts.rich).toMatchObject({
            status: 'PASS',
            pageCount: 1,
            expectedPage: 'YES',
            expectedPageToken: 'YES',
            paginationCompleted: 'YES',
        });
        expect(canary.expectedPageTasks).toEqual(['MESSAGING', 'MANAGE']);
        expect(canary.expectedPageEligible).toBe('YES');
        expect(JSON.stringify(canary)).not.toContain('USER_TOKEN_SENTINEL');
        expect(JSON.stringify(canary)).not.toContain('PAGE_TOKEN_SENTINEL');
    });

    test('records rich and minimal hydration outcomes but keeps a rich failure fail-closed', async () => {
        const canary = diagnostics();
        axios.get
            .mockResolvedValueOnce({
                status: 200,
                data: {
                    data: {
                        is_valid: true,
                        app_id: 'test-app-id',
                        granular_scopes: [{ scope: 'pages_messaging', target_ids: ['1362174360316889'] }],
                    },
                },
            })
            .mockResolvedValueOnce({
                status: 200,
                data: { data: [], paging: {} },
            })
            .mockRejectedValueOnce({
                response: { status: 400, data: { error: { code: 100, error_subcode: 33 } } },
            })
            .mockResolvedValueOnce({
                status: 200,
                data: { id: '1362174360316889', name: 'Kutir Fashion', access_token: 'PAGE_TOKEN_SENTINEL' },
            });

        const pageCredentials = {};
        const result = await provider.listManagedAssets({
            userToken: 'USER_TOKEN_SENTINEL',
            pageCredentials,
            diagnostics: canary,
        });

        expect(result).toEqual([]);
        expect(canary.meAccounts.rich.expectedPage).toBe('NO');
        expect(canary.hydration).toMatchObject({
            rich: { status: 'FAIL' },
            minimal: { status: 'PASS', expectedPageToken: 'YES' },
        });
        expect(pageCredentials).toEqual({});
    });

    test('returns the unchanged production error contract when diagnostics are disabled', async () => {
        axios.get.mockRejectedValueOnce({
            response: { status: 400, data: { error: { code: 190, error_subcode: 463, message: 'expired' } } },
        });

        await expect(provider.listManagedAssets({
            userToken: 'USER_TOKEN_SENTINEL',
            pageCredentials: {},
        })).rejects.toMatchObject({
            code: 'META_API_ERROR',
            status: 400,
        });
    });

    test('returns a sanitized 502 and preserves only numeric Graph details for the canary', async () => {
        const canary = diagnostics();
        axios.get.mockRejectedValueOnce({
            response: {
                status: 400,
                data: {
                    error: {
                        code: 190,
                        error_subcode: 463,
                        message: 'token must not reach diagnostics',
                    },
                },
            },
        });

        const error = await provider.listManagedAssets({
            userToken: 'USER_TOKEN_SENTINEL',
            pageCredentials: {},
            diagnostics: canary,
        }).catch((caught) => caught);
        expect(error).toMatchObject({
            status: 502,
            code: 'META_PAGE_DISCOVERY_FAILED',
            details: { metaCode: 190, metaSubcode: 463 },
        });
        expect(error.toJSON('22222222-2222-4222-8222-222222222222')).toMatchObject({
            code: 'META_PAGE_DISCOVERY_FAILED',
            requestId: '22222222-2222-4222-8222-222222222222',
            details: { metaCode: 190, metaSubcode: 463 },
        });
        expect(JSON.stringify(canary)).not.toContain('token must not reach diagnostics');
        expect(canary.lastGraphError).toMatchObject({
            stage: 'debug_token',
            httpStatus: 400,
            metaCode: 190,
            metaSubcode: 463,
        });
    });

    test('does not log or return an OAuth code when canary exchange fails', async () => {
        const canary = diagnostics();
        axios.get.mockRejectedValueOnce({
            response: {
                status: 400,
                data: { error: { code: 100, error_subcode: 2, message: 'OAUTH_CODE_SENTINEL' } },
            },
        });

        const error = await provider.exchangeCode({
            code: 'OAUTH_CODE_SENTINEL',
            redirectUri: 'https://app.easymod.tech/channels/oauth-callback',
            diagnostics: canary,
        }).catch((caught) => caught);

        expect(error).toMatchObject({ status: 502, code: 'META_PAGE_DISCOVERY_FAILED' });
        expect(JSON.stringify(canary)).not.toContain('OAUTH_CODE_SENTINEL');
        expect(error.message).not.toContain('OAUTH_CODE_SENTINEL');
    });
});
