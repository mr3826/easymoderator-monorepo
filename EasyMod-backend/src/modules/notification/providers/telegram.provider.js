'use strict';

const axios = require('axios');
const { createLogger } = require('../../../utils/structured-logger');

const logger = createLogger('TelegramNotificationProvider');

function botToken() {
    return process.env.TELEGRAM_BOT_TOKEN;
}

function botUsername() {
    return (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
}

function isConfigured() {
    return Boolean(botToken());
}

async function sendMessage({ chatId, text, deepLink, disableNotification = false }) {
    if (!isConfigured()) {
        logger.warn('Telegram bot token not configured; skipping alert');
        return { sent: false, reason: 'not_configured' };
    }

    try {
        const body = {
            chat_id: chatId,
            text,
            disable_notification: disableNotification,
            disable_web_page_preview: true
        };
        if (deepLink) {
            body.reply_markup = {
                inline_keyboard: [[
                    { text: 'Open EasyModerator', url: deepLink }
                ]]
            };
        }

        const response = await axios.post(
            `https://api.telegram.org/bot${botToken()}/sendMessage`,
            body,
            { timeout: 8000 }
        );

        return {
            sent: true,
            messageId: response.data?.result?.message_id || null
        };
    } catch (error) {
        const status = error.response?.status || null;
        const description = error.response?.data?.description || error.message;
        const retryAfter = error.response?.data?.parameters?.retry_after || null;
        const blocked = status === 400 || status === 403;

        logger.warn('Telegram send failed', { status, description });
        return {
            sent: false,
            blocked,
            retryAfter,
            status,
            error: description
        };
    }
}

module.exports = {
    sendMessage,
    isConfigured,
    botUsername
};
