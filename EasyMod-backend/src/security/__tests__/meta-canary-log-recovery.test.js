const { parseArgs, parseRecoveryLines } = require('../../../../scripts/meta-canary-log-recovery');

const scope = {
    shopId: '458b6a78-d409-4740-9fbd-c48875d67155',
    pageId: '1362174360316889',
    from: '2026-10-13T11:33:49.000Z',
    to: '2026-10-13T12:19:54.000Z',
};

describe('Meta canary log recovery', () => {
    test('filters by event, exact shop/Page, and UTC window', () => {
        const matching = {
            message: 'metaDiscoveryCanaryFailed',
            timestamp: '2026-10-13T11:40:00.000Z',
            shopId: scope.shopId,
            expectedPageId: scope.pageId,
            correlationId: 'corr-1',
            lastGraphError: { stage: 'me_accounts', metaCode: 100, metaSubcode: 200 },
            token: 'must-not-survive',
        };
        const ignoredShop = { ...matching, shopId: 'other-shop' };
        const ignoredTime = { ...matching, timestamp: '2026-10-13T12:20:00.000Z' };
        const result = parseRecoveryLines(
            [matching, ignoredShop, ignoredTime].map((event) => `EVENT=${JSON.stringify(event)}`).join('\n'),
            scope,
        );

        expect(result).toHaveLength(1);
        expect(result[0].lastGraphError).toEqual({ stage: 'me_accounts', metaCode: 100, metaSubcode: 200 });
        expect(JSON.stringify(result[0])).not.toContain('must-not-survive');
    });

    test('allowlists nested diagnostic fields and excludes raw tokens', () => {
        const result = parseRecoveryLines(`EVENT=${JSON.stringify({
            message: 'metaDiscoveryCanaryCompleted',
            timestamp: scope.from,
            shopId: scope.shopId,
            expectedPageId: scope.pageId,
            granularScopes: { pages_messaging: { granted: 'YES', expectedPage: 'YES', access_token: 'secret' } },
            hydration: { minimal: { status: 'PASS', raw: 'secret' } },
        })}`, scope);

        expect(result[0].granularScopes.pages_messaging).toEqual({ granted: 'YES', expectedPage: 'YES' });
        expect(result[0].hydration.minimal).toEqual({ status: 'PASS' });
        expect(JSON.stringify(result)).not.toContain('secret');
    });

    test('rejects recovery windows longer than 24 hours', () => {
        expect(() => parseArgs([
            `--shop=${scope.shopId}`,
            `--page=${scope.pageId}`,
            '--from=2026-10-12T00:00:00Z',
            '--to=2026-10-13T00:00:01Z',
        ])).toThrow('no longer than 24 hours');
    });
});
