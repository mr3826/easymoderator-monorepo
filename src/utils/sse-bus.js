'use strict';

/**
 * SSEBus — Redis pub/sub bridge for Server-Sent Events.
 *
 * Enables events emitted on backend instance A to reach SSE clients
 * connected to backend instance B. Uses two dedicated Redis clients
 * (sseRedisPub + sseRedisSub) on DB 3 to avoid interfering with the
 * cache / rate-limit / session pipelines.
 *
 * Channel naming convention:
 *   pub/sub channel : sse:shop:{shopId}
 *   sequence key    : sse:shop:{shopId}:seq     (INCR — monotonic per shop)
 *   replay list key : sse:shop:{shopId}:replay  (LPUSH, LTRIM 0 49, EXPIRE 600)
 *
 * Replay buffer:
 *   - Newest event at list index 0 (LPUSH prepends).
 *   - Capped at 50 entries via LTRIM after every push.
 *   - 10-minute TTL refreshed on every push (EXPIRE 600).
 *   - getReplay(shopId, lastEventId) returns entries with id > lastEventId,
 *     sorted oldest-first for ordered SSE replay on reconnect.
 *
 * Fallback mode:
 *   When pub or sub client has _isMemoryFallback=true, the bus operates
 *   entirely in-process via EventEmitter. This preserves local-dev behaviour
 *   without requiring a Redis instance. Replay buffer is disabled in fallback.
 *
 * Critical invariant — no double-emit:
 *   publish() only writes to the Redis channel. Delivery to local res objects
 *   happens exclusively via the subscription callback. The publish() method
 *   itself never writes to res objects directly.
 */

const EventEmitter = require('events');
const { createLogger } = require('./structured-logger');

const logger = createLogger('SSEBus');

const REPLAY_KEY_PREFIX  = 'sse:shop:';
const REPLAY_SUFFIX      = ':replay';
const SEQ_SUFFIX         = ':seq';
const PUBSUB_PREFIX      = 'sse:shop:';
const REPLAY_CAP         = 50;
const REPLAY_TTL_SECONDS = 600;

/**
 * SSEBus class.
 *
 * Usage (production):
 *   const { sseRedisPub, sseRedisSub } = require('../config/redis');
 *   const bus = new SSEBus({ pub: sseRedisPub, sub: sseRedisSub });
 *
 * Usage (test):
 *   const bus = new SSEBus({ pub: mockPub, sub: mockSub });
 *
 * @param {{ pub: object, sub: object }} clients
 */
class SSEBus {
    constructor({ pub, sub }) {
        this._pub = pub;
        this._sub = sub;

        // Determine operating mode. Both clients must be real Redis connections
        // for distributed pub/sub to work. If either is a memory fallback,
        // the bus degrades to in-process EventEmitter.
        this._fallback = !!(pub._isMemoryFallback || sub._isMemoryFallback);

        // In-process EventEmitter used in fallback mode AND to route incoming
        // Redis subscription messages to registered handlers.
        this._emitter = new EventEmitter();
        this._emitter.setMaxListeners(0); // unbounded — one listener per res connection

        // In-process sequence counter — used in fallback mode only.
        // In real-Redis mode the INCR command provides process-wide monotonic IDs.
        this._localSeq = 0;

        // Set of Redis channels currently subscribed (to know when to subscribe/
        // unsubscribe on the sub client).
        this._subscribedChannels = new Set();

        if (!this._fallback) {
            // Wire the ioredis 'message' event to our internal emitter so that
            // any handler registered via subscribe() receives it.
            this._sub.on('message', (channel, message) => {
                let envelope;
                try {
                    envelope = JSON.parse(message);
                } catch (err) {
                    logger.warn('SSEBus: received non-JSON message from Redis', { channel, message });
                    return;
                }
                // Emit on the internal emitter keyed by channel name
                this._emitter.emit(channel, envelope);
            });
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Publish an event for a shop.
     *
     * Assigns a monotonic numeric id, stores in the replay buffer, and publishes
     * to the Redis channel. Delivery to local handlers is via the subscription
     * callback only — this method never writes to res objects directly.
     *
     * @param {string} shopId
     * @param {string} event   SSE event name (e.g. 'new_message', 'hitl_changed')
     * @param {object} data    JSON-serialisable payload
     * @returns {Promise<number>} the assigned event id
     */
    async publish(shopId, event, data) {
        if (this._fallback) {
            return this._publishFallback(shopId, event, data);
        }

        const seqKey     = `${REPLAY_KEY_PREFIX}${shopId}${SEQ_SUFFIX}`;
        const replayKey  = `${REPLAY_KEY_PREFIX}${shopId}${REPLAY_SUFFIX}`;
        const channel    = `${PUBSUB_PREFIX}${shopId}`;

        // 1. Obtain the next sequence number for this shop.
        const id = await this._pub.incr(seqKey);

        const envelope = JSON.stringify({ id, event, data });

        // 2. Store in replay buffer: LPUSH (newest at index 0), then cap + TTL.
        await this._pub.lpush(replayKey, envelope);
        await this._pub.ltrim(replayKey, 0, REPLAY_CAP - 1);
        await this._pub.expire(replayKey, REPLAY_TTL_SECONDS);

        // 3. Publish to the Redis channel. Delivery to local handlers is via the
        //    'message' subscriber event — not via any direct call here.
        await this._pub.publish(channel, envelope);

        return id;
    }

    /**
     * Register a handler for events published to a shop's channel.
     *
     * First subscription for a shop causes the sub client to subscribe to the
     * Redis channel. Subsequent subscriptions for the same shop reuse the
     * existing Redis subscription (one channel sub, many handlers).
     *
     * @param {string}   shopId
     * @param {Function} handler  Called with the parsed envelope: { id, event, data }
     */
    async subscribe(shopId, handler) {
        if (this._fallback) {
            this._emitter.on(`fallback:${shopId}`, handler);
            return;
        }

        const channel = `${PUBSUB_PREFIX}${shopId}`;

        // Register handler on internal emitter (keyed by Redis channel name)
        this._emitter.on(channel, handler);

        // Subscribe the sub client to the Redis channel on first local listener
        if (!this._subscribedChannels.has(channel)) {
            this._subscribedChannels.add(channel);
            await this._sub.subscribe(channel);
            logger.debug('SSEBus: subscribed to Redis channel', { channel });
        }
    }

    /**
     * Remove a previously registered handler.
     *
     * When the last handler for a shop is removed, the sub client unsubscribes
     * from the Redis channel to avoid accumulating idle subscriptions.
     *
     * @param {string}   shopId
     * @param {Function} handler  The exact function reference passed to subscribe()
     */
    async unsubscribe(shopId, handler) {
        if (this._fallback) {
            this._emitter.off(`fallback:${shopId}`, handler);
            return;
        }

        const channel = `${PUBSUB_PREFIX}${shopId}`;
        this._emitter.off(channel, handler);

        // If no listeners remain, release the Redis channel subscription
        if (this._emitter.listenerCount(channel) === 0) {
            this._subscribedChannels.delete(channel);
            try {
                await this._sub.unsubscribe(channel);
                logger.debug('SSEBus: unsubscribed from Redis channel', { channel });
            } catch (err) {
                logger.warn('SSEBus: error unsubscribing from channel', { channel, err: err.message });
            }
        }
    }

    /**
     * Retrieve buffered events for a shop with id strictly greater than lastEventId.
     * Returned in oldest-first order so the client receives them in original sequence.
     *
     * Returns an empty array in fallback mode (no persistent buffer in dev).
     *
     * @param {string} shopId
     * @param {number} lastEventId  Reconnecting client's last received event id
     * @returns {Promise<Array<{id: number, event: string, data: object}>>}
     */
    async getReplay(shopId, lastEventId) {
        if (this._fallback) {
            return [];
        }

        const replayKey = `${REPLAY_KEY_PREFIX}${shopId}${REPLAY_SUFFIX}`;

        // LRANGE 0 -1 returns the full list (newest at index 0)
        const raw = await this._pub.lrange(replayKey, 0, -1);

        const events = [];
        for (const entry of raw) {
            let parsed;
            try {
                parsed = JSON.parse(entry);
            } catch {
                logger.warn('SSEBus: skipping malformed replay entry', { entry });
                continue;
            }
            if (typeof parsed.id === 'number' && parsed.id > lastEventId) {
                events.push(parsed);
            }
        }

        // Sort ascending by id (oldest first) — LRANGE returns newest-first
        events.sort((a, b) => a.id - b.id);
        return events;
    }

    /**
     * Clean up all listeners. Call on process shutdown.
     */
    destroy() {
        this._emitter.removeAllListeners();
        this._subscribedChannels.clear();
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * In-process publish for memory-fallback mode.
     * Uses a local counter for ids and emits directly on the EventEmitter.
     * No replay buffer in fallback mode.
     *
     * @param {string} shopId
     * @param {string} event
     * @param {object} data
     * @returns {Promise<number>}
     */
    async _publishFallback(shopId, event, data) {
        const id = ++this._localSeq;
        const envelope = { id, event, data };
        // In fallback mode delivery is synchronous. This is intentional: there is
        // no Redis broker hop and no risk of double-emit because the fallback path
        // does not use the real pub/sub client at all.
        this._emitter.emit(`fallback:${shopId}`, envelope);
        return id;
    }
}

// ── Singleton export ──────────────────────────────────────────────────────────
// Lazily constructed on first require() so tests can inject mocks before import.
// Production code requires this module and gets the singleton wired to real Redis.

let _singleton = null;

/**
 * Returns the singleton SSEBus instance wired to the real Redis clients
 * from src/config/redis.js. The instance is created lazily on first call.
 */
function getBus() {
    if (!_singleton) {
        const { sseRedisPub, sseRedisSub } = require('../config/redis');
        _singleton = new SSEBus({ pub: sseRedisPub, sub: sseRedisSub });
    }
    return _singleton;
}

module.exports = SSEBus;
module.exports.getBus = getBus;
