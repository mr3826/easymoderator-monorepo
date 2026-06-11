const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');

// Use the shared main entity models — avoids re-defining on the same Sequelize instance
const Customer = require('../customer/customer.entity');
const { Conversation, Message } = require('./conversation.entity');

// Import OrderSessionService
const OrderSessionService = require('../order/order-session-standalone.service');

class ConversationStateService {
    /**
     * Ingest incoming message and update conversation state
     */
    static async ingestMessage(data) {
        const {
            shop_id,
            customer_channel_id,
            platform,
            message,
            sender_type = 'customer',
            metadata = {},
            meta_channel_id = null
        } = data;

        try {
            const channelType = platform === 'facebook' ? 'messenger' : platform;

            // Find or create customer. channel_type must be included — the same
            // channel_user_id can exist on both 'messenger' and 'instagram' rows
            // (two-row-per-channel design, locked 2026-05-22).
            let customer = await Customer.findOne({
                where: {
                    shop_id,
                    channel_type: channelType,
                    channel_user_id: customer_channel_id
                }
            });

            if (!customer) {
                customer = await Customer.create({
                    id: uuidv4(),
                    shop_id,
                    channel_user_id: customer_channel_id,
                    channel_type: channelType,
                    name: 'Customer',
                    phone: null,
                    email: null,
                    metadata: {}
                });

                // Best-effort: replace the "Customer" placeholder with the real
                // Facebook/Instagram name from the Graph profile API. Fire-and-forget
                // so a slow or denied Graph call never blocks message processing.
                try {
                    const { enrichCustomerNameFromMeta } = require('../customer/customer-profile.service');
                    enrichCustomerNameFromMeta({
                        customerId: customer.id,
                        metaChannelId: meta_channel_id,
                        shopId: shop_id,
                        platform: channelType,
                        psid: customer_channel_id,
                    }).catch(() => {});
                } catch (_) { /* never block ingestion */ }
            }

            // Find or create conversation (24-hour window).
            // Phase 2: scope by meta_channel_id when caller provided one so two
            // pages of the same shop+platform don't share a conversation row.
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const convoWhere = {
                shop_id,
                customer_id: customer.id,
                channel: channelType,
                updated_at: { [Op.gte]: oneDayAgo }
            };
            if (meta_channel_id) {
                convoWhere.meta_channel_id = { [Op.or]: [meta_channel_id, null] };
            }
            let conversation = await Conversation.findOne({
                where: convoWhere,
                order: [['updated_at', 'DESC']]
            });

            // Lazy backfill: if we matched an older row without meta_channel_id, set it.
            if (conversation && meta_channel_id && !conversation.meta_channel_id) {
                await conversation.update({ meta_channel_id });
            }

            const messageTime = new Date();

            if (!conversation || conversation.status === 'closed') {
                conversation = await Conversation.create({
                    id: uuidv4(),
                    shop_id,
                    customer_id: customer.id,
                    channel: channelType,
                    meta_channel_id,
                    status: 'active',
                    role: 'user',
                    message: message,
                    metadata: {
                        platform,
                        started_at: messageTime.toISOString(),
                        last_intent: null,
                        language_detected: null,
                        automation_enabled: true,
                        message_count: 0
                    }
                });
            }

            // Store the message
            const senderValue = sender_type === 'ai' ? 'ai' : 'customer';
            const messageRecord = await Message.create({
                id: uuidv4(),
                conversation_id: conversation.id,
                content: message,
                sender: senderValue,
                external_id: metadata.message_id || null,
                metadata: {
                    ...metadata,
                    platform,
                    timestamp: messageTime.toISOString()
                }
            });

            // Update conversation activity
            const currentMeta = conversation.metadata || {};
            await conversation.update({
                metadata: {
                    ...currentMeta,
                    last_message_at: messageTime.toISOString(),
                    message_count: (currentMeta.message_count || 0) + 1
                }
            });

            // FIX BUG #1: Get last 11 messages, exclude the newest (current message),
            // and use the 10 previous messages as context history.
            // This ensures the current message is not duplicated when passed to LLM.
            const allRecentMessages = await Message.findAll({
                where: { conversation_id: conversation.id },
                order: [['created_at', 'DESC']],
                limit: 11
            });

            // Find and remove the current message (most recent) from history
            // The rest become the context history (up to 10 messages)
            const previousMessages = allRecentMessages.filter(msg => msg.id !== messageRecord.id);
            const recentMessages = previousMessages.slice(0, 10).reverse();

            const conversationHistory = recentMessages.map(msg => ({
                role: msg.sender === 'customer' ? 'user' : 'assistant',
                message: msg.content,
                content: msg.content,
                timestamp: msg.created_at
            }));

            // Check for active order session
            const activeOrderSession = await OrderSessionService.getActiveSession(
                shop_id,
                customer_channel_id
            );

            return {
                success: true,
                conversation_id: conversation.id,
                customer_id: customer.id,
                message_id: messageRecord.id,
                shop_id,
                customer_channel_id,
                platform,
                conversation_state: {
                    status: conversation.status,
                    language: currentMeta.language_detected,
                    last_intent: currentMeta.last_intent,
                    message_count: (currentMeta.message_count || 0) + 1
                },
                conversation_history: conversationHistory,
                active_order_session: activeOrderSession,
                customer_info: {
                    id: customer.id,
                    name: customer.name,
                    channel_id: customer.channel_user_id,
                    platform
                }
            };

        } catch (error) {
            console.error('Message ingestion error:', error);
            throw new Error(`Failed to ingest message: ${error.message}`);
        }
    }

    /**
     * Update conversation with AI response
     */
    static async storeAIResponse(conversationId, response, metadata = {}) {
        try {
            // Extract first-class columns from metadata bag; keep the rest in JSON.
            const { confidence, sourceReferences, ...restMeta } = metadata;
            const message = await Message.create({
                id: uuidv4(),
                conversation_id: conversationId,
                content: response,
                sender: 'ai',
                external_id: null,
                ai_confidence: typeof confidence === 'number' ? confidence : null,
                source_references: Array.isArray(sourceReferences) && sourceReferences.length
                    ? sourceReferences
                    : null,
                metadata: {
                    ...restMeta,
                    confidence,
                    timestamp: new Date().toISOString(),
                    type: 'ai_response'
                }
            });

            const conversation = await Conversation.findByPk(conversationId);
            if (conversation) {
                const currentMeta = conversation.metadata || {};
                await conversation.update({
                    metadata: {
                        ...currentMeta,
                        last_ai_response_at: new Date().toISOString(),
                        ai_response_count: (currentMeta.ai_response_count || 0) + 1
                    }
                });
            }

            return { success: true, message_id: message.id, message };

        } catch (error) {
            console.error('Store AI response error:', error);
            throw new Error(`Failed to store AI response: ${error.message}`);
        }
    }

    /**
     * Update conversation intent and language
     */
    static async updateConversationState(conversationId, stateUpdate) {
        try {
            const conversation = await Conversation.findByPk(conversationId);
            if (!conversation) throw new Error('Conversation not found');

            const { intent, language, confidence, automation_mode } = stateUpdate;
            const currentMeta = conversation.metadata || {};

            await conversation.update({
                metadata: {
                    ...currentMeta,
                    last_intent: intent,
                    language_detected: language,
                    last_intent_confidence: confidence,
                    automation_mode: automation_mode || currentMeta.automation_enabled,
                    last_state_update: new Date().toISOString()
                }
            });

            return {
                success: true,
                conversation_state: {
                    status: conversation.status,
                    last_intent: intent,
                    language,
                    confidence,
                    automation_mode
                }
            };

        } catch (error) {
            console.error('Update conversation state error:', error);
            throw new Error(`Failed to update conversation state: ${error.message}`);
        }
    }

    /**
     * Mark conversation for human handoff
     */
    static async markForHumanHandoff(conversationId, reason, metadata = {}) {
        try {
            const conversation = await Conversation.findByPk(conversationId);
            if (!conversation) throw new Error('Conversation not found');

            const currentMeta = conversation.metadata || {};
            await conversation.update({
                status: 'needs_human',
                metadata: {
                    ...currentMeta,
                    handoff_reason: reason,
                    handoff_timestamp: new Date().toISOString(),
                    handoff_metadata: metadata
                }
            });

            // Log as a business message (no 'system' sender in production schema)
            await Message.create({
                id: uuidv4(),
                conversation_id: conversationId,
                content: `[HANDOFF] Marked for human review - Reason: ${reason}`,
                sender: 'business',
                external_id: null,
                metadata: { type: 'handoff', reason, timestamp: new Date().toISOString() }
            });

            return { success: true, status: 'needs_human', handoff_reason: reason };

        } catch (error) {
            console.error('Mark handoff error:', error);
            throw new Error(`Failed to mark for handoff: ${error.message}`);
        }
    }

    /**
     * Get conversation context for LLM
     */
    static async getConversationContext(conversationId, includeHistory = true) {
        try {
            const conversation = await Conversation.findByPk(conversationId, {
                include: [{ model: Customer, as: 'customer' }]
            });
            if (!conversation) throw new Error('Conversation not found');

            let history = [];
            if (includeHistory) {
                const messages = await Message.findAll({
                    where: { conversation_id: conversationId },
                    order: [['created_at', 'ASC']],
                    limit: 20
                });
                history = messages.map(msg => ({
                    role: msg.sender === 'customer' ? 'user' : msg.sender === 'ai' ? 'assistant' : 'system',
                    content: msg.content,
                    timestamp: msg.created_at,
                    metadata: msg.metadata
                }));
            }

            const activeOrderSession = await OrderSessionService.getActiveSession(
                conversation.shop_id,
                conversation.customer.channel_user_id
            );

            const meta = conversation.metadata || {};
            return {
                conversation_id: conversation.id,
                customer: {
                    id: conversation.customer.id,
                    name: conversation.customer.name,
                    channel_id: conversation.customer.channel_user_id,
                    platform: conversation.channel
                },
                state: {
                    status: conversation.status,
                    last_intent: meta.last_intent,
                    language: meta.language_detected,
                    message_count: meta.message_count || 0,
                    automation_enabled: meta.automation_enabled
                },
                history,
                active_order_session: activeOrderSession,
                metadata: meta
            };

        } catch (error) {
            console.error('Get conversation context error:', error);
            throw new Error(`Failed to get conversation context: ${error.message}`);
        }
    }

    /**
     * Detect language from message
     */
    static detectLanguage(message) {
        const hasBangla = /[\u0980-\u09FF]/.test(message);
        const hasEnglish = /[a-zA-Z]/.test(message);
        if (hasBangla && hasEnglish) return 'mixed';
        if (hasBangla) return 'bn';
        if (hasEnglish) return 'en';
        return 'unknown';
    }

    /**
     * Extract entities from message
     */
    static extractEntities(message) {
        const entities = {};
        const phones = message.match(/01[3-9]\d{8}/g);
        if (phones) entities.phone_numbers = phones;
        const prices = message.match(/[৳]?(\d+(?:,\d{3})*(?:\.\d{2})?|\d+)/g);
        if (prices) entities.prices = prices;
        const productKeywords = ['dress', 'shirt', 'panjabi', 'saree', 'kameez', 'পোশাক', 'ড্রেস', 'শার্ট'];
        const foundProducts = productKeywords.filter(k => message.toLowerCase().includes(k.toLowerCase()));
        if (foundProducts.length > 0) entities.product_types = foundProducts;
        return entities;
    }
}

module.exports = ConversationStateService;
