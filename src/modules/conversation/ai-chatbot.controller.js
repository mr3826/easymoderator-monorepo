const { body, validationResult } = require('express-validator');
const ConversationStateService = require('./conversation-state-standalone.service');
const OrderSessionService = require('../order/order-session-standalone.service');
const intentRouter = require('../ai/intent-router.service');
const knowledgeService = require('../knowledge/knowledge.service');

class AIChatbotController {
    /**
     * Process incoming message and generate AI response
     */
    static async processMessage(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const {
                shop_id,
                customer_channel_id,
                platform,
                message,
                message_id,
                sender_info = {}
            } = req.body;

            // Step 1: Ingest message and get conversation state
            const ingestionResult = await ConversationStateService.ingestMessage({
                shop_id,
                customer_channel_id,
                platform,
                message,
                sender_type: 'customer',
                metadata: {
                    message_id,
                    sender_info
                }
            });

            const { conversation_id, conversation_history, active_order_session } = ingestionResult;

            // Step 2: Detect language and extract entities
            const detectedLanguage = ConversationStateService.detectLanguage(message);
            const entities = ConversationStateService.extractEntities(message);

            // Step 3: Get shop AI settings (using defaults for now)
            const aiSettings = {
                automation_mode: 'DRAFT',
                confidence_threshold: 60,
                payment_methods: ['COD', 'bKash', 'Nagad'],
                ask_email: false,
                primary_language: 'mixed'
            };

            // Step 4: Determine if we should continue order session or process new intent
            let response;
            let confidence;
            let shouldContinueOrderSession = false;

            if (active_order_session && active_order_session.status === 'ACTIVE') {
                // Continue existing order session
                shouldContinueOrderSession = true;
                const stepResult = await OrderSessionService.processStep(
                    active_order_session.id,
                    message,
                    message
                );

                response = stepResult.prompt;
                // Order session steps are deterministic — confidence is inherently high
                confidence = stepResult.confidence ?? 1.0;

                await ConversationStateService.updateConversationState(conversation_id, {
                    intent: 'order_session_continue',
                    language: detectedLanguage,
                    confidence,
                    automation_mode: aiSettings.automation_mode
                });

            } else {
                // Process new message for intent classification
                const intentResult = await AIChatbotController.processNewIntent(
                    message,
                    conversation_history,
                    entities,
                    detectedLanguage,
                    aiSettings,
                    ingestionResult
                );
                response = intentResult.response;
                confidence = intentResult.confidence;
            }

            // H3: Confidence gate — if below threshold, intercept and request verification
            // Threshold stored as 0-100 integer; confidence is 0.0-1.0 float
            const thresholdFraction = aiSettings.confidence_threshold / 100;
            const gateFailed = !shouldContinueOrderSession && confidence < thresholdFraction;
            if (gateFailed) {
                response = AIChatbotController.buildVerificationRequest(detectedLanguage, message);
            }

            // Step 5: Store AI response
            await ConversationStateService.storeAIResponse(conversation_id, response, {
                platform,
                intent: shouldContinueOrderSession ? 'order_session_continue' : 'new_intent',
                language: detectedLanguage,
                entities,
                order_session_active: !!active_order_session,
                confidence,
                gate_triggered: gateFailed
            });

            // Step 6: Return response
            res.json({
                success: true,
                response,
                conversation_id,
                metadata: {
                    language_detected: detectedLanguage,
                    entities_extracted: entities,
                    order_session_active: !!active_order_session,
                    order_session_continued: shouldContinueOrderSession,
                    confidence,
                    gate_triggered: gateFailed,
                    ai_settings: aiSettings
                }
            });

        } catch (error) {
            console.error('Process message error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to process message',
                _debug: error.message  // temporary: remove after debugging
            });
        }
    }

    /**
     * Process new intent via the hybrid intent router (LLM failover + semantic FAQ caching).
     * Falls back to keyword matching if all LLM providers are unavailable.
     * Returns { response: string, confidence: number (0.0–1.0) }.
     */
    static async processNewIntent(message, conversationHistory, entities, language, aiSettings, ingestionResult) {
        const { shop_id, customer_channel_id, platform } = ingestionResult;
        const { conversation_id } = ingestionResult;

        // --- Try the AI intent router first ---
        try {
            // Load shop knowledge to build the system prompt (cached by Anthropic prompt caching)
            let shopKnowledge = null;
            try {
                // getKnowledge requires userId; use a system-level bypass by querying knowledge directly
                shopKnowledge = await knowledgeService.queryKnowledge({ query: message, shop_id, limit: 3 });
            } catch (_) { /* ignore */ }

            const systemPrompt = intentRouter.buildSystemPrompt(
                shopKnowledge || {},
                language
            );

            const routerResult = await intentRouter.route({
                shopId: shop_id,
                message,
                conversationId: conversation_id,
                history: conversationHistory,
                language,
                systemPrompt
            });

            // Invalidate summary cache so next message gets fresh context
            await intentRouter.invalidateSummary(conversation_id).catch(() => {});

            return { response: routerResult.response, confidence: routerResult.confidence };
        } catch (llmError) {
            // LLM/router unavailable — fall through to keyword matching
            console.warn('Intent router unavailable, falling back to keyword matching:', llmError.message);
        }

        // --- Keyword-based fallback (original logic) ---
        const lowerMessage = message.toLowerCase().trim();

        const orderKeywords = [
            'order', 'buy', 'purchase', 'অর্ডার', 'কিনতে', 'নিবে', 'চাই',
            'দাম', 'price', 'cost', 'কত', 'available'
        ];
        const hasOrderIntent = orderKeywords.some(keyword => lowerMessage.includes(keyword));

        if (hasOrderIntent) {
            const productInfo = AIChatbotController.extractProductInfo(message, entities);
            const sessionResult = await OrderSessionService.startOrderSession({
                shop_id,
                customer_channel_id,
                platform,
                initial_message: message,
                entities,
                product_info: productInfo
            });
            return { response: sessionResult.prompt, confidence: 0.75 };
        }

        const greetings = [
            'hello', 'hi', 'hey', 'হ্যালো', 'স্বাগতম', 'আসসালামু আলাইকুম',
            'good morning', 'good evening', 'সুপ্রভাত', 'শুভ সকাল'
        ];
        const hasGreeting = greetings.some(greeting => lowerMessage.includes(greeting));

        if (hasGreeting) {
            return { response: AIChatbotController.generateGreetingResponse(language, aiSettings), confidence: 0.90 };
        }

        const helpKeywords = [
            'help', 'support', 'সাহায্য', 'তথ্য', 'information', 'details',
            'how to', 'কিভাবে', 'where', 'কোথা', 'contact', 'যোগাযোগ'
        ];
        const hasHelpIntent = helpKeywords.some(keyword => lowerMessage.includes(keyword));

        if (hasHelpIntent) {
            return { response: AIChatbotController.generateHelpResponse(language, aiSettings), confidence: 0.80 };
        }

        return { response: AIChatbotController.generateDefaultResponse(language, aiSettings), confidence: 0.30 };
    }

    /**
     * H3: Build a verification request sent back to the customer when confidence < threshold.
     * Asks the customer to rephrase instead of proceeding with uncertain order logic.
     */
    static buildVerificationRequest(language, originalMessage) {
        const responses = {
            bn: '🤔 আমি আপনার বার্তাটি সঠিকভাবে বুঝতে পারিনি। আপনি কি একটু সহজভাবে বলবেন?\n\nযেমন: "পণ্যের নাম অর্ডার করতে চাই" বা "দাম জানতে চাই"।',
            en: "🤔 I'm not quite sure I understood your message. Could you rephrase it?\n\nFor example: \"I want to order [product name]\" or \"What is the price of [product]?\"",
            mixed: '🤔 আমি বুঝতে পারিনি। I\'m not sure I understood.\n\nআপনার প্রশ্নটি আরেকবার বলুন? Could you rephrase your message?\n\nযেমন / e.g.: "অর্ডার করতে চাই" / "I want to order"'
        };
        return responses[language] || responses['mixed'];
    }

    /**
     * Extract product information from message
     */
    static extractProductInfo(message, entities) {
        const productInfo = {
            name: null,
            price: null,
            quantity: 1,
            variant: null
        };

        // Try to extract product name
        const productKeywords = ['dress', 'shirt', 'panjabi', 'saree', 'kameez', 'ড্রেস', 'শার্ট', 'পাঞ্জাবি'];
        for (const keyword of productKeywords) {
            if (message.toLowerCase().includes(keyword)) {
                productInfo.name = keyword;
                break;
            }
        }

        // Extract price from entities
        if (entities.prices && entities.prices.length > 0) {
            const priceStr = entities.prices[0].replace(/[৳,]/g, '');
            const price = parseInt(priceStr);
            if (!isNaN(price) && price > 0) {
                productInfo.price = price;
            }
        }

        // Extract quantity
        const quantityRegex = /(\d+)\s*(?:piece|pc|টা|টি|টি)/i;
        const quantityMatch = message.match(quantityRegex);
        if (quantityMatch) {
            productInfo.quantity = parseInt(quantityMatch[1]);
        }

        return productInfo.name || productInfo.price ? productInfo : null;
    }

    /**
     * Generate greeting response
     */
    static generateGreetingResponse(language, aiSettings) {
        const responses = {
            'bn': '👋 স্বাগতম! আমি আপনার সাহায্য করতে পেরে খুশি। আপনি কি অর্ডার করতে চান, নাকি অন্য কোনো তথ্য জানতে চান?',
            'en': '👋 Welcome! I\'m happy to help you. Would you like to place an order, or do you need some information?',
            'mixed': '👋 স্বাগতম! Welcome! আমি আপনার সাহায্য করতে পেরে খুশি। I\'m here to help! অর্ডার করতে চান? Want to order?'
        };

        return responses[language] || responses['mixed'];
    }

    /**
     * Generate help response
     */
    static generateHelpResponse(language, aiSettings) {
        const responses = {
            'bn': '🤝 আমি আপনাকে সাহায্য করতে পারি:\n• পণ্য অর্ডার করতে\n• পণ্যের তথ্য জানতে\n• ডেলিভারি সম্পর্কে জানতে\n• পেমেন্ট পদ্ধতি জানতে\n\nআপনি কি জানতে চান?',
            'en': '🤝 I can help you with:\n• Placing orders\n• Product information\n• Delivery details\n• Payment methods\n\nWhat would you like to know?',
            'mixed': '🤝 আমি আপনাকে সাহায্য করতে পারি: I can help you with:\n• পণ্য অর্ডার Placing orders\n• পণ্যের তথ্য Product info\n• ডেলিভারি Delivery\n• পেমেন্ট Payment\n\nকি জানতে চান? What do you need?'
        };

        return responses[language] || responses['mixed'];
    }

    /**
     * Generate default response
     */
    static generateDefaultResponse(language, aiSettings) {
        const responses = {
            'bn': 'আমি বুঝতে পারিনি। আপনি কি পণ্য অর্ডার করতে চান, নাকি অন্য কোনো সাহায্য লাগবে?',
            'en': 'I didn\'t understand. Would you like to place an order, or do you need some help?',
            'mixed': 'আমি বুঝতে পারিনি। I didn\'t quite understand. অর্ডার করতে চান? Want to order? নাকি সাহায্য লাগবে? Or need help?'
        };

        return responses[language] || responses['mixed'];
    }

    /**
     * Get conversation context
     */
    static async getConversationContext(req, res) {
        try {
            const { conversation_id } = req.params;
            const { include_history = 'true' } = req.query;

            const context = await ConversationStateService.getConversationContext(
                conversation_id,
                include_history === 'true'
            );

            res.json({
                success: true,
                data: context
            });

        } catch (error) {
            console.error('Get conversation context error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get conversation context'
            });
        }
    }

    /**
     * Mark conversation for human handoff
     */
    static async markForHumanHandoff(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const { conversation_id } = req.params;
            const { reason, metadata = {} } = req.body;

            const result = await ConversationStateService.markForHumanHandoff(
                conversation_id,
                reason,
                metadata
            );

            res.json({
                success: true,
                data: result
            });

        } catch (error) {
            console.error('Mark handoff error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to mark for handoff'
            });
        }
    }
}

module.exports = AIChatbotController;
