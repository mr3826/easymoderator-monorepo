const express = require('express');
const request = require('supertest');

jest.mock('./payment-webhook.controller', () => ({
    handleBkashWebhook: jest.fn((_req, res) => res.status(200).json({ success: true })),
    handleOwnerPaymentConfirmation: jest.fn((_req, res) => res.status(200).json({ success: true }))
}));

jest.mock('./webhook.middleware', () => ({
    validateWebhookSignature: () => (_req, _res, next) => next()
}));

jest.mock('../entities', () => ({
    DeliveryTracking: {
        findOne: jest.fn().mockResolvedValue({
            shop_id: 'shop-1'
        })
    },
    DeliveryIntegration: {
        findOne: jest.fn().mockResolvedValue({
            credentials: { client_secret: 'secret' }
        })
    }
}));

jest.mock('../delivery/delivery-tracking.service', () => ({
    handleDeliveryWebhook: jest.fn().mockResolvedValue({
        trackingNumber: 'CN-1',
        status: 'delivered'
    })
}));

const paymentWebhookRoutes = require('./payment-webhook.routes');
const courierWebhookRoutes = require('./courier-webhook.routes');
const paymentWebhookController = require('./payment-webhook.controller');
const deliveryTrackingService = require('../delivery/delivery-tracking.service');

const buildApp = () => {
    const app = express();
    app.use('/api/webhooks', paymentWebhookRoutes);
    app.use('/api/webhooks/delivery', courierWebhookRoutes);
    return app;
};

describe('webhook route contracts', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = buildApp();
    });

    it('exposes the documented bKash payment callback route', async () => {
        await request(app)
            .post('/api/webhooks/bkash/payment-status')
            .send({ paymentID: 'pay-1' })
            .expect(200);

        expect(paymentWebhookController.handleBkashWebhook).toHaveBeenCalledTimes(1);
    });

    it('exposes canonical courier webhook routes under /api/webhooks/delivery', async () => {
        await request(app)
            .post('/api/webhooks/delivery/pathao')
            .send({ consignment_id: 'CN-1', order_status: 'delivered' })
            .expect(200);

        expect(deliveryTrackingService.handleDeliveryWebhook).toHaveBeenCalledWith(
            'pathao',
            'CN-1',
            expect.objectContaining({ status: 'delivered' })
        );
    });
});
