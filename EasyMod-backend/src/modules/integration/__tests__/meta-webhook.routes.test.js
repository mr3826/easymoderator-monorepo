/**
 * Meta Webhook Routes — Unit Tests (Phase 5 canonical-only rewrite)
 *
 * Covers: storeIncomingMessage (conversation pipeline), webhook GET verification,
 * and incoming webhook POST routing.
 *
 * Phase 5: MetaIntegration is gone. All channel resolution goes through
 * MetaChannelService (meta_channels table). metaReadFromNew flag is removed.
 */

// ── Environment ────────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-jwt-access-secret-32chars!!';
process.env.META_APP_SECRET = 'test-app-secret';
process.env.META_WEBHOOK_VERIFY_TOKEN = 'global-verify-token';
// Durable webhook receipts encrypt their replay body with this key.
process.env.CHANNEL_ENCRYPTION_KEY = 'b'.repeat(64);
// ── Mocks (before any require) ─────────────────────────────────────────────────

jest.mock('src/config/redis', () => ({
    sessionRedis: null, cacheRedis: null, rateLimitRedis: null,
    closeAllRedis: jest.fn(), checkRedisAvailability: jest.fn(() => ({}))
}));

jest.mock('rate-limit-redis', () => ({ RedisStore: jest.fn() }));

jest.mock('src/utils/structured-logger', () => ({
    createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }))
}));

// Mock config — metaReadFromNew / metaWriteLegacy removed in Phase 5
jest.mock('src/config/config', () => ({
    metaWebhookAppSecret: null,  // legacy alias; override per test
    jwtAccessSecret: 'test-jwt-access-secret-32chars!!',
    metaAppId: 'test-app-id',
    metaAppSecret: 'test-app-secret',
    metaOAuthRedirectUri: 'https://example.com/callback'
}));

// ── Entity mocks ───────────────────────────────────────────────────────────────

// Phase 5: MetaChannel replaces MetaIntegration for all channel resolution.
const mockMetaChannelEntity = {
    findOne: jest.fn(),
    findAll: jest.fn(),
};
jest.mock('src/modules/channel-providers/meta-channel.entity', () => mockMetaChannelEntity);

// MetaChannelService.findByMetaAssetId is the canonical resolution path.
const mockMetaChannelService = {
    findByMetaAssetId: jest.fn(),
};
jest.mock('src/modules/channel-providers/meta-channel.service', () => mockMetaChannelService);

const mockCustomer = { findOne: jest.fn(), findOrCreate: jest.fn(), update: jest.fn(), destroy: jest.fn() };
const mockConversation = { findOne: jest.fn(), create: jest.fn() };
const mockMessage = { findOne: jest.fn(), create: jest.fn() };

jest.mock('src/modules/entities', () => ({
    Customer: mockCustomer,
    Conversation: mockConversation,
    Message: mockMessage,
}));

jest.mock('src/modules/conversation/conversation.entity', () => ({
    Conversation: mockConversation,
    Message: mockMessage,
}));

const mockTransaction = { LOCK: { UPDATE: 'UPDATE' } };
jest.mock('src/utils/database/database-setup', () => ({
    sequelize: {
        define: jest.fn(() => ({
            findOne: jest.fn(), findAll: jest.fn(), create: jest.fn(), update: jest.fn(),
            belongsTo: jest.fn(), hasMany: jest.fn(), hasOne: jest.fn(), belongsToMany: jest.fn(),
            addScope: jest.fn(), scope: jest.fn(function () { return this; })
        })),
        transaction: jest.fn(async (fn) => fn(mockTransaction)),
        authenticate: jest.fn(), sync: jest.fn(),
        literal: jest.fn(s => s)
    }
}));

// Consent service — fire-and-forget, always resolves
jest.mock('src/modules/consent/consent.service', () => ({
    isStopKeyword: jest.fn(() => false),
    recordInbound: jest.fn().mockResolvedValue(undefined),
    recordOptOut: jest.fn().mockResolvedValue(undefined),
    recordOptIn: jest.fn().mockResolvedValue(undefined),
}));

const mockCustomerProfileService = {
    enrichCustomerNameFromMeta: jest.fn(),
    isPlaceholderName: jest.fn(),
};
jest.mock('src/modules/customer/customer-profile.service', () => mockCustomerProfileService);

// SSE manager — no-op
jest.mock('src/utils/sse-manager', () => ({
    emit: jest.fn(),
}));

// BullMQ message queue — no-op
jest.mock('src/jobs/message-queue', () => ({
    messageQueue: { add: jest.fn().mockResolvedValue(undefined) },
}));

// Global fetch mock
global.fetch = jest.fn();

// ── Requires (after mocks) ─────────────────────────────────────────────────────
const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const config = require('src/config/config');

let app;
let storeIncomingMessage;

beforeAll(() => {
    const webhookRouter = require('src/modules/integration/meta-webhook.routes');
    storeIncomingMessage = webhookRouter.storeIncomingMessage;

    app = express();
    app.use('/webhooks/meta', webhookRouter);
});

// ── Fixtures ───────────────────────────────────────────────────────────────────
const SHOP_ID = 'shop-uuid-1';
const PAGE_ID = 'page-111';
const CONV_ID = 'conv-uuid-1';
const CUSTOMER_ID = 'cust-uuid-1';
const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const isGenericCustomerName = (name) => {
    if (!name) return true;
    const normalized = String(name).trim().toLowerCase();
    return normalized === 'customer'
        || normalized.startsWith('customer ')
        || normalized === 'facebook user'
        || normalized === 'messenger user'
        || normalized === 'instagram user';
};

const buildMetaChannel = (overrides = {}) => ({
    id: 'mc-1',
    shop_id: SHOP_ID,
    platform: 'facebook',
    meta_asset_id: PAGE_ID,
    status: 'CONNECTED',
    display_name: 'Test Page',
    ...overrides,
});

const buildConversation = (overrides = {}) => ({
    id: CONV_ID,
    shop_id: SHOP_ID,
    customer_id: CUSTOMER_ID,
    channel: 'messenger',
    update: jest.fn().mockResolvedValue(undefined),
    ...overrides,
});

const buildMessage = (overrides = {}) => ({
    id: 'msg-uuid-1',
    conversation_id: CONV_ID,
    sender: 'customer',
    content: 'Hello',
    external_id: 'mid.12345',
    created_at: new Date(),
    ...overrides,
});

// ── storeIncomingMessage ───────────────────────────────────────────────────────

describe('storeIncomingMessage', () => {
    const baseEvent = {
        platform: 'facebook',
        shop_id: SHOP_ID,
        meta_channel_id: 'mc-1',
        sender: 'sender-fb-123',
        message: 'Hello there',
        attachments: [],
        timestamp: new Date(),
        raw_event: { message: { mid: 'mid.ABCDE', text: 'Hello there' } }
    };

    const customer = {
        id: CUSTOMER_ID,
        name: 'Facebook User',
        metadata: { source: 'webhook', platform: 'facebook', external_id: 'sender-fb-123', channel: 'Facebook' },
        update: jest.fn().mockResolvedValue(undefined),
    };
    const conversation = buildConversation();
    const msgRecord = buildMessage({ id: 'msg-new' });

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

        mockCustomer.findOrCreate.mockResolvedValue([customer, true]);
        mockConversation.findOne.mockResolvedValue(null);
        mockConversation.create.mockResolvedValue(conversation);
        mockMessage.findOne.mockResolvedValue(null);
        mockMessage.create.mockResolvedValue(msgRecord);
        mockCustomerProfileService.enrichCustomerNameFromMeta.mockResolvedValue(true);
        mockCustomerProfileService.isPlaceholderName.mockImplementation(isGenericCustomerName);
    });

    it('creates customer, conversation and message on first message', async () => {
        const result = await storeIncomingMessage(baseEvent);

        expect(mockCustomer.findOrCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ shop_id: SHOP_ID, channel_type: 'messenger', channel_user_id: 'sender-fb-123' }),
                transaction: mockTransaction
            })
        );
        expect(mockConversation.create).toHaveBeenCalled();
        expect(mockMessage.create).toHaveBeenCalledWith(
            expect.objectContaining({ content: 'Hello there', sender: 'customer', external_id: 'mid.ABCDE' }),
            expect.objectContaining({ transaction: mockTransaction })
        );
        expect(result).toMatchObject({ customer_id: CUSTOMER_ID, conversation_id: CONV_ID });
    });

    it('triggers Meta profile enrichment for a new Facebook tester customer', async () => {
        await storeIncomingMessage(baseEvent);

        expect(mockCustomer.findOrCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                defaults: expect.objectContaining({
                    name: 'Facebook User',
                    channel_user_id: 'sender-fb-123',
                    metadata: expect.objectContaining({
                        platform: 'facebook',
                        external_id: 'sender-fb-123',
                        channel: 'Facebook',
                    }),
                }),
            })
        );
        expect(mockCustomerProfileService.enrichCustomerNameFromMeta).toHaveBeenCalledWith({
            customerId: CUSTOMER_ID,
            metaChannelId: 'mc-1',
            shopId: SHOP_ID,
            platform: 'messenger',
            psid: 'sender-fb-123',
        });
    });

    it('triggers enrichment for an existing generic Facebook customer', async () => {
        const existingGenericCustomer = {
            id: CUSTOMER_ID,
            name: 'facebook user',
            metadata: { source: 'webhook', platform: 'facebook' },
            update: jest.fn().mockResolvedValue(undefined),
        };
        mockCustomer.findOrCreate.mockResolvedValue([existingGenericCustomer, false]);

        await storeIncomingMessage(baseEvent);

        expect(mockCustomerProfileService.enrichCustomerNameFromMeta).toHaveBeenCalledWith({
            customerId: CUSTOMER_ID,
            metaChannelId: 'mc-1',
            shopId: SHOP_ID,
            platform: 'messenger',
            psid: 'sender-fb-123',
        });
    });

    it('keeps a safe fallback customer when enrichment fails', async () => {
        const existingGenericCustomer = {
            id: CUSTOMER_ID,
            name: 'facebook user',
            metadata: { source: 'webhook', platform: 'facebook' },
            update: jest.fn().mockResolvedValue(undefined),
        };
        mockCustomer.findOrCreate.mockResolvedValue([existingGenericCustomer, false]);
        mockCustomerProfileService.enrichCustomerNameFromMeta.mockResolvedValue(false);

        await storeIncomingMessage(baseEvent);
        await flushPromises();

        expect(existingGenericCustomer.update).toHaveBeenCalledWith({
            name: 'Facebook User',
            metadata: expect.objectContaining({
                source: 'webhook',
                platform: 'facebook',
                external_id: 'sender-fb-123',
                channel: 'Facebook',
            }),
        });
    });

    it('maps facebook platform to messenger channel_type', async () => {
        await storeIncomingMessage(baseEvent);

        expect(mockCustomer.findOrCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ channel_type: 'messenger' })
            })
        );
    });

    it('reuses the existing active conversation within 24h window', async () => {
        mockConversation.findOne.mockResolvedValue(conversation);

        await storeIncomingMessage(baseEvent);

        expect(mockConversation.create).not.toHaveBeenCalled();
        expect(mockMessage.create).toHaveBeenCalledWith(
            expect.objectContaining({ conversation_id: CONV_ID }),
            expect.anything()
        );
    });

    it('creates a new conversation when none exists within 24h', async () => {
        mockConversation.findOne.mockResolvedValue(null);

        await storeIncomingMessage(baseEvent);

        expect(mockConversation.create).toHaveBeenCalledWith(
            expect.objectContaining({ shop_id: SHOP_ID, customer_id: CUSTOMER_ID, channel: 'messenger' }),
            expect.objectContaining({ transaction: mockTransaction })
        );
    });

    it('skips duplicate message by external_id (idempotency)', async () => {
        const existingMsg = buildMessage({ id: 'existing-msg', conversation_id: CONV_ID });
        mockMessage.findOne.mockResolvedValue(existingMsg);

        const result = await storeIncomingMessage(baseEvent);

        expect(mockCustomer.findOrCreate).not.toHaveBeenCalled();
        expect(result.message_id).toBe('existing-msg');
    });

    it('proceeds without idempotency check when raw_event has no message ID', async () => {
        const eventNoMid = { ...baseEvent, raw_event: { message: { text: 'hi' } } };
        await storeIncomingMessage(eventNoMid);

        expect(mockMessage.findOne).not.toHaveBeenCalled();
        expect(mockMessage.create).toHaveBeenCalled();
    });

    it('returns correct shape: customer_id, customer_name, conversation_id, message_id', async () => {
        const result = await storeIncomingMessage(baseEvent);
        expect(result).toHaveProperty('customer_id');
        expect(result).toHaveProperty('conversation_id');
        expect(result).toHaveProperty('message_id');
    });

    it('rethrows on DB error so the caller can log it', async () => {
        mockCustomer.findOrCreate.mockRejectedValue(new Error('DB connection lost'));

        await expect(storeIncomingMessage(baseEvent)).rejects.toThrow('DB connection lost');
    });
});

// ── GET /webhooks/meta (webhook verification) ──────────────────────────────────

describe('GET /webhooks/meta (webhook verification)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default: no channel found
        mockMetaChannelEntity.findOne.mockResolvedValue(null);
    });

    it('returns 403 when hub.mode is not subscribe', async () => {
        await request(app)
            .get('/webhooks/meta')
            .query({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'any-token', 'hub.challenge': 'ch1' })
            .expect(403);
    });

    it('returns 403 when verify_token is missing', async () => {
        await request(app)
            .get('/webhooks/meta')
            .query({ 'hub.mode': 'subscribe', 'hub.challenge': 'ch1' })
            .expect(403);
    });

    it('returns 403 when verify_token does not match any MetaChannel', async () => {
        mockMetaChannelEntity.findOne.mockResolvedValue(null);
        await request(app)
            .get('/webhooks/meta')
            .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'ch1' })
            .expect(403);
    });

    it('returns 200 with challenge when verify_token matches a MetaChannel', async () => {
        mockMetaChannelEntity.findOne.mockResolvedValue(
            buildMetaChannel({ webhook_verify_token: 'tenant-token-xyz' })
        );

        const res = await request(app)
            .get('/webhooks/meta')
            .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tenant-token-xyz', 'hub.challenge': 'ch-tenant' })
            .expect(200);

        expect(res.text).toBe('ch-tenant');
    });
});

// ── POST /webhooks/meta (incoming webhook) ─────────────────────────────────────

const POST_APP_SECRET = 'post-test-app-secret';

describe('POST /webhooks/meta (incoming webhook)', () => {
    const buildPagePayload = (overrides = {}) => ({
        object: 'page',
        entry: [{
            id: PAGE_ID,
            messaging: [{
                sender: { id: 'fb-user-789' },
                recipient: { id: PAGE_ID },
                timestamp: Date.now(),
                message: { mid: 'mid.XYZ', text: 'Order status?' }
            }]
        }],
        ...overrides
    });

    // Helper that sends with a valid signature for the POST_APP_SECRET
    const sendWebhookWithSig = (payload) => {
        const body = Buffer.from(JSON.stringify(payload));
        const sig = 'sha256=' + require('crypto').createHmac('sha256', POST_APP_SECRET).update(body).digest('hex');
        return request(app)
            .post('/webhooks/meta')
            .set('Content-Type', 'application/octet-stream')
            .set('x-hub-signature-256', sig)
            .send(body);
    };

    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch.mockResolvedValue({ ok: true });

        // Set app secret so the router processes the payload instead of rejecting.
        // The signature check is exercised by sendWebhookWithSig.
        config.metaAppSecret = POST_APP_SECRET;
        config.metaWebhookAppSecret = POST_APP_SECRET;

        // Default: channel found via MetaChannelService
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(buildMetaChannel());
        mockMetaChannelEntity.findOne.mockResolvedValue(null); // SSE fallback — not needed

        mockCustomer.findOrCreate.mockResolvedValue([{ id: CUSTOMER_ID }, true]);
        mockConversation.findOne.mockResolvedValue(null);
        mockConversation.create.mockResolvedValue(buildConversation());
        mockMessage.findOne.mockResolvedValue(null);
        mockMessage.create.mockResolvedValue(buildMessage());
        mockCustomerProfileService.enrichCustomerNameFromMeta.mockResolvedValue(true);
        mockCustomerProfileService.isPlaceholderName.mockImplementation(isGenericCustomerName);
    });

    afterEach(() => {
        config.metaAppSecret = 'test-app-secret';
        config.metaWebhookAppSecret = null;
    });

    // Acknowledgement contract: 200 once the event is durably recorded, 5xx only
    // when the durable receipt itself could not be written. See
    // meta-webhook-durability.test.js for the full F-02/F-03 matrix.
    it('returns 200 once the event is durably recorded', async () => {
        await sendWebhookWithSig(buildPagePayload()).expect(200);
    });

    it('returns 200 when MetaChannel is missing (the event is held, not dropped)', async () => {
        mockMetaChannelService.findByMetaAssetId.mockResolvedValue(null);
        await sendWebhookWithSig(buildPagePayload()).expect(200);
    });

    it('returns 200 for unrecognised object type', async () => {
        await sendWebhookWithSig({ object: 'user', entry: [] }).expect(200);
    });

    it('routes page events and stores the incoming message', async () => {
        await sendWebhookWithSig(buildPagePayload()).expect(200);
        expect(mockMessage.create).toHaveBeenCalled();
    });

    it('skips echo events (page own outbound messages)', async () => {
        const echoPayload = buildPagePayload();
        echoPayload.entry[0].messaging[0].message.is_echo = true;

        await sendWebhookWithSig(echoPayload).expect(200);
        expect(mockMessage.create).not.toHaveBeenCalled();
    });

    it('skips non-message events (read receipts, delivery reports)', async () => {
        const noMsgPayload = {
            object: 'page',
            entry: [{
                id: PAGE_ID,
                messaging: [{
                    sender: { id: 'fb-user-789' },
                    recipient: { id: PAGE_ID },
                    timestamp: Date.now(),
                    delivery: { watermark: 12345 }
                }]
            }]
        };
        await sendWebhookWithSig(noMsgPayload).expect(200);
        expect(mockMessage.create).not.toHaveBeenCalled();
    });

    it('ignores page feed/comment changes (Messenger-only launch)', async () => {
        const feedPayload = {
            object: 'page',
            entry: [{
                id: PAGE_ID,
                changes: [{
                    field: 'feed',
                    value: {
                        item: 'comment',
                        comment_id: 'cmt-1',
                        post_id: 'post-1',
                        from: { id: 'fb-user-789' },
                        message: 'price?',
                    },
                }],
            }],
        };

        await sendWebhookWithSig(feedPayload).expect(200);
        expect(mockMessage.create).not.toHaveBeenCalled();
    });

    it('ignores instagram events (Facebook-only launch) — acks 200 without storing', async () => {
        // Instagram was removed from product scope (2026-06-24). The dispatcher
        // only handles object:'page'; an 'instagram' payload is acknowledged so
        // Meta does not retry, but no message is stored.
        const igPayload = {
            object: 'instagram',
            entry: [{
                id: 'ig-acct-111',
                messaging: [{
                    sender: { id: 'ig-user-999' },
                    recipient: { id: 'ig-acct-111' },
                    timestamp: Date.now(),
                    message: { mid: 'ig.mid.ABC', text: 'Hi from IG' }
                }]
            }]
        };
        await sendWebhookWithSig(igPayload).expect(200);
        expect(mockMessage.create).not.toHaveBeenCalled();
    });

    it('returns 200 when message storage fails — the receipt keeps it retryable', async () => {
        mockMessage.create.mockRejectedValue(new Error('DB write failed'));

        await sendWebhookWithSig(buildPagePayload()).expect(200);
    });

    it('rejects webhook with invalid signature when META_APP_SECRET is set', async () => {
        await request(app)
            .post('/webhooks/meta')
            .set('Content-Type', 'application/octet-stream')
            .set('x-hub-signature-256', 'sha256=invalidsignature')
            .send(Buffer.from(JSON.stringify(buildPagePayload())))
            .expect(403);
    });

    it('accepts webhook with valid HMAC-SHA256 signature', async () => {
        await sendWebhookWithSig(buildPagePayload()).expect(200);
    });
});
