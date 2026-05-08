const { v4: uuidv4 } = require('uuid');
const { Conversation, Message } = require('./conversation.entity');
const { Customer } = require('../customer/customer.entity');
const OrderSessionService = require('../order/order-session-standalone.service');

class ConversationStateService {
    /**
     * Ingest incoming message and update conversation state
     */
    static async ingestMessage(data) {
        const {
            shop_id,
            customer_channel_id,
            platform, // messenger, instagram, whatsapp
            message,
            sender_type = 'customer',
            metadata = {}
        } = data;

        try {
            // Find or create customer
            let customer = await Customer.findOne({
                where: {
                    shop_id,
                    channel_id: customer_channel_id
                }
            });

            if (!customer) {
                customer = await Customer.create({
                    id: uuidv4(),
                    shop_id,
                    channel_id: customer_channel_id,
                    channel: platform === 'facebook' ? 'messenger' : platform,
                    name: 'Customer',
                    phone: null,
                    email: null,
                    address: null,
                    metadata: {}
                });
            }

            // Find or create conversation
            let conversation = await Conversation.findOne({
                where: {
                    shop_id,
                    customer_id: customer.id,
                    channel: platform === 'facebook' ? 'messenger' : platform
                },
                order: [['updated_at', 'DESC']]
            });

            const messageTime = new Date();
            const conversationTimeout = 24 * 60 * 60 * 1000; // 24 hours

            // Create new conversation if doesn't exist or is too old
            if (!conversation || 
                (messageTime - conversation.updated_at) > conversationTimeout ||
                conversation.status === 'CLOSED') {
                
                conversation = await Conversation.create({
                    id: uuidv4(),
                    shop_id,
                    customer_id: customer.id,
                    channel: platform === 'facebook' ? 'messenger' : platform,
                    status: 'ACTIVE',
                    metadata: {
                        platform,
                        started_at: messageTime.toISOString(),
                        last_intent: null,
                        language_detected: null,
                        automation_enabled: true
                    }
                });
            }

            // Store the message
            const messageRecord = await Message.create({
                id: uuidv4(),
                conversation_id: conversation.id,
                content: message,
                sender: sender_type,
                external_id: metadata.message_id || null,
                metadata: {
                    ...metadata,
                    platform,
                    timestamp: messageTime.toISOString()
                }
            });

            // Update conversation activity
            await conversation.update({
                updated_at: messageTime,
                metadata: {
                    ...conversation.metadata,
                    last_message_at: messageTime.toISOString(),
                    message_count: (conversation.metadata.message_count || 0) + 1
                }
            });

            // Get conversation history for context
            const recentMessages = await Message.findAll({
                where: { conversation_id: conversation.id },
                order: [['created_at', 'DESC']],
                limit: 10
            });

            const conversationHistory = recentMessages.reverse().map(msg => ({
                role: msg.sender === 'customer' ? 'user' : 'assistant',
                message: msg.content,
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
                conversation_state: {
                    status: conversation.status,
                    language: conversation.metadata.language_detected,
                    last_intent: conversation.metadata.last_intent,
                    message_count: conversation.metadata.message_count || 1
                },
                conversation_history: conversationHistory,
                active_order_session: activeOrderSession,
                customer_info: {
                    id: customer.id,
                    name: customer.name,
                    channel_id: customer.channel_id,
                    platform: platform
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
            const message = await Message.create({
                id: uuidv4(),
                conversation_id: conversationId,
                content: response,
                sender: 'ai',
                external_id: null,
                metadata: {
                    ...metadata,
                    timestamp: new Date().toISOString(),
                    type: 'ai_response'
                }
            });

            // Update conversation
            const conversation = await Conversation.findByPk(conversationId);
            if (conversation) {
                await conversation.update({
                    updated_at: new Date(),
                    metadata: {
                        ...conversation.metadata,
                        last_ai_response_at: new Date().toISOString(),
                        ai_response_count: (conversation.metadata.ai_response_count || 0) + 1
                    }
                });
            }

            return {
                success: true,
                message_id: message.id
            };

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
            if (!conversation) {
                throw new Error('Conversation not found');
            }

            const { intent, language, confidence, automation_mode } = stateUpdate;

            await conversation.update({
                metadata: {
                    ...conversation.metadata,
                    last_intent: intent,
                    language_detected: language,
                    last_intent_confidence: confidence,
                    automation_mode: automation_mode || conversation.metadata.automation_enabled,
                    last_state_update: new Date().toISOString()
                }
            });

            return {
                success: true,
                conversation_state: {
                    status: conversation.status,
                    last_intent: intent,
                    language: language,
                    confidence: confidence,
                    automation_mode: automation_mode
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
            if (!conversation) {
                throw new Error('Conversation not found');
            }

            await conversation.update({
                status: 'NEEDS_HUMAN',
                metadata: {
                    ...conversation.metadata,
                    handoff_reason: reason,
                    handoff_timestamp: new Date().toISOString(),
                    handoff_metadata: metadata
                }
            });

            // Log handoff in messages
            await Message.create({
                id: uuidv4(),
                conversation_id: conversationId,
                content: `[SYSTEM] Conversation marked for human review - Reason: ${reason}`,
                sender: 'system',
                external_id: null,
                metadata: {
                    type: 'handoff',
                    reason,
                    timestamp: new Date().toISOString()
                }
            });

            return {
                success: true,
                status: 'NEEDS_HUMAN',
                handoff_reason: reason
            };

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
                include: [{
                    model: Customer,
                    as: 'customer'
                }]
            });

            if (!conversation) {
                throw new Error('Conversation not found');
            }

            let history = [];
            if (includeHistory) {
                const messages = await Message.findAll({
                    where: { conversation_id: conversationId },
                    order: [['created_at', 'ASC']],
                    limit: 20
                });

                history = messages.map(msg => ({
                    role: msg.sender === 'customer' ? 'user' : 
                          msg.sender === 'ai' ? 'assistant' : 'system',
                    content: msg.content,
                    timestamp: msg.created_at,
                    metadata: msg.metadata
                }));
            }

            // Check for active order session
            const activeOrderSession = await OrderSessionService.getActiveSession(
                conversation.shop_id,
                conversation.customer.channel_id
            );

            return {
                conversation_id: conversation.id,
                customer: {
                    id: conversation.customer.id,
                    name: conversation.customer.name,
                    channel_id: conversation.customer.channel_id,
                    platform: conversation.channel
                },
                state: {
                    status: conversation.status,
                    last_intent: conversation.metadata.last_intent,
                    language: conversation.metadata.language_detected,
                    message_count: conversation.metadata.message_count || 0,
                    automation_enabled: conversation.metadata.automation_enabled
                },
                history,
                active_order_session,
                metadata: conversation.metadata
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
        const banglaRegex = /[\u0980-\u09FF]/;
        const englishRegex = /[a-zA-Z]/;
        
        const hasBangla = banglaRegex.test(message);
        const hasEnglish = englishRegex.test(message);
        
        if (hasBangla && hasEnglish) {
            return 'mixed';
        } else if (hasBangla) {
            return 'bn';
        } else if (hasEnglish) {
            return 'en';
        }
        
        return 'unknown';
    }

    /**
     * Extract entities from message (basic implementation)
     */
    static extractEntities(message) {
        const entities = {};
        
        // Phone numbers
        const phoneRegex = /01[3-9]\d{8}/g;
        const phones = message.match(phoneRegex);
        if (phones) {
            entities.phone_numbers = phones;
        }
        
        // Prices (BDT format)
        const priceRegex = /[৳]?(\d+(?:,\d{3})*(?:\.\d{2})?|\d+)/g;
        const prices = message.match(priceRegex);
        if (prices) {
            entities.prices = prices;
        }
        
        // Product keywords
        const productKeywords = ['dress', 'shirt', 'panjabi', 'saree', 'kameez', 'পোশাক', 'ড্রেস', 'শার্ট'];
        const foundProducts = productKeywords.filter(keyword => 
            message.toLowerCase().includes(keyword.toLowerCase())
        );
        if (foundProducts.length > 0) {
            entities.product_types = foundProducts;
        }
        
        return entities;
    }
}

module.exports = ConversationStateService;
