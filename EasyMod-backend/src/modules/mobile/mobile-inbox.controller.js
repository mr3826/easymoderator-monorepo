'use strict';

const asyncHandler = require('../../utils/async-middleware-handler');
const { AppError, sendSuccess } = require('../../utils/AppError');
const conversationService = require('../conversation/conversation.service');

const MAX_PAGE_SIZE = 50;
const SUPPORTED_CHANNELS = new Set(['facebook', 'messenger', 'web', 'webchat', 'telegram']);

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

module.exports = { getConversations, getConversation, getMessages };
