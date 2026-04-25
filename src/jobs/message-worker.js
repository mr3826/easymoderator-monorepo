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

const { Worker } = require('bullmq');
const { connection } = require('./message-queue');
const { cacheRedis } = require('../config/redis');
const { Conversation, Message } = require('../modules/conversation/conversation.entity');
const ConversationStateService = require('../modules/conversation/conversation-state-standalone.service');
const metaSendService = require('../modules/integration/meta-send.service');
const { MetaRateLimitError } = require('../modules/integration/meta-send.service');
const sseManager = require('../utils/sse-manager');

// Lazy imports to avoid circular dependency issues at module load
const getShopAISettings = async (shopId) => {
    const shopService = require('../modules/shop/shop.service');
    return shopService.getShopAiSettings(shopId).catch(() => ({}));
};

const getChannelAISettings = async (shopId, platform) => {
    const channelService = require('../modules/channel/channel.service');
    return channelService.getChannelAISettings(shopId, platform).catch(() => ({}));
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
    } = job.data;

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
    if (!conversation) throw new Error(`Conversation ${conversationId} not found for shop ${shopId}`);
    if (conversation.hitl) return { skipped: true, reason: 'hitl_active' };

    // ── Guard 3: AI pause (30-min mute when agent sends manually) ──────────
    const paused = await cacheRedis.get(`ai:pause:${conversationId}`);
    if (paused) return { skipped: true, reason: 'ai_paused' };

    // ── Guard 4: Automation mode ────────────────────────────────────────────
    const [shopAISettings, channelAISettings] = await Promise.all([
        getShopAISettings(shopId),
        getChannelAISettings(shopId, platform),
    ]);
    const aiSettings = { ...shopAISettings, ...channelAISettings };
    if (aiSettings.automation_mode === 'MANUAL') {
        return { skipped: true, reason: 'manual_mode' };
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
    const { response, confidence } = await AIChatbotController.processNewIntent(
        message, history, entities, detectedLanguage, aiSettings, ingestionResult, []
    );

    // ── Store AI response ───────────────────────────────────────────────────
    const aiStoreResult = await ConversationStateService.storeAIResponse(conversationId, response, {
        platform,
        confidence,
        automation_mode: aiSettings.automation_mode,
    });

    // Notify connected agent tabs about the AI response in real-time
    sseManager.emit(shopId, 'new_message', {
        conversation_id: conversationId,
        message: aiStoreResult.message
    });

    // ── Guard 5: DRAFT mode — store but don't send ─────────────────────────
    if (aiSettings.automation_mode === 'DRAFT') {
        return { success: true, conversationId, confidence, sent: false, reason: 'draft_mode' };
    }

    // ── Send to Meta (leaky bucket) ─────────────────────────────────────────
    try {
        await metaSendService.sendWithRateLimit({ shopId, platform, recipientId, message: response });
    } catch (err) {
        if (err instanceof MetaRateLimitError) {
            // Move job to delayed queue — it will re-run after the rate window expires
            await job.moveToDelayed(Date.now() + err.retryAfterMs, job.token);
            return { delayed: true, reason: 'meta_rate_limit', retryAfterMs: err.retryAfterMs };
        }
        throw err; // Other send errors bubble up for normal retry/DLQ handling
    }

    return { success: true, conversationId, confidence, sent: true };
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

    worker.on('failed', (job, err) => {
        const isTerminal = job.attemptsMade >= (job.opts.attempts || 1);
        if (isTerminal) {
            console.error(`[worker/DLQ] Job ${job?.id} exhausted all retries. Error: ${err.message}`, { jobData: job?.data });
        } else {
            console.warn(`[worker] Job ${job?.id} attempt ${job?.attemptsMade} failed: ${err.message}`);
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
