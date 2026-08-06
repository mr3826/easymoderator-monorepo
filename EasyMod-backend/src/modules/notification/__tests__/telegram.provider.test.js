'use strict';

const axios = require('axios');

jest.mock('axios');
jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() })
}));

const provider = require('../providers/telegram.provider');

describe('telegram.provider', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_BOT_USERNAME;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('skips sending when the bot token is not configured', async () => {
        const result = await provider.sendMessage({ chatId: '-1001', text: 'test' });

        expect(result).toEqual({ sent: false, reason: 'not_configured' });
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('sends Telegram messages with a deep-link button', async () => {
        process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
        axios.post.mockResolvedValue({ data: { result: { message_id: 77 } } });

        const result = await provider.sendMessage({
            chatId: '-1001',
            text: 'New order',
            deepLink: 'https://app.easymod.tech/orders'
        });

        expect(result).toEqual({ sent: true, messageId: 77 });
        expect(axios.post).toHaveBeenCalledWith(
            'https://api.telegram.org/botbot-token/sendMessage',
            expect.objectContaining({
                chat_id: '-1001',
                text: 'New order',
                reply_markup: expect.objectContaining({ inline_keyboard: expect.any(Array) })
            }),
            expect.objectContaining({ timeout: 8000 })
        );
    });

    it('marks blocked chat errors for removed bot handling', async () => {
        process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
        axios.post.mockRejectedValue({
            response: { status: 403, data: { description: 'Forbidden: bot was kicked' } }
        });

        const result = await provider.sendMessage({ chatId: '-1001', text: 'test' });

        expect(result.sent).toBe(false);
        expect(result.blocked).toBe(true);
        expect(result.status).toBe(403);
    });
});
