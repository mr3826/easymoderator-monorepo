'use strict';

const { formatTelegramAlert, toPushPayload } = require('../telegram-alert.formatter');
const { NOTIFICATION_EVENTS } = require('../notification-events');

describe('telegram-alert.formatter', () => {
    const previousAppUrl = process.env.APP_URL;
    const previousFrontendUrl = process.env.FRONTEND_URL;

    beforeEach(() => {
        // getOrigins() reads APP_URL before the FRONTEND_URL alias, so stubbing
        // only the alias let an ambient APP_URL from the developer's shell
        // decide these assertions. Pin the canonical variable.
        process.env.APP_URL = 'https://app.easymod.tech';
        process.env.FRONTEND_URL = 'https://app.easymod.tech';
    });

    afterAll(() => {
        if (previousAppUrl === undefined) delete process.env.APP_URL;
        else process.env.APP_URL = previousAppUrl;
        if (previousFrontendUrl === undefined) delete process.env.FRONTEND_URL;
        else process.env.FRONTEND_URL = previousFrontendUrl;
    });

    it('formats new order alerts with a deep link', () => {
        const alert = formatTelegramAlert(NOTIFICATION_EVENTS.NEW_ORDER, {
            orderId: 'order-1',
            orderNumber: 'EM-42',
            customerName: 'Sapna',
            total: 1200,
            channel: 'messenger'
        });

        expect(alert.title).toBe('New order received');
        expect(alert.body).toContain('Order: #EM-42');
        expect(alert.body).toContain('Customer: Sapna');
        expect(alert.deepLink).toBe('https://app.easymod.tech/orders?orderId=order-1');
    });

    it('formats courier failure alerts without exposing customer messages', () => {
        const alert = formatTelegramAlert(NOTIFICATION_EVENTS.COURIER_BOOKING_FAILED, {
            orderNumber: 'EM-99',
            provider: 'pathao',
            error: 'Invalid city'
        });

        expect(alert.body).toContain('Courier: pathao');
        expect(alert.body).toContain('Invalid city');
        expect(alert.deepLink).toBe('https://app.easymod.tech/orders');
    });

    it('formats courier setup blockers with merchant-safe readiness details', () => {
        const alert = formatTelegramAlert(NOTIFICATION_EVENTS.COURIER_SETUP_REQUIRED, {
            orderId: 'order-1',
            orderNumber: 'EM-100',
            provider: 'pathao',
            missing: ['pickup_location', 'provider_store'],
            status: 'SETUP_INCOMPLETE',
            reasonCode: 'pickup_profile_required',
            customerName: 'Customer secret',
            error: 'provider token must not be exposed'
        });

        expect(alert.title).toBe('Courier setup required');
        expect(alert.body).toContain('Order: #EM-100');
        expect(alert.body).toContain('Courier: pathao');
        expect(alert.body).toContain('Missing: pickup_location, provider_store');
        expect(alert.body).toContain('Reason: pickup_profile_required');
        expect(alert.body).not.toContain('Customer secret');
        expect(alert.body).not.toContain('provider token must not be exposed');
        expect(alert.deepLink).toBe('https://app.easymod.tech/manage-shop/delivery-settings');
    });

    it('sanitizes and bounds readiness values instead of stringifying objects', () => {
        const alert = formatTelegramAlert(NOTIFICATION_EVENTS.COURIER_SETUP_REQUIRED, {
            orderNumber: 'EM-1\r\nInjected line',
            provider: 'pathao\t',
            missing: ['pickup_location\ninjected', { secret: 'token' }],
            reason: 'r'.repeat(200)
        });

        expect(alert.body).toContain('Order: #EM-1 Injected line');
        expect(alert.body).toContain('Missing: pickup_location injected');
        expect(alert.body).not.toContain('[object Object]');
        expect(alert.body).not.toContain('token');
        expect(alert.body).toContain(`Reason: ${'r'.repeat(160)}`);
        expect(alert.body).not.toContain(`Reason: ${'r'.repeat(161)}`);
    });

    it('converts an alert into a browser push payload', () => {
        const payload = toPushPayload(NOTIFICATION_EVENTS.AI_HITL, { conversationId: 'conv-1' });

        expect(payload.title).toBe('AI needs human help');
        expect(payload.icon).toBe('/icon-512.png');
        expect(payload.data.deepLink).toContain('/inbox?conversationId=conv-1');
    });
});
