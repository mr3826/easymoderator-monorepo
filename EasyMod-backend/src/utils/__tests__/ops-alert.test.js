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
