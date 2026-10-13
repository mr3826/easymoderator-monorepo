const {
    parseArgs,
    parseRecoveryLines,
    summarizeRecoveryOutput,
} = require('../../../../scripts/meta-canary-log-recovery');

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
        const eventField = { ...matching, message: undefined, event: 'metaDiscoveryCanaryCompleted' };
        const mixedInput = [
            'ordinary docker text',
            '{not-json',
            JSON.stringify(matching),
            `EVENT=${JSON.stringify(ignoredShop)}`,
            JSON.stringify(ignoredTime),
            `EVENT=${JSON.stringify(eventField)}`,
        ].join('\n');
        const result = parseRecoveryLines(mixedInput, scope);

        expect(result).toHaveLength(2);
        expect(result.map((event) => event.event)).toEqual(['metaDiscoveryCanaryFailed', 'metaDiscoveryCanaryCompleted']);
        expect(result[0].lastGraphError).toEqual({ stage: 'me_accounts', metaCode: 100, metaSubcode: 200 });
        expect(JSON.stringify(result)).not.toContain('must-not-survive');
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

    test('distinguishes no matches, missing containers, and extraction errors', () => {
        expect(summarizeRecoveryOutput('ORIGINAL_CONTAINER_AVAILABLE=YES\n', scope).extractionStatus)
            .toBe('NO_MATCHES');
        expect(summarizeRecoveryOutput('ORIGINAL_CONTAINER_AVAILABLE=NO\n', scope).extractionStatus)
            .toBe('NO_CONTAINER');
        expect(summarizeRecoveryOutput('ORIGINAL_CONTAINER_AVAILABLE=YES\nLOG_READ_ERROR=easymod-backend-1\n', scope))
            .toMatchObject({ extractionStatus: 'PARTIAL', logReadErrorCount: 1 });
        expect(summarizeRecoveryOutput('CONTAINER_DISCOVERY_ERROR=DOCKER_PS_FAILED\n', scope).extractionStatus)
            .toBe('ERROR');
    });
});
