const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

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
            credentials: {
                api_key: 'redx-key',
                client_secret: 'secret',
                secret_key: 'secret',
            }
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
const { DeliveryIntegration } = require('../entities');

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
        const payload = JSON.stringify({ consignment_id: 'CN-1', order_status: 'delivered' });
        const signature = crypto.createHmac('sha256', 'secret').update(payload).digest('hex');
        await request(app)
            .post('/api/webhooks/delivery/pathao')
            .set('content-type', 'application/json')
            .set('x-pathao-signature', signature)
            .send(payload)
            .expect(200);

        expect(deliveryTrackingService.handleDeliveryWebhook).toHaveBeenCalledWith(
            'pathao',
            'CN-1',
            expect.objectContaining({ status: 'delivered' })
        );
    });

    it('rejects an unsigned courier status update', async () => {
        await request(app)
            .post('/api/webhooks/delivery/pathao')
            .send({ consignment_id: 'CN-1', order_status: 'delivered' })
            .expect(401);
        expect(deliveryTrackingService.handleDeliveryWebhook).not.toHaveBeenCalled();
    });

    it('rejects missing or malformed Steadfast HMAC without throwing', async () => {
        await request(app)
            .post('/api/webhooks/delivery/steadfast')
            .send({ consignment_id: 'CN-1', delivery_status: 'delivered' })
            .expect(401);
        await request(app)
            .post('/api/webhooks/delivery/steadfast')
            .set('x-steadfast-signature', '00')
            .send({ consignment_id: 'CN-1', delivery_status: 'delivered' })
            .expect(401);
        expect(deliveryTrackingService.handleDeliveryWebhook).not.toHaveBeenCalled();
    });

    it('requires the exact RedX bearer credential', async () => {
        await request(app)
            .post('/api/webhooks/delivery/redx')
            .set('authorization', 'Bearer wrong-key')
            .send({ tracking_id: 'CN-1', status: 'delivered' })
            .expect(401);
        expect(deliveryTrackingService.handleDeliveryWebhook).not.toHaveBeenCalled();

        await request(app)
            .post('/api/webhooks/delivery/redx')
            .set('authorization', 'Bearer redx-key')
            .send({ tracking_id: 'CN-1', status: 'delivered' })
            .expect(200);
    });

    it('fails closed when an active integration lacks verification credentials', async () => {
        DeliveryIntegration.findOne.mockResolvedValueOnce({ credentials: {} });
        await request(app)
            .post('/api/webhooks/delivery/pathao')
            .send({ consignment_id: 'CN-1', order_status: 'delivered' })
            .expect(503);
        expect(deliveryTrackingService.handleDeliveryWebhook).not.toHaveBeenCalled();
    });
});
