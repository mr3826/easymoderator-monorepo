'use strict';

/**
 * Tests for the ops-alert fan-out + throttle. Slack is mocked via global.fetch;
 * Sentry via the sentry config module. Throttle state is per-module, so we
 * reset modules between tests for a clean window.
 */

describe('opsAlert', () => {
    let opsAlert;
    let mockSentry;

    beforeEach(() => {
        jest.resetModules();
        mockSentry = jest.fn();
        jest.doMock('src/config/sentry', () => ({ sentryCaptureMessage: mockSentry }));
        global.fetch = jest.fn().mockResolvedValue({ ok: true });
        process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.example/x';
        ({ opsAlert } = require('src/utils/ops-alert'));
    });

    afterEach(() => {
        delete process.env.SLACK_ALERT_WEBHOOK_URL;
    });

    test('fans out to both Slack and Sentry on first call', async () => {
        await opsAlert('Alert A', { detail: 'something broke', level: 'error' });
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(mockSentry).toHaveBeenCalledTimes(1);
        expect(mockSentry.mock.calls[0][0]).toBe('[OPS] Alert A');
    });

    test('throttles repeat alerts of the same title within the window', async () => {
        await opsAlert('Same Title', {});
        await opsAlert('Same Title', {});
        await opsAlert('Same Title', {});
        // First fans out; the next two are suppressed at the external sinks.
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(mockSentry).toHaveBeenCalledTimes(1);
    });

    test('distinct titles are not throttled against each other', async () => {
        await opsAlert('Title One', {});
        await opsAlert('Title Two', {});
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('no Slack URL → no fetch, but Sentry still fires (sinks independent)', async () => {
        delete process.env.SLACK_ALERT_WEBHOOK_URL;
        await opsAlert('No Slack', {});
        expect(global.fetch).not.toHaveBeenCalled();
        expect(mockSentry).toHaveBeenCalledTimes(1);
    });

    test('a failing Slack sink never throws into the caller', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
        await expect(opsAlert('Resilient', {})).resolves.toBeUndefined();
    });
});

describe('describeAlertSinks / sendTestAlert (F-06)', () => {
    let ops;
    let mockSentry;

    beforeEach(() => {
        jest.resetModules();
        mockSentry = jest.fn();
        jest.doMock('src/config/sentry', () => ({ sentryCaptureMessage: mockSentry }));
        global.fetch = jest.fn().mockResolvedValue({ ok: true });
        delete process.env.SLACK_ALERT_WEBHOOK_URL;
        delete process.env.SENTRY_DSN;
        ops = require('src/utils/ops-alert');
    });

    afterEach(() => {
        delete process.env.SLACK_ALERT_WEBHOOK_URL;
        delete process.env.SENTRY_DSN;
    });

    test('describeAlertSinks reports booleans only — never the URL or DSN', () => {
        process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.example/secret-path';
        process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/1';
        const sinks = ops.describeAlertSinks();
        expect(sinks).toEqual({ slackConfigured: true, sentryConfigured: true });
        expect(JSON.stringify(sinks)).not.toContain('secret-path');
    });

    test('no sink configured → anySinkConfigured false and nothing sent', async () => {
        const result = await ops.sendTestAlert({ actorLabel: 'admin:1' });
        expect(result.anySinkConfigured).toBe(false);
        expect(result.slackAccepted).toBe(false);
        expect(result.sentryAttempted).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('Slack configured → posts and reports acceptance', async () => {
        process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.example/x';
        const result = await ops.sendTestAlert({ actorLabel: 'admin:1' });
        expect(result.slackConfigured).toBe(true);
        expect(result.slackAccepted).toBe(true);
        expect(result.anySinkConfigured).toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('test alert carries no customer data', async () => {
        process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.example/x';
        await ops.sendTestAlert({ actorLabel: 'admin:42' });
        const body = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(body.text).toContain('No customer data');
    });

    test('test alert bypasses the throttle (two calls, two sends)', async () => {
        process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.example/x';
        await ops.sendTestAlert({ actorLabel: 'admin:1' });
        await ops.sendTestAlert({ actorLabel: 'admin:1' });
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });
});
