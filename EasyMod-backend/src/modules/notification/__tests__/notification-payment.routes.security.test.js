'use strict';

const express = require('express');
const request = require('supertest');

const mockOwnerNotification = { findByPk: jest.fn(), findOne: jest.fn() };
const mockUserShop = { findOne: jest.fn() };
const mockHandleOwnerResponse = jest.fn();

jest.mock('../../../middleware/auth.middleware', () => ({
    authenticate: (req, _res, next) => {
        req.user = { userId: 'owner-1', shopId: 'shop-1' };
        next();
    },
}));
jest.mock('../../entities', () => ({
    OwnerNotification: mockOwnerNotification,
    UserShop: mockUserShop,
}));
jest.mock('../owner-notification.service', () => ({
    handleOwnerResponse: mockHandleOwnerResponse,
}));
jest.mock('../notification.controller', () => ({
    markHandoff: jest.fn(),
    sendPush: jest.fn(),
}));
jest.mock('../push-subscription.routes', () => require('express').Router());
jest.mock('../telegram-notification.routes', () => require('express').Router());

const router = require('../notification.routes');
const notificationId = '11111111-1111-4111-8111-111111111111';

function app() {
    const instance = express();
    instance.use(express.json());
    instance.use(router);
    instance.use((err, _req, res, _next) => {
        res.status(err.status || 500).json({ error: err.message });
    });
    return instance;
}

describe('owner payment confirmation route authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockOwnerNotification.findByPk.mockResolvedValue({
            id: notificationId,
            shop_id: 'shop-1',
        });
        mockUserShop.findOne.mockResolvedValue({ id: 'membership-1' });
        mockHandleOwnerResponse.mockResolvedValue({ success: true });
    });

    test('rejects a notification owned by another shop', async () => {
        mockOwnerNotification.findByPk.mockResolvedValue({
            id: notificationId,
            shop_id: 'shop-2',
        });

        const response = await request(app())
            .post(`/payment-confirmation/${notificationId}/approve`);

        expect(response.status).toBe(403);
        expect(mockHandleOwnerResponse).not.toHaveBeenCalled();
    });

    test('requires an active owner membership', async () => {
        mockUserShop.findOne.mockResolvedValue(null);

        const response = await request(app())
            .post(`/payment-confirmation/${notificationId}/approve`);

        expect(response.status).toBe(403);
        expect(mockHandleOwnerResponse).not.toHaveBeenCalled();
    });

    test('rejects a forged action before mutation', async () => {
        const response = await request(app())
            .post(`/payment-confirmation/${notificationId}/refund`);

        expect(response.status).toBe(400);
        expect(mockHandleOwnerResponse).not.toHaveBeenCalled();
    });

    test('binds an allowed action to the authenticated owner and shop', async () => {
        const response = await request(app())
            .post(`/payment-confirmation/${notificationId}/approve`);

        expect(response.status).toBe(200);
        expect(mockUserShop.findOne).toHaveBeenCalledWith({
            where: {
                user_id: 'owner-1',
                shop_id: 'shop-1',
                role: 'owner',
                is_active: true,
            },
        });
        expect(mockHandleOwnerResponse).toHaveBeenCalledWith(
            notificationId,
            'approve',
            { userId: 'owner-1' },
        );
    });

    test('generic mark-read cannot complete a pending payment confirmation', async () => {
        const update = jest.fn();
        mockOwnerNotification.findOne.mockResolvedValue({
            id: notificationId,
            type: 'payment_confirmation',
            update,
        });

        const response = await request(app())
            .patch(`/in-app/${notificationId}/read`);

        expect(response.status).toBe(409);
        expect(mockOwnerNotification.findOne).toHaveBeenCalledWith({
            where: { id: notificationId, shop_id: 'shop-1' },
            attributes: ['id', 'type'],
        });
        expect(update).not.toHaveBeenCalled();
        expect(mockHandleOwnerResponse).not.toHaveBeenCalled();
    });

    test('generic mark-read still completes a non-payment notification in its shop', async () => {
        const update = jest.fn().mockResolvedValue(undefined);
        mockOwnerNotification.findOne.mockResolvedValue({
            id: notificationId,
            type: 'escalation',
            update,
        });

        const response = await request(app())
            .patch(`/in-app/${notificationId}/read`);

        expect(response.status).toBe(200);
        expect(update).toHaveBeenCalledWith({
            status: 'completed',
            responded_at: expect.any(Date),
        });
    });
});
