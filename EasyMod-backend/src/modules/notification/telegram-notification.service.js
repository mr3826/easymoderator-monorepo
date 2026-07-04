'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const { TelegramNotificationBinding, Shop } = require('../entities');
const AuditService = require('../audit/audit.service');
const telegramProvider = require('./providers/telegram.provider');
const {
    DEFAULT_NOTIFICATION_PREFERENCES,
    NOTIFICATION_EVENT_META,
    NOTIFICATION_EVENTS,
    normalizePreferences,
    isConfigurableEvent
} = require('./notification-events');
const { formatTelegramAlert } = require('./telegram-alert.formatter');
const { createLogger } = require('../../utils/structured-logger');

const logger = createLogger('TelegramNotificationService');
const CONNECT_TOKEN_TTL_MS = 15 * 60 * 1000;

function randomToken() {
    return crypto.randomBytes(24)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getShopName(shop) {
    return shop?.shop_name || shop?.name || 'EasyModerator Shop';
}

function suggestedGroupName(shop) {
    return `${getShopName(shop)} Alerts`;
}

function connectCommand(token) {
    const username = telegramProvider.botUsername();
    const command = username ? `/easymod_connect@${username}` : '/easymod_connect';
    return `${command} ${token}`;
}

function serializeBinding(binding, shop = null, pendingCommand = null) {
    const preferences = normalizePreferences(binding?.preferences || {});
    return {
        configured: telegramProvider.isConfigured(),
        botUsername: telegramProvider.botUsername() || null,
        suggestedGroupName: suggestedGroupName(shop),
        status: binding?.status || 'disconnected',
        enabled: Boolean(binding?.enabled),
        connected: binding?.status === 'connected' && Boolean(binding?.enabled),
        chatTitle: binding?.chat_title || null,
        chatType: binding?.chat_type || null,
        lastError: binding?.last_error || null,
        lastTestedAt: binding?.last_tested_at || null,
        lastSentAt: binding?.last_sent_at || null,
        connectedAt: binding?.connected_at || null,
        disconnectedAt: binding?.disconnected_at || null,
        connectionExpiresAt: binding?.connection_expires_at || null,
        preferences,
        events: Object.entries(NOTIFICATION_EVENT_META).map(([eventType, meta]) => ({
            eventType,
            label: meta.label,
            labelBn: meta.labelBn,
            enabled: preferences[eventType]
        })),
        pendingCommand
    };
}

function audit(action, { userId = null, shopId, binding = null, oldValues = null, newValues = null, req = null, metadata = null }) {
    return AuditService.logOperation({
        userId,
        shopId,
        action,
        resourceType: 'telegram_notification_binding',
        resourceId: binding?.id || null,
        oldValues,
        newValues,
        metadata,
        ipAddress: req?.ip || null,
        userAgent: req?.get ? req.get('user-agent') : null
    });
}

async function getShop(shopId) {
    return Shop.findByPk(shopId, { attributes: ['id', 'name', 'shop_name'] });
}

async function getStatus(shopId) {
    const [shop, binding] = await Promise.all([
        getShop(shopId),
        TelegramNotificationBinding.findOne({ where: { shop_id: shopId } })
    ]);
    return serializeBinding(binding, shop);
}

async function createConnectIntent({ shopId, userId, req = null }) {
    const shop = await getShop(shopId);
    const token = randomToken();
    const expiresAt = new Date(Date.now() + CONNECT_TOKEN_TTL_MS);
    const [binding] = await TelegramNotificationBinding.findOrCreate({
        where: { shop_id: shopId },
        defaults: {
            shop_id: shopId,
            status: 'pending',
            enabled: false,
            preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES }
        }
    });

    const oldValues = binding.toJSON();
    await binding.update({
        status: 'pending',
        enabled: false,
        connect_token_hash: hashToken(token),
        connection_expires_at: expiresAt,
        last_error: null,
        preferences: normalizePreferences(binding.preferences || {})
    });

    await audit('telegram_connect_intent_created', {
        userId,
        shopId,
        binding,
        oldValues,
        newValues: { status: 'pending', connection_expires_at: expiresAt },
        req
    });

    const command = connectCommand(token);
    return {
        ...serializeBinding(binding, shop, command),
        instructions: [
            `Create a Telegram group named "${suggestedGroupName(shop)}" or use your existing team group.`,
            'Add the EasyModerator bot to that group.',
            `Send this command in the group: ${command}`,
            'Return here and send a test alert.'
        ],
        expiresAt
    };
}

function extractCommand(text = '') {
    const parts = String(text).trim().split(/\s+/);
    if (parts.length < 2) return null;

    const commandName = parts[0].split('@')[0].toLowerCase();
    if (!['/easymod_connect', '/start'].includes(commandName)) return null;
    return { commandName, token: parts[1] };
}

function chatTitle(chat = {}) {
    return chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || String(chat.id);
}

async function bindTelegramChat(update) {
    const message = update.message || update.edited_message;
    const command = extractCommand(message?.text);
    if (!command) return { handled: false, reason: 'not_connect_command' };

    const chat = message.chat;
    const chatId = String(chat.id);
    const tokenHash = hashToken(command.token);
    const binding = await TelegramNotificationBinding.findOne({
        where: {
            connect_token_hash: tokenHash,
            status: 'pending',
            connection_expires_at: { [Op.gt]: new Date() }
        }
    });

    if (!binding) {
        await telegramProvider.sendMessage({
            chatId,
            text: 'This EasyModerator connect command is invalid or expired. Open Settings > Notifications and create a new command.'
        });
        return { handled: true, connected: false, reason: 'invalid_or_expired_token' };
    }

    const otherBinding = await TelegramNotificationBinding.findOne({
        where: {
            telegram_chat_id: chatId,
            shop_id: { [Op.ne]: binding.shop_id }
        }
    });
    if (otherBinding) {
        await telegramProvider.sendMessage({
            chatId,
            text: 'This Telegram group is already connected to another EasyModerator shop. Disconnect it there before connecting a new shop.'
        });
        return { handled: true, connected: false, reason: 'chat_already_bound' };
    }

    await binding.update({
        telegram_chat_id: chatId,
        chat_title: chatTitle(chat),
        chat_type: chat.type || null,
        status: 'connected',
        enabled: true,
        preferences: normalizePreferences(binding.preferences || {}),
        connect_token_hash: null,
        connection_expires_at: null,
        last_error: null,
        connected_at: new Date(),
        disconnected_at: null
    });

    await audit('telegram_group_connected', {
        shopId: binding.shop_id,
        binding,
        newValues: {
            chat_title: binding.chat_title,
            chat_type: binding.chat_type,
            status: 'connected'
        }
    });

    await telegramProvider.sendMessage({
        chatId,
        text: 'EasyModerator alerts are connected for this shop. This group will receive alerts only; replies here will not be sent to customers.'
    });

    return { handled: true, connected: true, shopId: binding.shop_id };
}

async function handleMembershipUpdate(update) {
    const memberUpdate = update.my_chat_member;
    if (!memberUpdate?.chat || !memberUpdate?.new_chat_member) {
        return { handled: false, reason: 'not_membership_update' };
    }

    const status = memberUpdate.new_chat_member.status;
    if (!['left', 'kicked'].includes(status)) {
        return { handled: true, status };
    }

    const binding = await TelegramNotificationBinding.findOne({
        where: { telegram_chat_id: String(memberUpdate.chat.id) }
    });
    if (!binding) return { handled: true, status, bindingFound: false };

    await binding.update({
        status: 'unhealthy',
        enabled: false,
        last_error: 'Telegram bot was removed from the group',
        disconnected_at: new Date()
    });

    await audit('telegram_bot_removed', {
        shopId: binding.shop_id,
        binding,
        newValues: { status: 'unhealthy', enabled: false }
    });

    return { handled: true, status, bindingFound: true };
}

async function handleTelegramUpdate(update, { secretToken } = {}) {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret && secretToken !== expectedSecret) {
        const err = new Error('Invalid Telegram webhook secret');
        err.statusCode = 401;
        throw err;
    }

    if (update.my_chat_member) return handleMembershipUpdate(update);
    return bindTelegramChat(update);
}

async function updatePreferences({ shopId, userId, preferences, req = null }) {
    const [binding] = await TelegramNotificationBinding.findOrCreate({
        where: { shop_id: shopId },
        defaults: {
            shop_id: shopId,
            status: 'disconnected',
            enabled: false,
            preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES }
        }
    });

    const sanitized = {};
    for (const [eventType, enabled] of Object.entries(preferences || {})) {
        if (isConfigurableEvent(eventType) && typeof enabled === 'boolean') {
            sanitized[eventType] = enabled;
        }
    }

    const oldPreferences = normalizePreferences(binding.preferences || {});
    const newPreferences = normalizePreferences({ ...oldPreferences, ...sanitized });
    await binding.update({ preferences: newPreferences });
    await audit('telegram_preferences_updated', {
        userId,
        shopId,
        binding,
        oldValues: { preferences: oldPreferences },
        newValues: { preferences: newPreferences },
        req
    });

    return getStatus(shopId);
}

async function disconnect({ shopId, userId, req = null }) {
    const binding = await TelegramNotificationBinding.findOne({ where: { shop_id: shopId } });
    if (!binding) return { disconnected: true };

    const oldValues = binding.toJSON();
    await binding.update({
        telegram_chat_id: null,
        chat_title: null,
        chat_type: null,
        status: 'disconnected',
        enabled: false,
        connect_token_hash: null,
        connection_expires_at: null,
        disconnected_at: new Date(),
        last_error: null
    });

    await audit('telegram_group_disconnected', {
        userId,
        shopId,
        binding,
        oldValues: {
            chat_title: oldValues.chat_title,
            chat_type: oldValues.chat_type,
            status: oldValues.status
        },
        newValues: { status: 'disconnected', enabled: false },
        req
    });

    return { disconnected: true, status: await getStatus(shopId) };
}

async function markSendFailure(binding, result) {
    const updates = {
        last_error: result.error || result.reason || 'Telegram send failed'
    };
    if (result.blocked) {
        updates.status = 'unhealthy';
        updates.enabled = false;
        updates.disconnected_at = new Date();
    }
    await binding.update(updates);
}

async function sendEvent(shopId, eventType, payload = {}) {
    const binding = await TelegramNotificationBinding.findOne({ where: { shop_id: shopId } });
    if (!binding || binding.status !== 'connected' || !binding.enabled || !binding.telegram_chat_id) {
        return { sent: false, skipped: true, reason: 'not_connected' };
    }

    const preferences = normalizePreferences(binding.preferences || {});
    if (eventType !== NOTIFICATION_EVENTS.TELEGRAM_TEST && preferences[eventType] !== true) {
        return { sent: false, skipped: true, reason: 'event_disabled' };
    }

    const alert = formatTelegramAlert(eventType, payload);
    const result = await telegramProvider.sendMessage({
        chatId: binding.telegram_chat_id,
        text: alert.body,
        deepLink: alert.deepLink
    });

    if (result.sent) {
        await binding.update({
            last_sent_at: new Date(),
            last_error: null
        });
    } else {
        await markSendFailure(binding, result);
    }

    return { ...result, eventType };
}

async function sendTest({ shopId, userId, req = null }) {
    const result = await sendEvent(shopId, NOTIFICATION_EVENTS.TELEGRAM_TEST, {});
    const binding = await TelegramNotificationBinding.findOne({ where: { shop_id: shopId } });
    if (binding) await binding.update({ last_tested_at: new Date() });
    await audit('telegram_test_alert_sent', {
        userId,
        shopId,
        binding,
        newValues: { result },
        req
    });

    if (!result.sent) {
        const err = new Error(result.reason === 'not_connected'
            ? 'Telegram group is not connected'
            : result.error || result.reason || 'Telegram test alert failed');
        err.statusCode = result.reason === 'not_connected' ? 400 : 502;
        err.result = result;
        throw err;
    }

    logger.info('Telegram test alert sent', { shopId });
    return result;
}

module.exports = {
    getStatus,
    createConnectIntent,
    updatePreferences,
    disconnect,
    handleTelegramUpdate,
    sendEvent,
    sendTest,
    hashToken,
    extractCommand
};
