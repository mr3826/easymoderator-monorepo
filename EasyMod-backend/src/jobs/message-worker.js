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
const { Conversation, Message } = require('../modules/conversation/conversation.entity');
const ConversationStateService = require('../modules/conversation/conversation-state-standalone.service');
const { getProvider } = require('../modules/channel-providers/provider.registry');
const sseManager = require('../utils/sse-manager');
const policyEngine = require('../modules/policy/policy.engine');
const metaChannelService = require('../modules/channel-providers/meta-channel.service');
const MetaChannel = require('../modules/channel-providers/meta-channel.entity');
const Customer = require('../modules/customer/customer.entity');

// Lazy imports to avoid circular dependency issues at module load
const getShopAISettings = async (shopId) => {
    const shopService = require('../modules/shop/shop.service');
    return shopService.getShopAiSettings(shopId).catch(() => ({}));
};

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
 * Load the last 10 messages prior to the current one, as LLM conversation history.
 */
async function loadConversationHistory(conversationId, currentMessageId) {
    const messages = await Message.findAll({
        where: { conversation_id: conversationId },
        order: [['created_at', 'DESC']],
        limit: 11,
    });
    return messages
        .filter(m => m.id !== currentMessageId)
        .slice(0, 10)
        .reverse()
        .map(m => ({
            role: m.sender === 'customer' ? 'user' : 'assistant',
            content: m.content,
            message: m.content,
        }));
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

/**
 * Core job handler. Called by the BullMQ worker for each message job.
 *
 * Expected job.data shape:
 *   shopId, conversationId, messageId, externalId, message,
 *   platform, recipientId, senderInfo
 */
async function processMessageJob(job) {
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

    // Resolve the channel once and pass it to every step that needs it. With
    // multi-page shops (one shop owns N FB Pages and/or IG accounts), routing
    // every send back through the same channel the message arrived on is the
    // only correct behavior — see Phase 1-2 of the multi-channel rework.
    const jobChannel = await resolveChannelForJob(shopId, platform, metaChannelId);

    // ── Guard 1: Redis idempotency ──────────────────────────────────────────
    if (externalId) {
        const isNew = await claimDedupKey(`msg:dedup:${shopId}:${externalId}`);
        if (!isNew) return { skipped: true, reason: 'duplicate', externalId };
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
    const aiSettings = { ...shopAISettings, ...channelAISettings };
    if (aiSettings.automation_mode === 'MANUAL') {
        return { skipped: true, reason: 'manual_mode' };
    }

    // ── Guard 4b: Per-channel ai_auto_reply flag ────────────────────────────
    // Explicit false disables auto-reply for this channel regardless of mode.
    if (channelAISettings.ai_auto_reply === false) {
        return { skipped: true, reason: 'channel_ai_disabled' };
    }

    // ── Guard 5: Sentiment — auto-escalate angry/frustrated customers ──────
    // Fast keyword pre-check first (no LLM cost); LLM used only for ambiguous cases.
    // On any failure, default to treating the customer as negative/escalation-needed (safe fallback).
    {
        let sentimentResult;
        try {
            const { analyzeSentiment } = require('../modules/ai/sentiment.service');
            sentimentResult = await analyzeSentiment(message, shopId);
        } catch (sentimentErr) {
            console.error(`[worker] Sentiment analysis failed, defaulting to escalation`, { error: sentimentErr.message });
            sentimentResult = { sentiment: 'negative', score: -1, method: 'fallback' };
        }
        try {
            const { shouldAutoEscalate } = require('../modules/ai/sentiment.service');
            if (shouldAutoEscalate(sentimentResult.sentiment)) {
                console.log(`[worker] Auto-escalating conv ${conversationId}: sentiment=${sentimentResult.sentiment} (${sentimentResult.method})`);
                await conversation.update({ hitl: true });
                sseManager.emit(shopId, 'hitl_changed', { conversation_id: conversationId, hitl: true });
                const { sendEscalationAutoReply } = require('../modules/conversation/escalation-auto-reply.service');
                const autoReplyMsg = await sendEscalationAutoReply(conversationId, shopId).catch(() => null);
                if (autoReplyMsg) {
                    sseManager.emit(shopId, 'new_message', { conversation_id: conversationId, message: autoReplyMsg });
                    // Deliver escalation message to customer via provider registry.
                    // Use the same channel the inbound message arrived on so multi-Page
                    // shops reply from the correct Page.
                    const pf = platform === 'messenger' ? 'facebook' : platform;
                    if (jobChannel) {
                        const escProvider = getProvider(pf);
                        escProvider.sendMessage({
                            channel: jobChannel, recipientId: String(recipientId),
                            normalizedMessage: { text: autoReplyMsg.content, attachments: [], platform: pf, direction: 'outbound', senderRole: 'ai' },
                            decision: { allow: true, reason: 'OK', augment: {} },
                        }).catch(err => console.warn(`[worker] Escalation delivery failed: ${err.message}`));
                    }
                }
                return { skipped: true, reason: 'auto_escalated', sentiment: sentimentResult.sentiment };
            }
        } catch (escalateErr) {
            // If escalation itself fails, log and proceed with normal AI processing
            console.error(`[worker] Auto-escalation handler failed (continuing)`, { error: escalateErr.message });
        }
    }

    // ── Run AI pipeline ─────────────────────────────────────────────────────
    const history = await loadConversationHistory(conversationId, messageId);
    const detectedLanguage = ConversationStateService.detectLanguage(message);
    const entities = ConversationStateService.extractEntities(message);

    const ingestionResult = {
        shop_id: shopId,
        customer_channel_id: recipientId,
        platform,
        conversation_id: conversationId,
        sender_info: senderInfo,
    };

    // AIChatbotController is loaded lazily to avoid circular requires
    const AIChatbotController = require('../modules/conversation/ai-chatbot.controller');
    let rawResponse, confidence, sourceReferences;
    try {
        ({ response: rawResponse, confidence, sourceReferences } = await AIChatbotController.processNewIntent(
            message, history, entities, detectedLanguage, aiSettings, ingestionResult, []
        ));
    } catch (aiErr) {
        console.error(`[worker] processNewIntent failed for conv ${conversationId}:`, aiErr.message);
        rawResponse = detectedLanguage === 'bn'
            ? 'আপনার বার্তার জন্য ধন্যবাদ! আমরা শীঘ্রই সাড়া দেব।'
            : 'Thank you for your message! We will respond shortly.';
        confidence = 0;
        sourceReferences = null;
    }

    // ── Bot attribution (Meta Platform Policy 4.2) ──────────────────────────
    // Customers must be able to identify automated replies. Default-on; can be
    // disabled per-channel by setting `bot_attribution_suffix` to an empty string
    // in meta_channel_settings, or globally via AI_BOT_ATTRIBUTION_ENABLED=false.
    // Suffix is applied before storage so the in-app inbox shows the same text
    // the customer received.
    const attributionEnabled = process.env.AI_BOT_ATTRIBUTION_ENABLED !== 'false';
    const attributionSuffix = process.env.AI_BOT_ATTRIBUTION_SUFFIX || ' 🤖';
    const alreadyMarked = /🤖|\(ai\)|\bAI assistant\b/i.test(rawResponse || '');
    const response = (attributionEnabled && rawResponse && !alreadyMarked)
        ? `${rawResponse.trimEnd()}${attributionSuffix}`
        : rawResponse;

    // ── Store AI response ───────────────────────────────────────────────────
    const aiStoreResult = await ConversationStateService.storeAIResponse(conversationId, response, {
        platform,
        confidence,
        automation_mode: aiSettings.automation_mode,
        sourceReferences: sourceReferences || null,
    });

    // Notify connected agent tabs about the AI response in real-time
    sseManager.emit(shopId, 'new_message', {
        conversation_id: conversationId,
        message: aiStoreResult.message
    });

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
        // AI response is already stored; just don't deliver.
        return {
            success: true, conversationId, confidence,
            sent: false, reason: decision.reason, decisionId: decision.decisionId,
        };
    }

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
            } catch (dlqErr) {
                console.error('[worker] Failed to add to DLQ', { error: dlqErr.message });
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

module.exports = { processMessageJob, startWorker, getWorker: () => worker };
