'use strict';

const express = require('express');
const telegramNotificationService = require('../notification/telegram-notification.service');

const router = express.Router();

router.post('/', async (req, res) => {
    try {
        const result = await telegramNotificationService.handleTelegramUpdate(req.body, {
            secretToken: req.get('x-telegram-bot-api-secret-token')
        });
        res.json({ ok: true, result });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            ok: false,
            error: error.statusCode === 401 ? 'unauthorized' : 'telegram_webhook_failed'
        });
    }
});

module.exports = router;
