'use strict';

/**
 * sse-bus.test.js
 *
 * Unit tests for the SSE Redis pub/sub bridge.
 *
 * All Redis clients are hand-rolled mocks (no ioredis-mock dependency needed)
 * because sse-bus.js accepts them as constructor arguments.
 *
 * Tests cover:
 *   - publish() stores event in replay buffer and publishes to channel
 *   - subscribe() delivers published events to handlers
 *   - replay buffer is capped at 50 events (LTRIM 0 49)
 *   - replay buffer TTL is set to 600s on every push
 *   - sequence numbers are monotonically increasing per shop
 *   - getReplay() returns events with id > lastEventId, oldest first
 *   - fallback mode (in-process EventEmitter) works when _isMemoryFallback=true
 *   - no double-emit: publisher's own handler receives the event exactly once
 *     (via the subscribe callback, not via a separate direct write)
 *   - unsubscribe() stops delivery to removed handlers
 */

process.env.NODE_ENV = 'test';

// ── Inline Redis mock factory ─────────────────────────────────────────────────

/**
 * Build a minimal Redis mock that supports the commands sse-bus.js uses:
 *   INCR, LPUSH, LTRIM, EXPIRE, LRANGE, PUBLISH, SUBSCRIBE, UNSUBSCRIBE
 *
 * The mock is synchronous-first (returns resolved Promises) and captures
 * calls for assertion.
 */
function makeRedisMock() {
    const store = {}; // key → value (strings or lists)
    const channels = {}; // channel → [handler]
    const calls = { incr: [], lpush: [], ltrim: [], expire: [], lrange: [], publish: [] };

    const mock = {
        _isReal: true, // NOT a memory fallback — force real-Redis path
        status: 'ready',
        store,
        calls,

        async incr(key) {
            store[key] = (parseInt(store[key] || '0', 10) + 1).toString();
            calls.incr.push(key);
            return parseInt(store[key], 10);
        },

        async lpush(key, ...values) {
            if (!Array.isArray(store[key])) store[key] = [];
            // LPUSH prepends each value left-to-right so rightmost ends up at index 0
            for (const v of values) store[key].unshift(v);
            calls.lpush.push({ key, values });
            return store[key].length;
        },

        async ltrim(key, start, stop) {
            if (!Array.isArray(store[key])) return 'OK';
            store[key] = store[key].slice(start, stop + 1);
            calls.ltrim.push({ key, start, stop });
            return 'OK';
        },

        async expire(key, seconds) {
            calls.expire.push({ key, seconds });
            return 1;
        },

        async lrange(key, start, stop) {
            if (!Array.isArray(store[key])) return [];
            const end = stop === -1 ? store[key].length : stop + 1;
            calls.lrange.push({ key, start, stop });
            return store[key].slice(start, end);
        },

        async publish(channel, message) {
            calls.publish.push({ channel, message });
            // Simulate synchronous delivery to all subscribers
            if (channels[channel]) {
                for (const handler of channels[channel]) {
                    handler(channel, message);
                }
            }
            return channels[channel] ? channels[channel].length : 0;
        },

        async subscribe(channel) {
            // ioredis subscribe transitions client to subscriber mode;
            // actual message delivery is via the 'message' event listener.
            // We record the subscription here; message delivery is via publish().
            return 'OK';
        },

        async unsubscribe(channel) {
            return 'OK';
        },

        // EventEmitter-style for message delivery
        _handlers: {},
        on(event, handler) {
            this._handlers[event] = this._handlers[event] || [];
            this._handlers[event].push(handler);
            return this;
        },

        // Helper: simulate an incoming message on this subscriber client
        _deliver(channel, message) {
            const handlers = this._handlers['message'] || [];
            for (const h of handlers) h(channel, message);
        },

        // Track which channels are subscribed
        _subscribed: new Set(),
        _subscribeTrack(channel) { this._subscribed.add(channel); },
        _unsubscribeTrack(channel) { this._subscribed.delete(channel); }
    };

    return mock;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SSEBus', () => {
    let SSEBus;
    let pubMock, subMock;
    let bus;

    beforeEach(() => {
        jest.resetModules();
        // We need to re-require after resetting modules so the bus gets fresh mocks
        pubMock = makeRedisMock();
        subMock = makeRedisMock();

        // sse-bus.js exports a class; we construct with injected clients
        SSEBus = require('../sse-bus');
        bus = new SSEBus({ pub: pubMock, sub: subMock });
    });

    afterEach(() => {
        bus.destroy();
    });

    // ── Sequence number monotonicity ──────────────────────────────────────────

    describe('sequence numbers', () => {
        test('first publish for a shop returns id 1', async () => {
            // The mock INCR starts at 0 and increments
            pubMock.incr = jest.fn().mockResolvedValue(1);
            pubMock.lpush = jest.fn().mockResolvedValue(1);
            pubMock.ltrim = jest.fn().mockResolvedValue('OK');
            pubMock.expire = jest.fn().mockResolvedValue(1);
            pubMock.publish = jest.fn().mockResolvedValue(0);

            const id = await bus.publish('shop-1', 'new_message', { text: 'hello' });
            expect(id).toBe(1);
        });

        test('sequence numbers increase monotonically per shop', async () => {
            let seq = 0;
            pubMock.incr = jest.fn().mockImplementation(async () => ++seq);
            pubMock.lpush = jest.fn().mockResolvedValue(1);
            pubMock.ltrim = jest.fn().mockResolvedValue('OK');
            pubMock.expire = jest.fn().mockResolvedValue(1);
            pubMock.publish = jest.fn().mockResolvedValue(0);

            const ids = [];
            for (let i = 0; i < 5; i++) {
                ids.push(await bus.publish('shop-1', 'evt', { i }));
            }
            expect(ids).toEqual([1, 2, 3, 4, 5]);
        });

        test('different shops have independent sequence keys', async () => {
            const incrCalls = [];
            pubMock.incr = jest.fn().mockImplementation(async (key) => {
                incrCalls.push(key);
                return 1;
            });
            pubMock.lpush = jest.fn().mockResolvedValue(1);
            pubMock.ltrim = jest.fn().mockResolvedValue('OK');
            pubMock.expire = jest.fn().mockResolvedValue(1);
            pubMock.publish = jest.fn().mockResolvedValue(0);

            await bus.publish('shop-A', 'evt', {});
            await bus.publish('shop-B', 'evt', {});

            expect(incrCalls).toContain('sse:shop:shop-A:seq');
            expect(incrCalls).toContain('sse:shop:shop-B:seq');
        });
    });

    // ── Replay buffer ─────────────────────────────────────────────────────────

    describe('replay buffer', () => {
        test('publish calls LPUSH on the replay list key', async () => {
            pubMock.lpush = jest.fn().mockResolvedValue(1);
            pubMock.ltrim = jest.fn().mockResolvedValue('OK');
            pubMock.expire = jest.fn().mockResolvedValue(1);
            pubMock.publish = jest.fn().mockResolvedValue(0);

            await bus.publish('shop-1', 'new_message', { text: 'hi' });

            expect(pubMock.lpush).toHaveBeenCalledWith(
                'sse:shop:shop-1:replay',
                expect.stringContaining('"event":"new_message"')
            );
        });

        test('publish trims replay list to 50 elements (LTRIM 0 49)', async () => {
            pubMock.lpush = jest.fn().mockResolvedValue(51);
            pubMock.ltrim = jest.fn().mockResolvedValue('OK');
            pubMock.expire = jest.fn().mockResolvedValue(1);
            pubMock.publish = jest.fn().mockResolvedValue(0);

            await bus.publish('shop-1', 'evt', {});

            expect(pubMock.ltrim).toHaveBeenCalledWith('sse:shop:shop-1:replay', 0, 49);
        });

        test('publish sets 600-second TTL on the replay list', async () => {
            pubMock.lpush = jest.fn().mockResolvedValue(1);
            pubMock.ltrim = jest.fn().mockResolvedValue('OK');
            pubMock.expire = jest.fn().mockResolvedValue(1);
            pubMock.publish = jest.fn().mockResolvedValue(0);

            await bus.publish('shop-1', 'evt', {});

            expect(pubMock.expire).toHaveBeenCalledWith('sse:shop:shop-1:replay', 600);
        });

        test('getReplay returns events with id > lastEventId, oldest first', async () => {
            // The replay LIST is stored LPUSH (newest at index 0, oldest last).
            // Simulate 5 stored events: index 0 = newest (id 5), index 4 = oldest (id 1).
            const storedEvents = [5, 4, 3, 2, 1].map(id =>
                JSON.stringify({ id, event: 'evt', data: { seq: id } })
            );
            pubMock.lrange = jest.fn().mockResolvedValue(storedEvents);

            const result = await bus.getReplay('shop-1', 2);
            // Should return events with id > 2, ordered oldest first: 3, 4, 5
            expect(result.map(e => e.id)).toEqual([3, 4, 5]);
        });

        test('getReplay with lastEventId=0 returns all events oldest first', async () => {
            const storedEvents = [3, 2, 1].map(id =>
                JSON.stringify({ id, event: 'evt', data: {} })
            );
            pubMock.lrange = jest.fn().mockResolvedValue(storedEvents);

            const result = await bus.getReplay('shop-1', 0);
            expect(result.map(e => e.id)).toEqual([1, 2, 3]);
        });

        test('getReplay returns empty array when no events are newer', async () => {
            const storedEvents = [2, 1].map(id =>
                JSON.stringify({ id, event: 'evt', data: {} })
            );
            pubMock.lrange = jest.fn().mockResolvedValue(storedEvents);

            const result = await bus.getReplay('shop-1', 5);
            expect(result).toEqual([]);
        });

        test('getReplay handles empty replay buffer gracefully', async () => {
            pubMock.lrange = jest.fn().mockResolvedValue([]);
            const result = await bus.getReplay('shop-1', 0);
            expect(result).toEqual([]);
        });

        test('getReplay handles malformed JSON entries without throwing', async () => {
            pubMock.lrange = jest.fn().mockResolvedValue([
                'NOT_JSON',
                JSON.stringify({ id: 2, event: 'evt', data: {} })
            ]);
            const result = await bus.getReplay('shop-1', 0);
            // Malformed entry is skipped; valid entry is returned
            expect(result.map(e => e.id)).toContain(2);
        });
    });

    // ── Publish/subscribe delivery ────────────────────────────────────────────

    describe('publish/subscribe delivery', () => {
        test('publish writes to Redis channel with correct key', async () => {
            pubMock.publish = jest.fn().mockResolvedValue(1);
            pubMock.lpush = jest.fn().mockResolvedValue(1);
            pubMock.ltrim = jest.fn().mockResolvedValue('OK');
            pubMock.expire = jest.fn().mockResolvedValue(1);

            await bus.publish('shop-42', 'hitl_changed', { hitl: true });

            expect(pubMock.publish).toHaveBeenCalledWith(
                'sse:shop:shop-42',
                expect.stringContaining('"event":"hitl_changed"')
            );
        });

        test('subscribe handler is called when a message arrives on the channel', async () => {
            const received = [];
            await bus.subscribe('shop-1', (envelope) => received.push(envelope));

            // Simulate incoming message from Redis subscriber
            const envelope = JSON.stringify({ id: 1, event: 'new_message', data: { text: 'hi' } });
            subMock._deliver('sse:shop:shop-1', envelope);

            expect(received).toHaveLength(1);
            expect(received[0]).toMatchObject({ id: 1, event: 'new_message' });
        });

        test('multiple handlers for same shop all receive the event', async () => {
            const recv1 = [], recv2 = [];
            await bus.subscribe('shop-1', (e) => recv1.push(e));
            await bus.subscribe('shop-1', (e) => recv2.push(e));

            subMock._deliver('sse:shop:shop-1', JSON.stringify({ id: 1, event: 'evt', data: {} }));

            expect(recv1).toHaveLength(1);
            expect(recv2).toHaveLength(1);
        });

        test('unsubscribe removes handler — subsequent messages not delivered', async () => {
            const received = [];
            const handler = (e) => received.push(e);

            await bus.subscribe('shop-1', handler);
            await bus.unsubscribe('shop-1', handler);

            subMock._deliver('sse:shop:shop-1', JSON.stringify({ id: 2, event: 'evt', data: {} }));
            expect(received).toHaveLength(0);
        });

        test('handlers for different shops do not cross-pollinate', async () => {
            const recv1 = [], recv2 = [];
            await bus.subscribe('shop-A', (e) => recv1.push(e));
            await bus.subscribe('shop-B', (e) => recv2.push(e));

            subMock._deliver('sse:shop:shop-A', JSON.stringify({ id: 1, event: 'evt', data: {} }));

            expect(recv1).toHaveLength(1);
            expect(recv2).toHaveLength(0);
        });

        test('malformed JSON from Redis subscriber does not throw', async () => {
            const received = [];
            await bus.subscribe('shop-1', (e) => received.push(e));

            // Should not throw
            expect(() => subMock._deliver('sse:shop:shop-1', 'INVALID_JSON')).not.toThrow();
            expect(received).toHaveLength(0);
        });
    });

    // ── Payload structure ─────────────────────────────────────────────────────

    describe('published envelope structure', () => {
        test('published JSON contains id, event, and data fields', async () => {
            let capturedPayload = null;
            pubMock.publish = jest.fn().mockImplementation(async (channel, msg) => {
                capturedPayload = msg;
                return 0;
            });
            pubMock.lpush = jest.fn().mockResolvedValue(1);
            pubMock.ltrim = jest.fn().mockResolvedValue('OK');
            pubMock.expire = jest.fn().mockResolvedValue(1);

            await bus.publish('shop-1', 'delivery_failed', { reason: 'token expired' });

            const parsed = JSON.parse(capturedPayload);
            expect(parsed).toMatchObject({
                id: expect.any(Number),
                event: 'delivery_failed',
                data: { reason: 'token expired' }
            });
        });

        test('replay entry matches the published envelope', async () => {
            let capturedReplayEntry = null;
            pubMock.lpush = jest.fn().mockImplementation(async (key, value) => {
                capturedReplayEntry = value;
                return 1;
            });
            pubMock.ltrim = jest.fn().mockResolvedValue('OK');
            pubMock.expire = jest.fn().mockResolvedValue(1);
            pubMock.publish = jest.fn().mockResolvedValue(0);

            await bus.publish('shop-1', 'channel_error', { code: 'TOKEN_EXPIRED' });

            const parsed = JSON.parse(capturedReplayEntry);
            expect(parsed).toMatchObject({
                id: expect.any(Number),
                event: 'channel_error',
                data: { code: 'TOKEN_EXPIRED' }
            });
        });
    });

    // ── Memory-fallback mode ──────────────────────────────────────────────────

    describe('memory fallback (in-process EventEmitter)', () => {
        let fallbackBus;

        beforeEach(() => {
            const fallbackPub = { _isMemoryFallback: true };
            const fallbackSub = { _isMemoryFallback: true };
            fallbackBus = new SSEBus({ pub: fallbackPub, sub: fallbackSub });
        });

        afterEach(() => {
            fallbackBus.destroy();
        });

        test('publish in fallback mode delivers to subscribed handlers in-process', async () => {
            const received = [];
            await fallbackBus.subscribe('shop-1', (e) => received.push(e));
            await fallbackBus.publish('shop-1', 'new_message', { text: 'fallback' });

            expect(received).toHaveLength(1);
            expect(received[0]).toMatchObject({ event: 'new_message', data: { text: 'fallback' } });
        });

        test('publish in fallback mode returns a monotonically increasing id', async () => {
            await fallbackBus.subscribe('shop-1', () => {});
            const id1 = await fallbackBus.publish('shop-1', 'evt', {});
            const id2 = await fallbackBus.publish('shop-1', 'evt', {});
            expect(id2).toBeGreaterThan(id1);
        });

        test('getReplay in fallback mode returns empty array (no buffer)', async () => {
            const result = await fallbackBus.getReplay('shop-1', 0);
            expect(result).toEqual([]);
        });

        test('unsubscribe in fallback mode stops delivery', async () => {
            const received = [];
            const handler = (e) => received.push(e);
            await fallbackBus.subscribe('shop-1', handler);
            await fallbackBus.unsubscribe('shop-1', handler);
            await fallbackBus.publish('shop-1', 'evt', {});
            expect(received).toHaveLength(0);
        });
    });

    // ── No-double-emit guard ──────────────────────────────────────────────────

    describe('no-double-emit', () => {
        test('publish delivers to handler exactly once via subscription, not twice', async () => {
            // This test verifies Critical Invariant #3: when process A publishes,
            // delivery to local res objects happens ONLY via the subscription callback,
            // never also via a separate direct write in publish().
            const received = [];
            await bus.subscribe('shop-1', (e) => received.push(e));

            // Wire up publish to also simulate the Redis broker delivering back to subMock
            pubMock.publish = jest.fn().mockImplementation(async (channel, msg) => {
                // Simulate the broker delivering to ALL subscribers (including the publisher)
                subMock._deliver(channel, msg);
                return 1;
            });
            pubMock.lpush = jest.fn().mockResolvedValue(1);
            pubMock.ltrim = jest.fn().mockResolvedValue('OK');
            pubMock.expire = jest.fn().mockResolvedValue(1);

            await bus.publish('shop-1', 'new_message', { text: 'test' });

            // Handler must be called exactly once — no direct write in publish()
            expect(received).toHaveLength(1);
        });
    });
});
