const { Conversation, Message, Customer, MetaChannel, MetaChannelSettings } = require('../entities');
const { Op } = require('sequelize');
const subscriptionService = require('../subscription/subscription.service');
const { createLogger } = require('../../utils/structured-logger');
const { AppError } = require('../../utils/AppError');

class ConversationService {
    mapConversation(conversation) {
        const meta = conversation.metadata || {};
        const channel = conversation.channel === 'messenger'
            ? 'facebook'
            : conversation.channel === 'web'
                ? 'webchat'
                : conversation.channel;

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
            customer: conversation.customer || null,
            channel,
            meta_channel_id: conversation.meta_channel_id || null,
            metaChannel: metaChannelInfo,
            title: conversation.title || meta.title || conversation.intent || null,
            status: conversation.status || meta.status || 'active',
            hitl: conversation.hitl ?? false,
            lastMessage: conversation.message,
            unreadCount: meta.unreadCount || 0,
            created_at: conversation.created_at,
            updated_at: conversation.updated_at
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
                const validStatuses = ['active', 'unanswered', 'pending_order', 'completed', 'followed_up'];
                if (validStatuses.includes(status)) {
                    whereClause.status = status;
                }
            }

            const conversations = await Conversation.findAndCountAll({
                where: whereClause,
                order: [['created_at', 'DESC']],
                limit,
                offset,
                include: [
                    {
                        model: Customer,
                        as: 'customer',
                        attributes: ['id', 'name', 'phone']
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
            });

            return {
                conversations: conversations.rows.map((row) => this.mapConversation(row)),
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

            return this.mapConversation(conversation);
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
                order: [['created_at', 'ASC']],
                limit,
                offset
            });

            const messages = results.rows.map((message) => {
                // message_type is stored inside metadata to remain backward compatible with existing schema
                // and old rows that predate attachment support.
                const messageType = message.metadata?.message_type || 'text';

                return {
                id: message.id,
                conversation_id: message.conversation_id,
                content: message.content,
                sender: message.sender === 'business' ? 'agent' : message.sender,
                message_type: messageType,
                metadata: message.metadata || null,
                ai_suggestion: message.ai_suggestion || null,
                ai_confidence: message.ai_confidence ? Number(message.ai_confidence) : null,
                message_tag: message.message_tag || null,
                created_at: message.created_at,
                updated_at: message.updated_at || message.created_at
                };
            });

            return {
                messages,
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
        
        try {
            const resolvedTitle = conversationData.title
                || conversationData.intent
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

            // ATOMIC: Track usage ONLY after successful DB commit
            // Uses transaction-safe idempotent tracking with request_id
            // Usage increments ONLY on successful database persistence
            try {
                const usageResult = await subscriptionService.trackUsage(
                    shopId,
                    'conversations',
                    1,
                    requestId, // Request-scoped idempotency key - prevents double counting
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
                // CRITICAL errors: usage_limit_exceeded, validation errors
                if (usageError.code === 'USAGE_LIMIT_EXCEEDED') {
                    logger.error('Usage limit exceeded on conversation', usageError, { severity: 'critical' });
                    throw usageError;
                }
                
                // Non-critical errors: transient tracking issues don't fail conversation
                logger.error('Failed to track conversation usage', usageError, {
                    conversationId: conversation.id,
                    severity: 'warning'
                });
            }

            return conversation;
        } catch (error) {
            await transaction.rollback();
            if (error instanceof AppError) throw error;
            logger.error('Failed to create conversation', error);
            throw new AppError(`Failed to create conversation: ${error.message}`, 500);
        }
    }

    async createMessage(conversationId, shopId, messageData) {
        try {
            const conversation = await Conversation.findOne({
                where: {
                    id: conversationId,
                    shop_id: shopId
                }
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const sender = messageData.sender === 'agent'
                ? 'business'
                : messageData.sender || 'customer';

            const message = await Message.create({
                conversation_id: conversationId,
                content: messageData.content || messageData.message || '',
                sender,
                metadata: {
                    ...(messageData.metadata || {}),
                    message_type: messageData.message_type || 'text'
                },
                ai_suggestion: messageData.ai_suggestion || null,
                ai_confidence: messageData.ai_confidence || null,
                message_tag: messageData.message_tag || null,
                external_id: messageData.metadata?.external_id || null
            });

            return {
                id: message.id,
                conversation_id: message.conversation_id,
                content: message.content,
                sender: sender === 'business' ? 'agent' : sender,
                message_type: message.metadata?.message_type || messageData.message_type || 'text',
                metadata: message.metadata || null,
                ai_suggestion: message.ai_suggestion || null,
                ai_confidence: message.ai_confidence ? Number(message.ai_confidence) : null,
                message_tag: message.message_tag || null,
                created_at: message.created_at,
                updated_at: message.updated_at || message.created_at
            };
        } catch (error) {
            throw new Error(`Failed to create message: ${error.message}`);
        }
    }

    async updateConversation(conversationId, shopId, updates) {
        try {
            const conversation = await Conversation.findOne({
                where: { id: conversationId, shop_id: shopId }
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const fields = {};
            if (updates.hitl !== undefined) fields.hitl = updates.hitl;
            if (updates.status !== undefined) {
                fields.status = updates.status;
                fields.metadata = { ...(conversation.metadata || {}), status: updates.status };
                if (updates.status === 'closed' && !conversation.resolved_at) {
                    fields.resolved_at = new Date();
                }
            }
            if (updates.assignee_id !== undefined) fields.assignee_id = updates.assignee_id;
            if (updates.resolution_note !== undefined) fields.resolution_note = updates.resolution_note;

            await conversation.update(fields);

            return {
                ...this.mapConversation(conversation),
                hitl: conversation.hitl
            };
        } catch (error) {
            throw new Error(`Failed to update conversation: ${error.message}`);
        }
    }

    async updateConversationStatus(conversationId, shopId, status) {
        try {
            const conversation = await Conversation.findOne({
                where: {
                    id: conversationId,
                    shop_id: shopId
                }
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const resolvedStatus = status || 'active';
            const metadata = {
                ...(conversation.metadata || {}),
                status: resolvedStatus
            };

            await conversation.update({ status: resolvedStatus, metadata });

            return this.mapConversation(conversation);
        } catch (error) {
            throw new Error(`Failed to update conversation status: ${error.message}`);
        }
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
            created_at: message.created_at,
            updated_at: message.updated_at || message.created_at
        };
    }
}

module.exports = new ConversationService();
