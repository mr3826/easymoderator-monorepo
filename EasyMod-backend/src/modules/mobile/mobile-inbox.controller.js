'use strict';

const crypto = require('crypto');
const asyncHandler = require('../../utils/async-middleware-handler');
const { AppError, sendSuccess } = require('../../utils/AppError');
const conversationService = require('../conversation/conversation.service');
const conversationController = require('../conversation/conversation.controller');
const { Message, AuditLog } = require('../entities');
const sseManager = require('../../utils/sse-manager');
const { cacheRedis } = require('../../config/redis');

const MAX_PAGE_SIZE = 50;
const SUPPORTED_CHANNELS = new Set(['facebook', 'messenger', 'web', 'webchat', 'telegram']);
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function positiveInteger(value, fallback, maximum) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, maximum);
}

function conversationIdFrom(req) {
    const conversationId = String(req.params.conversationId || '').trim();
    if (!conversationId || conversationId.length > 100) {
        throw new AppError('Conversation ID is required', 400, 'VALIDATION_ERROR');
    }
    return conversationId;
}

function paginationFrom(req) {
    return {
        page: positiveInteger(req.query.page, 1, 10_000),
        limit: positiveInteger(req.query.limit, 25, MAX_PAGE_SIZE),
    };
}

/** GET /api/mobile/inbox/conversations: a shop-scoped, read-only Inbox projection. */
const getConversations = asyncHandler(async (req, res) => {
    const options = paginationFrom(req);
    if (req.query.status) options.status = String(req.query.status);
    if (req.query.channel && SUPPORTED_CHANNELS.has(String(req.query.channel))) {
        options.channel = String(req.query.channel);
    }
    const result = await conversationService.getConversations(req.shop.id, options);
    sendSuccess(res, result);
});

/** GET /api/mobile/inbox/conversations/:conversationId: safe current-shop detail. */
const getConversation = asyncHandler(async (req, res) => {
    const conversation = await conversationService.getConversationById(
        conversationIdFrom(req),
        req.shop.id,
    );
    if (!conversation) {
        throw new AppError('Conversation not found', 404, 'NOT_FOUND');
    }
    sendSuccess(res, conversation);
});

/** GET /api/mobile/inbox/conversations/:conversationId/messages: bounded transcript page. */
const getMessages = asyncHandler(async (req, res) => {
    const result = await conversationService.getMessages(
        conversationIdFrom(req),
        req.shop.id,
        paginationFrom(req),
    );
    sendSuccess(res, result);
});

/**
 * POST /api/mobile/inbox/conversations/:conversationId/reply
 * Merchant human reply from mobile app with Meta 24h guard, idempotency, AI pause, and audit log.
 */
const replyConversation = asyncHandler(async (req, res) => {
    const conversationId = conversationIdFrom(req);
    const shopId = req.shop.id;

    const conversation = await conversationService.getConversationById(conversationId, shopId);
    if (!conversation) {
        throw new AppError('Conversation not found', 404, 'NOT_FOUND');
    }

    const messageText = String(req.body?.message || req.body?.content || '').trim();
    if (!messageText) {
        throw new AppError('Message content is required', 400, 'VALIDATION_ERROR');
    }
    if (messageText.length > 2000) {
        throw new AppError('Message exceeds maximum length of 2000 characters', 400, 'MESSAGE_TOO_LONG');
    }

    // Meta 24-hour messaging policy check for Facebook / Messenger channels
    const isMeta = ['facebook', 'messenger'].includes(String(conversation.channel || '').toLowerCase());
    if (isMeta) {
        let lastCustomerAt = NaN;
        if (conversation.last_customer_message_at) {
            lastCustomerAt = new Date(conversation.last_customer_message_at).getTime();
        } else if (Message && typeof Message.findOne === 'function') {
            const lastCustMsg = await Message.findOne({
                where: { conversation_id: conversationId, sender: 'customer' },
                order: [['created_at', 'DESC']],
                attributes: ['created_at'],
            }).catch(() => null);
            if (lastCustMsg?.created_at) {
                lastCustomerAt = new Date(lastCustMsg.created_at).getTime();
            }
        }

        const tag = req.body?.message_tag;
        if (Number.isFinite(lastCustomerAt) && (Date.now() - lastCustomerAt > TWENTY_FOUR_HOURS_MS) && !tag) {
            throw new AppError('Cannot reply: Outside Meta 24-hour messaging window. Customer must message first.', 422, 'OUTSIDE_24H_WINDOW');
        }
    }

    const idempotencyKey = req.get('X-Idempotency-Key') || req.body?.idempotencyKey || null;

    // Pause AI for 30 minutes when a merchant replies
    if (cacheRedis && typeof cacheRedis.setex === 'function') {
        await Promise.resolve(cacheRedis.setex(`ai:pause:${conversationId}`, 1800, '1')).catch(() => {});
    }
    if (typeof conversationService.holdPendingAiCandidates === 'function') {
        await Promise.resolve(conversationService.holdPendingAiCandidates(conversationId, shopId, 'human_active')).catch(() => {});
    }

    const messageData = {
        content: messageText,
        sender: 'business',
        send_idempotency_key: idempotencyKey,
        metadata: {
            source: 'MOBILE',
            user_id: req.user?.id || req.user?.userId || null,
        },
    };
    if (req.body?.message_tag) {
        messageData.message_tag = String(req.body.message_tag);
    }

    const message = await conversationService.createMessage(conversationId, shopId, messageData);

    const idempotencyReplay = message?.idempotency_replay === true;
    if (!idempotencyReplay && sseManager && typeof sseManager.emit === 'function') {
        sseManager.emit(shopId, 'new_message', { conversation_id: conversationId, message });
    }

    let delivery = null;
    if (!idempotencyReplay && conversationController && typeof conversationController._deliverViaMetaIfApplicable === 'function') {
        delivery = await conversationController._deliverViaMetaIfApplicable(conversationId, shopId, message, 'agent').catch((err) => {
            console.warn(`[mobile-inbox] Outbound delivery failed for ${conversationId}:`, err.message);
            return { sent: false, reason: err.message };
        });
    }

    if (AuditLog && typeof AuditLog.create === 'function' && !idempotencyReplay) {
        const auditHash = crypto.createHash('sha256')
            .update(['INBOX_MESSAGE_SENT', shopId, conversationId, message?.id || 'msg', req.user?.id || 'mobile'].join('|'))
            .digest('hex');
        await AuditLog.create({
            user_id: req.user?.id || req.user?.userId || null,
            shop_id: shopId,
            action: 'INBOX_MESSAGE_SENT',
            resource_type: 'conversation_message',
            resource_id: message?.id || null,
            idempotency_key: auditHash,
            metadata: {
                conversation_id: conversationId,
                source: 'MOBILE',
                delivery_sent: delivery?.sent ?? null,
            },
        }).catch((err) => console.warn('Mobile inbox audit log failed:', err.message));
    }

    sendSuccess(res, { message }, 201);
});

/**
 * POST /api/mobile/inbox/conversations/:conversationId/ai-mode
 * Toggle AI mode (pause / resume) for a specific conversation.
 */
const setAiMode = asyncHandler(async (req, res) => {
    const conversationId = conversationIdFrom(req);
    const shopId = req.shop.id;

    const conversation = await conversationService.getConversationById(conversationId, shopId);
    if (!conversation) {
        throw new AppError('Conversation not found', 404, 'NOT_FOUND');
    }

    const mode = String(req.body?.mode || req.body?.action || '').toLowerCase();
    if (!['pause', 'resume'].includes(mode)) {
        throw new AppError('Mode must be "pause" or "resume"', 400, 'VALIDATION_ERROR');
    }

    if (mode === 'pause') {
        if (cacheRedis && typeof cacheRedis.setex === 'function') {
            await Promise.resolve(cacheRedis.setex(`ai:pause:${conversationId}`, 1800, '1')).catch(() => {});
        }
        if (typeof conversationService.holdPendingAiCandidates === 'function') {
            await Promise.resolve(conversationService.holdPendingAiCandidates(conversationId, shopId, 'human_paused')).catch(() => {});
        }
    } else {
        if (cacheRedis && typeof cacheRedis.del === 'function') {
            await Promise.resolve(cacheRedis.del(`ai:pause:${conversationId}`)).catch(() => {});
        }
    }

    if (sseManager && typeof sseManager.emit === 'function') {
        sseManager.emit(shopId, 'conversation_updated', {
            conversation_id: conversationId,
            ai_paused: mode === 'pause',
        });
    }

    if (AuditLog && typeof AuditLog.create === 'function') {
        const auditHash = crypto.createHash('sha256')
            .update(['AI_MODE_TOGGLED', shopId, conversationId, mode, Date.now()].join('|'))
            .digest('hex');
        await AuditLog.create({
            user_id: req.user?.id || req.user?.userId || null,
            shop_id: shopId,
            action: mode === 'pause' ? 'AI_PAUSED' : 'AI_RESUMED',
            resource_type: 'conversation',
            resource_id: conversationId,
            idempotency_key: auditHash,
            metadata: {
                conversation_id: conversationId,
                source: 'MOBILE',
                ai_mode: mode === 'pause' ? 'paused' : 'ai_active',
            },
        }).catch((err) => console.warn('Mobile AI mode audit log failed:', err.message));
    }

    sendSuccess(res, {
        success: true,
        ai_mode: mode === 'pause' ? 'paused' : 'ai_active',
        conversation_id: conversationId,
    });
});

module.exports = {
    getConversations,
    getConversation,
    getMessages,
    replyConversation,
    setAiMode,
};
