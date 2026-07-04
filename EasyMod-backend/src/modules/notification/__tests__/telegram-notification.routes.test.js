'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../../middleware/auth.middleware', () => ({
    authenticate: (req, _res, next) => {
        req.user = { userId: 'user-1', shopId: 'shop-1' };
        next();
    }
}));

jest.mock('../telegram-notification.service', () => ({
    getStatus: jest.fn().mockResolvedValue({ status: 'disconnected' }),
    createConnectIntent: jest.fn().mockResolvedValue({ status: 'pending', pendingCommand: '/easymod_connect token' }),
    sendTest: jest.fn().mockResolvedValue({ sent: true }),
    updatePreferences: jest.fn().mockResolvedValue({ status: 'connected', preferences: { new_order: false } }),
    disconnect: jest.fn().mockResolvedValue({ disconnected: true, status: { status: 'disconnected' } })
}));

const telegramService = require('../telegram-notification.service');
const router = require('../telegram-notification.routes');

describe('telegram-notification.routes', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = express();
        app.use(express.json());
        app.use('/api/notifications/telegram', router);
    });

    it('returns Telegram status for the authenticated shop', async () => {
        const res = await request(app).get('/api/notifications/telegram');

        expect(res.status).toBe(200);
        expect(telegramService.getStatus).toHaveBeenCalledWith('shop-1');
    });

    it('creates connect intent for the authenticated shop', async () => {
        const res = await request(app).post('/api/notifications/telegram/connect-intent').send({});

        expect(res.status).toBe(201);
        expect(res.body.data.pendingCommand).toContain('/easymod_connect');
        expect(telegramService.createConnectIntent).toHaveBeenCalledWith(expect.objectContaining({
            shopId: 'shop-1',
            userId: 'user-1'
        }));
    });

    it('updates preferences through validation', async () => {
        const res = await request(app)
            .patch('/api/notifications/telegram/preferences')
            .send({ preferences: { new_order: false } });

        expect(res.status).toBe(200);
        expect(telegramService.updatePreferences).toHaveBeenCalledWith(expect.objectContaining({
            shopId: 'shop-1',
            preferences: { new_order: false }
        }));
    });

    it('rejects invalid preference payloads', async () => {
        const res = await request(app)
            .patch('/api/notifications/telegram/preferences')
            .send({ preferences: 'bad' });

        expect(res.status).toBe(400);
    });

    it('sends test alert and disconnects', async () => {
        const testRes = await request(app).post('/api/notifications/telegram/test').send({});
        const disconnectRes = await request(app).delete('/api/notifications/telegram');

        expect(testRes.status).toBe(200);
        expect(disconnectRes.status).toBe(200);
        expect(telegramService.sendTest).toHaveBeenCalledWith(expect.objectContaining({ shopId: 'shop-1' }));
        expect(telegramService.disconnect).toHaveBeenCalledWith(expect.objectContaining({ shopId: 'shop-1' }));
    });
});
