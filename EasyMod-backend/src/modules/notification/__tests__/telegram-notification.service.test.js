'use strict';

jest.mock('../../entities', () => ({
    TelegramNotificationBinding: {
        findOne: jest.fn(),
        findOrCreate: jest.fn()
    },
    Shop: {
        findByPk: jest.fn()
    }
}));

jest.mock('../../audit/audit.service', () => ({
    logOperation: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../providers/telegram.provider', () => ({
    sendMessage: jest.fn().mockResolvedValue({ sent: true, messageId: 1 }),
    isConfigured: jest.fn(() => true),
    botUsername: jest.fn(() => 'EasyModBot')
}));

jest.mock('../../../utils/structured-logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() })
}));

const { TelegramNotificationBinding, Shop } = require('../../entities');
const telegramProvider = require('../providers/telegram.provider');
const service = require('../telegram-notification.service');
const { NOTIFICATION_EVENTS } = require('../notification-events');

function makeBinding(overrides = {}) {
    const binding = {
        id: 'bind-1',
        shop_id: 'shop-1',
        status: 'disconnected',
        enabled: false,
        preferences: {},
        telegram_chat_id: null,
        chat_title: null,
        chat_type: null,
        last_error: null,
        update: jest.fn(async function update(values) {
            Object.assign(binding, values);
            return binding;
        }),
        toJSON: jest.fn(() => ({ ...binding })),
        ...overrides
    };
    return binding;
}

describe('telegram-notification.service', () => {
    const originalEnv = process.env;
    let binding;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv, TELEGRAM_WEBHOOK_SECRET: 'secret' };
        binding = makeBinding();
        Shop.findByPk.mockResolvedValue({ id: 'shop-1', shop_name: 'Sapna Fashion', name: 'Sapna Fashion' });
        TelegramNotificationBinding.findOrCreate.mockResolvedValue([binding, true]);
        TelegramNotificationBinding.findOne.mockResolvedValue(binding);
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('creates a pending connect intent with a one-time command', async () => {
        const result = await service.createConnectIntent({ shopId: 'shop-1', userId: 'user-1' });

        expect(binding.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'pending',
            enabled: false,
            connect_token_hash: expect.any(String),
            connection_expires_at: expect.any(Date)
        }));
        expect(result.pendingCommand).toContain('/easymod_connect@EasyModBot');
        expect(result.suggestedGroupName).toBe('Sapna Fashion Alerts');
    });

    it('binds a Telegram group when the webhook command token matches', async () => {
        binding = makeBinding({
            shop_id: 'shop-1',
            status: 'pending',
            connect_token_hash: service.hashToken('token'),
            connection_expires_at: new Date(Date.now() + 10000)
        });
        TelegramNotificationBinding.findOne.mockImplementation(async ({ where }) => {
            if (where.connect_token_hash) return binding;
            if (where.telegram_chat_id) return null;
            return binding;
        });

        const result = await service.handleTelegramUpdate({
            message: {
                text: '/easymod_connect token',
                chat: { id: -100123, title: 'Sapna Fashion Alerts', type: 'supergroup' }
            }
        }, { secretToken: 'secret' });

        expect(result.connected).toBe(true);
        expect(binding.update).toHaveBeenCalledWith(expect.objectContaining({
            telegram_chat_id: '-100123',
            chat_title: 'Sapna Fashion Alerts',
            status: 'connected',
            enabled: true,
            connect_token_hash: null
        }));
        expect(telegramProvider.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            chatId: '-100123',
            text: expect.stringContaining('alerts are connected')
        }));
    });

    it('rejects webhook requests with the wrong Telegram secret', async () => {
        await expect(service.handleTelegramUpdate({}, { secretToken: 'wrong' }))
            .rejects.toMatchObject({ statusCode: 401 });
    });

    it('fails closed when the Telegram webhook secret is not configured', async () => {
        delete process.env.TELEGRAM_WEBHOOK_SECRET;
        await expect(service.handleTelegramUpdate({}, { secretToken: 'anything' }))
            .rejects.toMatchObject({ statusCode: 503 });
    });

    it('marks a binding unhealthy when Telegram reports the bot was removed', async () => {
        binding = makeBinding({ telegram_chat_id: '-100123', status: 'connected', enabled: true });
        TelegramNotificationBinding.findOne.mockResolvedValue(binding);

        const result = await service.handleTelegramUpdate({
            my_chat_member: {
                chat: { id: -100123 },
                new_chat_member: { status: 'kicked' }
            }
        }, { secretToken: 'secret' });

        expect(result.bindingFound).toBe(true);
        expect(binding.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'unhealthy',
            enabled: false,
            last_error: 'Telegram bot was removed from the group'
        }));
    });

    it('does not send disabled event alerts', async () => {
        binding = makeBinding({
            status: 'connected',
            enabled: true,
            telegram_chat_id: '-100123',
            preferences: { [NOTIFICATION_EVENTS.NEW_ORDER]: false }
        });
        TelegramNotificationBinding.findOne.mockResolvedValue(binding);

        const result = await service.sendEvent('shop-1', NOTIFICATION_EVENTS.NEW_ORDER, { orderNumber: 'EM-1' });

        expect(result).toEqual({ sent: false, skipped: true, reason: 'event_disabled' });
        expect(telegramProvider.sendMessage).not.toHaveBeenCalled();
    });

    it('saves preferences before Telegram is connected', async () => {
        binding = makeBinding();
        TelegramNotificationBinding.findOrCreate.mockResolvedValue([binding, true]);
        TelegramNotificationBinding.findOne.mockResolvedValue(binding);

        await service.updatePreferences({
            shopId: 'shop-1',
            userId: 'user-1',
            preferences: { [NOTIFICATION_EVENTS.NEW_ORDER]: false }
        });

        expect(TelegramNotificationBinding.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
            where: { shop_id: 'shop-1' }
        }));
        expect(binding.update).toHaveBeenCalledWith({
            preferences: expect.objectContaining({ [NOTIFICATION_EVENTS.NEW_ORDER]: false })
        });
    });
});
