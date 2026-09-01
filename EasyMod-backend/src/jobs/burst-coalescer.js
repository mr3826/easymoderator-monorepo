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
 * replied) and no-ops. The flush job id is deterministic for a message identity,
 * so an enqueue/update retry cannot create a second logical job; distinct
 * messages still receive distinct burst IDs.
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
async function removeQueuedJob(jobId, existingJob = null, { strict = false } = {}) {
    if (!jobId) return;
    try {
        const job = existingJob || await messageQueue.getJob(jobId);
        if (!job) return;
        let state;
        try {
            state = await job.getState();
        } catch (err) {
            if (strict) throw err;
            return;
        }
        if (state === 'delayed' || state === 'waiting' || state === 'prioritized') {
            try {
                await job.remove();
            } catch (err) {
                if (strict) throw err;
            }
        }
    } catch (err) {
        if (strict) throw err;
        /* best-effort — never block the inbound path */
    }
}

const RESIDENT_JOB_STATES = new Set(['waiting', 'delayed', 'prioritized', 'paused', 'active', 'completed']);

const isSameMessageJob = (job, messageId) => Boolean(
    job && messageId && job.data?.messageId != null
    && String(job.data.messageId) === String(messageId),
);

const isResidentJob = async (job) => {
    if (!job || typeof job.getState !== 'function') return false;
    try {
        return RESIDENT_JOB_STATES.has(await job.getState());
    } catch (_) {
        return false;
    }
};

const jobIdPart = (value) => String(value).replace(/[^A-Za-z0-9_-]/g, '_');

const buildFlushJobId = (payload) => {
    if (payload.messageId) {
        return `burstflush_${jobIdPart(payload.conversationId)}_${jobIdPart(payload.messageId)}`;
    }
    // Legacy callers without a message identity retain one job per scheduling
    // attempt; the webhook path always supplies messageId.
    return `burstflush_${payload.conversationId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

/**
 * (Re)schedule the single burst-flush job for a conversation.
 *
 * @param {object} payload
 * @param {string} payload.conversationId
 * @param {string} payload.shopId
 * @param {string} payload.platform        - 'facebook'
 * @param {string} payload.recipientId     - customer PSID to reply to
 * @param {string|null} [payload.metaChannelId]
 * @param {string|null} [payload.metaAssetId] - exact Facebook Page ID
 * @param {string|null} [payload.messageId] - internal message identity for retry idempotency
 * @param {object} [payload.senderInfo]
 */
async function scheduleBurstFlush(payload) {
    const { conversationId, shopId } = payload;
    if (!conversationId || !shopId) return;

    const flushJobId = buildFlushJobId(payload);

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
    let prevJobId = null;
    let previousJob = null;
    try {
        prevJobId = await cacheRedis.get(pendingKey(conversationId));
        previousJob = prevJobId && typeof messageQueue.getJob === 'function'
            ? await Promise.resolve(messageQueue.getJob(prevJobId)).catch(() => null)
            : null;
        if (payload.within_allowance === undefined && previousJob?.data?.within_allowance !== undefined) {
            payload.within_allowance = previousJob.data.within_allowance;
        }
    } catch (_) { /* best-effort */ }

    // A redelivery can arrive after BullMQ accepted the job but before the
    // receipt was updated. Reuse the existing message-identified job instead of
    // creating a second logical enqueue.
    if (isSameMessageJob(previousJob, payload.messageId) && await isResidentJob(previousJob)) {
        return previousJob;
    }

    let existingJob = null;
    if (payload.messageId && typeof messageQueue.getJob === 'function') {
        try {
            existingJob = await messageQueue.getJob(flushJobId);
        } catch (_) { /* enqueue below remains the source of truth */ }
        if (isSameMessageJob(existingJob, payload.messageId) && await isResidentJob(existingJob)) {
            return existingJob;
        }
    }

    await removeQueuedJob(prevJobId, previousJob);

    const queueResult = await messageQueue.add(
        'burst-flush',
        { ...payload, burstFlush: true },
        { jobId: flushJobId, delay, group: { id: shopId } },
    );
    try {
        await cacheRedis.set(pendingKey(conversationId), flushJobId, 'EX', KEY_TTL_SECONDS);
    } catch (_) { /* best-effort */ }
    return queueResult;
}

/**
 * Cancel a pending flush and clear the debounce bookkeeping (e.g. on a STOP
 * keyword, when no reply should be sent).
 */
async function cancelBurstFlush(conversationId, { strict = false } = {}) {
    if (!conversationId) return;
    try {
        const prevJobId = await cacheRedis.get(pendingKey(conversationId));
        await removeQueuedJob(prevJobId, null, { strict });
        await cacheRedis.del(pendingKey(conversationId), firstSeenKey(conversationId));
    } catch (err) {
        logger.warn('cancelBurstFlush failed (non-fatal)', { conversationId, error: err.message });
        if (strict) {
            const failure = new Error('Burst cancellation failed');
            failure.name = 'BurstCancellationError';
            failure.code = 'BURST_CANCELLATION_FAILED';
            failure.retryable = true;
            failure.cause = err;
            throw failure;
        }
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
