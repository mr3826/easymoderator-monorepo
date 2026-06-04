'use strict';

/**
 * Message-burst coalescer (debounce)
 *
 * Problem it solves: customers often send one thought across several quick
 * messages — "Orna ache?" / "lal color ashe?" / "Size hobe" — or a photo plus
 * a line of text. Each arrives as its own webhook event, and without coalescing
 * each would spawn its own AI job and its own reply, so the customer gets a
 * disjoint reply per fragment instead of one answer to the whole thought.
 *
 * Strategy: instead of enqueueing a reply job per message, every inbound message
 * (re)schedules a SINGLE delayed "burst-flush" job for its conversation. While
 * the customer keeps typing, the flush keeps getting pushed back by
 * AI_BURST_WINDOW_MS. When they go quiet for the window, exactly one flush fires;
 * the worker then loads every unanswered customer message since the last reply,
 * joins them into one turn, and runs the AI pipeline once.
 *
 * A hard cap (AI_BURST_MAX_WAIT_MS) bounds the total wait so a non-stop typer
 * can't postpone the reply indefinitely.
 *
 * Robustness: the message-processing worker runs with group concurrency 1 per
 * shop, so flushes for the same shop are serialized. If a reschedule race leaves
 * two flushes queued, the second finds nothing pending (the first already
 * replied) and no-ops. The flush job id is unique per burst, so completed jobs
 * lingering under removeOnComplete never block a later burst.
 */

const { messageQueue } = require('./message-queue');
const { cacheRedis } = require('../config/redis');
const { createLogger } = require('../utils/structured-logger');

const logger = createLogger('BurstCoalescer');

const BURST_WINDOW_MS = parseInt(process.env.AI_BURST_WINDOW_MS, 10) || 8000;
const BURST_MAX_WAIT_MS = parseInt(process.env.AI_BURST_MAX_WAIT_MS, 10) || 20000;

const pendingKey = (conversationId) => `burst:pending:${conversationId}`;
const firstSeenKey = (conversationId) => `burst:firstseen:${conversationId}`;

// Keep the bookkeeping keys around a bit longer than the worst-case wait so a
// flush that is still queued can always find them.
const KEY_TTL_SECONDS = Math.ceil((BURST_MAX_WAIT_MS + BURST_WINDOW_MS) / 1000) + 60;

/**
 * Remove a queued (delayed/waiting) flush job. Safe to call when the job has
 * already started (active) or no longer exists — those are left untouched.
 */
async function removeQueuedJob(jobId) {
    if (!jobId) return;
    try {
        const job = await messageQueue.getJob(jobId);
        if (!job) return;
        const state = await job.getState().catch(() => null);
        if (state === 'delayed' || state === 'waiting' || state === 'prioritized') {
            await job.remove().catch(() => {});
        }
    } catch (_) { /* best-effort — never block the inbound path */ }
}

/**
 * (Re)schedule the single burst-flush job for a conversation.
 *
 * @param {object} payload
 * @param {string} payload.conversationId
 * @param {string} payload.shopId
 * @param {string} payload.platform        - 'facebook' | 'instagram'
 * @param {string} payload.recipientId     - customer PSID / IGSID to reply to
 * @param {string|null} [payload.metaChannelId]
 * @param {object} [payload.senderInfo]
 */
async function scheduleBurstFlush(payload) {
    const { conversationId, shopId } = payload;
    if (!conversationId || !shopId) return;

    // ── Compute the delay, clamped by how long this burst has been open ──────
    let delay = BURST_WINDOW_MS;
    try {
        const firstSeen = await cacheRedis.get(firstSeenKey(conversationId));
        if (firstSeen) {
            const elapsed = Date.now() - Number(firstSeen);
            const remaining = BURST_MAX_WAIT_MS - elapsed;
            delay = Math.max(0, Math.min(BURST_WINDOW_MS, remaining));
        } else {
            await cacheRedis.set(firstSeenKey(conversationId), String(Date.now()), 'EX', KEY_TTL_SECONDS);
        }
    } catch (_) { /* fall back to the full window */ }

    // ── Cancel the previously-scheduled flush, then schedule a fresh one ─────
    try {
        const prevJobId = await cacheRedis.get(pendingKey(conversationId));
        await removeQueuedJob(prevJobId);
    } catch (_) { /* best-effort */ }

    // Unique per burst — Date.now() alone collides when two messages land in the
    // same millisecond, so add a short random suffix. (No ':' — BullMQ forbids it
    // in custom job ids.)
    const flushJobId = `burstflush_${conversationId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await messageQueue.add(
        'burst-flush',
        { ...payload, burstFlush: true },
        { jobId: flushJobId, delay, group: { id: shopId } },
    );
    try {
        await cacheRedis.set(pendingKey(conversationId), flushJobId, 'EX', KEY_TTL_SECONDS);
    } catch (_) { /* best-effort */ }
}

/**
 * Cancel a pending flush and clear the debounce bookkeeping (e.g. on a STOP
 * keyword, when no reply should be sent).
 */
async function cancelBurstFlush(conversationId) {
    if (!conversationId) return;
    try {
        const prevJobId = await cacheRedis.get(pendingKey(conversationId));
        await removeQueuedJob(prevJobId);
        await cacheRedis.del(pendingKey(conversationId), firstSeenKey(conversationId));
    } catch (err) {
        logger.warn('cancelBurstFlush failed (non-fatal)', { conversationId, error: err.message });
    }
}

/**
 * Clear the per-conversation debounce keys. Called by the worker when a flush
 * begins, so the next inbound message opens a brand-new burst window.
 */
async function clearBurstState(conversationId) {
    try {
        await cacheRedis.del(pendingKey(conversationId), firstSeenKey(conversationId));
    } catch (_) { /* best-effort */ }
}

/**
 * Pure: fold a list of customer messages (oldest → newest) into one AI turn.
 * Joins their text, gathers any image attachment URLs, and remembers the last
 * message id (used as the dedup anchor for the coalesced reply).
 */
function buildCoalescedTurn(messages) {
    const texts = [];
    const imageUrls = [];
    for (const m of messages) {
        const meta = m.metadata || {};
        if (meta.image_url) imageUrls.push(meta.image_url);
        const content = (m.content || '').trim();
        // '[Attachment]' is the placeholder stored for an image-only message —
        // it carries no question, so don't feed it to the model as text.
        if (content && content !== '[Attachment]') texts.push(content);
    }
    return {
        messages,
        messageIds: messages.map((m) => m.id),
        lastMessageId: messages.length ? messages[messages.length - 1].id : null,
        combinedText: texts.join('\n'),
        imageUrls,
    };
}

/**
 * Load the unanswered customer "turn": every customer message after the most
 * recent AI/business reply, oldest → newest, folded via buildCoalescedTurn.
 * Returns an empty turn when the conversation's latest message is already a reply.
 */
async function loadPendingCustomerTurn(conversationId) {
    const { Message } = require('../modules/conversation/conversation.entity');
    const recent = await Message.findAll({
        where: { conversation_id: conversationId },
        order: [['created_at', 'DESC']],
        limit: 30,
    });

    const pending = [];
    for (const m of recent) { // newest → oldest
        if (m.sender !== 'customer') break; // reached the last AI/business reply
        pending.push(m);
    }
    pending.reverse(); // oldest → newest
    return buildCoalescedTurn(pending);
}

module.exports = {
    scheduleBurstFlush,
    cancelBurstFlush,
    clearBurstState,
    buildCoalescedTurn,
    loadPendingCustomerTurn,
    BURST_WINDOW_MS,
    BURST_MAX_WAIT_MS,
};
