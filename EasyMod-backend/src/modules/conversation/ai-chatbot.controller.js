const { body, validationResult } = require('express-validator');
const ConversationStateService = require('./conversation-state-standalone.service');
const OrderSessionService = require('../order/order-session-standalone.service');
const intentRouter = require('../ai/intent-router.service');
const knowledgeService = require('../knowledge/knowledge.service');
const shopService = require('../shop/shop.service');
const metaChannelService = require('../channel-providers/meta-channel.service');
const cacheService = require('../../utils/cache.service');
const { isTooLong } = require('../ai/prompt-sanitizer.service');
const { SupportTicket } = require('../entities');
const { createLogger } = require('../../utils/structured-logger');

// Thin cached wrapper — delegates to the canonical shop service so there is
// a single source of truth for AI settings (stored under shop.settings.ai).
async function getShopAISettings(shopId) {
    const cacheKey = 'ai_settings';
    const cached = await cacheService.getForShop(shopId, cacheKey);
    if (cached) return cached;

    const settings = await shopService.getShopAiSettings(shopId) || {};
    await cacheService.setForShop(shopId, cacheKey, settings, 300);
    return settings;
}

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
                message: rawMessage = '',
                message_id,
                meta_channel_id = null,
                sender_info = {},
                attachments = []
            } = req.body;

            // Extract image URLs from attachments (Facebook/Instagram format)
            const imageUrls = attachments
                .filter(a => a.type === 'image' && (a.payload?.url || a.url))
                .map(a => a.payload?.url || a.url);

            // Messenger/IG: images arrive as { type: 'image', payload: { url } }.
            // Image-only messages without a URL are treated as image signals (hasImageAttachment flag).
            const hasImageAttachment = imageUrls.length > 0 ||
                attachments.some(a => a.type === 'image' || a.type === 'sticker');

            // Build effective message — if image-only, create a descriptive placeholder
            const message = rawMessage.trim() ||
                (hasImageAttachment ? '[image]' : '');

            if (!message) {
                return res.status(400).json({
                    success: false,
                    errors: [{ msg: 'message or attachments is required' }]
                });
            }

            if (isTooLong(message)) {
                return res.status(400).json({
                    success: false,
                    errors: [{ msg: 'Message exceeds maximum length of 500 characters' }]
                });
            }

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

            // Step 3: Load shop AI settings merged with channel-level overrides.
            // Shop settings are the base; channel settings win for per-channel toggles
            // (e.g. draftOrdersOnly on Instagram but not on Facebook).
            const [shopAISettings, channelAISettings] = await Promise.all([
                getShopAISettings(shop_id),
                (async () => {
                    // Prefer explicit meta_channel_id (unambiguous when a shop owns
                    // multiple Pages); fall back to shop+platform lookup for legacy
                    // callers that don't know which channel the message belongs to.
                    try {
                        let ch = null;
                        if (meta_channel_id) {
                            const MetaChannel = require('../channel-providers/meta-channel.entity');
                            const row = await MetaChannel.findByPk(meta_channel_id);
                            if (row && row.shop_id === shop_id) ch = row;
                        }
                        if (!ch) {
                            const pf = platform === 'messenger' ? 'facebook' : platform;
                            ch = await metaChannelService.findByShopAndPlatform(shop_id, pf);
                        }
                        if (!ch) return {};
                        const s = await metaChannelService.getSettings(ch.id);
                        return s?.toJSON?.() || s || {};
                    } catch { return {}; }
                })()
            ]);
            const aiSettings = { ...shopAISettings, ...channelAISettings };

            // Step 4: Determine if we should continue order session or process new intent
            let response;
            let confidence;
            let shouldContinueOrderSession = false;

            if (active_order_session && active_order_session.status === 'ACTIVE') {
                // Continue existing order session
                shouldContinueOrderSession = true;
                const stepResult = await OrderSessionService.processStep(
                    active_order_session.id,
                    shop_id,
                    message,
                    imageUrls.length ? { imageUrl: imageUrls[0] } : null
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
                    ingestionResult,
                    imageUrls
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

            // Onboarding window: first 48h after shop creation → force DRAFT so merchant
            // can see what the bot says before going fully live.
            const shopCreatedAt = aiSettings.shop_created_at;
            const isOnboarding = shopCreatedAt
                && (Date.now() - new Date(shopCreatedAt).getTime()) < 48 * 60 * 60 * 1000;
            const effectiveMode = isOnboarding ? 'DRAFT' : (aiSettings.automation_mode || 'AUTO');
            const isDraft = effectiveMode === 'DRAFT';

            // Step 5: Store AI response
            await ConversationStateService.storeAIResponse(conversation_id, response, {
                platform,
                intent: shouldContinueOrderSession ? 'order_session_continue' : 'new_intent',
                language: detectedLanguage,
                entities,
                order_session_active: !!active_order_session,
                confidence,
                gate_triggered: gateFailed,
                is_draft: isDraft,
                is_onboarding: !!isOnboarding
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
                    is_draft: isDraft,
                    is_onboarding: !!isOnboarding,
                    channel: platform,
                    ai_model: aiSettings.llm_model || 'gpt-4o-mini',
                    ai_settings: aiSettings
                }
            });

        } catch (error) {
            console.error('Process message error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to process message'
            });
        }
    }

    /**
     * Process new intent via the hybrid intent router (LLM failover + semantic FAQ caching).
     * Falls back to keyword matching if all LLM providers are unavailable.
     * Returns { response: string, confidence: number (0.0–1.0) }.
     */
    static async processNewIntent(message, conversationHistory, entities, language, aiSettings, ingestionResult, imageUrls = []) {
        const { shop_id, customer_channel_id, platform } = ingestionResult;
        const { conversation_id } = ingestionResult;

        const hasImages = imageUrls.length > 0;

        // --- Try the AI intent router first ---
        try {
            // Load shop knowledge to build the system prompt (cached by Anthropic prompt caching)
            let shopKnowledge = null;
            try {
                shopKnowledge = await knowledgeService.getKnowledgeForAI(shop_id);
            } catch (_) { /* ignore */ }

            // Fetch only the FAQs relevant to this message (top 5) instead of
            // dumping all 50 into the system prompt on every call.
            const relevantFaqs = hasImages
                ? null  // image flow doesn't benefit; fall back to full FAQ list
                : await knowledgeService.getRelevantFaqs(shop_id, message, 5).catch(() => null);

            const systemPrompt = intentRouter.buildSystemPrompt(
                shopKnowledge || {},
                language,
                hasImages,
                aiSettings.tone_persona || 'friendly_bd',
                relevantFaqs
            );

            // Map model_preset to preferredProvider
            // 'standard' = Gemini lite (cost-effective), 'advanced' = Gemini pro
            const modelPreset = aiSettings.model_preset || 'standard';
            const preferredProvider = modelPreset === 'advanced' ? 'gemini-pro' : 'gemini-lite';

            const routerResult = await intentRouter.route({
                shopId: shop_id,
                message,
                conversationId: conversation_id,
                history: conversationHistory,
                language,
                systemPrompt,
                imageUrls,
                preferredProvider,  // ✅ NEW: Pass model preset as provider hint
                // Bug #11: pass per-shop confidence threshold so FAQ matching
                // uses the value the shop owner configured, not the global env default
                confidenceThreshold: aiSettings.confidence_threshold
            });

            return { response: routerResult.response, confidence: routerResult.confidence };
        } catch (llmError) {
            // LLM/router unavailable — fall through to keyword matching
            console.warn('Intent router unavailable, falling back to keyword matching:', llmError.message);
        }

        // --- Keyword-based fallback (original logic) ---
        const lowerMessage = message.toLowerCase().trim();

        // Image-only messages arrive as '[image]' when the URL is unavailable.
        // Give a helpful nudge instead of falling through to a confusing default response.
        if (lowerMessage === '[image]') {
            const imgResponse = language === 'bn'
                ? '📸 ছবিটি পেয়েছি! কিন্তু এই মুহূর্তে ছবি প্রসেস করতে পারছি না। আপনি কি পণ্যের নাম বা বর্ণনা লিখে জানাবেন? যেমন: "লাল শার্টের দাম কত?"'
                : '📸 Got your image! Unfortunately I can\'t process it directly. Could you describe what you\'re looking for? e.g. "price of red shirt" or "do you have blue dress?"';
            return { response: imgResponse, confidence: 0.85 };
        }

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

        // --- Check for order modification/return intents ---
        const modificationIntents = AIChatbotController.detectModificationIntents(message);
        if (modificationIntents.detected) {
            await AIChatbotController.escalateToHumanAgent({
                shop_id,
                conversation_id,
                customer_channel_id,
                platform,
                message,
                intent: modificationIntents.intent,
                reason: modificationIntents.reason,
                customer_info: ingestionResult.sender_info
            });
            
            return { 
                response: AIChatbotController.generateEscalationMessage(language, modificationIntents.intent), 
                confidence: 0.95 
            };
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
    /**
     * Detect order modification/return intents
     */
    static detectModificationIntents(message) {
        const lowerMessage = message.toLowerCase().trim();
        
        const modificationPatterns = {
            'order_modification': [
                'change', 'modify', 'update', 'edit', 'পরিবর্তন', 'পরিবর্তন করো',
                'address change', 'change address', 'ঠিকানা পরিবর্তন',
                'phone change', 'change phone', 'ফোন পরিবর্তন'
            ],
            'return_request': [
                'return', 'refund', 'cancel', 'ফেরত', 'বাতিল', 'ফেরত চাই',
                'send back', 'take back', 'ফেরত পাঠাতে'
            ],
            'complaint': [
                'complaint', 'problem', 'issue', 'wrong', 'defective', 'অভিযোগ',
                'wrong product', 'defective product', 'ভুল পণ্য', 'ত্রুটিপূর্ণ পণ্য'
            ],
            'delay_inquiry': [
                'delay', 'late', 'when', 'status', 'দেরি', 'কবে', 'কখন',
                'delivery status', 'order status', 'ডেলিভারি স্ট্যাটাস'
            ]
        };

        for (const [intent, keywords] of Object.entries(modificationPatterns)) {
            if (keywords.some(keyword => lowerMessage.includes(keyword))) {
                return {
                    detected: true,
                    intent,
                    reason: `Customer wants to ${intent.replace('_', ' ')}`
                };
            }
        }

        return { detected: false };
    }

    /**
     * Escalate to human agent
     */
    static async escalateToHumanAgent(escalationData) {
        const logger = createLogger();
        
        try {
            // Create support ticket
            const ticket = await SupportTicket.create({
                shop_id: escalationData.shop_id,
                conversation_id: escalationData.conversation_id,
                customer_channel_id: escalationData.customer_channel_id,
                platform: escalationData.platform,
                type: escalationData.intent,
                status: 'pending',
                priority: 'medium',
                message: escalationData.message,
                customer_info: escalationData.customer_info,
                metadata: {
                    escalated_at: new Date(),
                    escalation_reason: escalationData.reason,
                    ai_detected_intent: escalationData.intent
                }
            });

            // Mark conversation for human handoff
            await ConversationStateService.markForHumanHandoff(
                escalationData.conversation_id,
                escalationData.reason,
                {
                    ticket_id: ticket.id,
                    intent: escalationData.intent
                }
            );

            logger.info('Escalated to human agent', {
                shopId: escalationData.shop_id,
                conversationId: escalationData.conversation_id,
                intent: escalationData.intent,
                ticketId: ticket.id
            });

            return ticket;

        } catch (error) {
            logger.error('Failed to escalate to human agent', {
                error: error.message,
                escalationData
            });
            throw error;
        }
    }

    /**
     * Generate escalation message
     */
    static generateEscalationMessage(language, intent) {
        const messages = {
            'order_modification': {
                bn: 'আপনার অর্ডার পরিবর্তনের অনুরোধ পেয়েছে। অনুগ্রহ করে অপেক্ষা করুন, আমাদের একজন প্রতিনিধি শীঘ্রই আপনার সাথে যোগাযোগ করবেন।',
                en: 'Your order modification request has been received. Please wait, one of our representatives will contact you shortly.'
            },
            'return_request': {
                bn: 'আপনার ফেরতের অনুরোধ পেয়েছে। অনুগ্রহ করে অপেক্ষা করুন, আমাদের একজন প্রতিনিধি শীঘ্রই আপনার সাথে যোগাযোগ করবেন।',
                en: 'Your return request has been received. Please wait, one of our representatives will contact you shortly.'
            },
            'complaint': {
                bn: 'আপনার অভিযোগ পেয়েছে। অনুগ্রহ করে অপেক্ষা করুন, আমাদের একজন প্রতিনিধি শীঘ্রই আপনার সাথে যোগাযোগ করবেন।',
                en: 'Your complaint has been received. Please wait, one of our representatives will contact you shortly.'
            },
            'delay_inquiry': {
                bn: 'আপনার অনুসন্ধান পেয়েছে। অনুগ্রহ করে অপেক্ষা করুন, আমাদের একজন প্রতিনিধি শীঘ্রই আপনার সাথে যোগাযোগ করবেন।',
                en: 'Your inquiry has been received. Please wait, one of our representatives will contact you shortly.'
            }
        };

        const messageSet = messages[intent] || messages['order_modification'];
        return messageSet[language] || messageSet['en'];
    }

    /**
     * Handle self-MFS payment confirmation
     */
    static async handleSelfMfsPayment(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    errors: errors.array()
                });
            }

            const { conversation_id } = req.params;
            const { transaction_id, customer_message, screenshot_url } = req.body;

            // Get active order session
            const session = await OrderSessionService.getActiveSession(req.body.shop_id, req.body.customer_channel_id);
            
            if (!session || session.status !== 'ACTIVE') {
                return res.status(404).json({
                    success: false,
                    error: 'No active order session found'
                });
            }

            // Handle self-MFS payment
            await OrderSessionService.handleSelfMfsPayment(session, {
                transactionId: transaction_id,
                message: customer_message,
                screenshotUrl: screenshot_url
            });

            res.json({
                success: true,
                message: 'Payment confirmation sent to shop owner'
            });

        } catch (error) {
            console.error('Self-MFS payment handling error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to process payment confirmation'
            });
        }
    }

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
