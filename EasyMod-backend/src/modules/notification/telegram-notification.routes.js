'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../../middleware/auth.middleware');
const telegramNotificationService = require('./telegram-notification.service');

const router = express.Router();

function shopIdFrom(req) {
    return req.user?.shopId || req.shopId;
}

function userIdFrom(req) {
    return req.user?.userId || req.userId;
}

function handleError(res, error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
        success: false,
        error: error.message,
        result: error.result || undefined
    });
}

router.get('/', authenticate, async (req, res) => {
    try {
        const status = await telegramNotificationService.getStatus(shopIdFrom(req));
        res.json({ success: true, data: status });
    } catch (error) {
        handleError(res, error);
    }
});

router.post('/connect-intent', authenticate, async (req, res) => {
    try {
        const data = await telegramNotificationService.createConnectIntent({
            shopId: shopIdFrom(req),
            userId: userIdFrom(req),
            req
        });
        res.status(201).json({ success: true, data });
    } catch (error) {
        handleError(res, error);
    }
});

router.post('/test', authenticate, async (req, res) => {
    try {
        const result = await telegramNotificationService.sendTest({
            shopId: shopIdFrom(req),
            userId: userIdFrom(req),
            req
        });
        res.json({ success: true, data: result });
    } catch (error) {
        handleError(res, error);
    }
});

router.patch(
    '/preferences',
    authenticate,
    [body('preferences').isObject().withMessage('preferences must be an object')],
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        try {
            const data = await telegramNotificationService.updatePreferences({
                shopId: shopIdFrom(req),
                userId: userIdFrom(req),
                preferences: req.body.preferences,
                req
            });
            res.json({ success: true, data });
        } catch (error) {
            handleError(res, error);
        }
    }
);

router.delete('/', authenticate, async (req, res) => {
    try {
        const data = await telegramNotificationService.disconnect({
            shopId: shopIdFrom(req),
            userId: userIdFrom(req),
            req
        });
        res.json({ success: true, data });
    } catch (error) {
        handleError(res, error);
    }
});

module.exports = router;
