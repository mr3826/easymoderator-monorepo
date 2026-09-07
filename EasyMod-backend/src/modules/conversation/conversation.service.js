const {
    Conversation,
    Message,
    Customer,
    MetaChannel,
    MetaChannelSettings,
    InboxDeliveryOutbox,
} = require('../entities');
const { Op } = require('sequelize');
const subscriptionService = require('../subscription/subscription.service');
const { createLogger } = require('../../utils/structured-logger');
const { AppError } = require('../../utils/AppError');
const sseManager = require('../../utils/sse-manager');
const { cacheRedis } = require('../../config/redis');
const conversationLockService = require('./conversation-lock.service');
const { getEffectiveAiReplyMode } = require('../shop/ai-reply-mode');
const { sequelize } = require('../../utils/database/database-setup');
const {
    MESSAGE_DELIVERY_STATES,
    SUGGESTION_VISIBILITY,
    normalizeDeliveryState,
    providerMessageIdFor,
    isProviderConfirmed,
    isReviewableSuggestion,
    deriveMessageSendIdempotencyKey,
    RESUME_BOUNDARY_METADATA_KEY,
    resumeBoundaryStateFor,
    candidateStartedAtStateFor,
    isBeforeResumeBoundary,
} = require('./message-lifecycle');

const PLACEHOLDER_CUSTOMER_NAMES = new Set([
    'customer',
    'facebook user',
    'messenger user',
    'instagram user',
    'no title',
    'unknown',
]);

const DELIVERY_LOCK_TIMEOUT_MS = 300_000;
const DELIVERY_LOCK_WAIT_MS = 10_000;

async function acquireBulkDeliveryLock(conversationId) {
    if (!cacheRedis || typeof cacheRedis.set !== 'function'
        || typeof conversationLockService?.acquireForDelivery !== 'function') {
        if (process.env.NODE_ENV === 'test') return null;
        throw Object.assign(new Error('Conversation delivery lock is unavailable'), {
            statusCode: 503,
            code: 'DELIVERY_LOCK_UNAVAILABLE',
        });
    }
    const lock = await conversationLockService.acquireForDelivery(conversationId, {
        lockTimeoutMs: DELIVERY_LOCK_TIMEOUT_MS,
        maxWaitMs: DELIVERY_LOCK_WAIT_MS,
    });
    if (lock?.available === false && process.env.NODE_ENV !== 'test') {
        throw Object.assign(new Error('Conversation delivery lock is unavailable'), {
            statusCode: 503,
            code: 'DELIVERY_LOCK_UNAVAILABLE',
        });
    }
    if (!lock?.success) {
        const error = new Error('Another Inbox delivery is in progress; retry after it completes');
        error.statusCode = 409;
        error.code = 'CONVERSATION_DELIVERY_BUSY';
        throw error;
    }
    return lock;
}

async function releaseBulkDeliveryLock(lock, conversationId) {
    if (!lock?.success || typeof conversationLockService?.releaseLock !== 'function') return;
    await conversationLockService.releaseLock(conversationId, lock.lockId).catch(() => {});
}

const normalizeObject = (value) => {
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_) {
            return {};
        }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
};

const workflowTimestamp = (message) => {
    const value = message?.created_at ?? message?.createdAt;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : NaN;
};

const workflowDeliverySource = (message) => {
    const metadata = normalizeObject(message?.metadata);
    return message?.delivery_source || metadata.delivery_source || null;
};

const isAnsweringOutbound = (message) => {
    if (message?.sender === 'business') {
        const state = normalizeDeliveryState(message);
        return ![
            MESSAGE_DELIVERY_STATES.GENERATING,
            MESSAGE_DELIVERY_STATES.SEND_PENDING,
            MESSAGE_DELIVERY_STATES.FAILED,
        ].includes(state);
    }
    return message?.sender === 'ai'
        && workflowDeliverySource(message) !== 'HITL_ESCALATION'
        && isProviderConfirmed(message);
};

const isCurrentWorkflowMessage = (message, latestCustomerAt, latestAnswerAt) => {
    const timestamp = workflowTimestamp(message);
    const afterCustomer = !Number.isFinite(latestCustomerAt)
        || !Number.isFinite(timestamp)
        || timestamp >= latestCustomerAt;
    const afterAnswer = !Number.isFinite(latestAnswerAt)
        || !Number.isFinite(timestamp)
        || timestamp > latestAnswerAt;
    return afterCustomer && afterAnswer;
};

const isActiveProviderAttempt = (message, latestCustomerAt, latestAnswerAt) => {
    if (!['ai', 'business'].includes(message?.sender)
        || isProviderConfirmed(message)
        || workflowDeliverySource(message) === 'HITL_ESCALATION'
        || !isCurrentWorkflowMessage(message, latestCustomerAt, latestAnswerAt)) return false;
    const metadata = normalizeObject(message.metadata);
    if (metadata.provider_send_attempted === true) return false;
    return [MESSAGE_DELIVERY_STATES.GENERATING, MESSAGE_DELIVERY_STATES.SEND_PENDING]
        .includes(normalizeDeliveryState(message));
};

const isResumableStaleCandidate = (message, resumeBoundaryAt) => {
    if (!message || isProviderConfirmed(message)) return false;
    const metadata = normalizeObject(message.metadata);
    if (metadata.provider_send_attempted === true) return false;
    if (!candidateStartedAtStateFor(message).valid) return true;
    return isBeforeResumeBoundary(message, resumeBoundaryAt);
};

const logicalTurnIdFor = (message) => {
    const logicalTurnId = normalizeObject(message?.metadata).logical_turn_id;
    return logicalTurnId ? String(logicalTurnId) : null;
};

const legacyLogicalTurnIdFor = (message, rows) => {
    const candidateAt = workflowTimestamp(message);
    if (!Number.isFinite(candidateAt)) return null;
    const ordered = (Array.isArray(rows) ? rows : [])
        .filter((row) => Number.isFinite(workflowTimestamp(row))
            && workflowTimestamp(row) <= candidateAt)
        .sort((left, right) => workflowTimestamp(left) - workflowTimestamp(right));
    const answerTimes = ordered
        .filter(isAnsweringOutbound)
        .map(workflowTimestamp)
        .filter(Number.isFinite);
    const latestAnswerAt = answerTimes.length ? Math.max(...answerTimes) : NaN;
    const firstPendingCustomer = ordered.find((row) => (
        row?.sender === 'customer'
        && (!Number.isFinite(latestAnswerAt) || workflowTimestamp(row) > latestAnswerAt)
    ));
    return firstPendingCustomer?.id ? `burst:${firstPendingCustomer.id}` : null;
};

const dismissalLogicalTurnIdFor = (message, rows) => {
    const persisted = logicalTurnIdFor(message);
    if (persisted) return persisted;
    return legacyLogicalTurnIdFor(message, rows);
};

const isDismissableDuplicateSibling = (candidate, sibling, rows) => {
    if (!candidate?.id || !sibling?.id || candidate.id === sibling.id) return false;
    if (!isReviewableSuggestion(sibling)) return false;

    const candidateTurnId = dismissalLogicalTurnIdFor(candidate, rows);
    const siblingTurnId = dismissalLogicalTurnIdFor(sibling, rows);
    return Boolean(candidateTurnId && siblingTurnId && candidateTurnId === siblingTurnId);
};

const dismissedMetadata = (message, actorId, dismissedAt, duplicateOf = null) => ({
    ...normalizeObject(message?.metadata),
    delivered: false,
    delivery_status: 'dismissed',
    delivery_state: MESSAGE_DELIVERY_STATES.DISMISSED,
    suggestion_visibility: SUGGESTION_VISIBILITY.HIDDEN_DISMISSED,
    held_reason: 'dismissed',
    dismissed_at: dismissedAt,
    dismissed_by_user_id: actorId || null,
    ...(duplicateOf ? {
        dismissed_as_duplicate: true,
        dismissed_duplicate_of: duplicateOf,
    } : {}),
});

const loadDismissalCandidates = async (conversationId, transaction, candidate) => {
    if (typeof Message.findAll !== 'function') return [candidate];
    const rows = await Message.findAll({
        where: { conversation_id: conversationId },
        transaction,
        lock: transaction.LOCK?.UPDATE,
    });
    const byId = new Map([[candidate.id, candidate]]);
    for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.id && !byId.has(row.id)) byId.set(row.id, row);
    }
    return [...byId.values()];
};

const terminalizeDuplicateSiblings = async (candidate, rows, transaction, actorId, dismissedAt) => {
    const dismissedSiblingMessageIds = [];
    for (const sibling of rows) {
        if (!isDismissableDuplicateSibling(candidate, sibling, rows)) continue;
        await sibling.update({
            metadata: dismissedMetadata(sibling, actorId, dismissedAt, candidate.id),
            delivery_state: MESSAGE_DELIVERY_STATES.DISMISSED,
            delivery_source: sibling.delivery_source || 'AI_DRAFT',
        }, { transaction });
        dismissedSiblingMessageIds.push(sibling.id);
    }
    return dismissedSiblingMessageIds;
};

const deriveWorkflowProjection = (conversation, messages, aiReplyMode) => {
    const metadata = normalizeObject(conversation?.metadata);
    const status = conversation?.status || metadata.status || 'active';
    const open = !['closed', 'archived'].includes(status);
    const rows = Array.isArray(messages) ? messages : [];
    const customerTimes = rows
        .filter((message) => message?.sender === 'customer')
        .map(workflowTimestamp)
        .filter(Number.isFinite);
    const answerTimes = rows
        .filter(isAnsweringOutbound)
        .map(workflowTimestamp)
        .filter(Number.isFinite);
    const latestCustomerAt = customerTimes.length ? Math.max(...customerTimes) : NaN;
    const latestAnswerAt = answerTimes.length ? Math.max(...answerTimes) : NaN;
    const unanswered = Number.isFinite(latestCustomerAt)
        && (!Number.isFinite(latestAnswerAt) || latestCustomerAt > latestAnswerAt);
    const currentRows = rows.filter((message) => isCurrentWorkflowMessage(
        message,
        latestCustomerAt,
        latestAnswerAt,
    ));
    const reviewable = currentRows.filter(isReviewableSuggestion);
    const failed = currentRows.filter((message) => {
        const metadataForMessage = normalizeObject(message.metadata);
        return ['ai', 'business'].includes(message?.sender)
            && (normalizeDeliveryState(message) === MESSAGE_DELIVERY_STATES.FAILED
                || (normalizeDeliveryState(message) === MESSAGE_DELIVERY_STATES.SEND_PENDING
                    && metadataForMessage.provider_send_attempted === true)
                || metadataForMessage.held_reason === 'provider_send_failed');
    });
    const activeAttempts = currentRows.filter((message) => isActiveProviderAttempt(
        message,
        latestCustomerAt,
        latestAnswerAt,
    ));
    const aiProcessing = activeAttempts.some((message) => (
        message.sender === 'ai'
        && workflowDeliverySource(message) !== 'DRAFT_APPROVAL'
        && workflowDeliverySource(message) !== 'HITL_ESCALATION'
    ));

    let needsMerchantReply = false;
    if (open) {
        if (reviewable.length > 0 || failed.length > 0) {
            needsMerchantReply = true;
        } else if (unanswered) {
            // Dismissal is not an answer. AUTO suppresses this flag only
            // while a provider attempt is genuinely active.
            needsMerchantReply = conversation?.hitl === true || activeAttempts.length === 0;
        }
    }

    let reason = null;
    if (needsMerchantReply) {
        if (failed.length > 0) {
            reason = failed.some((message) => message.sender === 'business')
                ? 'PROVIDER_SEND_FAILED'
                : 'AI_FAILED';
        } else if (reviewable.length > 0) {
            const hasDraft = reviewable.some((message) => {
                const messageMetadata = normalizeObject(message.metadata);
                return messageMetadata.suggestion_visibility === SUGGESTION_VISIBILITY.VISIBLE_DRAFT_REVIEW
                    || normalizeDeliveryState(message) === MESSAGE_DELIVERY_STATES.DRAFT_READY;
            });
            reason = hasDraft ? 'DRAFT_REVIEW_REQUIRED' : 'HITL_REQUIRED';
        } else if (conversation?.hitl === true) {
            reason = 'HITL_REQUIRED';
        } else {
            reason = 'CUSTOMER_UNANSWERED';
        }
    }

    return {
        needs_merchant_reply: needsMerchantReply,
        needs_merchant_reply_reason: reason,
        ai_is_replying: open
            && aiReplyMode === 'AUTO'
            && conversation?.hitl !== true
            && aiProcessing,
    };
};

const displayChannelName = (channel) => (
    channel === 'facebook' || channel === 'messenger' ? 'Facebook customer' : 'Customer'
);

const customerFallbackName = (channel, providerId) => {
    const prefix = displayChannelName(channel);
    const normalizedId = typeof providerId === 'string' ? providerId.trim() : '';
    const suffix = normalizedId.replace(/[^A-Za-z0-9]/g, '').slice(-4);
    return suffix ? `${prefix} · …${suffix}` : prefix;
};

const isPlaceholderCustomerName = (name) => {
    if (!name) return true;
    const normalized = String(name).trim().toLowerCase();
    return PLACEHOLDER_CUSTOMER_NAMES.has(normalized)
        || normalized.startsWith('facebook user ')
        || normalized.startsWith('messenger user ')
        || normalized.startsWith('instagram user ')
        || normalized.startsWith('facebook customer ·');
};

const CLIENT_MESSAGE_METADATA_FIELDS = new Set([
    'external_id',
    'provider_message_id',
    'provider_message_ids',
    'provider_send_confirmed',
    'provider_send_attempted',
    'delivery_state',
    'delivery_status',
    'delivered',
    'suggestion_visibility',
    'reply_to',
    'reply_to_provider_message_id',
    'reply_to_internal_message_id',
    'reply_to_is_self_reply',
]);

const sanitizeClientMessageMetadata = (metadata) => Object.fromEntries(
    Object.entries(normalizeObject(metadata))
        .filter(([key]) => !CLIENT_MESSAGE_METADATA_FIELDS.has(key)),
);

const internalIntentTitle = (value, intent) => {
    if (!value) return true;
    const title = String(value).trim();
    return title.toLowerCase() === 'no title'
        || title.toLowerCase() === 'facebook user'
        || title.toLowerCase() === 'messenger user'
        || title === intent
        || title === 'GENERAL_CHAT_OR_UNKNOWN'
        || title === 'PURCHASE_INTENT_START'
        || title === 'ORDER_STATUS_LOOKUP'
        || title === 'SUPPORT_HANDOFF'
        || /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(title);
};

const plainCustomer = (customer, channel) => {
    if (!customer) return null;
    const raw = typeof customer.toJSON === 'function' ? customer.toJSON() : { ...customer };
    if (isPlaceholderCustomerName(raw.name)) {
        raw.name = customerFallbackName(channel, raw.channel_user_id);
    }
    return raw;
};

const mapMessage = (message) => {
    const metadata = normalizeObject(message?.metadata);
    const deliveryState = normalizeDeliveryState(message);
    const sender = message?.sender === 'business' ? 'agent' : message?.sender;
    return {
        id: message.id,
        conversation_id: message.conversation_id,
        content: message.content,
        sender,
        message_type: metadata.message_type || 'text',
        metadata: message.metadata || null,
        ai_suggestion: message.ai_suggestion || null,
        ai_confidence: message.ai_confidence ? Number(message.ai_confidence) : null,
        source_references: message.source_references || null,
        message_tag: message.message_tag || null,
        delivery_state: deliveryState,
        provider_message_id: providerMessageIdFor(message),
        delivery_source: message.delivery_source || metadata.delivery_source || null,
        reply_to: metadata.reply_to || (metadata.reply_to_provider_message_id
            ? {
                provider_message_id: metadata.reply_to_provider_message_id,
                internal_message_id: metadata.reply_to_internal_message_id || null,
                is_self_reply: metadata.reply_to_is_self_reply === true,
                status: metadata.reply_to_internal_message_id ? 'resolved' : 'unavailable',
            }
            : null),
        is_transcript_message: sender !== 'ai' || isProviderConfirmed(message),
        created_at: message.created_at,
        updated_at: message.updated_at || message.created_at,
    };
};

class ConversationService {
    mapMessage(message) {
        return mapMessage(message);
    }

    mapConversation(conversation) {
        const meta = normalizeObject(conversation.metadata);
        const channel = conversation.channel === 'messenger'
            ? 'facebook'
            : conversation.channel === 'web'
                ? 'webchat'
                : conversation.channel;

        const customer = plainCustomer(conversation.customer, channel);
        const customerName = customer?.name || customerFallbackName(channel, customer?.channel_user_id);
        const titleCandidate = conversation.title || meta.title;
        const title = internalIntentTitle(titleCandidate, conversation.intent)
            ? customerName
            : titleCandidate;

        // Phase 2 FK + Phase 4 purpose label. Lets the inbox label which page
        // / IG account a thread arrived on without a separate API call.
        const metaChannel = conversation.metaChannel || null;
        const metaChannelInfo = metaChannel
            ? {
                id: metaChannel.id,
                displayName: metaChannel.display_name || null,
                platform: metaChannel.platform || null,
                purposeLabel: metaChannel.settings?.purpose_label || null,
            }
            : null;

        return {
            id: conversation.id,
            customer_id: conversation.customer_id,
            customer,
            channel,
            meta_channel_id: conversation.meta_channel_id || null,
            metaChannel: metaChannelInfo,
            title,
            status: conversation.status || meta.status || 'active',
            hitl: conversation.hitl ?? false,
            lastMessage: meta.last_actual_message ?? conversation.message ?? null,
            unreadCount: Math.max(0, Number(meta.unreadCount) || 0),
            lastReadMessageId: meta.last_read_message_id || null,
            lastReadMessageAt: meta.last_read_message_at || null,
            // Sequelize timestamps with `underscored: true` are exposed on the
            // instance as camelCase accessors (createdAt/updatedAt) even though
            // the DB columns are snake_case. Reading conversation.created_at
            // directly returns undefined → the inbox rendered "Invalid Date" and
            // the 24h-window guard computed against NaN. Prefer the real accessor,
            // falling back to the snake_case key for plain-object inputs.
            created_at: conversation.createdAt ?? conversation.created_at,
            updated_at: conversation.updatedAt ?? conversation.updated_at
        };
    }

    async getConversations(shopId, options = {}) {
        try {
            const { page = 1, limit = 20, channel, customer_id, status } = options;
            const offset = (page - 1) * limit;

            const whereClause = { shop_id: shopId };
            if (channel) whereClause.channel = channel;
            if (customer_id) whereClause.customer_id = customer_id;
            
            // Add status filter for conversation management
            // Valid statuses: 'active', 'unanswered', 'pending_order', 'completed', 'followed_up'
            if (status) {
                const validStatuses = [
                    'active',
                    'unanswered',
                    'pending_order',
                    'completed',
                    'followed_up',
                    'closed',
                    'archived',
                ];
                if (validStatuses.includes(status)) {
                    whereClause.status = status;
                }
            }

            const [conversations, aiReplyMode] = await Promise.all([
                Conversation.findAndCountAll({
                    where: whereClause,
                    order: [['updated_at', 'DESC']],
                    limit,
                    offset,
                    include: [
                        {
                            model: Customer,
                            as: 'customer',
                            attributes: ['id', 'name', 'phone', 'channel_user_id']
                        },
                        {
                            model: MetaChannel,
                            as: 'metaChannel',
                            required: false,
                            attributes: ['id', 'display_name', 'platform'],
                            include: [{
                                model: MetaChannelSettings,
                                as: 'settings',
                                required: false,
                                attributes: ['purpose_label']
                            }]
                        }
                    ]
                }),
                // One shop-level read for the envelope; never resolve this per row.
                getEffectiveAiReplyMode(shopId),
            ]);

            const suggestionCounts = new Map();
            const messagesByConversation = new Map();
            const conversationIds = conversations.rows.map((row) => row.id);
            if (conversationIds.length > 0 && typeof Message.findAll === 'function') {
                const candidates = await Message.findAll({
                    where: {
                        conversation_id: { [Op.in]: conversationIds },
                    },
                    attributes: [
                        'id',
                        'conversation_id',
                        'sender',
                        'created_at',
                        'delivery_state',
                        'delivery_source',
                        'provider_message_id',
                        'metadata',
                    ],
                }) || [];
                for (const candidate of candidates) {
                    const conversationMessages = messagesByConversation.get(candidate.conversation_id) || [];
                    conversationMessages.push(candidate);
                    messagesByConversation.set(candidate.conversation_id, conversationMessages);
                }
                for (const candidate of candidates.filter(isReviewableSuggestion)) {
                    suggestionCounts.set(
                        candidate.conversation_id,
                        (suggestionCounts.get(candidate.conversation_id) || 0) + 1,
                    );
                }
            }

            return {
                conversations: conversations.rows.map((row) => ({
                    ...this.mapConversation(row),
                    suggestionCount: suggestionCounts.get(row.id) || 0,
                    hasAiSuggestion: suggestionCounts.has(row.id),
                    ...deriveWorkflowProjection(
                        row,
                        messagesByConversation.get(row.id) || [],
                        aiReplyMode,
                    ),
                })),
                ai_reply_mode: aiReplyMode,
                pagination: {
                    total: conversations.count,
                    page,
                    limit,
                    totalPages: Math.ceil(conversations.count / limit)
                }
            };
        } catch (error) {
            throw new Error(`Failed to fetch conversations: ${error.message}`);
        }
    }

    async getConversationById(conversationId, shopId) {
        try {
            const conversation = await Conversation.findOne({
                where: {
                    id: conversationId,
                    shop_id: shopId
                },
                include: [
                    { model: Customer, as: 'customer' },
                    {
                        model: MetaChannel,
                        as: 'metaChannel',
                        required: false,
                        attributes: ['id', 'display_name', 'platform'],
                        include: [{
                            model: MetaChannelSettings,
                            as: 'settings',
                            required: false,
                            attributes: ['purpose_label']
                        }]
                    }
                ]
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const [aiReplyMode, messages] = await Promise.all([
                getEffectiveAiReplyMode(shopId),
                typeof Message.findAll === 'function'
                    ? Message.findAll({
                        where: { conversation_id: conversationId },
                        attributes: [
                            'id',
                            'conversation_id',
                            'sender',
                            'created_at',
                            'delivery_state',
                            'delivery_source',
                            'provider_message_id',
                            'metadata',
                        ],
                    })
                    : [],
            ]);
            return {
                ...this.mapConversation(conversation),
                ...deriveWorkflowProjection(conversation, messages || [], aiReplyMode),
            };
        } catch (error) {
            throw new Error(`Failed to fetch conversation: ${error.message}`);
        }
    }

    async getMessages(conversationId, shopId, options = {}) {
        try {
            const { page = 1, limit = 50 } = options;
            const offset = (page - 1) * limit;

            const conversation = await Conversation.findOne({
                where: {
                    id: conversationId,
                    shop_id: shopId
                }
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const results = await Message.findAndCountAll({
                where: {
                    conversation_id: conversationId
                },
                // Page one must contain the newest messages so the merchant
                // actually sees the latest inbound before the read watermark is
                // advanced. Reverse the bounded page for chronological render.
                order: [['created_at', 'DESC']],
                limit,
                offset
            });

            const projectedMessages = results.rows.map(mapMessage).reverse();
            const messages = projectedMessages.filter((message) => message.is_transcript_message);
            const latestCustomerMessage = results.rows.find((message) => message.sender === 'customer');
            const latestCustomerAt = workflowTimestamp(latestCustomerMessage);
            const latestCustomerTurnId = normalizeObject(latestCustomerMessage?.metadata).logical_turn_id || null;
            const suggestions = results.rows
                .filter(isReviewableSuggestion)
                .filter((message) => {
                    const metadata = normalizeObject(message.metadata);
                    const suggestionTurnId = metadata.logical_turn_id || null;
                    if (latestCustomerTurnId && suggestionTurnId) {
                        return suggestionTurnId === latestCustomerTurnId;
                    }
                    const suggestionAt = workflowTimestamp(message);
                    return !Number.isFinite(latestCustomerAt)
                        || !Number.isFinite(suggestionAt)
                        || suggestionAt >= latestCustomerAt;
                })
                .map(mapMessage);

            return {
                messages,
                suggestions,
                pagination: {
                    total: results.count,
                    page,
                    limit,
                    totalPages: Math.ceil(results.count / limit)
                }
            };
        } catch (error) {
            throw new Error(`Failed to fetch messages: ${error.message}`);
        }
    }

    async createConversation(shopId, conversationData, requestId = null) {
        const logger = createLogger(requestId, shopId);
        const { sequelize } = require('../../utils/database/database-setup');
        const transaction = await sequelize.transaction();
        let committed = false;
        
        try {
            if (conversationData.customer_id && typeof Customer.findOne === 'function') {
                const ownedCustomer = await Customer.findOne({
                    where: { id: conversationData.customer_id, shop_id: shopId },
                    transaction,
                });
                if (!ownedCustomer) {
                    throw new AppError('Customer not found for this shop', 404);
                }
            }
            const resolvedTitle = conversationData.title
                || conversationData.metadata?.title
                || null;
            const resolvedStatus = conversationData.status
                || conversationData.metadata?.status
                || 'active';

            const metadata = {
                ...(conversationData.metadata || {}),
                title: resolvedTitle || conversationData.metadata?.title || null,
                status: resolvedStatus || conversationData.metadata?.status || 'active'
            };

            // Create conversation within transaction
            const conversation = await Conversation.create({
                ...conversationData,
                shop_id: shopId,
                title: resolvedTitle,
                status: resolvedStatus,
                metadata
            }, { transaction });

            // Commit transaction - NOW conversation is persisted
            await transaction.commit();
            committed = true;

            // ATOMIC: Track usage ONLY after successful DB commit
            // Uses transaction-safe idempotent tracking with request_id
            // Usage increments ONLY on successful database persistence
            try {
                const usageResult = await subscriptionService.trackUsage(
                    shopId,
                    'conversations',
                    1,
                    requestId || conversation.id, // Request-scoped idempotency key - prevents double counting
                    {
                        resourceId: conversation.id,
                        channel: conversation.channel,
                        customerId: conversation.customer_id
                    }
                );
                
                logger.logUsage('conversation_created', shopId, null, {
                    conversationId: conversation.id,
                    channel: conversation.channel,
                    transactionId: usageResult.transactionId,
                    isRetry: usageResult.isRetry
                });
            } catch (usageError) {
                logger.error('Failed to track conversation usage', usageError, {
                    conversationId: conversation.id,
                    severity: usageError.code === 'USAGE_LIMIT_EXCEEDED' ? 'critical' : 'error'
                });
                // The conversation transaction is already committed. Keep the
                // successful resource visible; the worker can use the persisted
                // allowance decision or retry metering without creating a
                // duplicate conversation on the client's retry.
            }

            return conversation;
        } catch (error) {
            if (!committed) await transaction.rollback();
            if (error instanceof AppError) throw error;
            logger.error('Failed to create conversation', error);
            throw new AppError(`Failed to create conversation: ${error.message}`, 500);
        }
    }

    async createMessage(conversationId, shopId, messageData) {
        const create = async (transaction) => {
            const conversation = await Conversation.findOne({
                where: {
                    id: conversationId,
                    shop_id: shopId
                },
                ...(transaction ? { transaction, lock: transaction.LOCK?.UPDATE } : {}),
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const sender = messageData.sender === 'agent'
                ? 'business'
                : messageData.sender || 'customer';
            const isManualOutbound = sender === 'business';
            const isMetaOutbound = ['facebook', 'messenger'].includes(conversation.channel);
            const sendIdempotencyKey = messageData.send_idempotency_key || null;
            if (isManualOutbound && sendIdempotencyKey && typeof Message.findOne === 'function') {
                const existing = await Message.findOne({
                    where: {
                        conversation_id: conversationId,
                        send_idempotency_key: sendIdempotencyKey,
                    },
                    ...(transaction ? { transaction } : {}),
                });
                if (existing) {
                    return { ...mapMessage(existing), idempotency_replay: true };
                }
            }
            const metadata = {
                ...sanitizeClientMessageMetadata(messageData.metadata),
                message_type: messageData.message_type || messageData.metadata?.message_type || 'text',
                ...(isManualOutbound ? {
                    delivered: !isMetaOutbound,
                    delivery_status: isMetaOutbound ? 'pending' : 'sent',
                    delivery_state: isMetaOutbound
                        ? MESSAGE_DELIVERY_STATES.SEND_PENDING
                        : MESSAGE_DELIVERY_STATES.SENT,
                    delivery_source: isMetaOutbound ? 'MANUAL' : 'LOCAL',
                } : {}),
            };

            const message = await Message.create({
                conversation_id: conversationId,
                content: messageData.content || messageData.message || '',
                sender,
                metadata,
                ai_suggestion: messageData.ai_suggestion || null,
                ai_confidence: messageData.ai_confidence || null,
                message_tag: messageData.message_tag || null,
                external_id: null,
                delivery_state: isManualOutbound
                    ? isMetaOutbound ? MESSAGE_DELIVERY_STATES.SEND_PENDING : MESSAGE_DELIVERY_STATES.SENT
                    : null,
                delivery_source: isManualOutbound ? (isMetaOutbound ? 'MANUAL' : 'LOCAL') : null,
                provider_message_id: null,
                send_idempotency_key: sendIdempotencyKey,
            }, transaction ? { transaction } : undefined);

            return { ...mapMessage(message), idempotency_replay: false };
        };

        try {
            if (sequelize?.getDialect?.() === 'postgres' && typeof sequelize.transaction === 'function') {
                return await sequelize.transaction((transaction) => create(transaction));
            }
            return await create(null);
        } catch (error) {
            throw new Error(`Failed to create message: ${error.message}`);
        }
    }

    async approveAiDraft(conversationId, shopId, messageId, content, actorId = null) {
        const transaction = await sequelize.transaction();
        try {
            const conversation = await Conversation.findOne({
                where: { id: conversationId, shop_id: shopId },
                transaction,
                lock: transaction.LOCK?.UPDATE,
            });
            if (!conversation) {
                const error = new Error('Conversation not found');
                error.statusCode = 404;
                throw error;
            }

            const candidate = await Message.findOne({
                where: { id: messageId, conversation_id: conversationId, sender: 'ai' },
                transaction,
                lock: transaction.LOCK?.UPDATE,
            });
            if (!candidate) {
                const error = new Error('AI suggestion not found');
                error.statusCode = 404;
                throw error;
            }

            const state = normalizeDeliveryState(candidate);
            if (state === MESSAGE_DELIVERY_STATES.SENT || state === MESSAGE_DELIVERY_STATES.DELIVERED) {
                await transaction.commit();
                return { message: mapMessage(candidate), alreadySent: true };
            }
            if (state === MESSAGE_DELIVERY_STATES.SEND_PENDING) {
                const error = new Error('AI suggestion send is already in progress');
                error.statusCode = 409;
                error.code = 'DRAFT_SEND_IN_PROGRESS';
                throw error;
            }
            if (normalizeObject(candidate.metadata).provider_send_attempted === true) {
                const error = new Error('Provider delivery was already attempted; send a fresh merchant reply after checking the channel');
                error.statusCode = 409;
                error.code = 'PROVIDER_SEND_ALREADY_ATTEMPTED';
                throw error;
            }
            if (state === MESSAGE_DELIVERY_STATES.DISMISSED) {
                const error = new Error('AI suggestion was dismissed');
                error.statusCode = 409;
                error.code = 'DRAFT_DISMISSED';
                throw error;
            }
            if (!isReviewableSuggestion(candidate)) {
                const error = new Error('AI suggestion is not awaiting merchant approval');
                error.statusCode = 409;
                error.code = 'DRAFT_NOT_APPROVABLE';
                throw error;
            }

            const approvedContent = content === undefined || content === null
                ? candidate.content
                : String(content).trim();
            if (!approvedContent) {
                const error = new Error('Approved message content is required');
                error.statusCode = 400;
                throw error;
            }
            if (approvedContent.length > 4000) {
                const error = new Error('Approved message content must not exceed 4000 characters');
                error.statusCode = 400;
                throw error;
            }

            const sendIdempotencyKey = deriveMessageSendIdempotencyKey({
                shopId,
                conversationId,
                messageId,
            });
            const nextMetadata = {
                ...normalizeObject(candidate.metadata),
                delivered: false,
                delivery_status: 'pending',
                delivery_state: MESSAGE_DELIVERY_STATES.SEND_PENDING,
                delivery_source: 'DRAFT_APPROVAL',
                suggestion_visibility: SUGGESTION_VISIBILITY.HIDDEN_AUTO_PROCESSING,
                held_reason: null,
                approved_at: new Date().toISOString(),
                approved_by_user_id: actorId || null,
                send_idempotency_key: sendIdempotencyKey,
            };

            await candidate.update({
                content: approvedContent,
                metadata: nextMetadata,
                delivery_state: MESSAGE_DELIVERY_STATES.SEND_PENDING,
                delivery_source: 'DRAFT_APPROVAL',
                provider_message_id: null,
                send_idempotency_key: sendIdempotencyKey,
            }, { transaction });
            if (InboxDeliveryOutbox && typeof InboxDeliveryOutbox.create === 'function'
                && ['facebook', 'messenger'].includes(conversation.channel)) {
                await InboxDeliveryOutbox.create({
                    shop_id: shopId,
                    conversation_id: conversationId,
                    message_id: messageId,
                    delivery_source: 'DRAFT_APPROVAL',
                    status: 'PENDING',
                    next_attempt_at: new Date(),
                }, { transaction });
            }
            await transaction.commit();
            return { message: candidate, sendIdempotencyKey, alreadySent: false };
        } catch (error) {
            if (!transaction.finished) await transaction.rollback();
            throw error;
        }
    }

    async settleInboxDeliveryOutbox(messageId, {
        sent = false,
        providerAttempted = false,
        providerMessageId = null,
        errorCode = null,
    } = {}) {
        if (!InboxDeliveryOutbox || typeof InboxDeliveryOutbox.update !== 'function' || !messageId) return;
        const status = sent ? 'COMPLETED' : providerAttempted ? 'NEEDS_RECONCILIATION' : 'PENDING';
        await InboxDeliveryOutbox.update({
            status,
            processing_token: null,
            ...(providerMessageId ? { provider_message_id: providerMessageId } : {}),
            last_error_code: errorCode || null,
            next_attempt_at: status === 'PENDING' ? new Date() : null,
        }, {
            where: {
                message_id: messageId,
                status: { [Op.in]: ['PENDING', 'PROCESSING'] },
            },
        });
    }

    async dismissAiDraft(conversationId, shopId, messageId, actorId = null) {
        const transaction = await sequelize.transaction();
        try {
            const conversation = await Conversation.findOne({
                where: { id: conversationId, shop_id: shopId },
                transaction,
                lock: transaction.LOCK?.UPDATE,
            });
            if (!conversation) {
                const error = new Error('Conversation not found');
                error.statusCode = 404;
                throw error;
            }
            const candidate = await Message.findOne({
                where: { id: messageId, conversation_id: conversationId, sender: 'ai' },
                transaction,
                lock: transaction.LOCK?.UPDATE,
            });
            if (!candidate) {
                const error = new Error('AI suggestion not found');
                error.statusCode = 404;
                throw error;
            }

            const state = normalizeDeliveryState(candidate);
            const dismissalCandidates = await loadDismissalCandidates(conversationId, transaction, candidate);
            const dismissedAt = new Date().toISOString();
            if (state === MESSAGE_DELIVERY_STATES.DISMISSED) {
                const dismissedSiblingMessageIds = await terminalizeDuplicateSiblings(
                    candidate,
                    dismissalCandidates,
                    transaction,
                    actorId,
                    dismissedAt,
                );
                await transaction.commit();
                return { message: mapMessage(candidate), alreadyDismissed: true, dismissedSiblingMessageIds };
            }
            if (state === MESSAGE_DELIVERY_STATES.SENT || state === MESSAGE_DELIVERY_STATES.DELIVERED) {
                const error = new Error('A sent AI message cannot be dismissed');
                error.statusCode = 409;
                error.code = 'DRAFT_ALREADY_SENT';
                throw error;
            }
            if (state === MESSAGE_DELIVERY_STATES.SEND_PENDING) {
                const error = new Error('AI suggestion send is already in progress');
                error.statusCode = 409;
                error.code = 'DRAFT_SEND_IN_PROGRESS';
                throw error;
            }
            if (normalizeObject(candidate.metadata).provider_send_attempted === true) {
                const error = new Error('Provider delivery was already attempted; reconcile the message before dismissing it');
                error.statusCode = 409;
                error.code = 'PROVIDER_SEND_ALREADY_ATTEMPTED';
                throw error;
            }
            if (!isReviewableSuggestion(candidate)) {
                const error = new Error('AI suggestion is not dismissible');
                error.statusCode = 409;
                error.code = 'DRAFT_NOT_DISMISSIBLE';
                throw error;
            }

            const metadata = dismissedMetadata(candidate, actorId, dismissedAt);
            await candidate.update({
                metadata,
                delivery_state: MESSAGE_DELIVERY_STATES.DISMISSED,
                delivery_source: candidate.delivery_source || 'AI_DRAFT',
            }, { transaction });
            const dismissedSiblingMessageIds = await terminalizeDuplicateSiblings(
                candidate,
                dismissalCandidates,
                transaction,
                actorId,
                dismissedAt,
            );
            await transaction.commit();
            return { message: candidate, alreadyDismissed: false, dismissedSiblingMessageIds };
        } catch (error) {
            if (!transaction.finished) await transaction.rollback();
            throw error;
        }
    }

    async markConversationRead(conversationId, shopId, messageId) {
        const transaction = await sequelize.transaction();
        let conversation;
        try {
            conversation = await Conversation.findOne({
                where: { id: conversationId, shop_id: shopId },
                transaction,
                lock: transaction.LOCK?.UPDATE,
            });
            if (!conversation) {
                const error = new Error('Conversation not found');
                error.statusCode = 404;
                throw error;
            }
            const readThrough = await Message.findOne({
                where: { id: messageId, conversation_id: conversationId, sender: 'customer' },
                transaction,
            });
            if (!readThrough) {
                const error = new Error('Read watermark must reference a customer message in this conversation');
                error.statusCode = 400;
                throw error;
            }

            const currentMetadata = normalizeObject(conversation.metadata);
            const requestedReadAt = new Date(readThrough.created_at).getTime();
            const currentReadAt = currentMetadata.last_read_message_at
                ? new Date(currentMetadata.last_read_message_at).getTime()
                : NaN;
            if (Number.isFinite(currentReadAt)
                && Number.isFinite(requestedReadAt)
                && requestedReadAt <= currentReadAt) {
                await transaction.commit();
                return this.mapConversation(conversation);
            }

            const unreadCount = typeof Message.count === 'function' && Number.isFinite(requestedReadAt)
                ? await Message.count({
                    where: {
                        conversation_id: conversationId,
                        sender: 'customer',
                        created_at: { [Op.gt]: readThrough.created_at },
                    },
                    transaction,
                })
                : 0;
            const metadata = {
                ...currentMetadata,
                unreadCount,
                last_read_message_id: readThrough.id,
                last_read_message_at: readThrough.created_at || new Date().toISOString(),
                last_read_at: new Date().toISOString(),
            };
            await conversation.update({ metadata }, { transaction });
            await transaction.commit();
            return this.mapConversation(conversation);
        } catch (error) {
            if (!transaction.finished) await transaction.rollback();
            throw error;
        }
    }

    async holdPendingAiCandidates(conversationId, shopId, reason = 'human_active') {
        const conversation = await Conversation.findOne({
            where: { id: conversationId, shop_id: shopId },
        });
        if (!conversation || typeof Message.findAll !== 'function') return 0;

        const candidates = await Message.findAll({
            where: { conversation_id: conversationId, sender: 'ai' },
        });
        const pending = candidates.filter((message) => {
            const state = normalizeDeliveryState(message);
            const metadata = normalizeObject(message.metadata);
            return !isProviderConfirmed(message)
                && state !== MESSAGE_DELIVERY_STATES.DISMISSED
                && state !== MESSAGE_DELIVERY_STATES.FAILED
                && metadata.provider_send_attempted !== true;
        });
        await Promise.all(pending.map(async (message) => {
            const metadata = {
                ...normalizeObject(message.metadata),
                delivered: false,
                delivery_status: 'held',
                delivery_state: MESSAGE_DELIVERY_STATES.HELD,
                held_reason: reason,
                suggestion_visibility: SUGGESTION_VISIBILITY.VISIBLE_HITL_REVIEW,
                cancelled_by_human: true,
                cancelled_at: new Date().toISOString(),
            };
            let updatedCount = 0;
            if (typeof Message.update === 'function') {
                const result = await Message.update({
                    delivery_state: MESSAGE_DELIVERY_STATES.HELD,
                    metadata,
                }, {
                    where: {
                        id: message.id,
                        conversation_id: conversationId,
                        sender: 'ai',
                        delivery_state: MESSAGE_DELIVERY_STATES.SEND_PENDING,
                        provider_message_id: null,
                        [Op.and]: [
                            literal(`(metadata->>'provider_send_attempted') IS DISTINCT FROM 'true'`),
                        ],
                    },
                });
                updatedCount = Array.isArray(result) ? result[0] : 1;
            } else if (typeof message.update === 'function') {
                await message.update({
                    delivery_state: MESSAGE_DELIVERY_STATES.HELD,
                    metadata,
                });
                updatedCount = 1;
            }
            if (updatedCount !== 1) return;
            message.delivery_state = MESSAGE_DELIVERY_STATES.HELD;
            message.metadata = metadata;
            sseManager.emit(shopId, 'message_delivery_updated', {
                conversation_id: conversationId,
                message_id: message.id,
                metadata,
                delivery_state: MESSAGE_DELIVERY_STATES.HELD,
                delivery_source: message.delivery_source || metadata.delivery_source || null,
                content: message.content || null,
                sender: message.sender === 'business' ? 'agent' : message.sender || 'ai',
                created_at: message.created_at || null,
            });
        }));
        return pending.length;
    }

    async updateConversation(conversationId, shopId, updates) {
        const update = async (transaction) => {
            const conversation = await Conversation.findOne({
                where: { id: conversationId, shop_id: shopId },
                ...(transaction ? { transaction, lock: transaction.LOCK?.UPDATE } : {}),
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const currentConversationMetadata = normalizeObject(conversation.metadata);
            const closing = updates.status === 'closed';
            const resuming = updates.hitl === false && !closing;
            const existingResumeBoundaryState = resumeBoundaryStateFor(conversation);
            if (resuming
                && existingResumeBoundaryState.present
                && !existingResumeBoundaryState.valid) {
                const error = new Error('Resume AI boundary is invalid');
                error.code = 'RESUME_BOUNDARY_INVALID';
                throw error;
            }
            const existingResumeBoundary = existingResumeBoundaryState.valid
                ? existingResumeBoundaryState.timestamp
                : null;
            const resumeBoundary = resuming
                ? (conversation.hitl === true || !existingResumeBoundary
                    ? new Date().toISOString()
                    : new Date(existingResumeBoundary).toISOString())
                : null;
            const fields = {};
            if (updates.hitl !== undefined) fields.hitl = updates.hitl;
            if (updates.status !== undefined) {
                fields.status = updates.status;
                fields.metadata = { ...currentConversationMetadata, status: updates.status };
                if (updates.status === 'closed') {
                    // Fence any in-flight pre-close AI turn. A later customer
                    // inbound is newer than this boundary and still reopens normally.
                    fields.metadata[RESUME_BOUNDARY_METADATA_KEY] = new Date().toISOString();
                }
                if (updates.status === 'closed' && !conversation.resolved_at) {
                    fields.resolved_at = new Date();
                }
                if (updates.status === 'closed') {
                    // Resolution ends the transient human session. The shop's
                    // global automation mode is intentionally unchanged.
                    fields.hitl = false;
                }
            }
            if (resuming && (conversation.hitl === true || !existingResumeBoundary)) {
                fields.metadata = {
                    ...(fields.metadata || currentConversationMetadata),
                    [RESUME_BOUNDARY_METADATA_KEY]: resumeBoundary,
                };
            }
            if (updates.assignee_id !== undefined) fields.assignee_id = updates.assignee_id;
            if (updates.resolution_note !== undefined) fields.resolution_note = updates.resolution_note;

            await conversation.update(fields, ...(transaction ? [{ transaction }] : []));

            const heldEvents = [];

            // Takeover and resolution invalidate any candidate that has not
            // crossed the provider boundary. The worker performs the same check
            // at its final send gate, while this update keeps an already-
            // persisted pending candidate from appearing sendable elsewhere.
            if ((updates.hitl === true || updates.hitl === false || updates.status === 'closed')
                && typeof Message.findAll === 'function') {
                const heldReason = closing ? 'conversation_closed' : 'human_active';
                const nextState = resuming
                    ? MESSAGE_DELIVERY_STATES.DISMISSED
                    : MESSAGE_DELIVERY_STATES.HELD;
                const suggestionVisibility = closing || resuming
                    ? SUGGESTION_VISIBILITY.HIDDEN_DISMISSED
                    : SUGGESTION_VISIBILITY.VISIBLE_HITL_REVIEW;
                const candidateWhere = {
                    conversation_id: conversationId,
                    sender: 'ai',
                };
                const pending = await Message.findAll({
                    where: candidateWhere,
                    ...(transaction ? { transaction, lock: transaction.LOCK?.UPDATE } : {}),
                });
                const cancellable = pending.filter((message) => (
                    !isProviderConfirmed(message)
                    && normalizeDeliveryState(message) !== MESSAGE_DELIVERY_STATES.DISMISSED
                    && normalizeObject(message.metadata).provider_send_attempted !== true
                    && (!resuming || isResumableStaleCandidate(message, resumeBoundary))
                ));
                await Promise.all(cancellable.map(async (message) => {
                    const messageMetadata = normalizeObject(message.metadata);
                    const metadata = {
                        ...messageMetadata,
                        delivered: false,
                        delivery_status: resuming ? 'dismissed' : 'held',
                        delivery_state: nextState,
                        held_reason: resuming ? 'resume_obsolete' : heldReason,
                        suggestion_visibility: suggestionVisibility,
                        ...(resuming ? {
                            dismissed_at: new Date().toISOString(),
                            dismissed_by_resume: true,
                        } : {}),
                    };
                    await message.update({
                        delivery_state: nextState,
                        metadata,
                    }, ...(transaction ? [{ transaction }] : []));
                    heldEvents.push({ message, metadata });
                }));
            }

            return { conversation, heldEvents };
        };

        try {
            const result = sequelize?.getDialect?.() === 'postgres' && typeof sequelize.transaction === 'function'
                ? await sequelize.transaction((transaction) => update(transaction))
                : await update(null);
            for (const { message, metadata } of result.heldEvents) {
                sseManager.emit(shopId, 'message_delivery_updated', {
                    conversation_id: conversationId,
                    message_id: message.id,
                    metadata,
                    delivery_state: metadata.delivery_state,
                    delivery_source: message.delivery_source || metadata.delivery_source || null,
                    content: message.content || null,
                    sender: message.sender === 'business' ? 'agent' : message.sender || 'ai',
                    created_at: message.created_at || null,
                });
            }
            const aiReplyMode = await getEffectiveAiReplyMode(shopId);
            const messages = typeof Message.findAll === 'function'
                ? await Message.findAll({
                    where: { conversation_id: conversationId },
                    attributes: [
                        'id',
                        'conversation_id',
                        'sender',
                        'created_at',
                        'delivery_state',
                        'delivery_source',
                        'provider_message_id',
                        'metadata',
                    ],
                })
                : [];
            return {
                ...this.mapConversation(result.conversation),
                hitl: result.conversation.hitl,
                ...deriveWorkflowProjection(result.conversation, messages || [], aiReplyMode),
            };
        } catch (error) {
            const wrapped = new Error(`Failed to update conversation: ${error.message}`);
            if (error?.code) wrapped.code = error.code;
            throw wrapped;
        }
    }

    async updateConversationStatus(conversationId, shopId, status) {
        return this.updateConversation(conversationId, shopId, { status: status || 'active' });
    }

    async bulkUpdateStatus(shopId, conversationIds = [], status) {
        try {
            if (!shopId) {
                const error = new Error('Shop ID is required');
                error.statusCode = 400;
                throw error;
            }

            if (!Array.isArray(conversationIds) || conversationIds.length === 0) {
                const error = new Error('conversationIds must be a non-empty array');
                error.statusCode = 400;
                throw error;
            }

            const allowedStatuses = new Set([
                'active',
                'closed',
                'archived',
                'unanswered',
                'pending_order',
                'completed',
                'followed_up'
            ]);

            if (!allowedStatuses.has(status)) {
                const error = new Error('Invalid status');
                error.statusCode = 400;
                throw error;
            }

            if (status === 'closed') {
                const targets = typeof Conversation.findAll === 'function'
                    ? await Conversation.findAll({
                        where: {
                            shop_id: shopId,
                            id: { [Op.in]: conversationIds },
                        },
                        attributes: ['id'],
                    })
                    : conversationIds.map((id) => ({ id }));
                const updatedConversationIds = [];

                for (const target of targets) {
                    const conversationId = target?.id || target;
                    const deliveryLock = await acquireBulkDeliveryLock(conversationId);
                    try {
                        const updatedConversation = await this.updateConversation(conversationId, shopId, { status: 'closed' });
                        updatedConversationIds.push(conversationId);
                        await Promise.resolve(cacheRedis.del(`ai:pause:${conversationId}`)).catch(() => {});
                        sseManager.emit(shopId, 'hitl_changed', {
                            conversation_id: conversationId,
                            hitl: updatedConversation.hitl,
                            status: updatedConversation.status,
                            needs_merchant_reply: updatedConversation.needs_merchant_reply,
                            needs_merchant_reply_reason: updatedConversation.needs_merchant_reply_reason,
                            ai_is_replying: updatedConversation.ai_is_replying,
                        });
                    } finally {
                        await releaseBulkDeliveryLock(deliveryLock, conversationId);
                    }
                }

                return {
                    requested: conversationIds.length,
                    updated: updatedConversationIds.length,
                    skipped: Math.max(conversationIds.length - updatedConversationIds.length, 0),
                    status,
                    updated_conversation_ids: updatedConversationIds,
                };
            }

            const [updatedCount] = await Conversation.update(
                { status },
                {
                    where: {
                        shop_id: shopId,
                        id: {
                            [Op.in]: conversationIds
                        }
                    }
                }
            );

            if (status === 'active' && typeof Conversation.findAll === 'function') {
                const updatedConversationRows = await Conversation.findAll({
                    where: {
                        shop_id: shopId,
                        id: { [Op.in]: conversationIds },
                    },
                    attributes: ['id'],
                });
                await Promise.all(updatedConversationRows.map(({ id: conversationId }) => (
                    Promise.resolve(cacheRedis.del(`ai:pause:${conversationId}`)).catch(() => {})
                )));
            }

            return {
                requested: conversationIds.length,
                updated: updatedCount,
                skipped: Math.max(conversationIds.length - updatedCount, 0),
                status
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Bug #2 Fix: Full-history search across conversations AND messages.
     * Searches customer name, phone, conversation title, and message content.
     * Returns conversations that match, each annotated with the matching message snippet.
     * 
     * Improvements:
     * - Proper pagination on merged results (not per-query)
     * - Returns total count for proper pagination UI
     * - Uses indexed columns for performance
     */
    async searchConversations(shopId, query, options = {}) {
        const { limit = 20, page = 1 } = options;
        const offset = (page - 1) * limit;

        if (!query || query.trim().length < 2) {
            throw new Error('Search query must be at least 2 characters');
        }

        const like = `%${query.trim()}%`;

        // Search conversations by customer name/phone/title
        const conversationMatches = await Conversation.findAll({
            where: {
                shop_id: shopId,
                [Op.or]: [
                    { title: { [Op.like]: like } }
                ]
            },
            include: [{ model: Customer, as: 'customer' }],
            order: [['created_at', 'DESC']]
            // Note: Don't apply limit/offset here — merge first, paginate after
        });

        // Search message content across ALL messages in this shop's conversations
        const messageMatches = await Message.findAll({
            where: { content: { [Op.like]: like } },
            include: [{
                model: Conversation,
                as: 'conversation',
                where: { shop_id: shopId },
                include: [{ model: Customer, as: 'customer' }]
            }],
            order: [['created_at', 'DESC']]
            // Note: Don't apply limit/offset here — merge first, paginate after
        });

        // Merge results, deduplicate by conversation_id
        const seen = new Set();
        const results = [];

        for (const conv of conversationMatches) {
            if (!seen.has(conv.id)) {
                seen.add(conv.id);
                results.push({ ...this.mapConversation(conv), matchType: 'conversation' });
            }
        }

        for (const msg of messageMatches) {
            const conv = msg.conversation;
            if (conv && !seen.has(conv.id)) {
                seen.add(conv.id);
                results.push({
                    ...this.mapConversation(conv),
                    matchType: 'message',
                    matchSnippet: msg.content?.slice(0, 120)
                });
            }
        }

        // FIX BUG #2: Apply pagination AFTER merging to ensure proper page navigation
        const totalResults = results.length;
        const paginatedResults = results.slice(offset, offset + limit);

        return {
            results: paginatedResults,
            pagination: {
                total: totalResults,
                page,
                limit,
                totalPages: Math.ceil(totalResults / limit),
                hasMore: offset + limit < totalResults
            },
            query
        };
    }

    async getHistoryByCustomer(shopId, customerId, options = {}) {
        const { limit = 10, within_hours } = options;
        const whereClause = {
            shop_id: shopId,
            customer_id: customerId
        };

        if (within_hours) {
            const since = new Date(Date.now() - Number(within_hours) * 60 * 60 * 1000);
            whereClause.created_at = {
                [Op.gte]: since
            };
        }

        const entries = await Conversation.findAll({
            where: whereClause,
            order: [['created_at', 'DESC']],
            limit: Number(limit)
        });

        return entries;
    }

    /**
     * Auto-detect and update conversation status based on conversation state
     * Statuses: 'active', 'unanswered', 'pending_order', 'completed', 'followed_up'
     * 
     * Logic:
     *   - 'pending_order': if any attached order is in draft or pending state
     *   - 'followed_up': if agent has sent a message to this conversation
     *   - 'unanswered': if last message is from customer and >30 min old with no AI response
     *   - 'completed': if conversation marked as completed or all orders shipped
     *   - 'active': default for ongoing conversations
     */
    async autoDetectAndUpdateStatus(conversationId, shopId) {
        try {
            const conversation = await Conversation.findOne({
                where: { id: conversationId, shop_id: shopId }
            });

            if (!conversation) {
                return null;
            }

            let detectedStatus = 'active';

            // Import Order model to check for pending orders
            const { Order } = require('../order/order.entity');
            const pendingOrder = await Order.findOne({
                where: {
                    conversation_id: conversationId,
                    status: ['draft', 'pending']
                }
            });

            if (pendingOrder) {
                detectedStatus = 'pending_order';
            } else {
                // Check if agent has replied (message from 'business')
                const agentMessage = await Message.findOne({
                    where: {
                        conversation_id: conversationId,
                        sender: 'business'
                    },
                    order: [['created_at', 'DESC']],
                    limit: 1
                });

                if (agentMessage) {
                    detectedStatus = 'followed_up';
                } else {
                    // Check if unanswered (last message from customer, 30+ min old)
                    const lastCustomerMessage = await Message.findOne({
                        where: {
                            conversation_id: conversationId,
                            sender: 'customer'
                        },
                        order: [['created_at', 'DESC']],
                        limit: 1
                    });

                    if (lastCustomerMessage) {
                        const minutesOld = (Date.now() - lastCustomerMessage.created_at.getTime()) / 60000;
                        if (minutesOld > 30) {
                            detectedStatus = 'unanswered';
                        }
                    }
                }
            }

            // Only update if status changed
            if (conversation.status !== detectedStatus) {
                await conversation.update({ status: detectedStatus });
            }

            return detectedStatus;
        } catch (error) {
            // Log but don't throw — status detection is a nice-to-have
            console.warn(`Failed to auto-detect status for conversation ${conversationId}:`, error.message);
            return null;
        }
    }

    /**
     * ✅ NEW: Send auto-reply when conversation is escalated to human agents
     * Fetches the escalation_reply_template from shop settings and creates a message
     *
     * @param {string} conversationId - Conversation to escalate
     * @param {string} shopId - Shop ID for settings lookup
     * @returns {Promise<Message>} - The created escalation message
     */
    async sendEscalationAutoReply(conversationId, shopId) {
        try {
            const shopService = require('../shop/shop.service');
            const aiSettings = await shopService.getShopAiSettings(shopId);
            
            if (!aiSettings || !aiSettings.escalation_reply_template) {
                return null; // No template configured, skip
            }

            const conversation = await Conversation.findOne({
                where: { id: conversationId, shop_id: shopId }
            });

            if (!conversation) {
                throw new Error(`Conversation ${conversationId} not found`);
            }

            // Create escalation message from AI with the template
            const escalationReply = await Message.create({
                conversation_id: conversationId,
                content: aiSettings.escalation_reply_template,
                sender: 'ai',
                ai_confidence: 1.0,  // Escalation replies are always sent
                metadata: {
                    type: 'escalation_auto_reply',
                    timestamp: new Date().toISOString()
                }
            });

            return this._mapMessage(escalationReply);
        } catch (error) {
            console.warn(`Failed to send escalation auto-reply for conversation ${conversationId}:`, error.message);
            return null;
        }
    }

    /**
     * Helper to map message entity to API response format
     */
    _mapMessage(message) {
        return {
            id: message.id,
            conversation_id: message.conversation_id,
            content: message.content,
            sender: message.sender === 'business' ? 'agent' : message.sender,
            ai_confidence: message.ai_confidence ? Number(message.ai_confidence) : null,
            source_references: message.source_references || null,
            created_at: message.created_at,
            updated_at: message.updated_at || message.created_at
        };
    }
}

module.exports = new ConversationService();
