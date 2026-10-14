'use strict';

const {
    PAGE_GRANT_MODE,
    interpretPageGrant,
    interpretPageGrants,
    intersectPageGrants,
    grantAllowsPage,
} = require('../meta-page-grants');

const APP_ID = 'test-app-id';

function debugData({ scopes = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'], granularScopes }) {
    return {
        is_valid: true,
        app_id: APP_ID,
        scopes,
        granular_scopes: granularScopes,
    };
}

describe('Meta Page grant interpretation', () => {
    test('represents omitted target_ids as a verified ALL grant', () => {
        const grant = interpretPageGrant(debugData({
            granularScopes: [{ scope: 'pages_messaging' }],
        }), 'pages_messaging', { expectedAppId: APP_ID });

        expect(grant).toMatchObject({ mode: PAGE_GRANT_MODE.ALL, reason: null });
        expect(grant.pageIds).toEqual(new Set());
        expect(grantAllowsPage(grant, 'P1')).toBe(true);
    });

    test('represents nonempty target_ids as EXPLICIT', () => {
        const grant = interpretPageGrant(debugData({
            granularScopes: [{ scope: 'pages_messaging', target_ids: ['P1', 2] }],
        }), 'pages_messaging', { expectedAppId: APP_ID });

        expect(grant.mode).toBe(PAGE_GRANT_MODE.EXPLICIT);
        expect(grant.pageIds).toEqual(new Set(['P1', '2']));
        expect(grantAllowsPage(grant, 'P1')).toBe(true);
        expect(grantAllowsPage(grant, 'P2')).toBe(false);
    });

    test.each([
        ['missing scope', { scopes: ['pages_show_list'], granularScopes: [] }, PAGE_GRANT_MODE.NONE],
        ['missing granular entry', { granularScopes: [{ scope: 'pages_show_list' }] }, PAGE_GRANT_MODE.UNKNOWN],
        ['empty target list', { granularScopes: [{ scope: 'pages_messaging', target_ids: [] }] }, PAGE_GRANT_MODE.UNKNOWN],
        ['null target list', { granularScopes: [{ scope: 'pages_messaging', target_ids: null }] }, PAGE_GRANT_MODE.UNKNOWN],
        ['malformed target list', { granularScopes: [{ scope: 'pages_messaging', target_ids: [{}] }] }, PAGE_GRANT_MODE.UNKNOWN],
        ['invalid token', { is_valid: false, granularScopes: [{ scope: 'pages_messaging' }] }, PAGE_GRANT_MODE.UNKNOWN],
        ['wrong app', { app_id: 'another-app', granularScopes: [{ scope: 'pages_messaging' }] }, PAGE_GRANT_MODE.UNKNOWN],
    ])('fails closed for %s', (_label, overrides, expectedMode) => {
        const grant = interpretPageGrant({
            ...debugData(overrides),
            ...overrides,
        }, 'pages_messaging', { expectedAppId: APP_ID });

        expect(grant.mode).toBe(expectedMode);
        expect(grantAllowsPage(grant, 'P1')).toBe(false);
    });

    test.each([
        ['EXPLICIT + EXPLICIT', ['P1'], ['P1'], PAGE_GRANT_MODE.EXPLICIT, ['P1']],
        ['EXPLICIT + disjoint EXPLICIT', ['P1'], ['P2'], PAGE_GRANT_MODE.EXPLICIT, []],
        ['ALL + EXPLICIT', undefined, ['P1'], PAGE_GRANT_MODE.EXPLICIT, ['P1']],
        ['EXPLICIT + ALL', ['P1'], undefined, PAGE_GRANT_MODE.EXPLICIT, ['P1']],
        ['ALL + ALL', undefined, undefined, PAGE_GRANT_MODE.ALL, []],
    ])('combines %s safely', (_label, leftIds, rightIds, expectedMode, expectedIds) => {
        const left = interpretPageGrant(debugData({
            granularScopes: [{ scope: 'pages_messaging', ...(leftIds === undefined ? {} : { target_ids: leftIds }) }],
        }), 'pages_messaging', { expectedAppId: APP_ID });
        const right = interpretPageGrant(debugData({
            granularScopes: [{ scope: 'pages_manage_metadata', ...(rightIds === undefined ? {} : { target_ids: rightIds }) }],
        }), 'pages_manage_metadata', { expectedAppId: APP_ID });

        const combined = intersectPageGrants(left, right);
        expect(combined.mode).toBe(expectedMode);
        expect(combined.pageIds).toEqual(new Set(expectedIds));
    });

    test('does not treat a successful listing as permission evidence', () => {
        const grants = interpretPageGrants(debugData({
            granularScopes: [
                { scope: 'pages_show_list' },
                { scope: 'pages_messaging' },
                { scope: 'pages_manage_metadata' },
            ],
        }), APP_ID);

        expect(grants.pages_show_list.mode).toBe(PAGE_GRANT_MODE.ALL);
        expect(grants.pages_messaging.mode).toBe(PAGE_GRANT_MODE.ALL);
        expect(grants.pages_manage_metadata.mode).toBe(PAGE_GRANT_MODE.ALL);
    });
});
