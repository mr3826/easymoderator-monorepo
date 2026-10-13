'use strict';

const { runProgressiveProbe } = require('../meta-page-discovery-probe');

const APP_ID = 'test-app-id';
const PAGE_ID = 'test-page-id';
const BUSINESS_ID = 'test-business-id';

function response(data, status = 200) {
    return { data, status };
}

function errorResponse(code, subcode = null, fbtraceId = 'trace-123') {
    const error = new Error('sanitized test error');
    error.response = {
        status: 400,
        data: {
            error: {
                code,
                error_subcode: subcode,
                fbtrace_id: fbtraceId,
                type: 'OAuthException',
                message: 'Unsupported get request.',
            },
        },
    };
    return error;
}

describe('progressive Meta Page discovery probe', () => {
    test('runs the A/B probe sequence without exposing response values', async () => {
        const request = jest.fn(async (url, options) => {
            const fields = options?.params?.fields;
            if (url.endsWith('/debug_token')) {
                return response({
                    data: {
                        is_valid: true,
                        app_id: APP_ID,
                        type: 'USER',
                        scopes: [
                            'business_management',
                            'pages_manage_metadata',
                            'pages_messaging',
                            'pages_show_list',
                        ],
                        granular_scopes: [
                            { scope: 'pages_messaging', target_ids: [PAGE_ID] },
                            { scope: 'pages_manage_metadata', target_ids: [PAGE_ID] },
                            { scope: 'pages_show_list', target_ids: [PAGE_ID] },
                        ],
                    },
                });
            }
            if (url.endsWith('/me/accounts')) {
                const page = { id: PAGE_ID, name: 'Organic Plus' };
                if (fields.includes('access_token')) page.access_token = 'page-token-not-returned';
                if (fields.includes('tasks')) page.tasks = ['MESSAGING', 'MANAGE'];
                return response({ data: [page] });
            }
            if (url.endsWith(`/${BUSINESS_ID}/owned_pages`)) {
                return response({ data: [{ id: PAGE_ID, name: 'Organic Plus' }] });
            }
            if (url.endsWith(`/${PAGE_ID}`)) {
                const page = { id: PAGE_ID, name: 'Organic Plus' };
                if (fields.includes('access_token')) page.access_token = 'page-token-not-returned';
                if (fields.includes('tasks')) page.tasks = ['MESSAGING', 'MANAGE'];
                return response(page);
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const result = await runProgressiveProbe({
            request,
            graphBase: 'https://graph.test/v22.0',
            userToken: 'user-token-not-returned',
            appId: APP_ID,
            appSecret: 'app-secret-not-returned',
            expectedPageId: PAGE_ID,
            businessId: BUSINESS_ID,
            configuration: 'B',
        });

        expect(result.status).toBe('PASS');
        expect(result.debugToken).toMatchObject({
            tokenValid: 'YES',
            tokenAppIdMatches: 'YES',
            tokenType: 'USER',
            businessManagementGranted: 'YES',
        });
        expect(result.debugToken.granularTargets.pages_messaging.expectedPage).toBe('YES');
        expect(result.probes.meAccountsMinimal.expectedPageVisible).toBe('YES');
        expect(result.probes.meAccountsMinimal.pageTokenAvailable).toBe('NOT_REQUESTED');
        expect(result.probes.meAccountsWithPageToken.pageTokenAvailable).toBe('YES');
        expect(result.probes.directRich.tasks).toEqual(['MANAGE', 'MESSAGING']);
        expect(result.probes.businessOwnedPages.expectedPageVisible).toBe('YES');
        expect(request).toHaveBeenCalledTimes(8);
    });

    test('records Graph error 100 safely and skips Business discovery without a grant', async () => {
        const request = jest.fn(async (url, options) => {
            if (url.endsWith('/debug_token')) {
                return response({
                    data: {
                        is_valid: true,
                        app_id: APP_ID,
                        type: 'USER',
                        scopes: ['pages_manage_metadata', 'pages_messaging', 'pages_show_list'],
                        granular_scopes: [
                            { scope: 'pages_messaging', target_ids: [PAGE_ID] },
                            { scope: 'pages_manage_metadata', target_ids: [PAGE_ID] },
                        ],
                    },
                });
            }
            if (url.endsWith('/me/accounts')) return response({ data: [] });
            if (url.endsWith(`/${PAGE_ID}`)) throw errorResponse(100, 33);
            throw new Error(`Unexpected URL: ${url}`);
        });

        const result = await runProgressiveProbe({
            request,
            graphBase: 'https://graph.test/v22.0',
            userToken: 'user-token-not-returned',
            appId: APP_ID,
            appSecret: 'app-secret-not-returned',
            expectedPageId: PAGE_ID,
            businessId: BUSINESS_ID,
            configuration: 'A',
        });

        expect(result.status).toBe('FAIL');
        expect(result.probes.meAccountsMinimal.expectedPageVisible).toBe('NO');
        expect(result.probes.directMinimal.graphError).toMatchObject({
            code: 100,
            subcode: 33,
            classification: 'INVALID_PARAMETER_OR_REQUEST',
            type: 'OAuthException',
            message: 'Unsupported get request.',
        });
        expect(result.probes.businessOwnedPages).toEqual({
            status: 'SKIPPED',
            reason: 'BUSINESS_MANAGEMENT_NOT_GRANTED',
        });
        expect(JSON.stringify(result)).not.toContain('user-token-not-returned');
        expect(JSON.stringify(result)).not.toContain('app-secret-not-returned');
    });

    test('continues endpoint probes when debug_token itself fails', async () => {
        const request = jest.fn(async (url) => {
            throw url.endsWith('/debug_token')
                ? errorResponse(190, null, 'trace-debug-190')
                : errorResponse(100, null, 'trace-probe-100');
        });

        const result = await runProgressiveProbe({
            request,
            graphBase: 'https://graph.test/v22.0',
            userToken: 'user-token-not-returned',
            appId: APP_ID,
            appSecret: 'app-secret-not-returned',
            expectedPageId: PAGE_ID,
            businessId: BUSINESS_ID,
            configuration: 'A',
        });

        expect(result.status).toBe('FAIL');
        expect(result.debugToken.graphError).toMatchObject({
            code: 190,
            classification: 'INVALID_OR_EXPIRED_TOKEN',
        });
        expect(result.probes.meAccountsMinimal).toBeDefined();
        expect(result.probes.directMinimal).toBeDefined();
    });
});
