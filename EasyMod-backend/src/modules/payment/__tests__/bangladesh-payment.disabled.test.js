'use strict';

/**
 * bKash fail-closed posture (§6).
 *
 * When bKash is disabled — or enabled but not fully credentialled — no code path
 * may reach the bKash network. Every entry point throws BEFORE any HTTP call.
 */

const axios = require('axios');
jest.mock('axios');

const BangladeshPaymentService = require('../bangladesh-payment.service');
const { isBkashEnabled } = require('../bangladesh-payment.service');

const FULL_CREDS = {
    BKASH_ENABLED: 'true',
    BKASH_BASE_URL: 'https://tokenized.pay.bka.sh',
    BKASH_USERNAME: 'user',
    BKASH_PASSWORD: 'pass',
    BKASH_APP_KEY: 'app-key',
    BKASH_APP_SECRET: 'app-secret',
};

const ORIGINAL_ENV = { ...process.env };

function setEnv(vars) {
    for (const key of ['BKASH_ENABLED', 'BKASH_BASE_URL', 'BKASH_USERNAME', 'BKASH_PASSWORD', 'BKASH_APP_KEY', 'BKASH_APP_SECRET']) {
        delete process.env[key];
    }
    Object.assign(process.env, vars);
}

afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.clearAllMocks();
});

describe('isBkashEnabled', () => {
    test('false when BKASH_ENABLED is not "true"', () => {
        setEnv({ ...FULL_CREDS, BKASH_ENABLED: 'false' });
        expect(isBkashEnabled()).toBe(false);
    });

    test('false when enabled but a credential is missing', () => {
        setEnv({ ...FULL_CREDS, BKASH_APP_KEY: '' });
        expect(isBkashEnabled()).toBe(false);
    });

    test('true only when enabled AND fully credentialled', () => {
        setEnv(FULL_CREDS);
        expect(isBkashEnabled()).toBe(true);
    });
});

describe('disabled gateway never reaches the network', () => {
    beforeEach(() => setEnv({ BKASH_ENABLED: 'false' }));

    test('initializeBkashPayment throws 503 and makes no HTTP call', async () => {
        const svc = new BangladeshPaymentService();
        await expect(svc.initializeBkashPayment({ order_id: 'o1', amount: 100 }))
            .rejects.toMatchObject({ status: 503 });
        expect(axios.post).not.toHaveBeenCalled();
    });

    test('verifyBkashPayment throws 503 and makes no HTTP call', async () => {
        const svc = new BangladeshPaymentService();
        await expect(svc.verifyBkashPayment('pay-1')).rejects.toMatchObject({ status: 503 });
        expect(axios.post).not.toHaveBeenCalled();
    });

    test('refundBkashPayment throws 503 and makes no HTTP call', async () => {
        const svc = new BangladeshPaymentService();
        await expect(svc.refundBkashPayment('pay-1', 50, 'reason')).rejects.toMatchObject({ status: 503 });
        expect(axios.post).not.toHaveBeenCalled();
    });

    test('getSupportedPaymentMethods reports bKash disabled', () => {
        const svc = new BangladeshPaymentService();
        const methods = svc.getSupportedPaymentMethods();
        expect(methods.find((m) => m.method === 'bKash')?.enabled).toBe(false);
    });

    test('validatePaymentConfig reports disabled as invalid', () => {
        const svc = new BangladeshPaymentService();
        expect(svc.validatePaymentConfig().valid).toBe(false);
    });
});

describe('enabled-but-incomplete gateway also fails closed', () => {
    test('a half-configured gateway throws rather than calling bKash', async () => {
        setEnv({ ...FULL_CREDS, BKASH_APP_SECRET: '' });
        const svc = new BangladeshPaymentService();
        await expect(svc.getBkashToken()).rejects.toMatchObject({ status: 503 });
        expect(axios.post).not.toHaveBeenCalled();
    });
});
