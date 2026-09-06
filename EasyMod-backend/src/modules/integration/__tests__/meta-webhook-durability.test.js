'use strict';

/**
 * Durable inbound webhook receipts — findings F-02 and F-03.
 *
 * Before this work an unmapped Page or a failed message INSERT was logged and
 * abandoned while Meta was told 200, which suppresses Meta's own retry. The
 * event then existed nowhere and a real customer message was gone.
 *
 * Every test below is a property of "no inbound message is ever lost".
 */

process.env.NODE_ENV = 'test';
process.env.META_APP_SECRET = 'durability-test-app-secret';
process.env.CHANNEL_ENCRYPTION_KEY = 'a'.repeat(64);

// ── Mocks (before any require) ────────────────────────────────────────────────

jest.mock('src/config/redis', () => ({
    sessionRedis: null, cacheRedis: null, rateLimitRedis: null,
    closeAllRedis: jest.fn(), checkRedisAvailability: jest.fn(() => ({})),
}));
jest.mock('rate-limit-redis', () => ({ RedisStore: jest.fn() }));

const logCalls = [];
jest.mock('src/utils/structured-logger', () => ({
    createLogger: jest.fn(() => new Proxy({}, {
        get: () => (...args) => { logCalls.push(args); },
    })),
}));

const alertCalls = [];
jest.mock('src/utils/ops-alert', () => ({
    opsAlert: jest.fn(async (title, opts) => { alertCalls.push({ title, ...opts }); }),
    sendSlack: jest.fn(),
}));

jest.mock('src/config/config', () => ({
    metaAppSecret: 'durability-test-app-secret',
    metaWebhookAppSecret: 'durability-test-app-secret',
    metaWebhookVerifyToken: 'verify-token',
    jwtAccessSecret: 'x'.repeat(32),
}));

const mockMetaChannelService = { findByMetaAssetId: jest.fn() };
jest.mock('src/modules/channel-providers/meta-channel.service', () => mockMetaChannelService);
jest.mock('src/modules/channel-providers/meta-channel.entity', () => ({ findOne: jest.fn() }));

const mockCustomer = { findOrCreate: jest.fn() };
const mockConversation = { findOne: jest.fn(), create: jest.fn() };
const mockMessage = { findOne: jest.fn(), create: jest.fn() };
jest.mock('src/modules/entities', () => ({
    Customer: mockCustomer, Conversation: mockConversation, Message: mockMessage,
}));
jest.mock('src/modules/conversation/conversation.entity', () => ({
    Conversation: mockConversation, Message: mockMessage,
}));

const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        define: jest.fn(() => ({})),
        transaction: jest.fn(async (fn) => fn(mockTransaction)),
        authenticate: jest.fn(),
    },
}));

const mockConsentService = {
    isStopKeyword: jest.fn(() => false),
    recordInbound: jest.fn().mockResolvedValue({ id: 'cust-1' }),
    recordOptOut: jest.fn().mockResolvedValue({ id: 'cust-1' }),
    recordOptIn: jest.fn().mockResolvedValue({ id: 'cust-1' }),
};
jest.mock('src/modules/consent/consent.service', () => mockConsentService);
jest.mock('src/modules/customer/customer-profile.service', () => ({
    enrichCustomerNameFromMeta: jest.fn().mockResolvedValue(true),
    isPlaceholderName: jest.fn(() => false),
}));
jest.mock('src/utils/sse-manager', () => ({ emit: jest.fn() }));
jest.mock('src/jobs/message-queue', () => ({
    messageQueue: { add: jest.fn().mockResolvedValue(undefined) },
}));
const mockScheduleBurstFlush = jest.fn().mockResolvedValue(undefined);
jest.mock('src/jobs/burst-coalescer', () => ({
    scheduleBurstFlush: (...args) => mockScheduleBurstFlush(...args),
    cancelBurstFlush: jest.fn().mockResolvedValue(undefined),
}));

const mockTrackUsage = jest.fn().mockResolvedValue({ transactionId: 'txn-1', isRetry: false });
jest.mock('src/modules/subscription/subscription.service', () => ({
    trackUsage: (...args) => mockTrackUsage(...args),
}));

// ── In-memory MetaWebhookReceipt standing in for the Postgres table ───────────

class UniqueConstraintError extends Error {
    constructor() { super('duplicate key'); this.name = 'SequelizeUniqueConstraintError'; }
}

const store = new Map();
let failCreate = null;
let failClaimOnce = false;
let idCounter = 0;

const matches = (row, where) => Object.entries(where).every(([field, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        const [[opSym, value]] = Object.getOwnPropertySymbols(cond).length
            ? [[Object.getOwnPropertySymbols(cond)[0], cond[Object.getOwnPropertySymbols(cond)[0]]]]
            : Object.entries(cond);
        const opName = String(opSym);
        if (opName.includes('in')) return value.includes(row[field]);
        if (opName.includes('lte')) return row[field] != null && row[field] <= value;
        if (opName.includes('lt')) return row[field] != null && row[field] < value;
        return false;
    }
    return row[field] === cond;
});

const evalWhere = (row, where = {}) => {
    const orSym = Object.getOwnPropertySymbols(where).find((s) => String(s).includes('or'));
    if (orSym) return where[orSym].some((clause) => evalWhere(row, clause));
    return matches(row, where);
};

const makeRow = (fields) => {
    const row = {
        id: `receipt-${++idCounter}`,
        status: 'RECEIVED',
        retry_count: 0,
        processing_token: null,
        next_retry_at: null,
        received_at: new Date(),
        updated_at: new Date(),
        created_at: new Date(),
        ...fields,
    };
    row.update = jest.fn(async (patch) => { Object.assign(row, patch, { updated_at: new Date() }); return row; });
    row.set = jest.fn((patch) => { Object.assign(row, patch); return row; });
    return row;
};

const MockReceipt = {
    findOne: jest.fn(async ({ where }) => [...store.values()].find((r) => evalWhere(r, where)) || null),
    findAll: jest.fn(async ({ where, limit, order }) => {
        const rows = [...store.values()].filter((r) => evalWhere(r, where));
        const orderExpression = order?.[0]?.[0]?.val || order?.[0]?.[0] || '';
        if (String(orderExpression).includes('COALESCE')) {
            rows.sort((left, right) => (
                (left.next_retry_at || left.updated_at).getTime()
                - (right.next_retry_at || right.updated_at).getTime()
            ));
        }
        return rows.slice(0, limit);
    }),
    count: jest.fn(async ({ where }) => [...store.values()].filter((r) => evalWhere(r, where)).length),
    destroy: jest.fn(async () => 0),
    create: jest.fn(async (fields) => {
        if (failCreate) throw failCreate;
        if ([...store.values()].some((r) => r.dedupe_key === fields.dedupe_key)) throw new UniqueConstraintError();
        const row = makeRow(fields);
        store.set(row.id, row);
        return row;
    }),
    update: jest.fn(async (patch, { where }) => {
        if (failClaimOnce && patch.status === 'PROCESSING') {
            failClaimOnce = false;
            throw new Error('claim store unavailable');
        }
        const rows = [...store.values()].filter((r) => evalWhere(r, where));
        rows.forEach((r) => Object.assign(r, patch, { updated_at: new Date() }));
        return [rows.length];
    }),
};
jest.mock('src/modules/integration/meta-webhook-receipt.entity', () => MockReceipt);

// ── Requires (after mocks) ────────────────────────────────────────────────────

const request = require('supertest');
const express = require('express');
const crypto = require('crypto');

const receiptService = require('src/modules/integration/meta-webhook-receipt.service');
const WebhookReceiptReconcilerJob = require('src/jobs/webhook-receipt-reconciler.job');
const { encryptPayload } = require('src/utils/webhook-payload-cipher');

const APP_SECRET = 'durability-test-app-secret';
const PAGE_ID = 'page-durability-1';
const SHOP_ID = 'shop-durability-1';
const SENDER_PSID = 'psid-secret-9988776655';
const MESSAGE_TEXT = 'Amar order ta kothay? Tracking din please';

let app;
beforeAll(() => {
    const webhookRouter = require('src/modules/integration/meta-webhook.routes');
    app = express();
    app.use('/webhooks/meta', webhookRouter);
});

const buildPayload = (overrides = {}, messagingOverrides = {}) => ({
    object: 'page',
    entry: [{
        id: PAGE_ID,
        messaging: [{
            sender: { id: SENDER_PSID },
            recipient: { id: PAGE_ID },
            timestamp: 1_800_000_000_000,
            message: { mid: 'mid.DURABILITY.1', text: MESSAGE_TEXT },
            ...messagingOverrides,
        }],
    }],
    ...overrides,
});

const post = (payload) => {
    const body = Buffer.from(JSON.stringify(payload));
    const sig = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
    return request(app)
        .post('/webhooks/meta')
        .set('Content-Type', 'application/octet-stream')
        .set('x-hub-signature-256', sig)
        .send(body);
};

const postRaw = (body, signature = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex')) =>
    request(app)
        .post('/webhooks/meta')
        .set('Content-Type', 'application/octet-stream')
        .set('x-hub-signature-256', signature)
        .send(body);

const connectedChannel = () => ({
    id: 'mc-durability-1',
    shop_id: SHOP_ID,
    platform: 'facebook',
    meta_asset_id: PAGE_ID,
    status: 'CONNECTED',
    display_name: 'Durability Test Page',
});

const receipts = () => [...store.values()];

beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    logCalls.length = 0;
    alertCalls.length = 0;
    failCreate = null;
    failClaimOnce = false;

    mockMetaChannelService.findByMetaAssetId.mockResolvedValue(connectedChannel());
    mockConsentService.isStopKeyword.mockReturnValue(false);
    mockConsentService.recordInbound.mockResolvedValue({ id: 'cust-1' });
    mockConsentService.recordOptOut.mockResolvedValue({ id: 'cust-1' });
    mockConsentService.recordOptIn.mockResolvedValue({ id: 'cust-1' });
    mockCustomer.findOrCreate.mockResolvedValue([{ id: 'cust-1', name: 'Facebook User', metadata: {} }, true]);
    mockConversation.findOne.mockResolvedValue(null);
    mockConversation.create.mockResolvedValue({ id: 'conv-1', update: jest.fn() });
    mockMessage.findOne.mockResolvedValue(null);
    mockMessage.create.mockResolvedValue({ id: 'msg-1', metadata: {}, toJSON: () => ({ id: 'msg-1' }) });
});

// ── 1. Receipt written before acknowledgement ────────────────────────────────

describe('durable receipt precedes acknowledgement', () => {
    test('a valid webhook creates a receipt and settles it QUEUED after handoff', async () => {
        await post(buildPayload()).expect(200);

        expect(receipts()).toHaveLength(1);
        const r = receipts()[0];
        expect(r.page_id).toBe(PAGE_ID);
        expect(r.event_id).toBe('mid.DURABILITY.1');
        expect(r.event_type).toBe('message');
        expect(r.status).toBe('QUEUED');
        expect(r.shop_id).toBe(SHOP_ID);
    });

    test('recovers when the live receipt claim throws instead of leaving RECEIVED unreachable', async () => {
        failClaimOnce = true;
        mockConsentService.isStopKeyword.mockReturnValue(true);

        await post(buildPayload()).expect(200);

        expect(receipts()[0].status).toBe('RETRY_PENDING');
        expect(receipts()[0].status).not.toBe('RECEIVED');
        expect(receipts()[0].payload_encrypted).toMatch(/^v1:/);

        receipts()[0].next_retry_at = new Date(Date.now() - 1000);
        const result = await new WebhookReceiptReconcilerJob().execute();

        expect(result.processed).toBe(1);
        expect(mockMessage.create).toHaveBeenCalledTimes(1);
        expect(receipts()[0].status).toBe('PROCESSED');
    });

    test('sweeps an orphaned RECEIVED receipt after the short orphan window', async () => {
        const messaging = buildPayload().entry[0].messaging[0];
        const recorded = await receiptService.recordReceipt({ pageId: PAGE_ID, messaging });
        recorded.receipt.received_at = new Date(Date.now() - 120_000);
        recorded.receipt.updated_at = new Date(Date.now() - 120_000);

        const claimed = await receiptService.claimDueReceipts(25);

        expect(claimed).toHaveLength(1);
        expect(claimed[0].receipt.id).toBe(recorded.receipt.id);
        expect(claimed[0].receipt.status).toBe('PROCESSING');
    });

    test('claims a stale PROCESSING receipt ahead of 25 due retryable receipts', async () => {
        const payload = buildPayload().entry[0].messaging[0];
        for (let index = 0; index < 25; index += 1) {
            const row = makeRow({
                status: 'RETRY_PENDING',
                next_retry_at: new Date(Date.now() - 5_000 + index),
                payload_encrypted: encryptPayload(payload),
            });
            store.set(row.id, row);
        }
        const stale = makeRow({
            status: 'PROCESSING',
            processing_token: 'stale-token',
            next_retry_at: null,
            updated_at: new Date(Date.now() - 60 * 60 * 1000),
            payload_encrypted: encryptPayload(payload),
        });
        store.set(stale.id, stale);

        const claimed = await receiptService.claimDueReceipts(25);

        expect(claimed[0].receipt.id).toBe(stale.id);
    });

    test('recovers a duplicate message before QUEUED without losing customer context', async () => {
        mockMessage.findOne.mockResolvedValue({
            id: 'message-existing',
            conversation_id: 'conv-1',
            external_id: 'mid.DURABILITY.1',
        });
        mockConversation.findOne.mockResolvedValue({
            id: 'conv-1',
            shop_id: SHOP_ID,
            customer_id: 'cust-1',
            channel: 'messenger',
            meta_channel_id: 'mc-durability-1',
            metadata: { within_allowance: true },
        });

        await post(buildPayload()).expect(200);

        expect(mockConsentService.recordInbound).toHaveBeenCalledWith(expect.objectContaining({
            customerId: 'cust-1',
            channelId: 'mc-durability-1',
        }));
        expect(mockScheduleBurstFlush).toHaveBeenCalled();
        expect(receipts()[0].status).toBe('QUEUED');
    });

    test('marks a channel resolution failure retryable after the receipt is created', async () => {
        mockMetaChannelService.findByMetaAssetId.mockRejectedValueOnce(new Error('channel store unavailable'));

        await post(buildPayload()).expect(200);

        expect(receipts()[0]).toMatchObject({
            status: 'RETRY_PENDING',
            last_error_code: 'CHANNEL_RESOLUTION_FAILED',
        });
        expect(mockMessage.create).not.toHaveBeenCalled();
    });

    test('returns 503 when a created receipt cannot persist its retry state', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValueOnce(null);
        MockReceipt.create.mockImplementationOnce(async (fields) => {
            const row = makeRow(fields);
            row.update = jest.fn(async () => { throw new Error('receipt status store unavailable'); });
            store.set(row.id, row);
            return row;
        });

        await post(buildPayload()).expect(503);

        expect(mockMessage.create).not.toHaveBeenCalled();
        expect(receipts()[0].status).toBe('RECEIVED');
    });

    test('marks a successful queue handoff as terminal and clears replay state', async () => {
        const receipt = makeRow({
            status: 'PROCESSING',
            payload_encrypted: 'v1:encrypted-replay-body',
            processing_token: 'processing-fence',
            last_error_code: 'QUEUE_DISPATCH_FAILED',
            next_retry_at: new Date(Date.now() + 60_000),
        });
        const before = Date.now();

        await receiptService.markQueued(receipt, {
            shopId: SHOP_ID,
            metaChannelId: 'mc-durability-1',
        });

        expect(receipt.status).toBe('QUEUED');
        expect(receipt.shop_id).toBe(SHOP_ID);
        expect(receipt.meta_channel_id).toBe('mc-durability-1');
        expect(receipt.processing_token).toBeNull();
        expect(receipt.payload_encrypted).toBeNull();
        expect(receipt.last_error_code).toBeNull();
        expect(receipt.next_retry_at).toBeNull();
        expect(receipt.processed_at).toBeInstanceOf(Date);
        expect(receipt.processed_at.getTime()).toBeGreaterThanOrEqual(before);
    });

    test('treats QUEUED as terminal while preserving PROCESSED for non-queue events', async () => {
        expect(receiptService.TERMINAL_STATUSES).toEqual(
            expect.arrayContaining(['QUEUED', 'PROCESSED', 'SKIPPED', 'DEAD_LETTERED']),
        );

        const receipt = makeRow({ status: 'PROCESSING' });
        await receiptService.markProcessed(receipt, { shopId: SHOP_ID, metaChannelId: 'mc-durability-1' });
        expect(receipt.status).toBe('PROCESSED');
    });

    test('includes QUEUED in terminal receipt retention', async () => {
        const now = new Date('2026-09-01T12:00:00.000Z');
        await receiptService.purgeExpiredReceipts(now);

        const where = MockReceipt.destroy.mock.calls[0][0].where;
        const orKey = Reflect.ownKeys(where).find((key) => String(key).includes('or'));
        const terminalClause = where[orKey].find((clause) => clause.created_at);
        const inKey = Reflect.ownKeys(terminalClause.status)[0];

        expect(terminalClause.status[inKey]).toEqual(
            expect.arrayContaining(['PROCESSED', 'SKIPPED', 'QUEUED']),
        );
    });

    test('carries the webhook Page asset through the normalized burst job payload', async () => {
        await post(buildPayload()).expect(200);

        expect(mockScheduleBurstFlush).toHaveBeenCalledWith(expect.objectContaining({
            metaChannelId: 'mc-durability-1',
            metaAssetId: PAGE_ID,
        }));
    });

    test('keeps a queue handoff failure retryable with its encrypted replay payload', async () => {
        mockScheduleBurstFlush.mockRejectedValueOnce(new Error('queue unavailable'));

        await post(buildPayload()).expect(200);

        expect(receipts()[0].status).toBe('RETRY_PENDING');
        expect(receipts()[0].payload_encrypted).toMatch(/^v1:/);
        expect(receipts()[0].last_error_code).toBe('QUEUE_DISPATCH_FAILED');
        expect(receipts()[0].next_retry_at).toBeInstanceOf(Date);
        expect(receipts()[0].status).not.toBe('QUEUED');
        expect(receipts()[0].status).not.toBe('PROCESSED');
    });

    test('keeps a consent failure retryable without scheduling an AI reply', async () => {
        mockConsentService.recordInbound.mockRejectedValueOnce(new Error('consent state unavailable'));

        await post(buildPayload()).expect(200);

        expect(receipts()[0].status).toBe('RETRY_PENDING');
        expect(receipts()[0].payload_encrypted).toMatch(/^v1:/);
        expect(receipts()[0].last_error_code).toBe('CONSENT_STATE_UNAVAILABLE');
        expect(mockScheduleBurstFlush).not.toHaveBeenCalled();
    });

    test('reconciles a queue failure into exactly one QUEUED terminal handoff', async () => {
        mockScheduleBurstFlush.mockRejectedValueOnce(new Error('queue unavailable'));

        await post(buildPayload()).expect(200);
        expect(receipts()[0].status).toBe('RETRY_PENDING');

        receipts()[0].next_retry_at = new Date(Date.now() - 1000);
        const result = await new WebhookReceiptReconcilerJob().execute();

        expect(result.processed).toBe(1);
        expect(receipts()[0].status).toBe('QUEUED');
        expect(receipts()[0].payload_encrypted).toBeNull();
        expect(receipts()[0].last_error_code).toBeNull();
        expect(mockScheduleBurstFlush).toHaveBeenCalledTimes(2);
    });

    test('keeps the receipt retryable when the queue update fails after enqueue', async () => {
        MockReceipt.create.mockImplementationOnce(async (fields) => {
            const row = makeRow(fields);
            const update = row.update;
            row.update = jest.fn(async (patch) => {
                if (patch.status === 'QUEUED') throw new Error('receipt update failed');
                return update(patch);
            });
            store.set(row.id, row);
            return row;
        });

        await post(buildPayload()).expect(200);

        expect(receipts()[0].status).toBe('RETRY_PENDING');
        expect(receipts()[0].last_error_code).toBe('QUEUE_RECEIPT_UPDATE_FAILED');
        expect(receipts()[0].payload_encrypted).toMatch(/^v1:/);
        expect(receipts()[0].status).not.toBe('QUEUED');
    });

    test('the receipt is written before channel resolution is attempted', async () => {
        const order = [];
        MockReceipt.create.mockImplementationOnce(async (fields) => {
            order.push('receipt');
            const row = makeRow(fields);
            store.set(row.id, row);
            return row;
        });
        mockMetaChannelService.findByMetaAssetId.mockImplementationOnce(async () => {
            order.push('resolve');
            return connectedChannel();
        });

        await post(buildPayload()).expect(200);
        expect(order).toEqual(['receipt', 'resolve']);
    });

    test('the sender PSID is stored only as a hash, never in the clear', async () => {
        await post(buildPayload()).expect(200);
        const r = receipts()[0];
        expect(r.sender_ref).toBe(crypto.createHash('sha256').update(SENDER_PSID).digest('hex'));
        expect(JSON.stringify({ ...r, update: undefined, set: undefined })).not.toContain(SENDER_PSID);
    });

    test('acknowledgement stays fast — no AI or provider work before the 200', async () => {
        const started = Date.now();
        await post(buildPayload()).expect(200);
        expect(Date.now() - started).toBeLessThan(2000);
    });
});

// ── 2. Receipt persistence failure must NOT be acknowledged ──────────────────

describe('receipt persistence failure returns a retryable 5xx', () => {
    test('a DB failure while writing the receipt returns 503, not 200', async () => {
        failCreate = new Error('connection terminated unexpectedly');
        await post(buildPayload()).expect(503);
        expect(receipts()).toHaveLength(0);
    });

    test('no message is stored when the receipt could not be written', async () => {
        failCreate = new Error('connection terminated unexpectedly');
        await post(buildPayload()).expect(503);
        expect(mockMessage.create).not.toHaveBeenCalled();
    });
});

// ── 3. Idempotency ───────────────────────────────────────────────────────────

describe('idempotency', () => {
    test('a redelivered webhook creates no second receipt and no second message', async () => {
        await post(buildPayload()).expect(200);
        expect(mockMessage.create).toHaveBeenCalledTimes(1);

        await post(buildPayload()).expect(200);
        expect(receipts()).toHaveLength(1);
        expect(mockMessage.create).toHaveBeenCalledTimes(1);
    });

    test('a redelivered webhook does not schedule a second AI reply', async () => {
        await post(buildPayload()).expect(200);
        await post(buildPayload()).expect(200);
        expect(mockScheduleBurstFlush).toHaveBeenCalledTimes(1);
    });

    test('concurrent deliveries of the same event stay idempotent', async () => {
        const payload = buildPayload();
        await Promise.all([post(payload), post(payload)]);
        expect(receipts()).toHaveLength(1);
        expect(mockMessage.create).toHaveBeenCalledTimes(1);
    });

    test('losing the unique-index race is a duplicate, not a persistence failure', async () => {
        // Both writers saw an empty table, so the loser's INSERT raises the
        // unique violation. That must resolve to the winner's row — returning a
        // 5xx here would make Meta redeliver an event we already have.
        const first = await receiptService.recordReceipt({
            pageId: PAGE_ID, messaging: buildPayload().entry[0].messaging[0],
        });
        MockReceipt.findOne.mockResolvedValueOnce(null);

        const second = await receiptService.recordReceipt({
            pageId: PAGE_ID, messaging: buildPayload().entry[0].messaging[0],
        });

        expect(second.duplicate).toBe(true);
        expect(second.receipt.id).toBe(first.receipt.id);
        expect(receipts()).toHaveLength(1);
    });
});

// ── 4. Unknown / non-connected Page (F-02) ───────────────────────────────────

describe('unknown or non-connected Page', () => {
    test('an unknown Page records IDENTITY_NOT_RESOLVED instead of dropping', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(null);
        await post(buildPayload()).expect(200);

        const r = receipts()[0];
        expect(r.status).toBe('IDENTITY_NOT_RESOLVED');
        expect(r.last_error_code).toBe('PAGE_NOT_CONNECTED');
        expect(r.next_retry_at).toBeInstanceOf(Date);
    });

    test('a DISCONNECTED channel is held, not routed', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue({
            ...connectedChannel(), status: 'DISCONNECTED',
        });
        await post(buildPayload()).expect(200);
        expect(receipts()[0].status).toBe('IDENTITY_NOT_RESOLVED');
        expect(mockMessage.create).not.toHaveBeenCalled();
    });

    test('a held event is never associated with another tenant', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(null);
        await post(buildPayload()).expect(200);
        expect(receipts()[0].shop_id ?? null).toBeNull();
        expect(receipts()[0].meta_channel_id ?? null).toBeNull();
    });

    test('an unresolved Page raises a PII-free operational alert', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(null);
        await post(buildPayload()).expect(200);

        expect(alertCalls).toHaveLength(1);
        const serialized = JSON.stringify(alertCalls);
        expect(serialized).toContain(PAGE_ID);
        expect(serialized).not.toContain(SENDER_PSID);
        expect(serialized).not.toContain(MESSAGE_TEXT);
    });

    test('the held event is delivered once the channel is legitimately reconnected', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(null);
        await post(buildPayload()).expect(200);
        expect(mockMessage.create).not.toHaveBeenCalled();

        // Merchant reconnects; the retry becomes due.
        receipts()[0].next_retry_at = new Date(Date.now() - 1000);
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(connectedChannel());

        const result = await new WebhookReceiptReconcilerJob().execute();

        expect(result.processed).toBe(1);
        expect(mockMessage.create).toHaveBeenCalledTimes(1);
        expect(receipts()[0].status).toBe('QUEUED');
        expect(receipts()[0].shop_id).toBe(SHOP_ID);
    });

    test('a still-unresolved Page advances the backoff ladder rather than resetting it', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(null);
        await post(buildPayload()).expect(200);
        expect(receipts()[0].retry_count).toBe(0);

        receipts()[0].next_retry_at = new Date(Date.now() - 1000);
        await new WebhookReceiptReconcilerJob().execute();

        expect(receipts()[0].status).toBe('IDENTITY_NOT_RESOLVED');
        expect(receipts()[0].retry_count).toBe(1);
    });

    test('an unresolved Page is dead-lettered once the ladder is exhausted', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(null);
        await post(buildPayload()).expect(200);

        for (let i = 0; i < receiptService.MAX_IDENTITY_RETRIES; i += 1) {
            receipts()[0].next_retry_at = new Date(Date.now() - 1000);
            await new WebhookReceiptReconcilerJob().execute();
        }

        expect(receipts()[0].status).toBe('DEAD_LETTERED');
        expect(alertCalls.some((a) => a.title.includes('DEAD-LETTERED'))).toBe(true);
    });
});

// ── 5. Message-store failure (F-03) ──────────────────────────────────────────

describe('message storage failure', () => {
    beforeEach(() => {
        mockMessage.create.mockRejectedValue(new Error('deadlock detected'));
    });

    test('a store failure records a durable retryable failure, not a silent drop', async () => {
        await post(buildPayload()).expect(200);

        const r = receipts()[0];
        expect(r.status).toBe('RETRY_PENDING');
        expect(r.retry_count).toBe(1);
        expect(r.next_retry_at).toBeInstanceOf(Date);
    });

    test('a store failure never marks the receipt processed', async () => {
        await post(buildPayload()).expect(200);
        expect(receipts()[0].status).not.toBe('PROCESSED');
        expect(receipts()[0].processed_at ?? null).toBeNull();
    });

    test('a store failure alerts without leaking the message body or PSID', async () => {
        await post(buildPayload()).expect(200);
        const serialized = JSON.stringify(alertCalls);
        expect(serialized).not.toContain(MESSAGE_TEXT);
        expect(serialized).not.toContain(SENDER_PSID);
    });

    test('the retry succeeds exactly once and stores exactly one message', async () => {
        await post(buildPayload()).expect(200);
        mockMessage.create.mockResolvedValue({ id: 'msg-retry', metadata: {}, toJSON: () => ({ id: 'msg-retry' }) });

        receipts()[0].next_retry_at = new Date(Date.now() - 1000);
        const first = await new WebhookReceiptReconcilerJob().execute();
        expect(first.processed).toBe(1);
        expect(receipts()[0].status).toBe('QUEUED');

        // A second sweep must not replay a settled receipt.
        const second = await new WebhookReceiptReconcilerJob().execute();
        expect(second.claimed).toBe(0);
        expect(mockMessage.create).toHaveBeenCalledTimes(2); // 1 failed + 1 successful retry
    });

    test('retry exhaustion moves the event to the dead-letter state and alerts', async () => {
        await post(buildPayload()).expect(200);

        for (let i = 0; i < receiptService.MAX_STORE_RETRIES; i += 1) {
            receipts()[0].next_retry_at = new Date(Date.now() - 1000);
            await new WebhookReceiptReconcilerJob().execute();
        }

        expect(receipts()[0].status).toBe('DEAD_LETTERED');
        expect(alertCalls.some((a) => a.title.includes('DEAD-LETTERED'))).toBe(true);
        expect(await receiptService.countDeadLettered()).toBe(1);
    });
});

// ── 6. Non-business events are accounted for, not ignored ────────────────────

describe('non-business events', () => {
    test('an echo is recorded and skipped', async () => {
        await post(buildPayload({}, {
            sender: { id: PAGE_ID },
            recipient: { id: SENDER_PSID },
            message: { mid: 'mid.ECHO', text: 'hi', is_echo: true },
        })).expect(200);
        expect(receipts()[0].status).toBe('SKIPPED');
        expect(receipts()[0].last_error_code).toBe('ECHO');
        expect(mockMessage.create).not.toHaveBeenCalled();
    });

    test('a delivery receipt is recorded and skipped', async () => {
        await post({
            object: 'page',
            entry: [{ id: PAGE_ID, messaging: [{ sender: { id: SENDER_PSID }, delivery: { watermark: 1 } }] }],
        }).expect(200);
        expect(receipts()[0].event_type).toBe('delivery');
        expect(receipts()[0].status).toBe('SKIPPED');
    });

    test('a skipped event carries no retained payload', async () => {
        await post(buildPayload({}, {
            sender: { id: PAGE_ID },
            recipient: { id: SENDER_PSID },
            message: { mid: 'mid.ECHO2', text: 'hi', is_echo: true },
        })).expect(200);
        expect(receipts()[0].payload_encrypted).toBeNull();
    });
});

// ── 7. Operational logging carries no customer content ───────────────────────

describe('operational logging', () => {
    test('no message body or secret reaches the logs on the unresolved path', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(null);
        await post(buildPayload()).expect(200);

        const serialized = JSON.stringify(logCalls);
        expect(serialized).not.toContain(MESSAGE_TEXT);
        expect(serialized).not.toContain(APP_SECRET);
        expect(serialized).not.toContain(process.env.CHANNEL_ENCRYPTION_KEY);
    });

    test('the stored replay payload is encrypted, not plaintext', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(null);
        await post(buildPayload()).expect(200);

        const blob = receipts()[0].payload_encrypted;
        expect(typeof blob).toBe('string');
        expect(blob).toMatch(/^v1:/);
        expect(blob).not.toContain(MESSAGE_TEXT);
        expect(blob).not.toContain(SENDER_PSID);
    });
});

describe('malformed webhook boundary', () => {
    test('rejects malformed bytes with an invalid signature before receipt or business work', async () => {
        const rawBody = Buffer.from('{"object":');

        await postRaw(rawBody, 'sha256=invalidsignature').expect(403);

        expect(MockReceipt.create).not.toHaveBeenCalled();
        expect(mockMetaChannelService.findByMetaAssetId).not.toHaveBeenCalled();
        expect(mockMessage.create).not.toHaveBeenCalled();
    });

    test('acks authenticated malformed bytes without persisting the raw body', async () => {
        const rawBody = Buffer.from('{"object":');

        await postRaw(rawBody).expect(200);

        expect(MockReceipt.create).not.toHaveBeenCalled();
        expect(mockMetaChannelService.findByMetaAssetId).not.toHaveBeenCalled();
        expect(mockMessage.create).not.toHaveBeenCalled();

        const serializedLogs = JSON.stringify(logCalls);
        expect(serializedLogs).not.toContain(rawBody.toString());
        expect(serializedLogs).toContain('INVALID_JSON');
    });
});

// ── 7. Conversation metering key ─────────────────────────────────────────────

describe('conversation usage metering', () => {
    // usage_events.request_id is a uuid column in production. A prefixed key
    // ("conv:<uuid>") makes Postgres reject the insert, and the failure is
    // swallowed as non-fatal — so billing silently records nothing.
    const CONV_UUID = 'ce4d0458-e5a7-464a-9ebd-b6dc589c4a20';

    beforeEach(() => {
        mockConversation.create.mockResolvedValue({ id: CONV_UUID, update: jest.fn() });
        mockMessage.create.mockResolvedValue({
            id: 'msg-1', conversation_id: CONV_UUID, metadata: {}, toJSON: () => ({ id: 'msg-1' }),
        });
    });

    test('meters a new conversation with the bare conversation id as the idempotency key', async () => {
        await post(buildPayload()).expect(200);

        expect(mockTrackUsage).toHaveBeenCalledTimes(1);
        const [shopId, usageType, amount, requestId] = mockTrackUsage.mock.calls[0];
        expect(shopId).toBe(SHOP_ID);
        expect(usageType).toBe('conversations');
        expect(amount).toBe(1);
        expect(requestId).toBe(CONV_UUID);
    });

    test('the idempotency key is a bare uuid a uuid column will accept', async () => {
        await post(buildPayload()).expect(200);

        const requestId = mockTrackUsage.mock.calls[0][3];
        expect(requestId).not.toMatch(/^conv:/);
        expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
});
