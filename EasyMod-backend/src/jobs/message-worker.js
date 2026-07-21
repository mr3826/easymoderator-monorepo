'use strict';

/**
 * BullMQ Message Processing Worker
 *
 * Consumes the 'message-processing' queue and runs the full AI pipeline for
 * each incoming customer message. Replaces the n8n → /api/ai-chatbot/process flow.
 *
 * Guards applied (in order):
 *   1. Redis idempotency  — drop duplicates via NX key (24 h TTL)
 *   2. HITL flag          — skip if a human agent has taken over the conversation
 *   3. AI pause           — skip if agent sent a manual message within the last 30 min
 *   4. Automation mode    — skip if shop is in MANUAL mode
 *   5. Meta rate limit    — delay job if the page has hit 170 sends/hr (leaky bucket)
 *
 * Fair queueing: each job is dispatched with group.id = shopId. BullMQ v5 processes
 * groups fairly so a viral shop cannot starve other shops.
 *
 * To start this worker as a standalone process:
 *   RUN_WORKER=true node src/jobs/message-worker.js
 */

const { Worker, Queue } = require('bullmq');
const { connection } = require('./message-queue');
const { cacheRedis } = require('../config/redis');
const { opsAlert } = require('../utils/ops-alert');
const { Conversation, Message } = require('../modules/conversation/conversation.entity');
const ConversationStateService = require('../modules/conversation/conversation-state-standalone.service');
const { getProvider } = require('../modules/channel-providers/provider.registry');
const sseManager = require('../utils/sse-manager');
const policyEngine = require('../modules/policy/policy.engine');
const metaChannelService = require('../modules/channel-providers/meta-channel.service');
const MetaChannel = require('../modules/channel-providers/meta-channel.entity');
const Customer = require('../modules/customer/customer.entity');
const { Op } = require('sequelize');

// Lazy imports to avoid circular dependency issues at module load
const getShopAISettings = async (shopId) => {
    const shopService = require('../modules/shop/shop.service');
    return shopService.getShopAiSettings(shopId).catch(() => ({}));
};

function captureKnowledgeGap(params) {
    return Promise.resolve()
        .then(() => require('../modules/knowledge/knowledge-gap-capture.service').recordKnowledgeGap(params))
        .catch((err) => {
            console.warn(`[worker] Knowledge gap capture skipped: ${err.message}`);
        });
}

function buildOrderFlowFailureResponse(message, language = 'mixed') {
    const { hasPurchaseIntent } = require('../modules/conversation/order-flow.service');
    if (!hasPurchaseIntent(message)) return null;

    return {
        handled: true,
        response: language === 'en'
            ? 'I could not start the order system right now. Please send the product name or a photo again, and our team will help if it still does not start.'
            : 'অর্ডার সিস্টেমটি এখন শুরু করা যায়নি। প্রোডাক্টের নাম বা ছবি আবার পাঠান, না হলে আমাদের টিম আপনাকে সাহায্য করবে।',
        confidence: 1.0,
        sourceReferences: null,
        meta: { order_session: 'unavailable', reason: 'order_flow_error' },
    };
}

/**
 * Resolve the MetaChannel row for this job. Prefers `metaChannelId` from the
 * job payload (set by the webhook dispatcher, unambiguous when a shop owns
 * multiple Pages/IG accounts of the same platform). Falls back to the
 * shop+platform lookup for legacy jobs that pre-date the FK threading.
 */
const resolveChannelForJob = async (shopId, platform, metaChannelId) => {
    try {
        if (metaChannelId) {
            const ch = await MetaChannel.findByPk(metaChannelId);
            if (ch && ch.shop_id === shopId) return ch;
        }
        const pf = platform === 'messenger' ? 'facebook' : platform;
        return await metaChannelService.findByShopAndPlatform(shopId, pf);
    } catch {
        return null;
    }
};

const getChannelAISettings = async (channel) => {
    if (!channel) return {};
    try {
        const settings = await metaChannelService.getSettings(channel.id);
        return settings?.toJSON?.() || settings || {};
    } catch {
        return {};
    }
};

/**
 * Load the last 10 messages prior to the current turn, as LLM conversation
 * history. `excludeIds` is the id (or ids, for a coalesced burst) of the message(s)
 * that make up the *current* turn — they must not appear in history as well.
 */
async function loadConversationHistory(conversationId, excludeIds) {
    const exclude = new Set((Array.isArray(excludeIds) ? excludeIds : [excludeIds]).filter(Boolean));
    const messages = await Message.findAll({
        where: { conversation_id: conversationId },
        order: [['created_at', 'DESC']],
        limit: 11 + exclude.size,
    });
    return messages
        .filter(m => !exclude.has(m.id))
        .slice(0, 10)
        .reverse()
        .map(m => ({
            role: m.sender === 'customer' ? 'user' : 'assistant',
            content: m.content,
            message: m.content,
        }));
}

/**
 * Legacy helper kept for focused unit coverage around burst-flush customer-turn
 * detection. Customer-visible disclosure now uses hasPriorCustomerVisibleAiReply
 * so a held AI draft does not consume the customer's first visible AI identity.
 */
async function isFirstCustomerTurn(conversationId, currentTurnMessageIds) {
    const excludeIds = (Array.isArray(currentTurnMessageIds) ? currentTurnMessageIds : [currentTurnMessageIds]).filter(Boolean);
    const where = { conversation_id: conversationId, sender: 'customer' };
    if (excludeIds.length > 0) {
        where.id = { [Op.notIn]: excludeIds };
    }
    const customerCount = await Message.count({ where });
    return excludeIds.length > 0 ? customerCount === 0 : customerCount <= 1;
}

function wasAiMessageCustomerVisible(message) {
    const metadata = message?.metadata || {};
    if (metadata.delivered === false) return false;
    if (metadata.held_reason) return false;
    return true;
}

function hasAiDisclosure(message) {
    const metadata = message?.metadata || {};
    if (metadata.ai_disclosure_applied === true) return true;

    const content = String(message?.content || '').toLowerCase();
    return content.includes('ai assistant') || content.includes('ai সহকার');
}

async function hasPriorCustomerVisibleAiDisclosure(conversationId) {
    const priorAiMessages = await Message.findAll({
        where: { conversation_id: conversationId, sender: 'ai' },
        attributes: ['id', 'content', 'metadata'],
        order: [['created_at', 'ASC']],
    });
    return priorAiMessages.some((message) => (
        wasAiMessageCustomerVisible(message) && hasAiDisclosure(message)
    ));
}

async function shouldApplyAiDisclosureGreeting({ conversationId, currentTurnMessageIds, aiSettings } = {}) {
    const mode = normalizeAutomationMode(aiSettings?.automation_mode || 'AI_ACTIVE');
    if (mode !== 'AI_ACTIVE') return false;
    if (aiSettings?.ai_auto_reply === false) return false;
    if (!(await isFirstCustomerTurn(conversationId, currentTurnMessageIds))) return false;
    return !(await hasPriorCustomerVisibleAiDisclosure(conversationId));
}

/**
 * Atomic NX set with 24 h TTL. Returns true if the key was newly set (first time).
 * Falls back to a get+setex pattern for mock Redis clients in dev.
 */
async function claimDedupKey(key) {
    try {
        const result = await cacheRedis.set(key, '1', 'NX', 'EX', 86400);
        return result === 'OK' || result === 1;
    } catch {
        const exists = await cacheRedis.get(key);
        if (exists) return false;
        await cacheRedis.setex(key, 86400, '1');
        return true;
    }
}

function normalizeAutomationMode(mode) {
    return mode === 'AUTO' ? 'AI_ACTIVE' : mode;
}

function isShopManualKillSwitch(settings = {}) {
    return normalizeAutomationMode(settings?.automation_mode) === 'MANUAL';
}

/**
 * Stamp the delivery outcome on a stored AI message and emit it to agent tabs.
 *
 * `delivered:false` flags the message as a HELD suggestion the inbox should
 * surface (Use this / Edit / Ignore); `delivered:true` is a normal sent reply
 * and shows no suggestion panel. `held_reason` lets the UI distinguish a
 * low-confidence hold (shows an "AI wasn't sure" note) from a draft/policy hold.
 *
 * The SSE emit moved here (from immediately after storeAIResponse) so connected
 * agent tabs receive the message with its final delivery flag already set.
 */
async function finalizeAiMessage(aiMessage, shopId, conversationId, { delivered, heldReason = null }) {
    if (aiMessage) {
        try {
            await aiMessage.update({
                metadata: { ...(aiMessage.metadata || {}), delivered, held_reason: heldReason },
            });
        } catch (err) {
            console.warn(`[worker] Failed to stamp delivery flag on AI message: ${err.message}`);
        }
    }
    sseManager.emit(shopId, 'new_message', { conversation_id: conversationId, message: aiMessage });
}

/**
 * Core job handler. Called by the BullMQ worker for each message job.
 *
 * Expected job.data shape:
 *   shopId, conversationId, messageId, externalId, message,
 *   platform, recipientId, senderInfo
 */
async function processMessageJob(job) {
    // ── Canary short-circuit ────────────────────────────────────────────────
    // Synthetic probe enqueued by pipeline-canary.job.js to prove the
    // enqueue → worker → complete loop is alive (the exact path the BullMQ jobId
    // bug silently broke). Sets a heartbeat and returns BEFORE any DB / AI / send
    // work, so it costs nothing and never messages a real customer.
    if (job.data && job.data.canary) {
        try { await cacheRedis.set('canary:msg:last_ok', String(Date.now())); } catch (_) { /* best-effort */ }
        return { canary: true, ok: true };
    }

    const {
        shopId,
        conversationId,
        messageId,
        externalId,
        message,
        platform,
        recipientId,
        senderInfo = {},
        metaChannelId = null,
    } = job.data;

    // ── Burst flush: coalesce a rapid-fire multi-message turn into ONE reply ──
    // A burst-flush job carries no single message — it stands in for every
    // unanswered customer message in the conversation. Load them, fold them into
    // one turn, and feed the rest of the pipeline as if they were one message.
    // See burst-coalescer.js for why this exists (multi-message → one answer).
    let effMessage = message;
    let effExternalId = externalId;
    let effImageUrls = [];
    let historyExcludeIds = messageId ? [messageId] : [];
    if (job.data.burstFlush) {
        const burst = require('../jobs/burst-coalescer');
        await burst.clearBurstState(conversationId); // next inbound opens a fresh window
        const turn = await burst.loadPendingCustomerTurn(conversationId);
        if (!turn.messages.length) {
            return { skipped: true, reason: 'burst_already_handled' };
        }
        effMessage = turn.combinedText || '';
        // Dedup anchor for the coalesced reply — a retried flush won't double-send.
        effExternalId = `burst:${turn.lastMessageId}`;
        effImageUrls = turn.imageUrls;
        historyExcludeIds = turn.messageIds;
    }

    // Resolve the channel once and pass it to every step that needs it. With
    // multi-page shops (one shop owns N FB Pages and/or IG accounts), routing
    // every send back through the same channel the message arrived on is the
    // only correct behavior — see Phase 1-2 of the multi-channel rework.
    const jobChannel = await resolveChannelForJob(shopId, platform, metaChannelId);

    // ── Guard 1: Redis idempotency ──────────────────────────────────────────
    if (effExternalId) {
        const isNew = await claimDedupKey(`msg:dedup:${shopId}:${effExternalId}`);
        if (!isNew) return { skipped: true, reason: 'duplicate', externalId: effExternalId };
    }

    // ── Guard 2: HITL (human-in-the-loop) ──────────────────────────────────
    const conversation = await Conversation.findOne({
        where: { id: conversationId, shop_id: shopId },
        attributes: ['id', 'hitl', 'status'],
    });
    if (!conversation) {
        console.warn(`[worker] Conversation ${conversationId} not found for shop ${shopId} — skipping job`);
        return { skipped: true, reason: 'conversation_not_found' };
    }
    if (conversation.hitl) return { skipped: true, reason: 'hitl_active' };

    // ── Guard 3: AI pause (30-min mute when agent sends manually) ──────────
    const paused = await cacheRedis.get(`ai:pause:${conversationId}`);
    if (paused) return { skipped: true, reason: 'ai_paused' };

    // ── Guard 4: Automation mode ────────────────────────────────────────────
    const [shopAISettings, channelAISettings] = await Promise.all([
        getShopAISettings(shopId),
        getChannelAISettings(jobChannel),
    ]);
    if (isShopManualKillSwitch(shopAISettings)) {
        return { skipped: true, reason: 'manual_mode', scope: 'shop' };
    }

    const aiSettings = { ...shopAISettings, ...channelAISettings };
    if (aiSettings.automation_mode === 'MANUAL') {
        return { skipped: true, reason: 'manual_mode', scope: 'effective' };
    }

    // ── Guard 4b: Per-channel ai_auto_reply flag ────────────────────────────
    // Explicit false disables auto-reply for this channel regardless of mode.
    if (channelAISettings.ai_auto_reply === false) {
        return { skipped: true, reason: 'channel_ai_disabled' };
    }

    // ── Guard 4c: Subscription billing status ───────────────────────────────
    // Pause automated AI replies when the shop's 14-day trial has expired or its
    // plan is suspended/cancelled. The inbound message is already persisted and
    // the manual inbox still works — we withhold only the *automated* reply, and
    // do so before the (LLM-costing) sentiment/AI steps below. Fails open: a
    // missing subscription row never blocks AI.
    {
        const { Subscription } = require('../modules/entities');
        const { isAiActive } = require('../modules/subscription/subscription.access');
        const billingSub = await Subscription.findOne({
            where: { shop_id: shopId },
            attributes: ['status'],
        }).catch(() => null);
        if (!isAiActive(billingSub)) {
            console.log(`[worker] AI paused for shop ${shopId}: subscription status=${billingSub?.status}`);
            return { skipped: true, reason: 'subscription_inactive', status: billingSub?.status || null };
        }
    }

    // ── Guard 5: Sentiment — auto-escalate angry/frustrated customers ──────
    // Fast keyword pre-check first (no LLM cost); LLM used only for ambiguous cases.
    // On any failure, default to treating the customer as negative/escalation-needed (safe fallback).
    {
        let sentimentResult;
        try {
            const { analyzeSentiment } = require('../modules/ai/sentiment.service');
            sentimentResult = await analyzeSentiment(effMessage, shopId);
        } catch (sentimentErr) {
            console.error(`[worker] Sentiment analysis failed, defaulting to escalation`, { error: sentimentErr.message });
            sentimentResult = { sentiment: 'negative', score: -1, method: 'fallback' };
        }
        try {
            const { shouldAutoEscalate } = require('../modules/ai/sentiment.service');
            if (shouldAutoEscalate(sentimentResult.sentiment)) {
                console.log(`[worker] Auto-escalating conv ${conversationId}: sentiment=${sentimentResult.sentiment} (${sentimentResult.method})`);
                // Pause AI + reassure the customer + deliver on the same channel the
                // inbound arrived on (shared with the low-confidence handoff path).
                const { escalateToHuman } = require('../modules/conversation/human-handoff.service');
                await escalateToHuman({
                    conversation, shopId, conversationId,
                    platform, recipientId, channel: jobChannel,
                    reason: `sentiment_${sentimentResult.sentiment}`,
                });
                return { skipped: true, reason: 'auto_escalated', sentiment: sentimentResult.sentiment };
            }
        } catch (escalateErr) {
            // If escalation itself fails, log and proceed with normal AI processing
            console.error(`[worker] Auto-escalation handler failed (continuing)`, { error: escalateErr.message });
        }
    }

    // ── Run AI pipeline ─────────────────────────────────────────────────────
    const history = await loadConversationHistory(conversationId, historyExcludeIds);
    const detectedLanguage = ConversationStateService.detectLanguage(effMessage);
    const entities = ConversationStateService.extractEntities(effMessage);

    const ingestionResult = {
        shop_id: shopId,
        customer_channel_id: recipientId,
        platform,
        conversation_id: conversationId,
        sender_info: senderInfo,
    };

    // ── Order capture (deterministic step-machine) ─────────────────────────
    // Runs BEFORE the conversational LLM. Continues an active order session, or
    // starts one when the customer shows clear purchase intent for an identified
    // product. While a session is in progress the LLM is skipped so order data is
    // captured reliably and an Order row is actually created on confirmation.
    // (Without this, the bot collects name/phone/address as chat but never makes
    // an order — see order-flow.service.js.)
    let rawResponse, confidence, sourceReferences;
    let orderFlow = { handled: false };
    let knowledgeGapCaptured = false;
    let fallbackKnowledgeGapSource = null;
    try {
        const { handleOrderFlow } = require('../modules/conversation/order-flow.service');
        orderFlow = await handleOrderFlow({
            shopId,
            customerChannelId: recipientId,
            platform,
            message: effMessage,
            entities,
            language: detectedLanguage,
            imageUrls: effImageUrls,
        });
    } catch (ofErr) {
        console.error(`[worker] handleOrderFlow failed for conv ${conversationId}:`, ofErr.message);
        const failureOrderFlow = buildOrderFlowFailureResponse(effMessage, detectedLanguage);
        if (failureOrderFlow) {
            orderFlow = failureOrderFlow;
            opsAlert('Order flow failed on purchase intent — sent safe fallback instead of LLM', {
                detail: `shop=${shopId} conv=${conversationId}\nerror: ${ofErr.message}`,
                level: 'warning',
                context: { shopId, conversationId, error: ofErr.message },
            }).catch(() => {});
        }
        // Non-purchase messages remain non-fatal and fall through to conversational AI.
    }

    // AIChatbotController is loaded lazily to avoid circular requires
    const AIChatbotController = require('../modules/conversation/ai-chatbot.controller');
    if (orderFlow.handled) {
        rawResponse = orderFlow.response;
        confidence = orderFlow.confidence ?? 1.0;
        sourceReferences = orderFlow.sourceReferences || null;
    } else {
        try {
            ({ response: rawResponse, confidence, sourceReferences } = await AIChatbotController.processNewIntent(
                effMessage, history, entities, detectedLanguage, aiSettings, ingestionResult, effImageUrls
            ));
        } catch (aiErr) {
            console.error(`[worker] processNewIntent failed for conv ${conversationId}:`, aiErr.message);
            // Stage alert (warning): the customer still gets a reply, but it's the
            // generic fallback — the AI pipeline (LLM/RAG/Gemini) is degraded. Throttled.
            opsAlert('AI reply degraded — LLM pipeline failed, sent fallback message', {
                detail: `shop=${shopId} conv=${conversationId}\nerror: ${aiErr.message}`,
                level: 'warning',
                context: { shopId, conversationId, error: aiErr.message },
            }).catch(() => {});
            rawResponse = detectedLanguage === 'bn'
                ? 'আপনার বার্তার জন্য ধন্যবাদ! আমরা শীঘ্রই সাড়া দেব।'
                : 'Thank you for your message! We will respond shortly.';
            confidence = 0;
            sourceReferences = null;
            fallbackKnowledgeGapSource = 'ai_pipeline_error';
        }
    }

    let repliedText = rawResponse;
    let disclosureApplied = false;
    const storeAiResponse = (content, aiDisclosureApplied) => ConversationStateService.storeAIResponse(conversationId, content, {
        platform,
        confidence,
        automation_mode: aiSettings.automation_mode,
        ai_disclosure_applied: aiDisclosureApplied,
        order_flow: orderFlow.meta || null,
        sourceReferences: sourceReferences || null,
    });

    // ── Confidence gate: hold + hand off when the AI is unsure ──────────────
    // In auto-send mode, an answer below the shop's confidence_threshold is NOT
    // delivered. We mark it as a held suggestion, pause AI, pull in a human (who
    // sees the held draft in the inbox), and send the customer one reassurance
    // message so they are not left in silence. Order-flow turns are deterministic
    // (confidence 1.0) and never held.
    const { shouldHoldForLowConfidence } = require('../modules/ai/confidence-gate.service');
    const holdForLowConfidence = shouldHoldForLowConfidence({
        confidence,
        automationMode: aiSettings.automation_mode,
        confidenceThreshold: aiSettings.confidence_threshold,
        orderFlowHandled: orderFlow.handled,
    });
    {
        if (holdForLowConfidence) {
            if (!knowledgeGapCaptured) {
                knowledgeGapCaptured = true;
                void captureKnowledgeGap({
                    shopId,
                    question: effMessage,
                    platform,
                    language: detectedLanguage,
                    source: fallbackKnowledgeGapSource || 'low_confidence_handoff',
                });
            }
            const aiMessage = (await storeAiResponse(rawResponse, false)).message;
            await finalizeAiMessage(aiMessage, shopId, conversationId, { delivered: false, heldReason: 'low_confidence' });
            const { escalateToHuman } = require('../modules/conversation/human-handoff.service');
            await escalateToHuman({
                conversation, shopId, conversationId,
                platform, recipientId, channel: jobChannel, reason: 'low_confidence',
            });
            console.log(`[worker] Low-confidence handoff conv ${conversationId} (confidence=${confidence})`);
            return { success: true, conversationId, confidence, sent: false, reason: 'low_confidence_handoff', handoff: true };
        }
    }

    if (
        !knowledgeGapCaptured
        && !orderFlow.handled
        && (fallbackKnowledgeGapSource || Number(confidence) <= 0.3)
    ) {
        knowledgeGapCaptured = true;
        void captureKnowledgeGap({
            shopId,
            question: effMessage,
            platform,
            language: detectedLanguage,
            source: fallbackKnowledgeGapSource || 'ai_unknown_response',
        });
    }

    // ── First-turn AI-disclosure greeting ───────────────────────────────────
    // Apply only when this reply will be attempted as an auto-send on the
    // customer's first turn. Held draft/manual suggestions must stay as plain
    // suggested copy for the shop owner to review.
    try {
        if (rawResponse && await shouldApplyAiDisclosureGreeting({
            conversationId,
            currentTurnMessageIds: historyExcludeIds,
            aiSettings,
        })) {
            const { buildGreeting } = require('../modules/shop/ai-messaging');
            const Shop = require('../modules/shop/shop.entity');
            const shopRow = await Shop.findByPk(shopId, { attributes: ['name', 'settings'] });
            const shopName = shopRow?.settings?.businessInfo?.shopName || shopRow?.name || '';
            const greetingText = buildGreeting({ shopName, language: detectedLanguage, greeting: aiSettings.greeting });
            if (greetingText) {
                repliedText = `${greetingText}\n\n${rawResponse}`;
                disclosureApplied = true;
            }
        }
    } catch (greetErr) {
        console.error(`[worker] AI-disclosure greeting failed for conv ${conversationId}:`, greetErr.message);
    }

    // ── AI disclosure ───────────────────────────────────────────────────────
    // Disclosure happens through a clear-text first-turn disclaimer only when
    // the automated reply is actually allowed to go out. No per-message icon.
    const response = repliedText;

    // ── Policy Engine: mandatory outbound gate ─────────────────────────────
    // Replaces the ad-hoc DRAFT/MANUAL/opt-out checks scattered through the
    // old guard list. Every send (including non-AI) flows through this gate.
    const policyChannelType = platform === 'messenger' ? 'facebook' : platform;
    // channel_type must be included — the same channel_user_id can exist on both
    // 'messenger' and 'instagram' rows (two-row-per-channel design, locked
    // 2026-05-22). Without it findOne returns an arbitrary row and the 24h
    // window / opt-out checks read consent for the wrong platform.
    // Customers are stored with channel_type='messenger' for Facebook (mirrors
    // the webhook handler mapping: facebook→messenger). The job platform is
    // already normalised to 'facebook', so we reverse the mapping here.
    const customerChannelType = platform === 'facebook' ? 'messenger' : platform;
    const customer = await Customer.findOne({
        where: { shop_id: shopId, channel_type: customerChannelType, channel_user_id: String(recipientId) },
    }).catch(() => null);
    const channel = jobChannel;
    let channelSettings = aiSettings;
    if (channel) {
        try {
            const s = await metaChannelService.getSettings(channel.id);
            channelSettings = { ...aiSettings, ...(s?.toJSON?.() || s || {}) };
        } catch { /* fall back to aiSettings */ }
    }

    const normalizedOutbound = {
        text: response,
        platform: policyChannelType,
        senderRole: 'ai',
        direction: 'outbound',
    };

    const decision = await policyEngine.evaluateOutbound(normalizedOutbound, {
        shopId,
        platform: policyChannelType,
        customer,
        channel,
        settings: channelSettings,
        conversationId,
    });

    if (!decision.allow) {
        // RATE_LIMIT: defer the job until the bucket clears.
        if (decision.reason === 'RATE_LIMIT' && decision.retryAfterMs) {
            await job.moveToDelayed(Date.now() + decision.retryAfterMs, job.token);
            return { delayed: true, reason: 'policy_rate_limit', retryAfterMs: decision.retryAfterMs };
        }
        // DRAFT / SUGGEST_ONLY / MANUAL / OPTED_OUT / NO_CONSENT / OUTSIDE_24H:
        // Store the raw AI response as a held suggestion. Do not include the
        // automated-assistant disclosure in draft/manual suggestions.
        const aiMessage = (await storeAiResponse(rawResponse, false)).message;
        await finalizeAiMessage(aiMessage, shopId, conversationId, { delivered: false, heldReason: 'draft_mode' });
        return {
            success: true, conversationId, confidence,
            sent: false, reason: decision.reason, decisionId: decision.decisionId,
        };
    }

    // ── Store AI response ───────────────────────────────────────────────────
    const aiStoreResult = await storeAiResponse(response, disclosureApplied);
    const aiMessage = aiStoreResult.message;
    // NOTE: the new_message SSE is emitted later (finalizeAiMessage) once the
    // delivery outcome is known, so the inbox never shows a "suggestion" panel
    // for a reply that was actually auto-sent.

    // ── Send to Meta via provider registry ─────────────────────────────────
    const finalText = decision.transform?.text || response;
    const policyChannelTypeForSend = platform === 'messenger' ? 'facebook' : platform;
    try {
        if (!channel) {
            throw new Error(`No MetaChannel found for shop ${shopId} platform ${policyChannelTypeForSend}`);
        }
        const provider = getProvider(policyChannelTypeForSend);
        await provider.sendMessage({
            channel,
            recipientId: String(recipientId),
            normalizedMessage: {
                text: finalText,
                attachments: [],
                platform: policyChannelTypeForSend,
                direction: 'outbound',
                senderRole: 'ai',
            },
            decision,
        });
    } catch (err) {
        // Check for rate limit signal from the provider
        if (err.retryAfterMs) {
            await job.moveToDelayed(Date.now() + err.retryAfterMs, job.token);
            return { delayed: true, reason: 'meta_rate_limit', retryAfterMs: err.retryAfterMs };
        }
        throw err; // Other send errors bubble up for normal retry/DLQ handling
    }

    // Mark the reply delivered (no suggestion panel) and emit to agent tabs.
    await finalizeAiMessage(aiMessage, shopId, conversationId, { delivered: true, heldReason: null });

    // Activation tracking: the first successful AI reply activates the shop.
    // Fire-and-forget + Redis NX-gated, so it runs once and never blocks the reply.
    try {
        require('../modules/analytics/growth-metrics.service')
            .recordActivation(shopId, conversationId)
            .catch(() => {});
        require('../modules/analytics/funnel-events.service')
            .recordFunnelEvent({
                event: 'first_ai_reply_sent',
                shopId,
                onceKey: shopId,
                metadata: {
                    conversation_id: conversationId,
                    channel_id: channel?.id || null,
                    platform: policyChannelTypeForSend,
                },
            })
            .catch(() => {});
    } catch (_) { /* analytics must never fail a sent reply */ }

    return { success: true, conversationId, confidence, sent: true, decisionId: decision.decisionId };
}

// ── Worker lifecycle ──────────────────────────────────────────────────────────

let worker = null;

function startWorker() {
    worker = new Worker('message-processing', processMessageJob, {
        connection,
        concurrency: 10,
        group: { concurrency: 1 }, // Max 1 concurrent job per shop (BullMQ v5 fair groups)
    });

    worker.on('completed', (job) => {
        const r = job.returnvalue;
        if (r?.skipped) console.log(`[worker] Job ${job.id} skipped: ${r.reason}`);
        else if (r?.delayed) console.log(`[worker] Job ${job.id} delayed: ${r.reason} (${r.retryAfterMs}ms)`);
        else console.log(`[worker] Job ${job.id} done — conv=${r?.conversationId} confidence=${r?.confidence}`);
    });

    worker.on('failed', async (job, err) => {
        console.error('[worker] Job failed', { jobId: job?.id, shopId: job?.data?.shopId, attempt: job?.attemptsMade, error: err.message });
        if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
            try {
                const dlqQueue = new Queue('message-dlq', { connection });
                await dlqQueue.add('failed-job', {
                    originalJobData: job.data,
                    error: err.message,
                    failedAt: new Date().toISOString()
                });
                console.error(`[worker/DLQ] Job ${job.id} moved to message-dlq after exhausting retries`);
                // A dead-lettered message means this customer got NO reply — page a human.
                opsAlert('Auto-reply job dead-lettered — customer received no reply', {
                    detail: `shop=${job.data?.shopId} platform=${job.data?.platform} jobId=${job.id} `
                        + `conv=${job.data?.conversationId}\nerror: ${err.message}`,
                    level: 'error',
                    context: { shopId: job.data?.shopId, jobId: job.id, error: err.message },
                }).catch(() => {});
            } catch (dlqErr) {
                console.error('[worker] Failed to add to DLQ', { error: dlqErr.message });
                opsAlert('Auto-reply job failed AND could not be dead-lettered', {
                    detail: `jobId=${job.id} dlqError: ${dlqErr.message} originalError: ${err.message}`,
                    level: 'error',
                    context: { jobId: job.id, dlqError: dlqErr.message },
                }).catch(() => {});
            }
        } else {
            console.warn(`[worker] Job ${job?.id} attempt ${job?.attemptsMade} failed (will retry): ${err.message}`);
        }
    });

    worker.on('error', (err) => console.error('[worker] Worker connection error:', err.message));

    console.log('✅ BullMQ message-processing worker started (concurrency=10, groups=fair)');
    return worker;
}

// Auto-start when this file is run directly or via RUN_WORKER env var
if (require.main === module || process.env.RUN_WORKER === 'true') {
    startWorker();
}

module.exports = {
    processMessageJob,
    startWorker,
    getWorker: () => worker,
    _private: {
        loadConversationHistory,
        isFirstCustomerTurn,
        shouldApplyAiDisclosureGreeting,
        hasPriorCustomerVisibleAiDisclosure,
        hasAiDisclosure,
        wasAiMessageCustomerVisible,
        buildOrderFlowFailureResponse,
        normalizeAutomationMode,
        isShopManualKillSwitch,
    },
};
