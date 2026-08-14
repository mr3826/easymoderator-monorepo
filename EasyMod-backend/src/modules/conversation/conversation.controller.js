const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const conversationService = require('./conversation.service');
const { sendEscalationAutoReply } = require('./escalation-auto-reply.service');
const cacheService = require('../../utils/cache.service');
const sseManager = require('../../utils/sse-manager');
const { cacheRedis } = require('../../config/redis');
const { Conversation: ConvModel, Customer: CustomerModel, Message: MessageModel } = require('../entities');
const metaChannelService = require('../channel-providers/meta-channel.service');
const MetaChannel = require('../channel-providers/meta-channel.entity');
const { getProvider } = require('../channel-providers/provider.registry');
const policyEngine = require('../policy/policy.engine');
const { resolvePublicAssetOrigin } = require('../../config/origins');
const config = require('../../config/config');

const AI_PAUSE_TTL_SECS = 1800; // 30 minutes
const META_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_UPLOAD_DIR = path.join(__dirname, '../../../uploads/conversation-attachments');
const ATTACHMENT_URL_TTL_SECONDS = 15 * 60;
const ALLOWED_META_ATTACHMENT_TYPES = {
    'image/jpeg': { ext: 'jpg', metaType: 'image' },
    'image/png': { ext: 'png', metaType: 'image' },
    'image/gif': { ext: 'gif', metaType: 'image' },
    'image/webp': { ext: 'webp', metaType: 'image' },
    'application/pdf': { ext: 'pdf', metaType: 'file' },
    'text/plain': { ext: 'txt', metaType: 'file' },
    'text/csv': { ext: 'csv', metaType: 'file' },
    'application/msword': { ext: 'doc', metaType: 'file' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', metaType: 'file' },
    'application/vnd.ms-excel': { ext: 'xls', metaType: 'file' },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', metaType: 'file' },
};

// Channels that route through Meta Graph API for delivery (Facebook-only).
// Legacy 'instagram' conversation rows resolve to undefined here and are
// skipped — Instagram is no longer a deliverable channel.
const META_CHANNEL_PLATFORM = {
    messenger: 'facebook',
    facebook:  'facebook',
};

function makeHttpError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

function parseDataUrl(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
    if (!match) return null;
    return {
        mimeType: match[1].toLowerCase(),
        buffer: Buffer.from(match[2].replace(/\s/g, ''), 'base64'),
    };
}

function isHttpsUrl(value) {
    if (typeof value !== 'string') return false;
    try {
        return new URL(value).protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function safePublicBaseUrl(req) {
    return resolvePublicAssetOrigin(req);
}

function attachmentSigningSecret() {
    return config.csrfSecret || config.sessionSecret || '';
}

function signAttachmentPath(shopId, fileName, expires) {
    return crypto.createHmac('sha256', attachmentSigningSecret())
        .update(`${shopId}/${fileName}.${expires}`)
        .digest('hex');
}

async function serveConversationAttachment(req, res, next) {
    try {
        const { shopId, fileName } = req.params;
        const expires = Number(req.query.expires);
        const signature = String(req.query.signature || '');
        const secret = attachmentSigningSecret();

        if (!secret || !/^\d+$/.test(String(req.query.expires || ''))
            || !Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)
            || !/^[A-Za-z0-9_-]+$/.test(shopId)
            || path.basename(fileName) !== fileName
            || !/^[a-f0-9]{64}$/.test(signature)) {
            return res.status(404).end();
        }

        const expected = signAttachmentPath(shopId, fileName, expires);
        const expectedBuffer = Buffer.from(expected, 'utf8');
        const receivedBuffer = Buffer.from(signature, 'utf8');
        if (expectedBuffer.length !== receivedBuffer.length
            || !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
            return res.status(404).end();
        }

        const absolutePath = path.join(ATTACHMENT_UPLOAD_DIR, shopId, fileName);
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (!stat?.isFile()) return res.status(404).end();
        return res.sendFile(absolutePath, { dotfiles: 'deny' }, (error) => {
            if (error) next(error);
        });
    } catch (error) {
        next(error);
    }
}

function getAttachmentUrlFromMetadata(metadata = {}) {
    return metadata.image_url || metadata.file_url || metadata.file_data_url;
}

async function prepareOutboundAttachmentMetadata(req, shopId, messageData) {
    const metadata = { ...(messageData.metadata || {}) };
    const incomingDataUrl = metadata.file_data_url || (parseDataUrl(metadata.image_url) ? metadata.image_url : null) || (parseDataUrl(metadata.file_url) ? metadata.file_url : null);
    const existingUrl = metadata.image_url || metadata.file_url;

    if (!incomingDataUrl && !existingUrl) {
        return messageData;
    }

    if (!incomingDataUrl && existingUrl && !isHttpsUrl(existingUrl)) {
        throw makeHttpError(400, 'Attachment URL must be HTTPS');
    }

    const parsed = parseDataUrl(incomingDataUrl);
    if (!parsed) {
        return {
            ...messageData,
            metadata: {
                ...metadata,
                delivery_status: metadata.delivery_status || 'pending',
            },
        };
    }

    const allowed = ALLOWED_META_ATTACHMENT_TYPES[parsed.mimeType];
    if (!allowed) {
        throw makeHttpError(400, 'Attachment type is not supported for Messenger');
    }
    if (parsed.buffer.length > META_ATTACHMENT_MAX_BYTES) {
        throw makeHttpError(400, 'Attachment exceeds the 25MB Messenger limit');
    }

    const messageType = allowed.metaType === 'image' ? 'image' : 'file';
    const publicBaseUrl = safePublicBaseUrl(req);
    if (!isHttpsUrl(publicBaseUrl)) {
        throw makeHttpError(400, 'Attachment delivery requires an HTTPS PUBLIC_BASE_URL or BASE_URL');
    }
    const uploadDir = path.join(ATTACHMENT_UPLOAD_DIR, shopId);
    await fs.mkdir(uploadDir, { recursive: true });
    const fileName = `${Date.now()}-${crypto.randomUUID()}.${allowed.ext}`;
    const absolutePath = path.join(uploadDir, fileName);
    await fs.writeFile(absolutePath, parsed.buffer);

    if (!attachmentSigningSecret()) {
        throw makeHttpError(503, 'Attachment delivery is not configured');
    }
    const expires = Math.floor(Date.now() / 1000) + ATTACHMENT_URL_TTL_SECONDS;
    const signature = signAttachmentPath(shopId, fileName, expires);
    const publicPath = `/uploads/conversation-attachments/${shopId}/${fileName}`;
    const publicUrl = `${publicBaseUrl}${publicPath}?expires=${expires}&signature=${signature}`;
    const storedMetadata = {
        ...metadata,
        message_type: messageType,
        mime_type: parsed.mimeType,
        file_size: parsed.buffer.length,
        file_url: publicUrl,
        delivery_status: 'pending',
        attachment_source: 'inbox_upload',
    };
    delete storedMetadata.file_data_url;
    if (messageType === 'image') {
        storedMetadata.image_url = publicUrl;
    } else {
        delete storedMetadata.image_url;
    }

    return {
        ...messageData,
        message_type: messageType,
        metadata: storedMetadata,
    };
}

function buildOutboundAttachments(message) {
    const metadata = message?.metadata || {};
    const messageType = metadata.message_type || message?.message_type;
    if (!['image', 'file'].includes(messageType)) return [];
    const url = getAttachmentUrlFromMetadata(metadata);
    if (!isHttpsUrl(url)) {
        throw new Error('Outbound attachment URL must be HTTPS');
    }
    return [{
        type: messageType === 'image' ? 'image' : 'file',
        url,
        name: metadata.file_name || null,
        mime_type: metadata.mime_type || null,
        size: metadata.file_size || null,
    }];
}

async function updateDeliveryStatus(shopId, conversationId, message, status, updates = {}) {
    if (!message?.id) return;
    const metadata = { ...(message.metadata || {}), delivery_status: status, ...updates };
    await MessageModel.update({ metadata }, { where: { id: message.id, conversation_id: conversationId } });
    sseManager.emit(shopId, 'message_delivery_updated', {
        conversation_id: conversationId,
        message_id: message.id,
        metadata,
    });
}

/**
 * Deliver an outbound message to the customer's Meta channel.
 * Phase 5: resolves MetaChannel (single source of truth), evaluates policy,
 * and delegates to the provider registry for transport.
 * Best-effort: never throws. Emits SSE `delivery_failed` on failure.
 */
async function deliverViaMetaIfApplicable(conversationId, shopId, outboundMessage) {
    let isMetaChannel = false;
    let failureReason = null;
    let deliveryResult = null;
    const content = typeof outboundMessage === 'string' ? outboundMessage : outboundMessage?.content || '';
    let attachments = [];
    try {
        attachments = typeof outboundMessage === 'string' ? [] : buildOutboundAttachments(outboundMessage);
        const conversation = await ConvModel.findOne({
            where: { id: conversationId, shop_id: shopId },
            include: [{ model: CustomerModel, as: 'customer' }]
        });
        if (!conversation) return;

        const platform = META_CHANNEL_PLATFORM[conversation.channel];
        if (!platform) return; // webchat/telegram — no Meta delivery expected

        isMetaChannel = true; // past this point: failures should surface to the agent

        const recipientId = conversation.customer?.channel_user_id;
        if (!recipientId) {
            failureReason = 'Customer Meta ID missing — message saved but not delivered to Messenger';
            return;
        }

        // Prefer the channel the conversation was pinned to (Phase 2 FK), so
        // multi-Page shops reply from the same Page the customer wrote to. Fall
        // back to shop+platform for pre-Phase-2 conversations without the FK.
        let metaChannel = null;
        if (conversation.meta_channel_id) {
            metaChannel = await MetaChannel.findByPk(conversation.meta_channel_id);
            if (metaChannel && metaChannel.shop_id !== shopId) metaChannel = null;
        }
        if (!metaChannel) {
            metaChannel = await metaChannelService.findByShopAndPlatform(shopId, platform);
        }
        if (!metaChannel) {
            failureReason = `No active ${platform} channel — connect your page in Settings → Channels`;
            return;
        }

        if (metaChannel.status !== 'CONNECTED') {
            failureReason = `Channel is ${metaChannel.status} — reconnect in Settings → Channels`;
            return;
        }

        const autoFileContent = attachments.length > 0 && outboundMessage?.metadata?.file_name && content === outboundMessage.metadata.file_name;
        const normalizedMessage = {
            text: autoFileContent ? '' : content,
            attachments,
            platform,
            direction: 'outbound',
            senderRole: 'agent',
        };
        const policyCtx = {
            shopId,
            channelId: metaChannel.id,
            recipientId,
            channel: metaChannel,
            customer: conversation.customer, // already loaded via include above
            platform,
        };
        const decision = await policyEngine.evaluateOutbound(normalizedMessage, policyCtx);
        if (!decision.allow) {
            failureReason = `Message blocked by policy: ${decision.reason}`;
            return;
        }

        const provider = getProvider(platform);
        deliveryResult = await provider.sendMessage({
            channel: metaChannel,
            recipientId,
            normalizedMessage: decision.transform || normalizedMessage,
            decision,
        });
        console.log(`[inbox] Message delivered via ${platform} to ${recipientId} (conv: ${conversationId})`);
    } catch (err) {
        failureReason = err.message;
        console.error(`[inbox] Meta delivery failed for conversation ${conversationId}: ${err.message}`);
    } finally {
        if (isMetaChannel && failureReason) {
            await updateDeliveryStatus(shopId, conversationId, outboundMessage, 'failed', {
                delivery_error: failureReason,
            }).catch(() => {});
            sseManager.emit(shopId, 'delivery_failed', {
                conversation_id: conversationId,
                message_id: outboundMessage?.id,
                reason: failureReason
            });
        } else if (isMetaChannel && outboundMessage?.id) {
            await updateDeliveryStatus(shopId, conversationId, outboundMessage, 'sent', {
                provider_message_id: deliveryResult?.providerMessageId || null,
                provider_message_ids: deliveryResult?.providerMessageIds || undefined,
            }).catch(() => {});
        }
    }
}

class ConversationController {
    async getConversations(req, res, next) {
        try {
            const shopId = req.user?.shopId;

            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
                });
            }

            const options = req.query;
            const result = await conversationService.getConversations(shopId, options);

            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }

    async getConversationById(req, res, next) {
        try {
            const { conversationId } = req.params;
            const shopId = req.user?.shopId;

            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
                });
            }

            const conversation = await conversationService.getConversationById(conversationId, shopId);
            res.json({ success: true, data: conversation });
        } catch (error) {
            next(error);
        }
    }

    async getMessages(req, res, next) {
        try {
            const { conversationId } = req.params;
            const shopId = req.user?.shopId;

            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
                });
            }

            const result = await conversationService.getMessages(conversationId, shopId, req.query);
            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    }

    async createConversation(req, res) {
        try {
            const shopId = req.user?.shopId;
            
            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Shop ID is required'
                    }
                });
            }
            const {
                customer_id,
                channel_type,
                channel,
                role,
                message,
                normalized_message,
                intent,
                intent_confidence,
                title,
                status,
                entities,
                response_metadata
            } = req.body;

            const resolvedChannel = channel_type || channel;

            const conversationData = {
                customer_id,
                channel: resolvedChannel,
                role,
                message,
                intent: intent || null,
                confidence: intent_confidence ? Math.round(intent_confidence * 100) : null,
                llm_used: Boolean(response_metadata && response_metadata.ai_model),
                cache_hit: Boolean(response_metadata && response_metadata.cache_hit),
                keyword_match: Boolean(response_metadata && response_metadata.keyword_match),
                metadata: {
                    normalized_message: normalized_message || null,
                    entities: entities || {},
                    response_metadata: response_metadata || {},
                    title: title || null,
                    status: status || null
                }
            };

            const conversation = await conversationService.createConversation(shopId, conversationData);

            res.status(201).json({
                conversation_id: conversation.id,
                created_at: conversation.created_at
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'CONVERSATION_CREATE_FAILED',
                    message: error.message
                }
            });
        }
    }

    async createMessage(req, res) {
        try {
            const { conversationId } = req.params; // Already validated
            const shopId = req.user?.shopId;
            
            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Shop ID is required'
                    }
                });
            }
            const messageData = await prepareOutboundAttachmentMetadata(req, shopId, req.body); // Already validated

            const message = await conversationService.createMessage(conversationId, shopId, messageData);

            // Push real-time update to all open agent tabs for this shop
            sseManager.emit(shopId, 'new_message', { conversation_id: conversationId, message });

            // AI pause: when a human agent sends a message, mute AI replies for 30 min.
            // Frontend sends sender='agent'; service maps it to 'business' in DB — check both.
            const sender = messageData.sender || req.body.sender;
            if (sender === 'agent' || sender === 'business') {
                cacheRedis.setex(`ai:pause:${conversationId}`, AI_PAUSE_TTL_SECS, '1').catch(() => {});
                // Deliver agent reply to customer via Meta Graph API (fire-and-forget)
                deliverViaMetaIfApplicable(conversationId, shopId, message);
            }

            res.status(201).json({
                success: true,
                data: message
            });
        } catch (error) {
            const statusCode = error.statusCode || (error.message === 'Conversation not found' ? 404 : 500);
            const errorCode = statusCode === 404 ? 'CONVERSATION_NOT_FOUND' : 'MESSAGE_CREATE_FAILED';

            res.status(statusCode).json({
                success: false,
                error: {
                    code: errorCode,
                    message: error.message
                }
            });
        }
    }

    async updateConversation(req, res) {
        try {
            const { conversationId } = req.params;
            const shopId = req.user?.shopId;

            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
                });
            }

            const { hitl, status, assignee_id, resolution_note } = req.body;
            const conversation = await conversationService.updateConversation(
                conversationId,
                shopId,
                { hitl, status, assignee_id, resolution_note }
            );

            // Notify other agent tabs of HITL change first so the banner appears immediately
            if (hitl !== undefined) {
                sseManager.emit(shopId, 'hitl_changed', {
                    conversation_id: conversationId,
                    hitl: conversation.hitl
                });
            }

            // When re-enabling AI (HITL off), clear the 30-min manual-reply pause so the AI
            // can respond immediately instead of waiting out the remainder of the timer.
            if (hitl === false) {
                cacheRedis.del(`ai:pause:${conversationId}`).catch(() => {});
            }

            // Send escalation auto-reply synchronously so the agent response only returns
            // after the customer notification attempt is complete (success or logged failure).
            if (hitl === true) {
                try {
                    const autoReplyMsg = await sendEscalationAutoReply(conversationId, shopId);
                    if (autoReplyMsg) {
                        sseManager.emit(shopId, 'new_message', { conversation_id: conversationId, message: autoReplyMsg });
                        await deliverViaMetaIfApplicable(conversationId, shopId, autoReplyMsg.content);
                    }
                } catch (err) {
                    // Non-fatal: HITL is already set; log and surface to the agent via SSE
                    console.error(`[escalation] Auto-reply failed for conv ${conversationId}: ${err.message}`);
                    sseManager.emit(shopId, 'delivery_failed', {
                        conversation_id: conversationId,
                        reason: `Escalation message not delivered to customer: ${err.message}`
                    });
                }
            }

            res.json({ success: true, data: conversation });
        } catch (error) {
            const statusCode = error.message === 'Conversation not found' ? 404 : 500;
            const errorCode = statusCode === 404 ? 'CONVERSATION_NOT_FOUND' : 'CONVERSATION_UPDATE_FAILED';
            res.status(statusCode).json({
                success: false,
                error: { code: errorCode, message: error.message }
            });
        }
    }

    async updateConversationStatus(req, res) {
        try {
            const { conversationId } = req.params; // Already validated
            const shopId = req.user?.shopId;
            
            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Shop ID is required'
                    }
                });
            }
            const { status } = req.body; // Already validated

            const conversation = await conversationService.updateConversationStatus(conversationId, shopId, status);

            res.json({
                success: true,
                data: conversation
            });
        } catch (error) {
            const statusCode = error.message === 'Conversation not found' ? 404 : 500;
            const errorCode = statusCode === 404 ? 'CONVERSATION_NOT_FOUND' : 'CONVERSATION_UPDATE_FAILED';

            res.status(statusCode).json({
                success: false,
                error: {
                    code: errorCode,
                    message: error.message
                }
            });
        }
    }

    async getHistory(req, res) {
        try {
            const shopId = req.user?.shopId;
            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Shop ID is required'
                    }
                });
            }

            const { customer_id, limit, within_hours } = req.query;
            if (!customer_id) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'customer_id is required'
                    }
                });
            }

            const entries = await conversationService.getHistoryByCustomer(shopId, customer_id, {
                limit,
                within_hours
            });

            const conversations = entries.map(entry => ({
                id: entry.id,
                role: entry.role,
                message: entry.message,
                normalized_message: entry.metadata?.normalized_message || null,
                intent: entry.intent || null,
                timestamp: entry.created_at,
                metadata: entry.metadata || {}
            }));

            res.status(200).json({
                conversations,
                total: entries.length
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'CONVERSATION_HISTORY_FAILED',
                    message: error.message
                }
            });
        }
    }

    async getEventStream(req, res) {
        if (req.headers['x-shop-id'] || req.query.shop_id) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'UNTRUSTED_SHOP_OVERRIDE',
                    message: 'SSE shop selection must come from the authenticated session',
                },
            });
        }
        const shopId = req.user?.shopId;
        if (!shopId) {
            return res.status(400).json({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
            });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        // Disable nginx/proxy buffering so events arrive immediately
        res.setHeader('X-Accel-Buffering', 'no');
        // Allow the browser to send Last-Event-ID on reconnect.
        // Browsers automatically include this header when an EventSource reconnects
        // after a dropped connection; no client-side code change is required.
        res.setHeader('Access-Control-Expose-Headers', 'Last-Event-ID');
        res.flushHeaders();

        // attachToRequest reads Last-Event-ID, replays any missed events from
        // the Redis replay buffer, then registers this connection on the bus.
        await sseManager.attachToRequest(req, res, shopId);

        // Heartbeat keeps the connection alive through idle proxies (25s < 30s proxy timeout)
        const heartbeat = setInterval(() => {
            try { res.write(':heartbeat\n\n'); } catch (_) {}
        }, 25000);

        req.on('close', () => {
            clearInterval(heartbeat);
            sseManager.unregister(shopId, res);
        });
    }

    async checkDuplicate(req, res) {
        try {
            const { message_id, customer_id, timestamp } = req.body;
            if (!message_id || !customer_id) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'message_id and customer_id are required'
                    }
                });
            }

            const key = `dedup:${customer_id}:${message_id}`;
            const existing = await cacheService.get(key);

            if (existing) {
                return res.status(200).json({
                    is_duplicate: true,
                    original_timestamp: existing
                });
            }

            const originalTimestamp = timestamp || new Date().toISOString();
            await cacheService.set(key, originalTimestamp, 86400);

            res.status(200).json({
                is_duplicate: false,
                original_timestamp: null
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: {
                    code: 'DEDUP_CHECK_FAILED',
                    message: error.message
                }
            });
        }
    }
    /**
     * B3: Bulk update status for multiple conversations.
     * PATCH /conversations/bulk-status
     * Body: { conversationIds: [], status: '' }
     */
    async bulkUpdateStatus(req, res) {
        try {
            const shopId = req.user?.shopId;
            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
                });
            }

            const { conversationIds, status } = req.body;
            const result = await conversationService.bulkUpdateStatus(shopId, conversationIds, status);

            res.json({ success: true, data: result });
        } catch (error) {
            const statusCode = error.statusCode || 500;
            res.status(statusCode).json({
                success: false,
                error: { code: 'BULK_UPDATE_FAILED', message: error.message }
            });
        }
    }

    /**
     * Bug #2: Full-history inbox search.
     * GET /conversations/search?q=<query>&page=1&limit=20
     */
    async searchConversations(req, res) {
        try {
            const shopId = req.user?.shopId;
            if (!shopId) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'Shop ID is required' }
                });
            }
            const { q, page, limit } = req.query;
            if (!q) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'VALIDATION_ERROR', message: 'q (search query) is required' }
                });
            }
            const results = await conversationService.searchConversations(shopId, q, { page, limit });
            res.json({ success: true, data: results });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: { code: 'SEARCH_FAILED', message: error.message }
            });
        }
    }
}

const conversationController = new ConversationController();
conversationController.serveConversationAttachment = serveConversationAttachment;

module.exports = conversationController;
